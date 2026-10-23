import { fetchRss, splitAggregatorTitle } from "./sources/rss.js";
import { fetchFacebookPage, loadFacebookImports } from "./sources/facebook.js";
import { summarizeItems, buildDigest, findSameStories } from "./ai.js";

const MAX_SUMMARIES_PER_REFRESH = 72;
const MAX_ATTEMPTS = 3;
const SOURCE_TIMEOUT_MS = 30_000;
const DEDUPE_WINDOW_MS = 3 * 86_400_000;
const DEDUPE_MAX_ITEMS = 150;

/** Rejects if a source takes too long, so one slow site can't stall a refresh. */
function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Which copy of a story to show: a direct feed over an aggregator, then the earliest. */
function pickPrimary(items) {
  return [...items].sort(
    (a, b) => Boolean(a.via) - Boolean(b.via) || new Date(a.publishedAt) - new Date(b.publishedAt),
  )[0];
}

/** Merges groups that share an item, so each item ends up in at most one group. */
function mergeGroups(groups) {
  const merged = [];
  for (const ids of groups) {
    const set = new Set(ids);
    for (let i = merged.length - 1; i >= 0; i--) {
      if ([...merged[i]].some((id) => set.has(id))) {
        for (const id of merged[i]) set.add(id);
        merged.splice(i, 1);
      }
    }
    merged.push(set);
  }
  return merged.map((s) => [...s]);
}

export class Pipeline {
  constructor(store, config) {
    this.store = store;
    this.config = config;
    this.running = null;
  }

  /** Runs one refresh; concurrent callers share the in-flight run. */
  refresh() {
    this.running ??= this.#run().finally(() => (this.running = null));
    return this.running;
  }

  async #run() {
    const { store, config } = this;
    const jobs = [
      ...config.rss.map((feed) => ({ name: feed.name, type: "rss", run: () => fetchRss(feed) })),
      ...config.facebook.pages.map((page) => ({
        name: page.name,
        type: "facebook",
        run: () => {
          if (!process.env.FB_ACCESS_TOKEN) throw new Error("FB_ACCESS_TOKEN not set");
          return fetchFacebookPage(page, process.env.FB_ACCESS_TOKEN);
        },
      })),
      { name: "Facebook-import", type: "facebook", run: async () => loadFacebookImports(config.facebook.importDir) },
    ];

    const results = await Promise.allSettled(jobs.map((j) => withTimeout(j.run(), SOURCE_TIMEOUT_MS)));
    let added = 0;
    store.data.sources = {};
    results.forEach((r, i) => {
      const { name, type } = jobs[i];
      const at = new Date().toISOString();
      if (r.status === "fulfilled") {
        added += store.upsert(r.value);
        store.data.sources[name] = { type, ok: true, count: r.value.length, at };
      } else {
        store.data.sources[name] = { type, ok: false, error: r.reason?.message ?? String(r.reason), at };
        console.warn(`[fetch] ${name}: ${r.reason?.message}`);
      }
    });
    // Items stored before aggregator titles were split get the same treatment.
    for (const item of store.all()) if (item.sourceType === "rss" && !item.via) Object.assign(item, splitAggregatorTitle(item));
    store.prune();
    store.save();
    console.log(`[fetch] ${added} new items`);

    const summarized = await this.summarizePending();
    if (summarized > 0 || !store.data.dedupedAt) await this.dedupe();
    if (summarized > 0 || !store.data.digest) {
      try {
        const digest = await buildDigest(store.all(), config.location);
        if (digest) store.data.digest = digest;
      } catch (err) {
        console.error(`[ai] digest: ${err.message}`);
      }
    }
    store.data.lastRefresh = new Date().toISOString();
    store.save();
    return { added, summarized };
  }

  async summarizePending() {
    const { store } = this;
    const pending = store.unsummarized().slice(0, MAX_SUMMARIES_PER_REFRESH);
    if (pending.length === 0) return 0;

    let results = new Map();
    try {
      results = await summarizeItems(pending, this.config.location, {
        onBatch: (partial) => {
          for (const [id, ai] of partial) store.setSummary(id, ai);
          store.save();
        },
      });
    } catch {
      // Fatal (auth) error: already logged; leave items for the next refresh.
      return 0;
    }
    for (const item of pending) {
      if (results.has(item.id)) continue;
      const stored = store.data.items[item.id];
      stored.aiAttempts = (stored.aiAttempts ?? 0) + 1;
      if (stored.aiAttempts >= MAX_ATTEMPTS) store.markFailed(item.id);
    }
    store.save();
    console.log(`[ai] summarised ${results.size}/${pending.length}`);
    return results.size;
  }

  /** Marks items that repeat a story already in the feed with `dupOf`. */
  async dedupe() {
    const { store } = this;
    const recent = store
      .all()
      .filter((i) => i.ai && Date.now() - new Date(i.publishedAt) < DEDUPE_WINDOW_MS)
      .slice(0, DEDUPE_MAX_ITEMS);
    if (recent.length < 2) return;

    let groups;
    try {
      groups = await findSameStories(recent, this.config.location);
    } catch (err) {
      console.error(`[ai] dedupe: ${err.message}`);
      return;
    }
    for (const item of recent) delete store.data.items[item.id].dupOf;
    groups = mergeGroups(groups);
    for (const ids of groups) {
      const primary = pickPrimary(ids.map((id) => store.data.items[id]));
      for (const id of ids) if (id !== primary.id) store.data.items[id].dupOf = primary.id;
    }
    store.data.dedupedAt = new Date().toISOString();
    store.save();
    console.log(`[ai] ${groups.length} stories covered more than once`);
  }
}
