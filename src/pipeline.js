import { fetchRss } from "./sources/rss.js";
import { fetchFacebookPage, loadFacebookImports } from "./sources/facebook.js";
import { summarizeItems, buildDigest } from "./ai.js";

const MAX_SUMMARIES_PER_REFRESH = 72;
const MAX_ATTEMPTS = 3;

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

    const results = await Promise.allSettled(jobs.map((j) => j.run()));
    let added = 0;
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
    store.prune();
    store.save();
    console.log(`[fetch] ${added} new items`);

    const summarized = await this.summarizePending();
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
}
