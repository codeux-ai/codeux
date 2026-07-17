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
import { extractJsonContainer } from "./provider-logs/usage-parse-utils.js";
import { IDockerRunner } from "./docker-runner.js";
import type {
  ProviderTranscriptChunk,
  ProviderTranscriptCursor,
} from "./provider-transcript-chunks.js";

const DEFAULT_TRANSCRIPT_CHUNK_BYTES = 2 * 1024 * 1024;
const MAX_FALLBACK_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_ANTIGRAVITY_TRANSCRIPT_BYTES = 8 * 1024 * 1024;
const MAX_ANTIGRAVITY_LOG_BYTES = 512 * 1024;

interface CodexSessionDateParts {
  year: string;
  month: string;
  day: string;
}

function codexSessionDateParts(date: Date, utc: boolean): CodexSessionDateParts {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
  const day = utc ? date.getUTCDate() : date.getDate();
  return {
    year: year.toString(),
    month: month.toString().padStart(2, "0"),
    day: day.toString().padStart(2, "0"),
  };
}

function resolveCodexSessionDateCandidates(nativeSessionId: string): CodexSessionDateParts[] {
  const compactId = nativeSessionId.replaceAll("-", "");
  const timestampHex = compactId.slice(0, 12);
  const timestampMs = /^[a-f0-9]{12}$/i.test(timestampHex)
    ? Number.parseInt(timestampHex, 16)
    : Number.NaN;
  const sessionDate = Number.isFinite(timestampMs) ? new Date(timestampMs) : new Date();
  const candidates = [
    codexSessionDateParts(sessionDate, true),
    codexSessionDateParts(sessionDate, false),
  ];
  return candidates.filter((candidate, index, all) => (
    all.findIndex((item) => (
      item.year === candidate.year
      && item.month === candidate.month
      && item.day === candidate.day
    )) === index
  ));
}

function codexRolloutGlob(nativeSessionId: string): string | null {
  const normalized = nativeSessionId.trim();
  return /^[A-Za-z0-9_-]+$/.test(normalized)
    ? `*-${normalized}.jsonl`
    : null;
}

async function resolveLatestCodexHostSessionPath(): Promise<string | null> {
  const now = new Date();
  const sessionsDir = path.join(
    os.homedir(),
    ".codex",
    "sessions",
    now.getFullYear().toString(),
    (now.getMonth() + 1).toString().padStart(2, "0"),
    now.getDate().toString().padStart(2, "0"),
  );
  try {
    const files = (await fs.readdir(sessionsDir)).filter((file) => file.endsWith(".jsonl"));
    const candidates = await Promise.all(files.map(async (file) => {
      const filePath = path.join(sessionsDir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      return { filePath, mtimeMs: stat?.mtimeMs ?? 0 };
    }));
    candidates.sort((left, right) => right.mtimeMs - left.mtimeMs);
    return candidates[0]?.filePath ?? null;
  } catch {
    return null;
  }
}

async function readHostFileChunk(
  filePath: string,
  cursor: ProviderTranscriptCursor,
  maxBytes = DEFAULT_TRANSCRIPT_CHUNK_BYTES,
): Promise<ProviderTranscriptChunk | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat?.isFile()) {
    return null;
  }
  const sourceId = `${stat.dev}:${stat.ino}`;
  const reset = cursor.sourceId !== sourceId || stat.size < cursor.offset;
  const startOffset = reset ? 0 : cursor.offset;
  const byteCount = Math.min(Math.max(stat.size - startOffset, 0), maxBytes);
  const buffer = Buffer.allocUnsafe(byteCount);
  if (byteCount > 0) {
    const handle = await fs.open(filePath, "r");
    try {
      await handle.read(buffer, 0, byteCount, startOffset);
    } finally {
      await handle.close();
    }
  }
  return {
    sourceId,
    startOffset,
    nextOffset: startOffset + byteCount,
    totalBytes: stat.size,
    contentBase64: buffer.toString("base64"),
    reset,
  };
}

async function readHostFileTail(filePath: string, maxBytes: number): Promise<string | null> {
  const stat = await fs.stat(filePath).catch(() => null);
  if (!stat || typeof stat.isFile !== "function" || !stat.isFile()) {
    // Compatibility fallback for virtual/mocked filesystems that implement
    // readFile but not stat/open. Real filesystem reads take the bounded path.
    const value = await fs.readFile(filePath, "utf8").catch(() => null);
    return value && value.length > maxBytes ? value.slice(-maxBytes) : value;
  }
  const byteCount = Math.min(stat.size, maxBytes);
  const buffer = Buffer.allocUnsafe(byteCount);
  const handle = await fs.open(filePath, "r");
  try {
    await handle.read(buffer, 0, byteCount, Math.max(0, stat.size - byteCount));
  } finally {
    await handle.close();
  }
  return buffer.toString("utf8");
}

