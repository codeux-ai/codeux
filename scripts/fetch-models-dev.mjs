#!/usr/bin/env node
// Prefetches the models.dev provider/model catalogue (pricing, limits, capabilities) and
// caches it locally under assets/models-dev/catalog.json. Run by CI on every push to
// main/dev (see .github/workflows/models-catalog.yml) so the running app never depends on
// network access to models.dev at runtime.

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SOURCE_URL = "https://models.dev/api.json";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outDir = path.join(projectRoot, "assets", "models-dev");
const outFile = path.join(outDir, "catalog.json");

function sortKeysDeep(value) {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value && typeof value === "object") {
    return Object.keys(value).sort().reduce((sorted, key) => {
      sorted[key] = sortKeysDeep(value[key]);
      return sorted;
    }, {});
  }
  return value;
}

async function main() {
  const response = await fetch(SOURCE_URL);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${SOURCE_URL}: ${response.status} ${response.statusText}`);
  }

  const catalog = await response.json();
  if (!catalog || typeof catalog !== "object" || Object.keys(catalog).length === 0) {
    throw new Error("Fetched models.dev catalogue is empty or malformed");
  }

  mkdirSync(outDir, { recursive: true });
  // Recursively sort object keys so the committed diff is minimal between CI runs
  // (a JSON.stringify array-replacer would filter nested keys instead of sorting them).
  writeFileSync(outFile, `${JSON.stringify(sortKeysDeep(catalog), null, 2)}\n`, "utf8");

  const providerCount = Object.keys(catalog).length;
  const modelCount = Object.values(catalog).reduce(
    (total, provider) => total + Object.keys(provider?.models ?? {}).length,
    0,
  );
  console.log(`Wrote ${outFile} (${providerCount} providers, ${modelCount} models)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
