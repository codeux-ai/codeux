#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const productionRoots = ["src", "dashboard/src"];
const scriptRoots = ["scripts"];
const artifactRoots = [...productionRoots, ...scriptRoots, "docs"];
const sourceExtensions = new Set([".ts", ".tsx"]);
const artifactSuffixes = [".orig", ".rej", ".bak"];
const ignoredDirectoryNames = new Set([
  ".cache",
  ".git",
  "coverage",
  "dist",
  "node_modules",
]);

const defaultMaxLines = readPositiveInt("CODEUX_GUARDRAIL_MAX_LINES", 800);
const dashboardMaxLines = readPositiveInt("CODEUX_GUARDRAIL_DASHBOARD_MAX_LINES", defaultMaxLines);
const topLimit = readPositiveInt("CODEUX_GUARDRAIL_REPORT_LIMIT", 20);

const broadAnyPattern =
  /(^|[^A-Za-z0-9_$])(?:as\s+any\b|:\s*any\b|<any\b|Array<\s*any\s*>|Promise<\s*any\s*>|Record<[^>\n]*\bany\b|\bany\[\])/;

function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    console.error(`Invalid ${name}: expected a positive integer, received ${JSON.stringify(raw)}`);
    process.exit(2);
  }

  return parsed;
}

function toRelative(filePath) {
  return path.relative(root, filePath).split(path.sep).join("/");
}

function isIgnoredDirectory(dirent) {
  return dirent.isDirectory() && ignoredDirectoryNames.has(dirent.name);
}

async function walkFiles(rootDir) {
  const absoluteRoot = path.join(root, rootDir);
  const files = [];

  async function walk(current) {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return;
      }
      throw error;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (isIgnoredDirectory(entry)) {
        continue;
      }
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  }

  await walk(absoluteRoot);
  return files;
}

function isProductionTypeScriptFile(filePath) {
  const relativePath = toRelative(filePath);
  const extension = path.extname(filePath);
  const basename = path.basename(filePath);

  return (
    sourceExtensions.has(extension) &&
    !relativePath.includes("/__tests__/") &&
    !basename.endsWith(".test.ts") &&
    !basename.endsWith(".test.tsx") &&
    !basename.endsWith(".spec.ts") &&
    !basename.endsWith(".spec.tsx")
  );
}

function isBackupArtifact(filePath) {
  const basename = path.basename(filePath);
  return artifactSuffixes.some((suffix) => basename.endsWith(suffix)) || basename.endsWith("~");
}

function thresholdFor(filePath) {
  return toRelative(filePath).startsWith("dashboard/src/") ? dashboardMaxLines : defaultMaxLines;
}

async function collectProductionFiles() {
  const files = [];
  for (const sourceRoot of [...productionRoots, ...scriptRoots]) {
    files.push(...(await walkFiles(sourceRoot)));
  }

  return files.filter(isProductionTypeScriptFile).sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
}

async function collectArtifactFiles() {
  const files = [];
  for (const artifactRoot of artifactRoots) {
    files.push(...(await walkFiles(artifactRoot)));
  }

  return files.filter(isBackupArtifact).sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
}

async function inspectSourceFile(filePath) {
  const text = await readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  const lineCount = lines.length > 0 && lines.at(-1) === "" ? lines.length - 1 : lines.length;
  const broadAnyMatches = [];

  lines.forEach((line, index) => {
    if (broadAnyPattern.test(line)) {
      broadAnyMatches.push({
        line: index + 1,
        text: line.trim().replace(/\s+/g, " "),
      });
    }
  });

  return {
    path: toRelative(filePath),
    lineCount,
    threshold: thresholdFor(filePath),
    broadAnyMatches,
  };
}

function printList(items, renderItem) {
  for (const item of items.slice(0, topLimit)) {
    console.log(renderItem(item));
  }

  if (items.length > topLimit) {
    console.log(`  ... ${items.length - topLimit} more omitted; set CODEUX_GUARDRAIL_REPORT_LIMIT to expand`);
  }
}

const [productionFiles, artifactFiles] = await Promise.all([
  collectProductionFiles(),
  collectArtifactFiles(),
]);

const reports = await Promise.all(productionFiles.map(inspectSourceFile));
const oversizedFiles = reports
  .filter((report) => report.lineCount > report.threshold)
  .sort((a, b) => b.lineCount - a.lineCount || a.path.localeCompare(b.path));
const anyFiles = reports
  .filter((report) => report.broadAnyMatches.length > 0)
  .sort((a, b) => b.broadAnyMatches.length - a.broadAnyMatches.length || a.path.localeCompare(b.path));
const anyCount = anyFiles.reduce((total, report) => total + report.broadAnyMatches.length, 0);

console.log("Quality guardrails");
console.log(`Scanned ${productionFiles.length} production TypeScript/TSX files.`);
console.log(`Line thresholds: default ${defaultMaxLines}, dashboard ${dashboardMaxLines}.`);

if (artifactFiles.length > 0) {
  console.error("\nBlocking hygiene violations: source backup artifacts must be removed.");
  for (const artifactFile of artifactFiles) {
    console.error(`  - ${toRelative(artifactFile)}`);
  }
}

if (oversizedFiles.length > 0) {
  console.log(`\nAdvisory: ${oversizedFiles.length} files exceed the configured line threshold.`);
  printList(
    oversizedFiles,
    (report) => `  - ${report.path}: ${report.lineCount} lines (threshold ${report.threshold})`,
  );
} else {
  console.log("\nAdvisory: no files exceed the configured line threshold.");
}

if (anyFiles.length > 0) {
  console.log(`\nAdvisory: found ${anyCount} broad any patterns across ${anyFiles.length} files.`);
  printList(anyFiles, (report) => {
    const first = report.broadAnyMatches[0];
    const extra = report.broadAnyMatches.length > 1 ? `, +${report.broadAnyMatches.length - 1} more` : "";
    return `  - ${report.path}:${first.line}${extra} - ${first.text}`;
  });
} else {
  console.log("\nAdvisory: no broad any patterns found.");
}

if (artifactFiles.length > 0) {
  process.exit(1);
}