export async function readCodexLatestSessionChunk(
  cwd: string,
  executionMode: CliWorkflowSettings["executionMode"],
  cursor: ProviderTranscriptCursor,
  dockerRunner: Pick<IDockerRunner, "readLatestWorkspaceFileChunk">,
): Promise<ProviderTranscriptChunk | null> {
  if (executionMode === "DOCKER") {
    const now = new Date();
    const sessionsDir = pathPosix.join(
      CONTAINER_RUNTIME_HOME,
      ".codex",
      "sessions",
      now.getFullYear().toString(),
      (now.getMonth() + 1).toString().padStart(2, "0"),
      now.getDate().toString().padStart(2, "0"),
    );
    return await dockerRunner.readLatestWorkspaceFileChunk?.(
      cwd,
      sessionsDir,
      "*.jsonl",
      cursor,
      DEFAULT_TRANSCRIPT_CHUNK_BYTES,
    ) ?? null;
  }
  const filePath = await resolveLatestCodexHostSessionPath();
  return filePath ? readHostFileChunk(filePath, cursor) : null;
}

export async function readCodexSessionChunk(
  cwd: string,
  nativeSessionId: string,
  executionMode: CliWorkflowSettings["executionMode"],
  cursor: ProviderTranscriptCursor,
  dockerRunner: Pick<IDockerRunner, "readLatestWorkspaceFileChunk">,
): Promise<ProviderTranscriptChunk | null> {
  const rolloutGlob = codexRolloutGlob(nativeSessionId);
  if (!rolloutGlob) {
    return null;
  }
  for (const date of resolveCodexSessionDateCandidates(nativeSessionId)) {
    const sessionsDir = executionMode === "DOCKER"
      ? pathPosix.join(
          CONTAINER_RUNTIME_HOME,
          ".codex",
          "sessions",
          date.year,
          date.month,
          date.day,
        )
      : path.join(
          os.homedir(),
          ".codex",
          "sessions",
          date.year,
          date.month,
          date.day,
        );
    if (executionMode === "DOCKER") {
      const chunk = await dockerRunner.readLatestWorkspaceFileChunk?.(
        cwd,
        sessionsDir,
        rolloutGlob,
        cursor,
        DEFAULT_TRANSCRIPT_CHUNK_BYTES,
      ) ?? null;
      if (chunk) {
        return chunk;
      }
      continue;
    }
    try {
      const rolloutFile = (await fs.readdir(sessionsDir))
        .find((file) => file.endsWith(`-${nativeSessionId}.jsonl`));
      if (rolloutFile) {
        return await readHostFileChunk(path.join(sessionsDir, rolloutFile), cursor);
      }
    } catch {
      // Try the next UTC/local date candidate.
    }
  }
  return null;
}

export async function readClaudeSessionJsonlChunk(
  cwd: string,
  nativeSessionId: string,
  executionMode: CliWorkflowSettings["executionMode"],
  cursor: ProviderTranscriptCursor,
  dockerRunner: Pick<IDockerRunner, "readWorkspaceFileChunk">,
): Promise<ProviderTranscriptChunk | null> {
  const slug = cwd.replace(/[/\\:]/g, "-");
  const sessionPath = executionMode === "DOCKER"
    ? pathPosix.join(
        CONTAINER_RUNTIME_HOME,
        ".claude",
        "projects",
        CONTAINER_WORKSPACE_ROOT.replaceAll(pathPosix.sep, "-"),
        `${nativeSessionId}.jsonl`,
      )
    : path.join(
        process.env.HOME || process.env.USERPROFILE || os.homedir(),
        ".claude",
        "projects",
        slug,
        `${nativeSessionId}.jsonl`,
      );
  if (executionMode === "DOCKER") {
    return await dockerRunner.readWorkspaceFileChunk?.(
      cwd,
      sessionPath,
      cursor,
      DEFAULT_TRANSCRIPT_CHUNK_BYTES,
    ) ?? null;
  }
  return readHostFileChunk(sessionPath, cursor);
}

function recoverJsonObjectRecords(value: string): Record<string, unknown>[] {
  const records: Record<string, unknown>[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const objectStart = value.indexOf("{", cursor);
    if (objectStart < 0) break;
    const parsed = extractJsonContainer<Record<string, unknown>>(value.slice(objectStart), "object");
    if (parsed.ok) {
      records.push(parsed.value);
      cursor = objectStart + parsed.endIndex;
    } else {
      cursor = objectStart + 1;
    }
  }
  return records;
}

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
      const parsed = extractJsonContainer<unknown[]>(arrayJson, "array");
      records = parsed.ok
        ? parsed.value
        : (arrayJson.includes("[") ? recoverJsonObjectRecords(arrayJson) : []);
    } else {
      records = await readQwenOpenAiLogRecords(resolveQwenHostLogDir(sessionId), startTimeMs);
    }
    if (records.length === 0) {
      return null;
    }
    return { usage: sumQwenOpenAiUsage(records, startTimeMs), conversation: buildQwenConversation(records, startTimeMs) };
}

export async function readCodexLatestSessionJson(
  cwd: string,
  executionMode: CliWorkflowSettings["executionMode"],
  dockerRunner: Pick<IDockerRunner, "readLatestWorkspaceFile">,
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
    return await readHostFileTail(
      withMtimes[0].filePath,
      MAX_FALLBACK_TRANSCRIPT_BYTES,
    ).catch(() => null);
  } catch {
    return null;
  }
}

