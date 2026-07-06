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
const supplyChainScanExtensions = new Set([".ts", ".tsx", ".js", ".mjs", ".cjs"]);
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
const realtimeFingerprintHotPathFiles = [
  "src/services/dashboard-realtime-service.ts",
  "src/services/dashboard-realtime-payload-fingerprint.ts",
];
const executionRuntimeEventProjectionDirectory = "src/repositories/execution";
const executionRuntimeEventProjectionPathPattern =
  /^src\/repositories\/execution\/.*runtime-events-query\.ts$/;
const optimisticInsertionFiles = [
  "dashboard/src/v2/TasksPage.tsx",
  "dashboard/src/v2/lib/tasks/task-board-actions.ts",
];
const coverageThresholdConfigPath = "vitest.config.ts";
const minimumGlobalCoverageThresholds = {
  lines: 77.4,
  functions: 71.5,
  branches: 66.1,
  statements: 76.0,
};
const activityCacheServiceCoveragePath = "src/server/activity-cache-service.ts";
const minimumActivityCacheServiceLineThreshold = 80;
const requiredCoverageIncludePattern = "src/**/*.ts";
const coverageThresholdRemediationCommand = "pnpm run test:backend:coverage";
const directRealtimePayloadStringifyPattern =
  /JSON\.stringify\s*\(\s*(?:payload|snapshot|event\.payload|options\.payload)\s*(?:[,)]|\s*\))/g;
