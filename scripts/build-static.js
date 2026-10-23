// Builds a static copy of the site into dist/ for GitHub Pages: runs one
// refresh (or uses demo data when no Anthropic key is set) and writes the
// feed to dist/feed.json next to the frontend.
import fs from "node:fs";
import path from "node:path";
import { root, loadConfig } from "../src/config.js";
import { Store } from "../src/store.js";
import { Pipeline } from "../src/pipeline.js";
import { feedPayload } from "../src/feed.js";
import { demoStore } from "../src/demo-data.js";

const config = loadConfig();
const demo = process.env.DEMO === "1" || !process.env.ANTHROPIC_API_KEY;
const store = new Store(path.join(root, "data/store.json"));

if (demo) {
  console.log("No ANTHROPIC_API_KEY: building with demo data");
  store.data = demoStore();
} else {
  const { added, summarized } = await new Pipeline(store, config).refresh();
  console.log(`Refreshed: ${added} new, ${summarized} summarised`);
}

const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, "public"), dist, { recursive: true });

const feed = feedPayload(store, config, { demo, publicOnly: true });
fs.writeFileSync(path.join(dist, "feed.json"), JSON.stringify(feed));

const indexPath = path.join(dist, "index.html");
fs.writeFileSync(indexPath, fs.readFileSync(indexPath, "utf8").replace('<html lang="no">', '<html lang="no" data-static>'));
console.log(`Wrote ${dist}`);

// Surface the result as annotations on the Actions run page.
if (process.env.GITHUB_ACTIONS) {
  const items = store.all();
  const summarised = items.filter((i) => i.ai).length;
  console.log(
    `::notice title=Nabonytt::${demo ? "DEMO data. " : ""}${items.length} items, ${summarised} summarised, ${feed.items.length} stories shown after folding duplicates, digest: ${store.data.digest ? "yes" : "no"}`,
  );
  for (const [name, s] of Object.entries(store.data.sources)) {
    if (!s.ok) console.log(`::warning title=Source failed: ${name}::${s.error}`);
  }
  if (!demo && items.length > 0 && summarised === 0) {
    console.log("::warning title=No AI summaries::Check the ANTHROPIC_API_KEY secret and your credit balance");
  }
}
