import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const MAX_AGE_DAYS = 14;

export function itemId(sourceType, key) {
  return crypto.createHash("sha1").update(`${sourceType}:${key}`).digest("hex").slice(0, 16);
}

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { items: {}, digest: null, sources: {}, lastRefresh: null };
    try {
      this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, "utf8")) };
    } catch {
      // First run, or unreadable store: start empty.
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    fs.renameSync(tmp, this.file);
  }

  /** Adds items not seen before; returns how many were new. */
  upsert(items) {
    let added = 0;
    for (const item of items) {
      if (!this.data.items[item.id]) {
        this.data.items[item.id] = { ...item, ai: null };
        added++;
      }
    }
    return added;
  }

  setSummary(id, ai) {
    if (this.data.items[id]) this.data.items[id].ai = ai;
  }

  unsummarized() {
    return this.all().filter((i) => !i.ai && !i.aiFailed);
  }

  markFailed(id) {
    if (this.data.items[id]) this.data.items[id].aiFailed = true;
  }

  all() {
    return Object.values(this.data.items).sort(
      (a, b) => new Date(b.publishedAt) - new Date(a.publishedAt),
    );
  }

  prune() {
    const cutoff = Date.now() - MAX_AGE_DAYS * 86_400_000;
    for (const [id, item] of Object.entries(this.data.items)) {
      if (new Date(item.publishedAt).getTime() < cutoff) delete this.data.items[id];
    }
  }
}
