#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const ROOT = process.cwd();
const BASELINE_PATH = "scripts/quality-guardrails-baseline.json";
const UPDATE_BASELINE = process.env.CODEUX_GUARDRAIL_UPDATE_BASELINE === "1";

const OVERSIZED_LINE_THRESHOLD = 1000;
const PRODUCTION_ROOTS = ["src", "dashboard/src"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".mts", ".cts"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".cache",
  "coverage",
  "dist",
  "node_modules",
  ".next",
  ".vite",
]);

const BACKUP_ARTIFACT_PATTERNS = [
  /\.bak$/i,
  /\.backup$/i,
  /\.orig$/i,
  /\.rej$/i,
  /~$/,
];

const execFileAsync = promisify(execFile);

function toPosixPath(filePath) {
  return filePath.split(path.sep).join("/");
}

function repoPath(filePath) {
  return toPosixPath(path.relative(ROOT, filePath));
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function listFiles(directory) {
  const files = [];
  if (!(await pathExists(directory))) {
    return files;
  }

  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        files.push(...await listFiles(absolutePath));
      }
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }
  return files;
}

function isTestPath(relativePath) {
  const normalized = relativePath.toLowerCase();
  return normalized.includes("/__tests__/")
    || normalized.includes("/tests/")
    || normalized.endsWith(".test.ts")
    || normalized.endsWith(".test.tsx")
    || normalized.endsWith(".spec.ts")
    || normalized.endsWith(".spec.tsx");
}

