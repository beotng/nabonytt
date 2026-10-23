import express from "express";
import path from "node:path";
import { root, loadConfig } from "./config.js";
import { Store, itemId } from "./store.js";
import { Pipeline } from "./pipeline.js";
import { feedPayload } from "./feed.js";
import { demoStore } from "./demo-data.js";

const config = loadConfig();
const DEMO = process.env.DEMO === "1";
const PORT = Number(process.env.PORT) || 3000;

const store = new Store(path.join(root, DEMO ? "data/demo-store.json" : "data/store.json"));
if (DEMO) store.data = demoStore();
const pipeline = new Pipeline(store, config);

const app = express();
app.use(express.json({ limit: "20kb" }));
app.use(express.static(path.join(root, "public")));

app.get("/api/feed", (_req, res) => {
  res.json(feedPayload(store, config, { demo: DEMO, refreshing: Boolean(pipeline.running) }));
});

app.post("/api/refresh", async (_req, res) => {
  if (DEMO) return res.json({ added: 0, summarized: 0, demo: true });
  try {
    res.json(await pipeline.refresh());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const tipLog = new Map();
app.post("/api/tips", async (req, res) => {
  const text = String(req.body?.text ?? "").trim();
  const url = String(req.body?.url ?? "").trim();
  if (text.length < 15 || text.length > 3000) {
    return res.status(400).json({ error: "Teksten må være mellom 15 og 3000 tegn." });
  }
  if (url && !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Lenken må starte med http:// eller https://" });
  }
  const now = Date.now();
  const recent = (tipLog.get(req.ip) ?? []).filter((t) => now - t < 3_600_000);
  if (recent.length >= 10) return res.status(429).json({ error: "For mange tips. Prøv igjen senere." });
  tipLog.set(req.ip, [...recent, now]);

  const item = {
    id: itemId("tips", `${text}:${now}`),
    sourceType: "tips",
    source: String(req.body?.source ?? "").trim().slice(0, 80) || "Tips fra leser",
    title: "",
    text,
    url: url || null,
    image: null,
    publishedAt: new Date().toISOString(),
  };
  store.upsert([item]);
  if (DEMO) {
    store.setSummary(item.id, {
      headline: text.split(/[.!?\n]/)[0].slice(0, 70),
      summary: "(Demo-modus: ingen AI-oppsummering.) " + text.slice(0, 200),
      category: "other",
      funScore: 5,
      localScore: 8,
      emoji: "📌",
    });
  } else {
    store.save();
    await pipeline.summarizePending();
  }
  res.json({ item: store.data.items[item.id] });
});

app.listen(PORT, () => {
  console.log(`Nabonytt for ${config.location.name} on http://localhost:${PORT}${DEMO ? " (demo mode)" : ""}`);
  if (DEMO) return;
  pipeline.refresh().catch((err) => console.error(err));
  setInterval(() => pipeline.refresh().catch((err) => console.error(err)), config.refreshMinutes * 60_000);
});
