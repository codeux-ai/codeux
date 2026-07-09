import { spawn } from "child_process";
import type { CommandResult } from "../../../services/cli-process-runner.js";

export const MOCKUP_CLI_NODE_SCRIPT = String.raw`
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const { spawnSync } = require("child_process");

const prompt = process.argv[1] || "";
const cwd = process.cwd();
const sessionId = process.env.CODE_UX_MOCKUP_SESSION_ID || "mockup-session";
const model = process.env.CODE_UX_MOCKUP_MODEL || "default";
const purpose = process.env.CODE_UX_MOCKUP_PURPOSE || "";

function stableId() {
  return "mockup-cli-" + crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 16);
}

function normalizeContent(value) {
  let content = String(value || "").trim();
  const backtick = String.fromCharCode(96);
  if (
    (content.startsWith("\"") && content.endsWith("\""))
    || (content.startsWith("'") && content.endsWith("'"))
    || (content.startsWith(backtick) && content.endsWith(backtick))
  ) {
    content = content.slice(1, -1);
  }
  return content.replace(/\\n/g, "\n");
}

function resolveWorkspacePath(rawPath) {
  const value = String(rawPath || "").trim().replace(/^["'\x60]|["'\x60]$/g, "");
  if (!value || value.includes("\0")) {
    throw new Error("mockup-cli refused an empty or invalid path");
  }
  const resolved = path.resolve(cwd, value);
  const relative = path.relative(cwd, resolved);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("mockup-cli refused to write outside the provider workspace: " + value);
  }
  return resolved;
}

function addWrite(operations, mode, rawPath, rawContent) {
  operations.push({ type: mode, filePath: rawPath.trim(), content: normalizeContent(rawContent) });
}

function isQaReviewInvocation() {
  return purpose === "qa_review";
}

function currentTaskKeyFromPrompt() {
  const match = prompt.match(/^Task key:\s*(\S+)/m);
  return match ? match[1].trim() : null;
}

function qaReviewPayload(overrides) {
  return {
    verdict: overrides.verdict,
    summary: overrides.summary,
    findings: overrides.findings || [],
    fixInstructions: overrides.fixInstructions || null,
    targetTaskKey: overrides.targetTaskKey === undefined ? null : overrides.targetTaskKey,
    shouldHavePr: overrides.shouldHavePr === undefined ? null : overrides.shouldHavePr,
    followUpTasks: overrides.followUpTasks || [],
  };
}

function parseQaReviewDirective() {
  if (!isQaReviewInvocation()) {
    return null;
  }

  for (const rawLine of prompt.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^mockup-cli:qa\s+fail\b/i.test(line)) {
      return { failure: true };
    }

    let match = line.match(/^mockup-cli:qa\s+pass(?:\s*::\s*(.*))?$/i);
    if (match) {
      const summary = normalizeContent(match[1] || "Mockup QA passed deterministic review.");
      return {
        payload: qaReviewPayload({
          verdict: "pass",
          summary,
          findings: ["Mockup QA completed deterministic pass review."],
        }),
      };
    }

    match = line.match(/^mockup-cli:qa\s+changes-requested\s+follow-up\s*::\s*(.+?)\s*=>\s*(.+)$/i);
    if (match) {
      const title = normalizeContent(match[1]);
      const promptMarkdown = normalizeContent(match[2]);
      return {
        payload: qaReviewPayload({
          verdict: "changes_requested",
          summary: "Mockup QA requested deterministic follow-up work.",
          findings: ["Mockup QA requested a deterministic follow-up task."],
          fixInstructions: null,
          targetTaskKey: currentTaskKeyFromPrompt(),
          followUpTasks: [{
            title,
            promptMarkdown,
            description: "Created by mockup-cli QA review directive.",
            dependsOnTaskKeys: [],
            priority: "medium",
          }],
        }),
      };
    }

    match = line.match(/^mockup-cli:qa\s+changes-requested(?:\s+fix)?\s*::\s*(.+)$/i);
    if (match) {
      const fixInstructions = normalizeContent(match[1]);
      return {
        payload: qaReviewPayload({
          verdict: "changes_requested",
          summary: "Mockup QA requested deterministic changes.",
          findings: ["Mockup QA requested deterministic fixes."],
          fixInstructions,
          targetTaskKey: currentTaskKeyFromPrompt(),
        }),
      };
    }
  }

  return {
    payload: qaReviewPayload({
      verdict: "pass",
      summary: "Mockup QA passed deterministic review.",
      findings: ["Mockup QA completed deterministic pass review."],
    }),
  };
}

function hasConflictMarkers(content) {
  return content.includes("<<<<<<<") && content.includes("=======") && content.includes(">>>>>>>");
}

function uniqueNonEmptyLines(...blocks) {
  const seen = new Set();
  const lines = [];
  for (const block of blocks) {
    for (const rawLine of String(block || "").split(/\r?\n/)) {
      const line = rawLine.trimEnd();
      if (!line.trim()) continue;
      if (seen.has(line)) continue;
      seen.add(line);
      lines.push(line);
    }
  }
  return lines;
}

function resolveConflictBlock(filePath, ours, theirs) {
  const combined = ours + "\n" + theirs;
  if (
    /(?:^|[/\\])conflict-target\.js$/i.test(filePath)
    && /export\s+function\s+conflictValue/.test(combined)
    && /return\s+['"]left['"]\s*;/.test(combined)
    && /return\s+['"]right['"]\s*;/.test(combined)
  ) {
    return "export function conflictValue() {\n  return 'left+right';\n}";
  }
  if (
    /(?:^|[/\\])final-merge-conflict\.js$/i.test(filePath)
    && /export\s+function\s+finalMergeValue/.test(combined)
    && /return\s+['"]feature['"]\s*;/.test(combined)
    && /return\s+['"]default['"]\s*;/.test(combined)
  ) {
    return "export function finalMergeValue() {\n  return 'feature+default';\n}";
  }
  return uniqueNonEmptyLines(ours, theirs).join("\n");
}

function resolveConflictContent(filePath, content) {
  const resolved = String(content).replace(
    /^<<<<<<<[^\n]*\n([\s\S]*?)(?:\n\|\|\|\|\|\|\|[^\n]*\n[\s\S]*?)?\n=======\n([\s\S]*?)\n>>>>>>>[^\n]*(?:\n|$)/gm,
    (_match, ours, theirs) => {
      const resolved = resolveConflictBlock(filePath, ours, theirs);
      return resolved.endsWith("\n") ? resolved : resolved + "\n";
    },
  );
  if (
    /(?:^|[/\\])conflict-target\.js$/i.test(filePath)
    && /export\s+function\s+conflictValue/.test(resolved)
    && /return\s+['"]left['"]\s*;/.test(resolved)
    && /return\s+['"]right['"]\s*;/.test(resolved)
  ) {
    return "export function conflictValue() {\n  return 'left+right';\n}\n";
  }
  if (
    /(?:^|[/\\])final-merge-conflict\.js$/i.test(filePath)
    && /export\s+function\s+finalMergeValue/.test(resolved)
    && /return\s+['"]feature['"]\s*;/.test(resolved)
    && /return\s+['"]default['"]\s*;/.test(resolved)
  ) {
    return "export function finalMergeValue() {\n  return 'feature+default';\n}\n";
  }
  return resolved;
}

async function walkFiles(dir, files = []) {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await walkFiles(fullPath, files);
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

async function listConflictFiles() {
  const candidates = await walkFiles(cwd);
  const conflicted = [];
  for (const filePath of candidates) {
    const content = await fsp.readFile(filePath, "utf8").catch(() => null);
    if (content && hasConflictMarkers(content)) {
      conflicted.push(filePath);
    }
  }
  return conflicted;
}

async function resolveActiveConflicts() {
  const files = await listConflictFiles();
  const resolved = [];
  for (const filePath of files) {
    const content = await fsp.readFile(filePath, "utf8");
    const next = resolveConflictContent(path.relative(cwd, filePath), content);
    await fsp.writeFile(filePath, next.endsWith("\n") ? next : next + "\n", "utf8");
    resolved.push(path.relative(cwd, filePath));
  }
  if (resolved.length === 0) {
    const marker = resolveWorkspacePath(".code-ux/mockup-cli-conflict-resolution.txt");
    await fsp.mkdir(path.dirname(marker), { recursive: true });
    await fsp.writeFile(marker, "No active conflict markers were found by mockup-cli.\n", "utf8");
    resolved.push(path.relative(cwd, marker));
  }
  return resolved;
}

function splitCommandLine(command) {
  const argv = [];
  let current = "";
  let quote = null;
  let escaped = false;

  for (const char of command.trim()) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }
    if (char === "\"" || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        argv.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }

  if (escaped) {
    current += "\\";
  }
  if (quote) {
    throw new Error("mockup-cli validation command has an unterminated quote");
  }
  if (current.length > 0) {
    argv.push(current);
  }

  return argv;
}

function parseOperations() {
  const shouldResolveActiveConflicts = /\b(resolve(?:\s+the)?(?:\s+active)?\s+merge conflict|active Git merge conflict|unresolved merge conflicts|merge-conflict resolution)\b/i.test(prompt);
  if (shouldResolveActiveConflicts) {
    // Virtual conflict-worker prompts include original task prompts as context. Those
    // prompts may contain mockup-cli directives, but replaying them after resolving the
    // active conflict can overwrite the actual merge resolution.
    return { operations: [{ type: "resolve-conflicts" }], validations: [] };
  }

  const operations = [];
  const validations = [];
  let hasExplicitMockupDirectives = /(^|\n)\s*mockup-cli:(?:file|write|append|conflict|replace|delete|run)\b/i.test(prompt);
  const fileFence = /mockup-cli:file\s+([^\n]+)\n\x60{3}[^\n]*\n([\s\S]*?)\n\x60{3}/gi;
  for (const match of prompt.matchAll(fileFence)) {
    addWrite(operations, "write", match[1], match[2]);
    hasExplicitMockupDirectives = true;
  }
  const heredoc = /mockup-cli:file\s+(.+?)\s+<<([A-Za-z0-9_-]+)\n([\s\S]*?)\n\2/g;
  for (const match of prompt.matchAll(heredoc)) {
    addWrite(operations, "write", match[1], match[3]);
    hasExplicitMockupDirectives = true;
  }

  for (const line of prompt.split(/\r?\n/)) {
    let match = line.match(/^mockup-cli:(write|append|conflict)\s+(.+?)\s*::\s*(.*)$/i);
    if (match) {
      addWrite(operations, match[1].toLowerCase(), match[2], match[3]);
      hasExplicitMockupDirectives = true;
      continue;
    }
    match = line.match(/^mockup-cli:replace\s+(.+?)\s*::\s*(.*?)\s*=>\s*(.*)$/i);
    if (match) {
      operations.push({ type: "replace", filePath: match[1].trim(), from: normalizeContent(match[2]), to: normalizeContent(match[3]) });
      hasExplicitMockupDirectives = true;
      continue;
    }
    match = line.match(/^mockup-cli:delete\s+(.+)$/i);
    if (match) {
      operations.push({ type: "delete", filePath: match[1].trim() });
      hasExplicitMockupDirectives = true;
      continue;
    }
    match = line.match(/^mockup-cli:run\s+(.+)$/i);
    if (match) {
      validations.push(match[1].trim());
      hasExplicitMockupDirectives = true;
      continue;
    }
    if (hasExplicitMockupDirectives) {
      continue;
    }
    match = line.match(/(?:create|write)\s+(?:a\s+)?file\s+[\x60'"]?([^\x60'":\s]+)[\x60'"]?\s+(?:with|containing)\s+(?:content|text)?[:\s]+(.+)$/i);
    if (match) {
      addWrite(operations, "write", match[1], match[2]);
      continue;
    }
    match = line.match(/(?:run|execute)\s+(?:the\s+)?(?:local\s+)?(?:validation|test|check|command)s?\s*:\s*(.+)$/i);
    if (match) {
      validations.push(match[1].trim());
    }
  }

  if (operations.length === 0 && /\b(merge conflict|conflicting edit|conflict task)\b/i.test(prompt)) {
    const target = prompt.match(/\bfile\s+[\x60'"]?([^\x60'"\s]+)[\x60'"]?/i)?.[1] || ".code-ux/mockup-cli-conflict.txt";
    operations.push({
      type: "conflict",
      filePath: target,
      content: "mockup-cli deterministic conflicting edit",
    });
  }

  if (operations.length === 0) {
    const digest = crypto.createHash("sha256").update(prompt).digest("hex").slice(0, 12);
    operations.push({
      type: "write",
      filePath: ".code-ux/mockup-cli-result.txt",
      content: [
        "Mockup CLI completed the deterministic task.",
        "promptSha256=" + digest,
        "",
      ].join("\n"),
    });
  }

  return { operations, validations };
}

async function applyOperation(operation) {
  if (operation.type === "resolve-conflicts") {
    const resolved = await resolveActiveConflicts();
    return { type: operation.type, path: resolved.join(",") };
  }
  const target = resolveWorkspacePath(operation.filePath);
  await fsp.mkdir(path.dirname(target), { recursive: true });
  if (operation.type === "write") {
    await fsp.writeFile(target, operation.content.endsWith("\n") ? operation.content : operation.content + "\n", "utf8");
  } else if (operation.type === "append") {
    await fsp.appendFile(target, operation.content.endsWith("\n") ? operation.content : operation.content + "\n", "utf8");
  } else if (operation.type === "replace") {
    const current = await fsp.readFile(target, "utf8").catch(() => "");
    const next = current.includes(operation.from)
      ? current.replace(operation.from, operation.to)
      : current + (current.endsWith("\n") || current.length === 0 ? "" : "\n") + operation.to + "\n";
    await fsp.writeFile(target, next, "utf8");
  } else if (operation.type === "delete") {
    await fsp.rm(target, { force: true });
  } else if (operation.type === "conflict") {
    const body = [
      "<<<<<<< mockup-cli-current",
      "current deterministic content",
      "=======",
      operation.content || "incoming deterministic content",
      ">>>>>>> mockup-cli-incoming",
      "",
    ].join("\n");
    await fsp.writeFile(target, body, "utf8");
  }
  return { type: operation.type, path: path.relative(cwd, target) };
}

function runValidation(command) {
  const [resolvedCommand, ...resolvedArgs] = splitCommandLine(command);
  if (!resolvedCommand) {
    return {
      command,
      code: 1,
      ok: false,
      stdout: "",
      stderr: "mockup-cli validation command was empty",
    };
  }
  const result = spawnSync(resolvedCommand, resolvedArgs, {
    cwd,
    env: process.env,
    encoding: "utf8",
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
  return {
    command,
    code: typeof result.status === "number" ? result.status : 1,
    ok: result.status === 0,
    stdout: (result.stdout || "").trim(),
    stderr: (result.stderr || result.error?.message || "").trim(),
  };
}

async function main() {
  const qaReviewDirective = parseQaReviewDirective();
  if (qaReviewDirective?.failure) {
    const failure = {
      provider: "mockup-cli",
      model,
      ok: false,
      nativeSessionId: stableId(),
      response: "Mockup CLI intentional QA failure directive triggered.",
      usage: { mock: true, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      actions: [],
      validation: [],
    };
    console.log(JSON.stringify(failure));
    console.error("mockup-cli intentional QA failure directive triggered");
    process.exit(1);
  }
  if (qaReviewDirective?.payload) {
    console.log(JSON.stringify(qaReviewDirective.payload));
    return;
  }

  if (/\b(MOCKUP_CLI_FAIL|MOCKUP_FAIL|mockup-cli:\s*fail|explicit mock failure)\b/i.test(prompt)) {
    const failure = {
      provider: "mockup-cli",
      model,
      ok: false,
      nativeSessionId: stableId(),
      response: "Mockup CLI intentional failure directive triggered.",
      usage: { mock: true, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      actions: [],
      validation: [],
    };
    console.log(JSON.stringify(failure));
    console.error("mockup-cli intentional failure directive triggered");
    process.exit(1);
  }

  const { operations, validations } = parseOperations();
  const actions = [];
  for (const operation of operations) {
    actions.push(await applyOperation(operation));
  }
  const validation = validations.map(runValidation);
  const failedValidation = validation.find((entry) => !entry.ok);
  const response = failedValidation
    ? "Mockup CLI completed workspace edits, but validation failed."
    : "Mockup CLI completed deterministic workspace task.";
  const payload = {
    provider: "mockup-cli",
    model,
    ok: !failedValidation,
    nativeSessionId: stableId(),
    response,
    usage: { mock: true, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    actions,
    validation,
  };
  console.log(JSON.stringify(payload));
  if (failedValidation) {
    process.exit(failedValidation.code || 1);
  }
}

main().catch((error) => {
  const payload = {
    provider: "mockup-cli",
    model,
    ok: false,
    nativeSessionId: stableId(),
    response: error instanceof Error ? error.message : String(error),
    usage: { mock: true, inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    actions: [],
    validation: [],
  };
  console.log(JSON.stringify(payload));
  console.error(payload.response);
  process.exit(1);
});
`;