const runtimeEventTableReadPattern = /\bFROM\s+(task_run_events|sprint_run_events)\b/gi;
const requiredWorkflowInstallCommand = "pnpm install --frozen-lockfile --ignore-scripts";
const workflowRoots = [".github/workflows"];
const supplyChainRiskPatterns = [
  {
    name: "curl pipe to shell",
    pattern: /curl\b[^|;\n]*\|\s*(?:bash|sh)\b/,
    remediation:
      "Avoid piping downloaded content into a shell. Use a pinned package, checksum-verified asset, or add a narrow allowlist rationale for a bounded provider fallback installer.",
  },
  {
    name: "wget pipe to shell",
    pattern: /wget\b[^|;\n]*\|\s*(?:bash|sh)\b/,
    remediation:
      "Avoid piping downloaded content into a shell. Use a pinned package, checksum-verified asset, or add a narrow allowlist rationale for a bounded provider fallback installer.",
  },
  {
    name: "eval execution",
    pattern: /\beval\s*\(/,
    remediation:
      "Do not introduce eval-based execution paths. Use typed parsing or explicit command/argument arrays instead.",
  },
  {
    name: "shell-enabled child process",
    pattern: /(?:\bshell\s*:\s*true\b|\bcp\.exec\s*\()/,
    remediation:
      "Use the shared shell-free command runner, spawn/execFile with explicit argv, or add a narrow allowlist rationale for a bounded legacy cleanup path.",
  },
  {
    name: "privileged Docker",
    pattern: /\bdocker\b[^\n]*["'\s]--privileged\b|["'\s]--privileged\b[^\n]*\bdocker\b/,
    remediation:
      "Do not run privileged Docker containers. Add only the minimum capabilities or mounts required for the workflow.",
  },
];
const shellPipe = (downloadCommand, shellCommand) => `${downloadCommand} | ${shellCommand}`;
const childProcessExec = (prefix) => `${prefix}.exec`;
const supplyChainRiskAllowlist = [
  {
    path: "src/services/cli-docker-utils.ts",
    line:
      'return "if ensure_curl; then '
      + shellPipe("curl -fsSL https://claude.ai/install.sh", "bash")
      + ' && export PATH=\\"$HOME/.local/bin:$PATH\\"; else echo \\"provider-runner: curl unavailable; cannot install claude\\" >&2; fi";',
    rationale:
      "Bounded container-only provider CLI fallback installer for the documented Claude host; guarded by ensure_curl and used only when the provider command is absent.",
  },
  {
    path: "src/services/cli-docker-utils.ts",
    line:
      'return "if ensure_curl; then '
      + shellPipe("curl -fsSL https://opencode.ai/install", "bash")
      + ' && export PATH=\\"$HOME/.opencode/bin:$HOME/.local/bin:$PATH\\"; else echo \\"provider-runner: curl unavailable; cannot install opencode\\" >&2; fi";',
    rationale:
      "Bounded container-only provider CLI fallback installer for the documented OpenCode host; guarded by ensure_curl and used only when the provider command is absent.",
  },
  {
    path: "src/services/cli-docker-utils.ts",
    line:
      "return 'if ensure_curl; then "
      + shellPipe("curl -fsSL https://antigravity.google/cli/install.sh", "bash")
      + ' && export PATH="$HOME/.local/bin:$PATH"; else echo "provider-runner: curl unavailable; cannot install antigravity" >&2; fi\';',
    rationale:
      "Bounded container-only provider CLI fallback installer for the documented Antigravity host; guarded by ensure_curl and used only when the provider command is absent.",
  },
  {
    path: "src/server/terminal-routes.ts",
    line: `${childProcessExec("cp")}("docker ps -a -q --filter 'label=code-ux.login=true'", (err, stdout) => {`,
    rationale:
      "Legacy login-container cleanup invokes a constant docker query without user-controlled shell interpolation.",
  },
  {
    path: "src/server/terminal-routes.ts",
    line: `${childProcessExec("cp")}(\`docker rm -f -v \${containerIds.join(" ")}\`, (rmErr) => {`,
    rationale:
      "Legacy login-container cleanup removes IDs returned by docker ps; the exact shell use remains allowlisted until migrated to execFile.",
  },
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

function stripJavaScriptComments(text) {
  let output = "";
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
        output += current;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      } else if (current === "\n" || current === "\r") {
        output += current;
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

    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    output += current;
  }

  return output;
}

function findMatchingBrace(text, openIndex) {
  let depth = 0;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
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
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === "{") {
      depth += 1;
    } else if (current === "}") {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function findObjectPropertyBlock(text, propertyName, fromIndex = 0) {
  const propertyPattern = new RegExp(`\\b${propertyName}\\s*:`, "g");
  propertyPattern.lastIndex = fromIndex;
  const match = propertyPattern.exec(text);
  if (!match) {
    return null;
  }

  const openIndex = text.indexOf("{", propertyPattern.lastIndex);
  if (openIndex < 0) {
    return null;
  }

  const closeIndex = findMatchingBrace(text, openIndex);
  if (closeIndex < 0) {
    return null;
  }

  return {
    content: text.slice(openIndex + 1, closeIndex),
    contentStartIndex: openIndex + 1,
    openIndex,
    closeIndex,
  };
}

function splitTopLevelProperties(objectContent) {
  const properties = [];
  let depth = 0;
  let start = 0;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < objectContent.length; index += 1) {
    const current = objectContent[index];
    const next = objectContent[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
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
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === "{" || current === "(" || current === "[") {
      depth += 1;
    } else if (current === "}" || current === ")" || current === "]") {
      depth -= 1;
    } else if (current === "," && depth === 0) {
      properties.push({ text: objectContent.slice(start, index), start });
      start = index + 1;
    }
  }

  properties.push({ text: objectContent.slice(start), start });
  return properties;
}

function parseTopLevelProperties(objectContent) {
  const properties = new Map();

  for (const property of splitTopLevelProperties(objectContent)) {
    const commentFreeText = stripJavaScriptComments(property.text).trim();
    if (!commentFreeText) {
      continue;
    }

    const match = /^(?:"([^"]+)"|'([^']+)'|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]*)$/.exec(commentFreeText);
    if (!match) {
      continue;
    }

    properties.set(match[1] ?? match[2] ?? match[3], {
      value: match[4].trim(),
      start: property.start,
      text: commentFreeText,
    });
  }

  return properties;
}

function parseNumericProperty(properties, propertyName) {
  const property = properties.get(propertyName);
  if (!property) {
    return { property, value: null };
  }

  const match = /^(-?\d+(?:\.\d+)?)\b/.exec(property.value);
  return {
    property,
    value: match ? Number.parseFloat(match[1]) : null,
  };
}

function parseStringArrayProperty(properties, propertyName) {
  const property = properties.get(propertyName);
  if (!property) {
    return { property, values: null };
  }

  const value = property.value.trim();
  if (!value.startsWith("[")) {
    return { property, values: null };
  }

  const closeIndex = findMatchingBracket(value, 0);
  if (closeIndex < 0) {
    return { property, values: null };
  }

  const arrayContent = value.slice(1, closeIndex);
  const values = [];
  for (const item of splitTopLevelProperties(arrayContent)) {
    const commentFreeText = stripJavaScriptComments(item.text).trim();
    if (!commentFreeText) {
      continue;
    }

    const match = /^(?:"([^"]*)"|'([^']*)'|`([^`]*)`)$/.exec(commentFreeText);
    if (!match) {
      return { property, values: null };
    }

    values.push(match[1] ?? match[2] ?? match[3]);
  }

  return { property, values };
}

function findMatchingBracket(text, openIndex) {
  const openChar = text[openIndex];
  const closeChar = openChar === "[" ? "]" : openChar === "(" ? ")" : "}";
  let depth = 0;
  let quote = "";
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const current = text[index];
    const next = text[index + 1] ?? "";

    if (inLineComment) {
      if (current === "\n" || current === "\r") {
        inLineComment = false;
      }
      continue;
    }

    if (inBlockComment) {
      if (current === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (quote) {
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
      continue;
    }

    if (current === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (current === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    if (current === openChar) {
      depth += 1;
    } else if (current === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function globPatternMatchesPath(pattern, filePath) {
  if (pattern === filePath) {
    return true;
  }

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\0")
    .replace(/\*/g, "[^/]*")
    .replace(/\0/g, ".*");
  return new RegExp(`^${escaped}$`).test(filePath);
}

function formatCoverageConfiguredValue(value) {
  return value === null ? "missing or malformed" : String(value);
}

function coverageThresholdRemediation(thresholdName, minimum) {
  return `Restore ${thresholdName} to ${minimum}% or higher in vitest.config.ts and run ${coverageThresholdRemediationCommand}.`;
}

async function collectProductionFiles() {
  const files = [];
  for (const sourceRoot of [...productionRoots, ...scriptRoots]) {
    files.push(...(await walkFiles(sourceRoot)));
  }

  return files.filter(isProductionTypeScriptFile).sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
}

async function collectSupplyChainScanFiles() {
  const files = [];
  for (const sourceRoot of [...productionRoots, ...scriptRoots]) {
    files.push(...(await walkFiles(sourceRoot)));
  }

  return files
    .filter((filePath) => supplyChainScanExtensions.has(path.extname(filePath)))
    .filter((filePath) => !toRelative(filePath).includes("/__tests__/"))
    .filter((filePath) => !path.basename(filePath).match(/\.(?:test|spec)\.[cm]?[jt]sx?$/))
    .sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
}

async function collectWorkflowFiles() {
  const files = [];
  for (const workflowRoot of workflowRoots) {
    files.push(...(await walkFiles(workflowRoot)));
  }

  return files
    .filter((filePath) => [".yml", ".yaml"].includes(path.extname(filePath)))
    .sort((a, b) => toRelative(a).localeCompare(toRelative(b)));
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

function allowlistKey(pathValue, line) {
  return `${pathValue}\0${line.trim()}`;
}

function buildSupplyChainRiskAllowlist() {
  const allowlist = new Map();

  for (const entry of supplyChainRiskAllowlist) {
    if (!entry.rationale || entry.rationale.trim().length < 20) {
      throw new Error(`Supply-chain allowlist entry for ${entry.path} is missing a security rationale.`);
    }
    allowlist.set(allowlistKey(entry.path, entry.line), entry.rationale);
  }

  return allowlist;
}

export function findSupplyChainRiskViolations(sources, options = {}) {
  const allowlist = options.allowlist ?? buildSupplyChainRiskAllowlist();
  const violations = [];

  for (const source of sources) {
    const lines = source.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine) {
        return;
      }

      for (const riskPattern of supplyChainRiskPatterns) {
        if (!riskPattern.pattern.test(trimmedLine)) {
          continue;
        }

        const rationale = allowlist.get(allowlistKey(source.path, trimmedLine));
        if (rationale) {
          return;
        }

        violations.push({
          path: source.path,
          line: index + 1,
          pattern: riskPattern.name,
          match: compactMatch(trimmedLine),
          remediation: riskPattern.remediation,
        });
      }
    });
  }

  return violations;
}

export function findWorkflowInstallGuardrailViolations(sources) {
  const violations = [];

  for (const source of sources) {
    const lines = source.text.split(/\r?\n/);
    lines.forEach((line, index) => {
      const trimmedLine = line.trim();
      if (!trimmedLine || trimmedLine.startsWith("#") || !trimmedLine.includes("pnpm install")) {
        return;
      }

      if (trimmedLine.includes(requiredWorkflowInstallCommand)) {
        return;
      }

      violations.push({
        path: source.path,
        line: index + 1,
        pattern: "workflow pnpm install without frozen ignore-scripts",
        match: compactMatch(trimmedLine),
        remediation:
          `Use ${requiredWorkflowInstallCommand}. If a packaging step must run lifecycle rebuilds, keep the install script-free and add an explicit documented rebuild step after it.`,
      });
    });
  }

  return violations;
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

async function collectExecutionRuntimeEventProjectionFiles() {
  const files = await walkFiles(executionRuntimeEventProjectionDirectory);
  return files
    .filter((filePath) => executionRuntimeEventProjectionPathPattern.test(toRelative(filePath)))
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

export function findRealtimeSnapshotPersistenceViolations(repositorySource, serviceSource) {
  const violations = [];
  const repositoryPath = repositorySource.path;
  const servicePath = serviceSource.path;
  const repositoryText = repositorySource.text;
  const serviceText = serviceSource.text;

  if (!/if\s*\(\s*replayable\s*\)\s*\{[\s\S]{0,2000}INSERT\s+INTO\s+dashboard_realtime_events/.test(repositoryText)) {
    violations.push({
      path: repositoryPath,
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
      path: servicePath,
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
        path: servicePath,
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

async function inspectRealtimeSnapshotPersistence() {
  const [repositoryRelativePath, serviceRelativePath] = realtimeFiles;
  const repositoryPath = path.join(root, repositoryRelativePath);
  const servicePath = path.join(root, serviceRelativePath);
  const [repositoryText, serviceText] = await Promise.all([
    readFile(repositoryPath, "utf8"),
    readFile(servicePath, "utf8"),
  ]);

  return findRealtimeSnapshotPersistenceViolations(
    { path: repositoryRelativePath, text: repositoryText },
    { path: serviceRelativePath, text: serviceText },
  );
}

export function findRealtimePayloadFingerprintViolations(sources) {
  const violations = [];

  for (const source of sources) {
    directRealtimePayloadStringifyPattern.lastIndex = 0;
    for (const match of source.text.matchAll(directRealtimePayloadStringifyPattern)) {
      violations.push({
        path: source.path,
        line: lineNumberAt(source.text, match.index ?? 0),
        pattern: "direct realtime payload JSON.stringify",
        match: compactMatch(match[0]),
        remediation:
          "Use getDashboardRealtimePayloadFingerprint(eventType, payload) for realtime snapshot fingerprints and size estimates; do not serialize the full payload in this hot path.",
      });
    }
  }

  return violations;
}

async function inspectRealtimePayloadFingerprinting() {
  const sources = [];

  for (const relativePath of realtimeFingerprintHotPathFiles) {
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
    sources.push({ path: relativePath, text });
  }

  return findRealtimePayloadFingerprintViolations(sources);
}

function findRuntimeEventQueryBlock(text, tableIndex) {
  const prepareIndex = text.lastIndexOf("prepare(`", tableIndex);
  const chunkedQueryIndex = text.lastIndexOf("executeChunkedInQuery", tableIndex);
  const fallbackEnd = Math.min(text.length, tableIndex + 2400);

  if (chunkedQueryIndex > prepareIndex) {
    const openIndex = text.indexOf("{", chunkedQueryIndex);
    if (openIndex >= 0) {
      const closeIndex = findMatchingBrace(text, openIndex);
      if (closeIndex >= 0) {
        return text.slice(chunkedQueryIndex, closeIndex + 1);
      }
    }
  }

  if (prepareIndex >= 0) {
    const closeIndex = text.indexOf("`)", tableIndex);
    if (closeIndex >= 0) {
      return text.slice(prepareIndex, closeIndex + 2);
    }
  }

  return text.slice(tableIndex, fallbackEnd);
}

export function findUnboundedExecutionRuntimeEventQueryViolations(sources) {
  const violations = [];

  for (const source of sources) {
    if (!executionRuntimeEventProjectionPathPattern.test(source.path)) {
      continue;
    }

    runtimeEventTableReadPattern.lastIndex = 0;
    for (const match of source.text.matchAll(runtimeEventTableReadPattern)) {
      const tableName = match[1];
      const block = findRuntimeEventQueryBlock(source.text, match.index ?? 0);
      if (!/\bORDER\s+BY\b[\s\S]{0,500}\bcreated_at\b/i.test(block)) {
        continue;
      }
      if (/\bLIMIT\s+(?:\?|\d+\b|[A-Z_][A-Z0-9_]*\b)/i.test(block) || /\brun_event_rank\s*<=/i.test(block)) {
        continue;
      }

      violations.push({
        path: source.path,
        line: lineNumberAt(source.text, match.index ?? 0),
        pattern: `unbounded execution runtime event ${tableName} query`,
        match: compactMatch(block).slice(0, 240),
        remediation:
          "Runtime-event live snapshot reads must keep an explicit row bound: add a SQL LIMIT for project/sprint slices or a ROW_NUMBER run_event_rank cap for expanded-run slices.",
      });
    }
  }

  return violations;
}

async function inspectExecutionRuntimeEventProjectionQueries(files) {
  const sources = await Promise.all(files.map(async (filePath) => ({
    path: toRelative(filePath),
    text: await readFile(filePath, "utf8"),
  })));

  return findUnboundedExecutionRuntimeEventQueryViolations(sources);
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

export function findCoverageThresholdViolations(source, options = {}) {
  const configPath = options.path ?? coverageThresholdConfigPath;
  const minimumGlobalThresholds = options.minimumGlobalThresholds ?? minimumGlobalCoverageThresholds;
  const filePath = options.filePath ?? activityCacheServiceCoveragePath;
  const minimumFileLineThreshold = options.minimumFileLineThreshold ?? minimumActivityCacheServiceLineThreshold;
  const violations = [];
  const coverageBlock = findObjectPropertyBlock(source, "coverage");
  const coverageProperties = coverageBlock ? parseTopLevelProperties(coverageBlock.content) : new Map();
  const thresholdsBlock = coverageBlock
    ? findObjectPropertyBlock(source, "thresholds", coverageBlock.openIndex)
    : findObjectPropertyBlock(source, "thresholds");

  const { property: includeProperty, values: includeValues } = parseStringArrayProperty(
    coverageProperties,
    "include",
  );
  if (!includeValues?.includes(requiredCoverageIncludePattern)) {
    violations.push({
      path: configPath,
      line: includeProperty
        ? lineNumberAt(source, coverageBlock.contentStartIndex + includeProperty.start)
        : coverageBlock
          ? lineNumberAt(source, coverageBlock.openIndex)
          : 1,
      pattern: "coverage include src TypeScript",
      match: `coverage.include configured ${
        includeValues === null ? "missing or malformed" : JSON.stringify(includeValues)
      }, required ${JSON.stringify(requiredCoverageIncludePattern)}`,
      remediation: `Keep coverage.include observing ${requiredCoverageIncludePattern} and run ${coverageThresholdRemediationCommand}.`,
    });
  }

  const { property: excludeProperty, values: excludeValues } = parseStringArrayProperty(
    coverageProperties,
    "exclude",
  );
  const activityCacheExclusion = excludeValues?.find((pattern) =>
    globPatternMatchesPath(pattern, filePath),
  );
  if (activityCacheExclusion) {
    violations.push({
      path: configPath,
      line: lineNumberAt(source, coverageBlock.contentStartIndex + (excludeProperty?.start ?? 0)),
      pattern: "activity-cache-service coverage exclusion",
      match: `coverage.exclude configured ${JSON.stringify(activityCacheExclusion)}, required not excluded for ${filePath}`,
      remediation: `Remove the ${filePath} coverage exclusion and run ${coverageThresholdRemediationCommand}.`,
    });
  }

  if (!thresholdsBlock) {
    violations.push({
      path: configPath,
      line: 1,
      pattern: "missing coverage thresholds",
      match: "coverage.thresholds",
      remediation:
        `Define test.coverage.thresholds with global minimums and the activity-cache-service line threshold, then run ${coverageThresholdRemediationCommand}.`,
    });
    return violations;
  }

  const thresholds = parseTopLevelProperties(thresholdsBlock.content);

  for (const [metric, minimum] of Object.entries(minimumGlobalThresholds)) {
    const { property, value } = parseNumericProperty(thresholds, metric);
    if (value !== null && value >= minimum) {
      continue;
    }

    violations.push({
      path: configPath,
      line: property ? lineNumberAt(source, thresholdsBlock.contentStartIndex + property.start) : lineNumberAt(source, thresholdsBlock.openIndex),
      pattern: `coverage threshold ${metric}`,
      match: `global ${metric} threshold configured ${formatCoverageConfiguredValue(value)}, required >= ${minimum}`,
      remediation: coverageThresholdRemediation(`global ${metric} coverage threshold`, minimum),
    });
  }

  const fileThreshold = thresholds.get(filePath);
  if (!fileThreshold) {
    violations.push({
      path: configPath,
      line: lineNumberAt(source, thresholdsBlock.openIndex),
      pattern: "activity-cache-service coverage threshold",
      match: `${filePath}.lines threshold configured missing, required >= ${minimumFileLineThreshold}`,
      remediation: coverageThresholdRemediation(`${filePath} line coverage threshold`, minimumFileLineThreshold),
    });
    return violations;
  }

  const fileThresholdOpenIndex = fileThreshold.value.indexOf("{");
  if (fileThresholdOpenIndex < 0) {
    violations.push({
      path: configPath,
      line: lineNumberAt(source, thresholdsBlock.contentStartIndex + fileThreshold.start),
      pattern: "activity-cache-service coverage threshold",
      match: `${filePath}.lines threshold configured malformed (${compactMatch(fileThreshold.text)}), required >= ${minimumFileLineThreshold}`,
      remediation: coverageThresholdRemediation(`${filePath} line coverage threshold`, minimumFileLineThreshold),
    });
    return violations;
  }

  const fileThresholdCloseIndex = findMatchingBrace(fileThreshold.value, fileThresholdOpenIndex);
  const fileThresholdContent =
    fileThresholdCloseIndex >= 0
      ? fileThreshold.value.slice(fileThresholdOpenIndex + 1, fileThresholdCloseIndex)
      : "";
  const fileThresholdProperties = parseTopLevelProperties(fileThresholdContent);
  const { property: lineProperty, value: lineValue } = parseNumericProperty(fileThresholdProperties, "lines");

  if (lineValue === null || lineValue < minimumFileLineThreshold) {
    violations.push({
      path: configPath,
      line: lineNumberAt(
        source,
        thresholdsBlock.contentStartIndex +
          fileThreshold.start +
          fileThreshold.value.indexOf("{") +
          1 +
          (lineProperty?.start ?? 0),
      ),
      pattern: "activity-cache-service coverage threshold",
      match: `${filePath}.lines threshold configured ${formatCoverageConfiguredValue(lineValue)}, required >= ${minimumFileLineThreshold}`,
      remediation: coverageThresholdRemediation(`${filePath} line coverage threshold`, minimumFileLineThreshold),
    });
  }

  return violations;
}

async function inspectCoverageThresholds() {
  const configPath = path.join(root, coverageThresholdConfigPath);
  const source = await readFile(configPath, "utf8");
  return findCoverageThresholdViolations(source, { path: coverageThresholdConfigPath });
}

async function inspectSupplyChainRiskPatterns(files) {
  const sources = await Promise.all(files.map(async (filePath) => ({
    path: toRelative(filePath),
    text: await readFile(filePath, "utf8"),
  })));

  return findSupplyChainRiskViolations(sources);
}

async function inspectWorkflowInstallGuardrails(files) {
  const sources = await Promise.all(files.map(async (filePath) => ({
    path: toRelative(filePath),
    text: await readFile(filePath, "utf8"),
  })));

  return findWorkflowInstallGuardrailViolations(sources);
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
  const [productionFiles, supplyChainScanFiles, workflowFiles, artifactFiles, dependencyFactoryFiles] = await Promise.all([
    collectProductionFiles(),
    collectSupplyChainScanFiles(),
    collectWorkflowFiles(),
    collectArtifactFiles(),
    collectDependencyFactoryFiles(),
  ]);
  const executionRuntimeEventProjectionFiles = await collectExecutionRuntimeEventProjectionFiles();

  const [
    reports,
    dependencyFactoryViolationsNested,
    realtimeSnapshotViolations,
    realtimePayloadFingerprintViolations,
    runtimeEventProjectionViolations,
    optimisticInsertionViolations,
    duplicateImplementationViolations,
    coverageThresholdViolations,
    supplyChainRiskViolations,
    workflowInstallViolations,
  ] = await Promise.all([
    Promise.all(productionFiles.map(inspectSourceFile)),
    Promise.all(dependencyFactoryFiles.map(inspectDependencyFactoryFile)),
    inspectRealtimeSnapshotPersistence(),
    inspectRealtimePayloadFingerprinting(),
    inspectExecutionRuntimeEventProjectionQueries(executionRuntimeEventProjectionFiles),
    inspectDuplicateOptimisticInsertions(),
    inspectDuplicateImplementationBlocks(productionFiles),
    inspectCoverageThresholds(),
    inspectSupplyChainRiskPatterns(supplyChainScanFiles),
    inspectWorkflowInstallGuardrails(workflowFiles),
  ]);
  const dependencyFactoryViolations = dependencyFactoryViolationsNested.flat();
  const blockingViolations = [
    ...dependencyFactoryViolations,
    ...realtimeSnapshotViolations,
    ...realtimePayloadFingerprintViolations,
    ...runtimeEventProjectionViolations,
    ...optimisticInsertionViolations,
    ...duplicateImplementationViolations,
    ...coverageThresholdViolations,
    ...supplyChainRiskViolations,
    ...workflowInstallViolations,
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
  console.log(`Scanned ${supplyChainScanFiles.length} production/script files for supply-chain shell risks.`);
  console.log(`Scanned ${workflowFiles.length} GitHub workflow files for script-free installs.`);
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
