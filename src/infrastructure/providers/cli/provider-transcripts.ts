import * as os from "os";
import * as path from "path";
import * as pathPosix from "path/posix";
import * as fs from "fs/promises";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import {
  CONTAINER_QWEN_OPENAI_LOG_DIR,
  CONTAINER_RUNTIME_HOME,
  CONTAINER_WORKSPACE_ROOT,
  resolveQwenHostLogDir
} from "./provider-runtime-artifacts.js";
import {
  readQwenOpenAiLogRecords,
  sumQwenOpenAiUsage,
  buildQwenConversation,
  QwenUsageTotals,
  ParsedConversationTurn
} from "./provider-usage.js";
import { IDockerRunner } from "./docker-runner.js";

export async function readQwenLogData(
    cwd: string,
    executionMode: CliWorkflowSettings["executionMode"],
    sessionId: string,
    startTimeMs: number,
    dockerRunner: Pick<IDockerRunner, "readWorkspaceJsonArray">
  ): Promise<{ usage: QwenUsageTotals | null; conversation: ParsedConversationTurn[] } | null> {
    let records: unknown[] = [];
    if (executionMode === "DOCKER") {
      const arrayJson = await dockerRunner.readWorkspaceJsonArray?.(cwd, CONTAINER_QWEN_OPENAI_LOG_DIR).catch(() => null);
      if (!arrayJson) return null;
      try {
        const parsed = JSON.parse(arrayJson);
        records = Array.isArray(parsed) ? parsed : [];
      } catch {
        return null;
      }
    } else {
      records = await readQwenOpenAiLogRecords(resolveQwenHostLogDir(sessionId), startTimeMs);
    }
    if (records.length === 0) {
      return null;
    }
    return { usage: sumQwenOpenAiUsage(records), conversation: buildQwenConversation(records) };
}

export async function readCodexLatestSessionJson(
    cwd: string,
    executionMode: CliWorkflowSettings["executionMode"],
    dockerRunner: Pick<IDockerRunner, "readLatestWorkspaceFile">
  ): Promise<string | null> {
    const now = new Date();
    const year = now.getFullYear().toString();
    const month = (now.getMonth() + 1).toString().padStart(2, "0");
    const day = now.getDate().toString().padStart(2, "0");

    if (executionMode === "DOCKER") {
      const sessionsDir = pathPosix.join(
        CONTAINER_RUNTIME_HOME,
        ".codex",
        "sessions",
        year,
        month,
        day,
      );
      return (await dockerRunner.readLatestWorkspaceFile?.(cwd, sessionsDir, "*.jsonl").catch(() => null)) ?? null;
    }

    const sessionsDir = path.join(os.homedir(), ".codex", "sessions", year, month, day);
    try {
      const files = await fs.readdir(sessionsDir);
      // Codex writes rollout transcripts as `rollout-<ts>-<uuid>.jsonl`.
      const jsonFiles = files.filter(f => f.endsWith(".jsonl"));
      if (jsonFiles.length === 0) return null;
      const withMtimes = await Promise.all(
        jsonFiles.map(async (f) => {
          const filePath = path.join(sessionsDir, f);
          const stat = await fs.stat(filePath).catch(() => null);
          return { filePath, mtime: stat?.mtimeMs ?? 0 };
        }),
      );
      withMtimes.sort((a, b) => b.mtime - a.mtime);
      return await fs.readFile(withMtimes[0].filePath, "utf8").catch(() => null);
    } catch {
      return null;
    }
}

export async function readClaudeSessionJsonl(
    cwd: string,
    nativeSessionId: string,
    executionMode: CliWorkflowSettings["executionMode"],
    dockerRunner: Pick<IDockerRunner, "readWorkspaceFile">
  ): Promise<string | null> {
    if (executionMode !== "DOCKER") {
      return null;
    }

    const sessionPath = pathPosix.join(
      CONTAINER_RUNTIME_HOME,
      ".claude",
      "projects",
      CONTAINER_WORKSPACE_ROOT.replaceAll(pathPosix.sep, "-"),
      `${nativeSessionId}.jsonl`,
    );
    return (await dockerRunner.readWorkspaceFile?.(cwd, sessionPath).catch(() => null)) || null;
}

export async function parseAntigravityConversationId(
    cwd: string,
    logPath: string,
    executionMode: CliWorkflowSettings["executionMode"],
    dockerRunner: Pick<IDockerRunner, "readWorkspaceFile">
  ): Promise<string | null> {
    try {
      const raw = executionMode === "DOCKER"
        ? ((await dockerRunner.readWorkspaceFile?.(cwd, logPath).catch(() => null)) || "")
        : (await fs.readFile(logPath, "utf8").catch(() => ""));
      if (!raw.trim()) {
        return null;
      }
      const match = raw.match(/Created conversation\s+([0-9a-fA-F-]+)/i) ||
                    raw.match(/found conversation\s+([0-9a-fA-F-]+)/i) ||
                    raw.match(/switching to conversation\s+([0-9a-fA-F-]+)/i) ||
                    raw.match(/GetConversationDetail:\s+found\s+conversation\s+([0-9a-fA-F-]+)/i);
      return match ? match[1] : null;
    } catch {
      return null;
    }
}

export async function readAntigravityTranscript(
    cwd: string,
    conversationId: string,
    executionMode: CliWorkflowSettings["executionMode"],
    dockerRunner: Pick<IDockerRunner, "readWorkspaceFile">
  ): Promise<string | null> {
    const candidates = [
      executionMode === "DOCKER"
        ? pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl")
        : path.join(os.homedir(), ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl"),
      executionMode === "DOCKER"
        ? pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "overview.txt")
        : path.join(os.homedir(), ".gemini", "antigravity-cli", "brain", conversationId, ".system_generated", "logs", "overview.txt"),
      executionMode === "DOCKER"
        ? pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl")
        : path.join(os.homedir(), ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "transcript.jsonl"),
      executionMode === "DOCKER"
        ? pathPosix.join(CONTAINER_RUNTIME_HOME, ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "overview.txt")
        : path.join(os.homedir(), ".gemini", "antigravity", "brain", conversationId, ".system_generated", "logs", "overview.txt"),
    ];

    for (const p of candidates) {
      const raw = executionMode === "DOCKER"
        ? await dockerRunner.readWorkspaceFile?.(cwd, p).catch(() => null)
        : await fs.readFile(p, "utf8").catch(() => null);
      if (raw) {
        return raw;
      }
    }
    return null;
}
