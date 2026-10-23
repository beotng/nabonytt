const normTitle = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/**
 * Shows each story once. Items marked `dupOf` (by the AI grouping) or with the
 * same headline as an earlier-listed item are folded into the item they repeat,
 * which lists them under `alsoIn`.
 */
function foldDuplicates(all) {
  const items = all.map((i) => ({ ...i, alsoIn: [] }));
  const byId = new Map(items.map((i) => [i.id, i]));
  const byTitle = new Map();
  // Direct feeds first, so the aggregator copy is the one folded away.
  for (const item of [...items].sort((a, b) => Boolean(a.via) - Boolean(b.via))) {
    if (item.dupOf && byId.has(item.dupOf)) continue;
    delete item.dupOf;
    const key = item.sourceType === "rss" && item.title ? normTitle(item.title) : null;
    if (key && byTitle.has(key)) item.dupOf = byTitle.get(key);
    else if (key) byTitle.set(key, item.id);
  }
  for (const item of items) {
    if (!item.dupOf) continue;
    let primary = byId.get(item.dupOf);
    for (let hops = 0; primary?.dupOf && hops < 5; hops++) primary = byId.get(primary.dupOf);
    if (primary && !primary.dupOf) primary.alsoIn.push({ source: item.source, url: item.url });
  }
  return items.filter((i) => !i.dupOf);
}

/**
 * The JSON the frontend renders. With `publicOnly`, community posts are
 * reduced to their AI summary (raw post text and unsummarised posts are left
 * out), for publishing as a static site.
 */
export function feedPayload(store, config, { demo = false, refreshing = false, publicOnly = false } = {}) {
  let items = foldDuplicates(store.all()).slice(0, 300);
  if (publicOnly) {
    items = items
      .filter((i) => i.sourceType === "rss" || i.ai)
      .map((i) => (i.sourceType === "rss" ? i : { ...i, text: "" }));
  }
  return {
    location: config.location,
    demo,
    static: publicOnly,
    lastRefresh: store.data.lastRefresh,
    refreshing,
    digest: store.data.digest,
    sources: store.data.sources,
    items,
  };
}
