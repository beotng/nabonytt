import Parser from "rss-parser";
import { itemId } from "../store.js";

const parser = new Parser({
  timeout: 15_000,
  headers: { "User-Agent": "Nabonytt/1.0 (local news digest)" },
  customFields: { item: [["media:content", "media"], ["enclosure", "enclosure"]] },
});

const stripHtml = (s = "") =>
  s.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();

/**
 * Google News titles look like "Headline - Altaposten". Split off the outlet
 * so the item is credited to it, and mark it as coming via the aggregator.
 */
export function splitAggregatorTitle(item) {
  if (!/google/i.test(item.source)) return item;
  const m = item.title.match(/^(.*\S)\s+[-–]\s+([^-–]+)$/);
  if (!m) return { ...item, via: item.source };
  return { ...item, title: m[1], source: m[2].trim(), via: item.source };
}

export async function fetchRss(feed) {
  const parsed = await parser.parseURL(feed.url);
  return parsed.items.slice(0, 40).map((entry) => {
    const url = entry.link ?? entry.guid ?? "";
    return splitAggregatorTitle({
      id: itemId("rss", url || entry.title),
      sourceType: "rss",
      source: feed.name,
      title: stripHtml(entry.title),
      text: stripHtml(entry.contentSnippet || entry.content || entry.summary || "").slice(0, 2000),
      url,
      image: entry.enclosure?.url ?? entry.media?.$?.url ?? null,
      publishedAt: new Date(entry.isoDate || entry.pubDate || Date.now()).toISOString(),
    });
  });
}
