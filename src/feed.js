/**
 * The JSON the frontend renders. With `publicOnly`, community posts are
 * reduced to their AI summary (raw post text and unsummarised posts are left
 * out), for publishing as a static site.
 */
export function feedPayload(store, config, { demo = false, refreshing = false, publicOnly = false } = {}) {
  let items = store.all().slice(0, 300);
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
