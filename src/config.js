import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function loadConfig() {
  const config = JSON.parse(fs.readFileSync(path.join(root, "config/sources.json"), "utf8"));
  config.facebook.importDir = path.resolve(root, config.facebook.importDir);
  return config;
}