export async function runMockupCliProvider(input: {
  prompt: string;
  cwd: string;
  model: string;
  sessionId: string;
  purpose?: string | null;
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const nodeExecutable = input.env.CODEUX_E2E_NODE_EXECUTABLE?.trim() || process.execPath;
    const child = spawn(nodeExecutable, ["-e", MOCKUP_CLI_NODE_SCRIPT, input.prompt], {
      cwd: input.cwd,
      env: {
        ...input.env,
        CODE_UX_MOCKUP_MODEL: input.model || "default",
        CODE_UX_MOCKUP_PURPOSE: input.purpose || "",
        CODE_UX_MOCKUP_SESSION_ID: input.sessionId,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    const emitLines = (chunk: Buffer, stream: "stdout" | "stderr"): void => {
      const text = chunk.toString("utf8");
      if (stream === "stdout") {
        stdout += text;
      } else {
        stderr += text;
      }
      const callback = stream === "stdout" ? input.onStdoutLine : input.onStderrLine;
      if (!callback) {
        return;
      }
      for (const line of text.split(/\r?\n/)) {
        if (line.length > 0) {
          callback(line);
        }
      }
    };

    const killOnAbort = (): void => {
      child.kill("SIGTERM");
    };
    if (input.signal) {
      input.signal.addEventListener("abort", killOnAbort, { once: true });
      if (input.signal.aborted) {
        killOnAbort();
      }
    }

    child.stdout.on("data", (chunk: Buffer) => emitLines(chunk, "stdout"));
    child.stderr.on("data", (chunk: Buffer) => emitLines(chunk, "stderr"));
    child.on("close", (code) => {
      if (input.signal) {
        input.signal.removeEventListener("abort", killOnAbort);
      }
      resolve({
        ok: code === 0,
        stdout,
        stderr,
        code,
      });
    });
    child.on("error", (error) => {
      if (input.signal) {
        input.signal.removeEventListener("abort", killOnAbort);
      }
      resolve({
        ok: false,
        stdout,
        stderr: [stderr, error.message].filter(Boolean).join("\n"),
        code: 1,
      });
    });
  });
}
