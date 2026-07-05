#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
const duplicateMinLines = readPositiveInt("CODEUX_GUARDRAIL_DUPLICATE_MIN_LINES", 80);
const duplicateMinTokens = readPositiveInt("CODEUX_GUARDRAIL_DUPLICATE_MIN_TOKENS", 700);

const broadAnyPattern =
  /(^|[^A-Za-z0-9_$])(?:as\s+any\b|:\s*any\b|<any\b|Array<\s*any\s*>|Promise<\s*any\s*>|Record<[^>\n]*\bany\b|\bany\[\])/;
const heavySnapshotEventTypes = [
  "project.live.updated",
  "project.execution.updated",
  "project.runtime_status.updated",
  "projects.updated",
  "overview.telemetry.updated",
];
const dependencyFactoryPlaceholderPatterns = [
  {
    name: "{} as any",
    pattern: /\{\s*\}\s+as\s+any\b/g,
    remediation:
      "Use createLateBoundDependency<T>() plus resolveLateBoundDependency(), or pass a typed concrete dependency.",
  },
  {
    name: "{} as unknown",
    pattern: /\{\s*\}\s+as\s+unknown\b/g,
    remediation:
      "Use createLateBoundDependency<T>() for construction-order links instead of an empty placeholder cast.",
  },
  {
    name: "{} as any/unknown as T",
    pattern: /\{\s*\}\s+as\s+(?:any|unknown)\s+as\s+[A-Za-z_$][\w$]*(?:<[^;\n]+>)?/g,
    remediation:
      "Replace double-cast placeholders with a LateBoundDependency<T> holder or a real typed instance.",
  },
  {
    name: "{} as service-like dependency",
    pattern: /\{\s*\}\s+as\s+[A-Za-z_$][\w$]*(?:Service|Repository|Handler|Manager|Runner|Factory|Dependencies)\b/g,
    remediation:
      "Do not cast empty objects to service dependencies; wire an actual implementation or a LateBoundDependency<T>.",
  },
];
const optimisticInsertionCallPattern =
  /\bsetOptimisticTasks\s*\([\s\S]{0,240}?=>\s*\[\s*([A-Za-z_$][\w$]*)\s*,\s*\.\.\.[A-Za-z_$][\w$]*\s*\]/;
const realtimeFiles = [
  "src/repositories/dashboard-realtime-event-repository.ts",
  "src/services/dashboard-realtime-service.ts",
];
const optimisticInsertionFiles = [
  "dashboard/src/v2/TasksPage.tsx",
  "dashboard/src/v2/lib/tasks/task-board-actions.ts",
];

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
    !basename.endsWith(".d.ts") &&
    !relativePath.includes("/fixtures/") &&
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

function lineNumberAt(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function compactMatch(value) {
  return value.trim().replace(/\s+/g, " ");
}

async function collectProductionFiles() {
  const files = [];
  for (const sourceRoot of [...productionRoots, ...scriptRoots]) {
    files.push(...(await walkFiles(sourceRoot)));
  }

  return files.filter(isProductionTypeScriptFile).sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
}

function stripInlineComments(line, state) {
  let output = "";
  let quote = "";
  let escaped = false;

  for (let index = 0; index < line.length; index += 1) {
    const current = line[index];
    const next = line[index + 1] ?? "";

    if (state.inBlockComment) {
      if (current === "*" && next === "/") {
        state.inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === "\\") {
        escaped = true;
      } else if (current === quote) {
        quote = "";
      }
      continue;
    }

    if (current === "\"" || current === "'" || current === "`") {
      quote = current;
      output += current;
      continue;
    }

    if (current === "/" && next === "*") {
      state.inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "/") {
      break;
    }

    output += current;
  }

  return output;
}

function braceDelta(line) {
  let delta = 0;
  for (const char of line) {
    if (char === "{" || char === "(" || char === "[") {
      delta += 1;
    } else if (char === "}" || char === ")" || char === "]") {
      delta -= 1;
    }
  }
  return delta;
}

function normalizeImplementationLine(line) {
  const trimmed = line.trim();
  if (!trimmed) {
    return "";
  }

  if (
    /^import\b/.test(trimmed) ||
    /^export\s+\{/.test(trimmed) ||
    /^export\s+type\b/.test(trimmed) ||
    /^declare\b/.test(trimmed)
  ) {
    return "";
  }

  if (/^(?:export\s+)?(?:interface|type)\b/.test(trimmed)) {
    return "";
  }

  if (/^(?:public|private|protected|readonly|static|abstract)\s*[\w$]+\??\s*[:;]/.test(trimmed)) {
    return "";
  }

  if (/^<[A-Za-z][^>]*\bclassName\s*=/.test(trimmed) || /\bclassName\s*=\s*["'`][^"'`]*["'`]/.test(trimmed)) {
    return "";
  }

  if (/^[{}()[\],.;:]+$/.test(trimmed)) {
    return "";
  }

  return trimmed
    .replace(/\bclassName\s*=\s*(?:"[^"]*"|'[^']*'|`[^`]*`|\{[^}]*\})/g, "className=CLASS")
    .replace(/(["'`])(?:\\.|(?!\1).)*\1/g, "STR")
    .replace(/\s+/g, " ")
    .replace(/\s*([{}()[\],.;:+\-*/%<>=!?|&])\s*/g, "$1");
}

function tokenizeNormalizedLine(line) {
  return line.match(/[A-Za-z_$][\w$]*|\d+(?:\.\d+)?|STR|=>|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||[{}()[\],.;:+\-*/%<>=!?|&]/g) ?? [];
}

function normalizeSourceForDuplicateScan(source) {
  const lines = source.text.split(/\r?\n/);
  const normalizedLines = [];
  const commentState = { inBlockComment: false };
  let typeBlockDepth = 0;

  lines.forEach((rawLine, index) => {
    const commentFreeLine = stripInlineComments(rawLine, commentState);
    const trimmed = commentFreeLine.trim();

    if (typeBlockDepth > 0) {
      typeBlockDepth += braceDelta(trimmed);
      if (typeBlockDepth <= 0 || /[};]\s*$/.test(trimmed)) {
        typeBlockDepth = 0;
      }
      return;
    }

    if (/^(?:export\s+)?(?:interface|type)\b/.test(trimmed)) {
      const delta = braceDelta(trimmed);
      if (delta > 0 && !/[};]\s*$/.test(trimmed)) {
        typeBlockDepth = delta;
      }
      return;
    }

    const normalized = normalizeImplementationLine(commentFreeLine);
    if (!normalized) {
      return;
    }

    const tokens = tokenizeNormalizedLine(normalized);
    if (tokens.length < 2) {
      return;
    }

    normalizedLines.push({
      path: source.path,
      originalLine: index + 1,
      text: normalized,
      tokenCount: tokens.length,
    });
  });

  return normalizedLines;
}

function windowsOverlap(first, second, lineCount) {
  if (first.path !== second.path) {
    return false;
  }

  return first.index < second.index + lineCount && second.index < first.index + lineCount;
}

function occurrenceKey(occurrence) {
  return `${occurrence.path}:${occurrence.index}`;
}

function compareOccurrenceOrder(first, second) {
  return first.path.localeCompare(second.path) || first.startLine - second.startLine || first.index - second.index;
}

function expandDuplicateWindow(normalizedLines, first, second, minimumLines) {
  let lineCount = minimumLines;
  let tokenCount = 0;

  for (let offset = 0; offset < minimumLines; offset += 1) {
    tokenCount += normalizedLines[first.index + offset].tokenCount;
  }

  while (
    first.index + lineCount < normalizedLines.length &&
    second.index + lineCount < normalizedLines.length &&
    normalizedLines[first.index + lineCount].path === first.path &&
    normalizedLines[second.index + lineCount].path === second.path &&
    normalizedLines[first.index + lineCount].text === normalizedLines[second.index + lineCount].text
  ) {
    tokenCount += normalizedLines[first.index + lineCount].tokenCount;
    lineCount += 1;
  }

  return { lineCount, tokenCount };
}

function markCovered(covered, occurrence, lineCount) {
  for (let offset = 0; offset < lineCount; offset += 1) {
    const line = occurrence.startLine + offset;
    if (!covered.has(occurrence.path)) {
      covered.set(occurrence.path, new Set());
    }
    covered.get(occurrence.path).add(line);
  }
}

function isCovered(covered, occurrence, lineCount) {
  const coveredLines = covered.get(occurrence.path);
  if (!coveredLines) {
    return false;
  }

  for (let offset = 0; offset < lineCount; offset += 1) {
    if (coveredLines.has(occurrence.startLine + offset)) {
      return true;
    }
  }

  return false;
}

export function findDuplicateImplementationBlocks(sources, options = {}) {
  const minimumLines = options.minimumLines ?? duplicateMinLines;
  const minimumTokens = options.minimumTokens ?? duplicateMinTokens;
  const normalizedLines = sources
    .flatMap(normalizeSourceForDuplicateScan)
    .sort((a, b) => a.path.localeCompare(b.path) || a.originalLine - b.originalLine);
  const windows = new Map();

  for (let index = 0; index <= normalizedLines.length - minimumLines; index += 1) {
    let tokenCount = 0;
    const windowLines = [];
    const sourcePath = normalizedLines[index].path;

    for (let offset = 0; offset < minimumLines; offset += 1) {
      const line = normalizedLines[index + offset];
      if (line.path !== sourcePath) {
        tokenCount = 0;
        break;
      }
      tokenCount += line.tokenCount;
      windowLines.push(line.text);
    }

    if (tokenCount < minimumTokens) {
      continue;
    }

    const key = windowLines.join("\n");
    const occurrence = {
      path: normalizedLines[index].path,
      line: normalizedLines[index].originalLine,
      startLine: normalizedLines[index].originalLine,
      index,
      tokenCount,
    };
    const existing = windows.get(key) ?? [];
    existing.push(occurrence);
    windows.set(key, existing);
  }

  const candidates = [];
  for (const occurrences of windows.values()) {
    if (occurrences.length < 2) {
      continue;
    }

    const sortedOccurrences = occurrences.sort(compareOccurrenceOrder);
    for (let firstIndex = 0; firstIndex < sortedOccurrences.length; firstIndex += 1) {
      for (let secondIndex = firstIndex + 1; secondIndex < sortedOccurrences.length; secondIndex += 1) {
        const first = sortedOccurrences[firstIndex];
        const second = sortedOccurrences[secondIndex];
        if (occurrenceKey(first) === occurrenceKey(second) || windowsOverlap(first, second, minimumLines)) {
          continue;
        }
        const expanded = expandDuplicateWindow(normalizedLines, first, second, minimumLines);
        if (expanded.tokenCount < minimumTokens) {
          continue;
        }
        candidates.push({ first, second, ...expanded });
        break;
      }
    }
  }

  const covered = new Map();
  return candidates
    .sort((a, b) => b.lineCount - a.lineCount || compareOccurrenceOrder(a.second, b.second))
    .filter((candidate) => {
      if (isCovered(covered, candidate.first, candidate.lineCount) || isCovered(covered, candidate.second, candidate.lineCount)) {
        return false;
      }
      markCovered(covered, candidate.first, candidate.lineCount);
      markCovered(covered, candidate.second, candidate.lineCount);
      return true;
    })
    .map((candidate) => ({
      path: candidate.second.path,
      line: candidate.second.line,
      pattern: "duplicate implementation block",
      lineCount: candidate.lineCount,
      tokenCount: candidate.tokenCount,
      match: `${candidate.lineCount} normalized lines / ${candidate.tokenCount} tokens duplicated from ${candidate.first.path}:${candidate.first.line}`,
      remediation:
        "Extract the shared implementation behind a named helper or consolidate the duplicated branches so behavior changes in one place.",
    }));
}

async function inspectDuplicateImplementationBlocks(files) {
  const sources = await Promise.all(files.map(async (filePath) => ({
    path: toRelative(filePath),
    text: await readFile(filePath, "utf8"),
  })));

  return findDuplicateImplementationBlocks(sources);
}

async function collectArtifactFiles() {
  const files = [];
  for (const artifactRoot of artifactRoots) {
    files.push(...(await walkFiles(artifactRoot)));
  }

  return files.filter(isBackupArtifact).sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
}

async function collectDependencyFactoryFiles() {
  const files = await walkFiles("src/app/dependency-factory");
  return files
    .filter((filePath) => path.extname(filePath) === ".ts")
    .sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
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

async function inspectDependencyFactoryFile(filePath) {
  const text = await readFile(filePath, "utf8");
  const violations = [];

  for (const placeholder of dependencyFactoryPlaceholderPatterns) {
    placeholder.pattern.lastIndex = 0;
    for (const match of text.matchAll(placeholder.pattern)) {
      violations.push({
        path: toRelative(filePath),
        line: lineNumberAt(text, match.index ?? 0),
        pattern: placeholder.name,
        match: compactMatch(match[0]),
        remediation: placeholder.remediation,
      });
    }
  }

  return violations;
}

async function inspectRealtimeSnapshotPersistence() {
  const violations = [];
  const [repositoryRelativePath, serviceRelativePath] = realtimeFiles;
  const repositoryPath = path.join(root, repositoryRelativePath);
  const servicePath = path.join(root, serviceRelativePath);
  const [repositoryText, serviceText] = await Promise.all([
    readFile(repositoryPath, "utf8"),
    readFile(servicePath, "utf8"),
  ]);

  if (!/if\s*\(\s*replayable\s*\)\s*\{[\s\S]{0,2000}INSERT\s+INTO\s+dashboard_realtime_events/.test(repositoryText)) {
    violations.push({
      path: toRelative(repositoryPath),
      line: lineNumberAt(repositoryText, repositoryText.indexOf("INSERT INTO dashboard_realtime_events")),
      pattern: "replayable-gated dashboard_realtime_events INSERT",
      match: "INSERT INTO dashboard_realtime_events",
      remediation:
        "Persist only replayable realtime events; non-replayable heavy snapshots should update in-memory sequence watermarks without writing payload_json.",
    });
  }

  const buildPublishTaskIndex = serviceText.indexOf("private buildPublishTask");
  const buildPublishTaskPublishIndex = serviceText.indexOf("this.publishRawEvent({", buildPublishTaskIndex);
  const buildPublishTaskPublishEnd = serviceText.indexOf("});", buildPublishTaskPublishIndex);
  const buildPublishTaskPublishBlock =
    buildPublishTaskPublishIndex >= 0 && buildPublishTaskPublishEnd >= 0
      ? serviceText.slice(buildPublishTaskPublishIndex, buildPublishTaskPublishEnd + 3)
      : "";

  if (!/\breplayable:\s*false\b/.test(buildPublishTaskPublishBlock)) {
    violations.push({
      path: toRelative(servicePath),
      line: lineNumberAt(serviceText, buildPublishTaskPublishIndex >= 0 ? buildPublishTaskPublishIndex : buildPublishTaskIndex),
      pattern: "buildPublishTask replayable: false",
      match: compactMatch(buildPublishTaskPublishBlock || "this.publishRawEvent({ ... })"),
      remediation:
        "Snapshot publish tasks must call publishRawEvent with replayable: false so heavy snapshot payloads are never replay-persisted.",
    });
  }

  const directPublishPattern = /this\.publishRawEvent\s*\(\s*\{[\s\S]*?\}\s*\)/g;
  for (const match of serviceText.matchAll(directPublishPattern)) {
    const block = match[0];
    if (!heavySnapshotEventTypes.some((eventType) => block.includes(`"${eventType}"`))) {
      continue;
    }
    if (/\bpayload\b/.test(block) && !/\breplayable:\s*false\b/.test(block)) {
      const eventType = heavySnapshotEventTypes.find((candidate) => block.includes(`"${candidate}"`)) ?? "heavy snapshot";
      violations.push({
        path: toRelative(servicePath),
        line: lineNumberAt(serviceText, match.index ?? 0),
        pattern: `${eventType} direct publishRawEvent replayability`,
        match: compactMatch(block),
        remediation:
          "Do not publish heavy snapshot payloads as replayable raw events; route them through buildPublishTask or set replayable: false.",
      });
    }
  }

  return violations;
}

async function inspectDuplicateOptimisticInsertions() {
  const violations = [];

  for (const relativePath of optimisticInsertionFiles) {
    const filePath = path.join(root, relativePath);
    let text;
    try {
      text = await readFile(filePath, "utf8");
    } catch (error) {
      if (error && error.code === "ENOENT") {
        continue;
      }
      throw error;
    }

    const calls = [];
    const callPattern = /setOptimisticTasks\s*\([\s\S]*?\);/g;
    for (const match of text.matchAll(callPattern)) {
      const block = match[0];
      const insertionMatch = optimisticInsertionCallPattern.exec(block);
      if (!insertionMatch) {
        continue;
      }
      calls.push({
        path: relativePath,
        line: lineNumberAt(text, match.index ?? 0),
        insertedSymbol: insertionMatch[1],
        match: compactMatch(block),
      });
    }

    for (let index = 1; index < calls.length; index += 1) {
      const previous = calls[index - 1];
      const current = calls[index];
      if (previous.insertedSymbol === current.insertedSymbol && current.line - previous.line <= 8) {
        violations.push({
          path: current.path,
          line: current.line,
          pattern: "duplicate adjacent optimistic insertion",
          match: current.match,
          remediation:
            "Keep one optimistic insertion for a newly created task; remove the duplicate adjacent setOptimisticTasks call or centralize insertion in one helper.",
        });
      }
    }
  }

  return violations;
}

function printList(items, renderItem) {
  for (const item of items.slice(0, topLimit)) {
    console.log(renderItem(item));
  }

  if (items.length > topLimit) {
    console.log(`  ... ${items.length - topLimit} more omitted; set CODEUX_GUARDRAIL_REPORT_LIMIT to expand`);
  }
}

async function main() {
  const [productionFiles, artifactFiles, dependencyFactoryFiles] = await Promise.all([
    collectProductionFiles(),
    collectArtifactFiles(),
    collectDependencyFactoryFiles(),
  ]);

  const [
    reports,
    dependencyFactoryViolationsNested,
    realtimeSnapshotViolations,
    optimisticInsertionViolations,
    duplicateImplementationViolations,
  ] = await Promise.all([
    Promise.all(productionFiles.map(inspectSourceFile)),
    Promise.all(dependencyFactoryFiles.map(inspectDependencyFactoryFile)),
    inspectRealtimeSnapshotPersistence(),
    inspectDuplicateOptimisticInsertions(),
    inspectDuplicateImplementationBlocks(productionFiles),
  ]);
  const dependencyFactoryViolations = dependencyFactoryViolationsNested.flat();
  const blockingViolations = [
    ...dependencyFactoryViolations,
    ...realtimeSnapshotViolations,
    ...optimisticInsertionViolations,
    ...duplicateImplementationViolations,
  ];
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
  console.log(`Duplicate thresholds: ${duplicateMinLines} normalized lines, ${duplicateMinTokens} tokens.`);

  if (artifactFiles.length > 0) {
    console.error("\nBlocking hygiene violations: source backup artifacts must be removed.");
    for (const artifactFile of artifactFiles) {
      console.error(`  - ${toRelative(artifactFile)}`);
    }
  }

  if (blockingViolations.length > 0) {
    console.error("\nBlocking quality guardrail violations:");
    printList(blockingViolations, (violation) => (
      `  - ${violation.path}:${violation.line} [${violation.pattern}] ${violation.match}\n` +
      `    Remediation: ${violation.remediation}`
    ));
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

  if (artifactFiles.length > 0 || blockingViolations.length > 0) {
    process.exit(1);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
