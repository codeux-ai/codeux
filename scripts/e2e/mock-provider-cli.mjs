#!/usr/bin/env node
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, posix, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const parsed = {
    provider: "unknown",
    model: "default",
    prompt: "",
    codexOutputPath: null,
    nativeSessionId: null,
    continueSession: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--provider") {
      parsed.provider = argv[index + 1] || parsed.provider;
      index += 1;
    } else if (arg === "--model") {
      parsed.model = argv[index + 1] || parsed.model;
      index += 1;
    } else if (arg === "--prompt") {
      parsed.prompt = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--codex-output-path") {
      parsed.codexOutputPath = argv[index + 1] || null;
      index += 1;
    } else if (arg === "--native-session-id") {
      parsed.nativeSessionId = argv[index + 1] || null;
      index += 1;
    } else if (arg === "--continue-session") {
      parsed.continueSession = true;
    }
  }

  if (!parsed.prompt && argv.length > 0) {
    parsed.prompt = argv[argv.length - 1] || "";
  }

  return parsed;
}

function readMarker(prompt, name) {
  const pattern = new RegExp(`\\[mock-provider:${name}=([^\\]]+)\\]`, "i");
  const match = pattern.exec(prompt);
  return match?.[1]?.trim() || null;
}

function hasMarker(prompt, name) {
  return new RegExp(`\\[mock-provider:${name}\\]`, "i").test(prompt);
}

function clampSleepMs(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }
  return Math.max(0, Math.min(10_000, Math.trunc(parsed)));
}

function sanitizeRelativePath(value) {
  const cleaned = posix.normalize(value.replace(/\\/g, "/").replace(/^\/+/, ""));
  if (!cleaned || cleaned === "." || cleaned === ".." || cleaned.startsWith("../") || cleaned.includes("/../")) {
    return "mock-provider-output.txt";
  }
  return cleaned;
}

function truncatePrompt(prompt) {
  return prompt.replace(/\s+/g, " ").trim().slice(0, 500);
}

function extractTaskMarker(prompt) {
  const match = /TASK\s+T\d+\s+[^\n\r]+/i.exec(prompt);
  return match?.[0]?.trim() || null;
}

async function sleep(ms) {
  if (ms <= 0) {
    return;
  }
  await new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function currentCommit(cwd) {
  try {
    const result = await execFileAsync("git", ["rev-parse", "--short", "HEAD"], { cwd });
    return result.stdout.trim() || null;
  } catch {
    return null;
  }
}

async function writeDeterministicFiles(cwd, run) {
  const outputPath = resolve(cwd, sanitizeRelativePath(readMarker(run.prompt, "write") || "mock-provider-output.txt"));
  const auditPath = join(cwd, ".codeux-mock-provider", "provider-run.json");
  const responseText = "Mock provider completed successfully.";
  const summary = [
    "Code UX mock provider output",
    `provider=${run.provider}`,
    `model=${run.model}`,
    `task=${extractTaskMarker(run.prompt) || "unknown"}`,
    `prompt=${truncatePrompt(run.prompt)}`,
    "",
  ].join("\n");

  await mkdir(dirname(outputPath), { recursive: true });
  await mkdir(dirname(auditPath), { recursive: true });
  await writeFile(outputPath, summary, "utf8");
  if (run.codexOutputPath) {
    await mkdir(dirname(resolve(cwd, run.codexOutputPath)), { recursive: true });
    await writeFile(resolve(cwd, run.codexOutputPath), `${responseText}\n`, "utf8");
  }
  await writeFile(auditPath, `${JSON.stringify({
    provider: run.provider,
    model: run.model,
    prompt: truncatePrompt(run.prompt),
    outputFile: basename(outputPath),
    commit: await currentCommit(cwd),
    continued: run.continueSession,
  }, null, 2)}\n`, "utf8");
}

function writeProviderStdout(run) {
  const nativeSessionId = run.nativeSessionId || `mock-${run.provider}-${Date.now().toString(36)}`;
  const requestedOutcome = readMarker(run.prompt, "outcome")?.toLowerCase();
  const outcomeMarker = requestedOutcome === "completed" || requestedOutcome === "blocked"
    ? `\nCODE_UX_TASK_OUTCOME: ${requestedOutcome}`
    : "";
  const responseText = `Mock provider completed successfully.${outcomeMarker}`;
  console.log(JSON.stringify({
    type: "thread.started",
    thread_id: nativeSessionId,
  }));
  console.log(JSON.stringify({
    type: "item.completed",
    item: {
      id: "mock-response",
      type: "agent_message",
      text: responseText,
    },
  }));
  console.log(JSON.stringify({
    type: "turn.completed",
    usage: {
      input_tokens: 8,
      cached_input_tokens: 0,
      output_tokens: 6,
      reasoning_output_tokens: 0,
      total_tokens: 14,
    },
  }));
}

async function main() {
  const run = parseArgs(process.argv.slice(2));
  const cwd = process.cwd();
  const sleepMs = clampSleepMs(readMarker(run.prompt, "sleep") || "0");
  const noOp = hasMarker(run.prompt, "no-op");
  const shouldFail = hasMarker(run.prompt, "fail") || readMarker(run.prompt, "exit") !== null;
  const exitCode = Math.max(1, Math.min(125, Number(readMarker(run.prompt, "exit") || "1") || 1));

  console.error(`[mock-provider] provider=${run.provider} model=${run.model} cwd=${cwd}`);
  await sleep(sleepMs);

  if (!noOp) {
    await writeDeterministicFiles(cwd, run);
  }

  if (shouldFail) {
    console.error(`[mock-provider] failing deterministically with exit code ${exitCode}`);
    process.exit(exitCode);
  }

  writeProviderStdout(run);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[mock-provider] unexpected failure: ${message}`);
  process.exit(1);
});
