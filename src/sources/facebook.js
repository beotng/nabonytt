import fs from "node:fs";
import path from "node:path";
import { itemId } from "../store.js";

const GRAPH_VERSION = process.env.FB_GRAPH_VERSION || "v23.0";

/**
 * Posts from a public Facebook *Page* via the Graph API. Needs a token with
 * access to the page (your own page, or an app approved for Page Public
 * Content Access). Facebook *groups* are not readable this way.
 */
export async function fetchFacebookPage(page, token) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(page.id)}/posts`);
  url.searchParams.set("fields", "message,created_time,permalink_url,full_picture");
  url.searchParams.set("limit", "25");
  url.searchParams.set("access_token", token);

  const res = await fetch(url, { signal: AbortSignal.timeout(15_000) });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Graph API ${res.status}`);

  return (body.data ?? [])
    .filter((p) => p.message)
    .map((p) => toItem(page.name, p.id, p.message, p.permalink_url, p.created_time, p.full_picture));
}

/**
 * Posts exported from Facebook groups or pages (by hand, or with a scraper
 * export) as JSON files. Accepts an array of objects with common field names:
 * text/message/postText, url/postUrl/permalink_url, time/created_time/date, image.
 */
export function loadFacebookImports(dir) {
  if (!fs.existsSync(dir)) return [];
  const items = [];
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const posts = Array.isArray(raw) ? raw : raw.posts ?? [];
    const sourceName = raw.source ?? path.basename(file, ".json");
    for (const p of posts) {
      const text = p.text ?? p.message ?? p.postText;
      if (!text) continue;
      const url = p.url ?? p.postUrl ?? p.permalink_url ?? null;
      const time = p.time ?? p.created_time ?? p.date ?? p.timestamp;
      items.push(toItem(p.groupTitle ?? sourceName, p.id ?? url ?? text.slice(0, 80), text, url, time, p.image ?? null));
    }
  }
  return items;
}

function toItem(source, key, text, url, time, image) {
  const ts = typeof time === "number" && time < 1e12 ? time * 1000 : time;
  const date = new Date(ts ?? Date.now());
  return {
    id: itemId("facebook", key),
    sourceType: "facebook",
    source,
    title: "",
    text: String(text).slice(0, 3000),
    url,
    image,
    publishedAt: (isNaN(date) ? new Date() : date).toISOString(),
  };
}
