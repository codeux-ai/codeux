import { spawn } from "child_process";
import type { CommandResult } from "../../../services/cli-process-runner.js";

export const MOCKUP_CLI_NODE_SCRIPT = String.raw`
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");

const prompt = process.argv[1] || "";
const cwd = process.cwd();
const sessionId = process.env.CODE_UX_MOCKUP_SESSION_ID || "mockup-session";
const model = process.env.CODE_UX_MOCKUP_MODEL || "default";

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
  const operations = [];
  const validations = [];
  const fileFence = /mockup-cli:file\s+([^\n]+)\n\x60{3}[^\n]*\n([\s\S]*?)\n\x60{3}/gi;
  for (const match of prompt.matchAll(fileFence)) {
    addWrite(operations, "write", match[1], match[2]);
  }
  const heredoc = /mockup-cli:file\s+(.+?)\s+<<([A-Za-z0-9_-]+)\n([\s\S]*?)\n\2/g;
  for (const match of prompt.matchAll(heredoc)) {
    addWrite(operations, "write", match[1], match[3]);
  }

  for (const line of prompt.split(/\r?\n/)) {
    let match = line.match(/^mockup-cli:(write|append|conflict)\s+(.+?)\s*::\s*(.*)$/i);
    if (match) {
      addWrite(operations, match[1].toLowerCase(), match[2], match[3]);
      continue;
    }
    match = line.match(/^mockup-cli:replace\s+(.+?)\s*::\s*(.*?)\s*=>\s*(.*)$/i);
    if (match) {
      operations.push({ type: "replace", filePath: match[1].trim(), from: normalizeContent(match[2]), to: normalizeContent(match[3]) });
      continue;
    }
    match = line.match(/^mockup-cli:delete\s+(.+)$/i);
    if (match) {
      operations.push({ type: "delete", filePath: match[1].trim() });
      continue;
    }
    match = line.match(/^mockup-cli:run\s+(.+)$/i);
    if (match) {
      validations.push(match[1].trim());
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
  const result = cp.spawnSync(resolvedCommand, resolvedArgs, {
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
  env: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-e", MOCKUP_CLI_NODE_SCRIPT, input.prompt], {
      cwd: input.cwd,
      env: {
        ...input.env,
        CODE_UX_MOCKUP_MODEL: input.model || "default",
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