function isProductionSource(relativePath) {
  return SOURCE_EXTENSIONS.has(path.extname(relativePath))
    && !isTestPath(relativePath);
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function countBroadAnyPatterns(source) {
  const code = stripComments(source);
  const broadAnyPattern = /\bas\s+any\b|:\s*any\s*\[\]|:\s*any\b|<\s*any\s*>|,\s*any\b|\bany\s*\[\]/g;
  return code.match(broadAnyPattern)?.length ?? 0;
}

function countLines(source) {
  if (source.length === 0) {
    return 0;
  }
  const newlineCount = source.match(/\n/g)?.length ?? 0;
  return source.endsWith("\n") ? newlineCount : newlineCount + 1;
}

async function scanProductionSources() {
  const allFiles = [];
  for (const root of PRODUCTION_ROOTS) {
    allFiles.push(...await listFiles(path.join(ROOT, root)));
  }

  const oversizedProductionFiles = {};
  const broadAnyPatterns = {};

  for (const absolutePath of allFiles) {
    const relativePath = repoPath(absolutePath);
    if (!isProductionSource(relativePath)) {
      continue;
    }

    const source = await readFile(absolutePath, "utf8");
    const lineCount = countLines(source);
    const broadAnyCount = countBroadAnyPatterns(source);

    if (lineCount > OVERSIZED_LINE_THRESHOLD) {
      oversizedProductionFiles[relativePath] = lineCount;
    }
    if (broadAnyCount > 0) {
      broadAnyPatterns[relativePath] = broadAnyCount;
    }
  }

  return {
    oversizedProductionFiles: sortRecord(oversizedProductionFiles),
    broadAnyPatterns: sortRecord(broadAnyPatterns),
  };
}

function sortRecord(record) {
  return Object.fromEntries(Object.entries(record).sort(([left], [right]) => left.localeCompare(right)));
}

async function readBaseline() {
  const absoluteBaselinePath = path.join(ROOT, BASELINE_PATH);
  if (!(await pathExists(absoluteBaselinePath))) {
    throw new Error(`Missing quality guardrails baseline: ${BASELINE_PATH}. Run CODEUX_GUARDRAIL_UPDATE_BASELINE=1 pnpm run quality:guardrails after approving the current counts.`);
  }
  const parsed = JSON.parse(await readFile(absoluteBaselinePath, "utf8"));
  return {
    oversizedLineThreshold: Number(parsed.oversizedLineThreshold),
    oversizedProductionFiles: parsed.oversizedProductionFiles ?? {},
    broadAnyPatterns: parsed.broadAnyPatterns ?? {},
  };
}

async function writeBaseline(scan) {
  const baseline = {
    description: "Ratchet baseline for production-file size and broad TypeScript any usage. Update intentionally with CODEUX_GUARDRAIL_UPDATE_BASELINE=1 pnpm run quality:guardrails.",
    oversizedLineThreshold: OVERSIZED_LINE_THRESHOLD,
    productionRoots: PRODUCTION_ROOTS,
    oversizedProductionFiles: scan.oversizedProductionFiles,
    broadAnyPatterns: scan.broadAnyPatterns,
  };
  const absoluteBaselinePath = path.join(ROOT, BASELINE_PATH);
  await mkdir(path.dirname(absoluteBaselinePath), { recursive: true });
  await writeFile(absoluteBaselinePath, `${JSON.stringify(baseline, null, 2)}\n`);
  console.log(`Updated ${BASELINE_PATH}`);
}

async function scanBackupArtifacts() {
  const trackedFiles = await listTrackedFiles();
  const files = await listFiles(ROOT);
  return files
    .map(repoPath)
    .filter((relativePath) => !relativePath.startsWith(".git/"))
    .filter((relativePath) => !trackedFiles.has(relativePath))
    .filter((relativePath) => BACKUP_ARTIFACT_PATTERNS.some((pattern) => pattern.test(relativePath)))
    .sort((left, right) => left.localeCompare(right));
}

async function listTrackedFiles() {
  try {
    const { stdout } = await execFileAsync("git", ["ls-files"], { cwd: ROOT });
    return new Set(stdout.split(/\r?\n/).filter(Boolean));
  } catch {
    return new Set();
  }
}

function compareAgainstBaseline(scan, baseline) {
  const failures = [];

  if (baseline.oversizedLineThreshold !== OVERSIZED_LINE_THRESHOLD) {
    failures.push(`Oversized file threshold changed from baseline ${baseline.oversizedLineThreshold} to ${OVERSIZED_LINE_THRESHOLD}. Update the baseline intentionally if this is approved.`);
  }

  for (const [relativePath, lineCount] of Object.entries(scan.oversizedProductionFiles)) {
    const baselineLineCount = baseline.oversizedProductionFiles[relativePath];
    if (baselineLineCount === undefined) {
      failures.push(`${relativePath} has ${lineCount} lines, exceeding the ${OVERSIZED_LINE_THRESHOLD}-line production threshold with no baseline entry.`);
      continue;
    }
    if (lineCount > baselineLineCount) {
      failures.push(`${relativePath} grew from baseline ${baselineLineCount} lines to ${lineCount} lines.`);
    }
  }

  for (const [relativePath, broadAnyCount] of Object.entries(scan.broadAnyPatterns)) {
    const baselineAnyCount = baseline.broadAnyPatterns[relativePath] ?? 0;
    if (broadAnyCount > baselineAnyCount) {
      failures.push(`${relativePath} broad any count increased from ${baselineAnyCount} to ${broadAnyCount}.`);
    }
  }

  return failures;
}

async function main() {
  const backupArtifacts = await scanBackupArtifacts();
  if (backupArtifacts.length > 0) {
    console.error("Quality guardrails failed: backup artifacts are present:");
    for (const artifact of backupArtifacts) {
      console.error(`- ${artifact}`);
    }
    process.exitCode = 1;
    return;
  }

  const scan = await scanProductionSources();

  if (UPDATE_BASELINE) {
    await writeBaseline(scan);
    return;
  }

  const baseline = await readBaseline();
  const failures = compareAgainstBaseline(scan, baseline);
  if (failures.length > 0) {
    console.error("Quality guardrails failed:");
    for (const failure of failures) {
      console.error(`- ${failure}`);
    }
    console.error("");
    console.error("If this drift is intentional and approved, run CODEUX_GUARDRAIL_UPDATE_BASELINE=1 pnpm run quality:guardrails and commit the updated baseline.");
    process.exitCode = 1;
    return;
  }

  console.log("Quality guardrails passed.");
  console.log(`Oversized production files at or below baseline: ${Object.keys(scan.oversizedProductionFiles).length}`);
  console.log(`Production files with broad any patterns at or below baseline: ${Object.keys(scan.broadAnyPatterns).length}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
