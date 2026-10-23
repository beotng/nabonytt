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
fs.writeFileSync(path.join(dist, "feed.json"), JSON.stringify(feedPayload(store, config, { demo, publicOnly: true })));

const indexPath = path.join(dist, "index.html");
fs.writeFileSync(indexPath, fs.readFileSync(indexPath, "utf8").replace('<html lang="no">', '<html lang="no" data-static>'));
console.log(`Wrote ${dist}`);