export async function readCodexSessionJson(
  cwd: string,
  nativeSessionId: string,
  executionMode: CliWorkflowSettings["executionMode"],
  dockerRunner: Pick<IDockerRunner, "readLatestWorkspaceFile">,
): Promise<string | null> {
  const rolloutGlob = codexRolloutGlob(nativeSessionId);
  if (!rolloutGlob) {
    return null;
  }
  for (const date of resolveCodexSessionDateCandidates(nativeSessionId)) {
    const sessionsDir = executionMode === "DOCKER"
      ? pathPosix.join(
          CONTAINER_RUNTIME_HOME,
          ".codex",
          "sessions",
          date.year,
          date.month,
          date.day,
        )
      : path.join(
          os.homedir(),
          ".codex",
          "sessions",
          date.year,
          date.month,
          date.day,
        );
    if (executionMode === "DOCKER") {
      const contents = await dockerRunner.readLatestWorkspaceFile?.(
        cwd,
        sessionsDir,
        rolloutGlob,
      ).catch(() => null) ?? null;
      if (contents) {
        return contents;
      }
      continue;
    }
    try {
      const rolloutFile = (await fs.readdir(sessionsDir))
        .find((file) => file.endsWith(`-${nativeSessionId}.jsonl`));
      if (rolloutFile) {
        return await readHostFileTail(
          path.join(sessionsDir, rolloutFile),
          MAX_FALLBACK_TRANSCRIPT_BYTES,
        ).catch(() => null);
      }
    } catch {
      // Try the next UTC/local date candidate.
    }
  }
  return null;
}

export async function readCodexHostSessionMetadata(
  nativeSessionId: string,
): Promise<string | null> {
  if (!codexRolloutGlob(nativeSessionId)) {
    return null;
  }
  for (const date of resolveCodexSessionDateCandidates(nativeSessionId)) {
    const sessionsDir = path.join(
      os.homedir(),
      ".codex",
      "sessions",
      date.year,
      date.month,
      date.day,
    );
    try {
      const rolloutFile = (await fs.readdir(sessionsDir))
        .find((file) => file.endsWith(`-${nativeSessionId}.jsonl`));
      if (!rolloutFile) {
        continue;
      }
      const filePath = path.join(sessionsDir, rolloutFile);
      const fileStat = await fs.stat(filePath).catch(() => null);
      return fileStat
        ? `${filePath}:${fileStat.size}:${Math.trunc(fileStat.mtimeMs)}`
        : null;
    } catch {
      // Try the next UTC/local date candidate.
    }
  }
  return null;
}

export async function readClaudeSessionJsonl(
    cwd: string,
    nativeSessionId: string,
    executionMode: CliWorkflowSettings["executionMode"],
    dockerRunner: Pick<IDockerRunner, "readWorkspaceFile">
  ): Promise<string | null> {
    if (executionMode === "DOCKER") {
      const sessionPath = pathPosix.join(
        CONTAINER_RUNTIME_HOME,
        ".claude",
        "projects",
        CONTAINER_WORKSPACE_ROOT.replaceAll(pathPosix.sep, "-"),
        `${nativeSessionId}.jsonl`,
      );
      return (await dockerRunner.readWorkspaceFile?.(cwd, sessionPath).catch(() => null)) || null;
    }

    const slug = cwd.replace(/[/\\:]/g, "-");
    const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
    const sessionPath = path.join(homeDir, ".claude", "projects", slug, `${nativeSessionId}.jsonl`);
    return (await readHostFileTail(
      sessionPath,
      MAX_FALLBACK_TRANSCRIPT_BYTES,
    ).catch(() => null)) || null;
}

export async function parseAntigravityConversationId(
    cwd: string,
    logPath: string,
    executionMode: CliWorkflowSettings["executionMode"],
    dockerRunner: Pick<IDockerRunner, "readWorkspaceFile" | "readWorkspaceFileTail">
  ): Promise<string | null> {
    try {
      const raw = executionMode === "DOCKER"
        ? ((await dockerRunner.readWorkspaceFileTail?.(
            cwd,
            logPath,
            MAX_ANTIGRAVITY_LOG_BYTES,
          ).catch(() => null))
          ?? (await dockerRunner.readWorkspaceFile?.(cwd, logPath).catch(() => null))
          ?? "")
        : ((await readHostFileTail(logPath, MAX_ANTIGRAVITY_LOG_BYTES).catch(() => null)) ?? "");
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
    dockerRunner: Pick<IDockerRunner, "readWorkspaceFile" | "readWorkspaceFileTail">
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
        ? (await dockerRunner.readWorkspaceFileTail?.(
            cwd,
            p,
            MAX_ANTIGRAVITY_TRANSCRIPT_BYTES,
          ).catch(() => null))
          ?? await dockerRunner.readWorkspaceFile?.(cwd, p).catch(() => null)
        : await readHostFileTail(p, MAX_ANTIGRAVITY_TRANSCRIPT_BYTES).catch(() => null);
      if (raw) {
        return raw;
      }
    }
    return null;
}
