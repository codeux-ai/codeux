import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { countTokens as countAnthropicTokens } from "@anthropic-ai/tokenizer";
import { encodingForModel } from "js-tiktoken";
import type { TokenUsageSource } from "../../../contracts/execution-types.js";

export interface ProviderUsageTelemetry {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  usageSource: TokenUsageSource;
  rawUsageJson: Record<string, unknown> | null;
  transcriptText: string;
  nativeSessionId: string | null;
}

function emptyTelemetry(): ProviderUsageTelemetry {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    usageSource: "unavailable",
    rawUsageJson: null,
    transcriptText: "",
    nativeSessionId: null,
  };
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

interface NormalizedUsageCounts {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function normalizeUsageCounts(
  usage: Record<string, unknown>,
  args?: {
    promptKeys?: string[];
    completionKeys?: string[];
    totalKeys?: string[];
  },
): NormalizedUsageCounts {
  const promptKeys = args?.promptKeys ?? ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens", "input"];
  const completionKeys = args?.completionKeys ?? ["output_tokens", "completion_tokens", "outputTokens", "completionTokens", "candidates"];
  const totalKeys = args?.totalKeys ?? ["total_tokens", "totalTokens", "totalTokenCount", "total"];

  const promptTokens = promptKeys.reduce((value, key) => value || toNumber(usage[key]), 0);
  const completionTokens = completionKeys.reduce((value, key) => value || toNumber(usage[key]), 0);
  const explicitTotal = totalKeys.reduce((value, key) => value || toNumber(usage[key]), 0);
  const totalTokens = explicitTotal > 0 ? explicitTotal : promptTokens + completionTokens;
  return { promptTokens, completionTokens, totalTokens };
}

function tokenizeWithCodexModel(model: string | null | undefined, text: string): number {
  const normalized = typeof model === "string" && model.trim().length > 0 ? model.trim() : "gpt-4o";
  try {
    const encoding = encodingForModel(normalized as Parameters<typeof encodingForModel>[0]);
    return encoding.encode(text).length;
  } catch {
    const encoding = encodingForModel("gpt-4o");
    return encoding.encode(text).length;
  }
}

function estimateTextTokens(provider: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity", model: string | null | undefined, text: string): number {
  if (!text.trim()) {
    return 0;
  }
  if (provider === "claude-code") {
    return countAnthropicTokens(text);
  }
  if (provider === "codex") {
    return tokenizeWithCodexModel(model, text);
  }

  // Gemini CLI can suppress machine-readable stats when native MCP tools are enabled.
  // Use the same conservative character heuristic used for non-native telemetry.
  return Math.ceil(text.length / 4);
}

function estimateTelemetry(provider: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity", model: string | null | undefined, inputText: string, outputText: string): ProviderUsageTelemetry {
  const inputTokens = estimateTextTokens(provider, model, inputText);
  const outputTokens = estimateTextTokens(provider, model, outputText);
  return {
    inputTokens,
    cachedInputTokens: 0,
    outputTokens,
    reasoningOutputTokens: 0,
    totalTokens: inputTokens + outputTokens,
    usageSource: "estimated",
    rawUsageJson: null,
    transcriptText: outputText,
    nativeSessionId: null,
  };
}

function parseGeminiTokens(stats: Record<string, unknown> | null): ProviderUsageTelemetry | null {
  if (!stats) {
    return null;
  }

  const directTokens = stats.tokens && typeof stats.tokens === "object" ? stats.tokens as Record<string, unknown> : null;
  if (directTokens) {
    const normalized = normalizeUsageCounts(directTokens, {
      promptKeys: ["input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
      completionKeys: ["candidates", "output", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
      totalKeys: ["total", "total_tokens", "totalTokens", "totalTokenCount"],
    });
    const inputTokens = normalized.promptTokens;
    const cachedInputTokens = toNumber(directTokens.cached);
    const outputTokens = normalized.completionTokens;
    const reasoningOutputTokens = toNumber(directTokens.thoughts);
    const totalTokens = Math.max(normalized.totalTokens, inputTokens + outputTokens + reasoningOutputTokens);
    if (totalTokens > 0) {
      return {
        ...emptyTelemetry(),
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        usageSource: "reported",
        rawUsageJson: stats,
      };
    }
  }

  const models = stats.models && typeof stats.models === "object" ? Object.values(stats.models as Record<string, unknown>) : [];
  if (models.length > 0) {
    let inputTokens = 0;
    let cachedInputTokens = 0;
    let outputTokens = 0;
    let reasoningOutputTokens = 0;
    for (const entry of models) {
      const tokens = entry && typeof entry === "object" ? (entry as Record<string, unknown>).tokens : null;
      if (!tokens || typeof tokens !== "object") {
        continue;
      }
      const normalized = normalizeUsageCounts(tokens as Record<string, unknown>, {
        promptKeys: ["input", "input_tokens", "inputTokens", "prompt_tokens", "promptTokens"],
        completionKeys: ["candidates", "output", "output_tokens", "outputTokens", "completion_tokens", "completionTokens"],
        totalKeys: ["total", "total_tokens", "totalTokens", "totalTokenCount"],
      });
      inputTokens += normalized.promptTokens;
      cachedInputTokens += toNumber((tokens as Record<string, unknown>).cached);
      outputTokens += normalized.completionTokens;
      reasoningOutputTokens += toNumber((tokens as Record<string, unknown>).thoughts);
    }
    const totalTokens = inputTokens + outputTokens + reasoningOutputTokens;
    if (totalTokens > 0) {
      return {
        ...emptyTelemetry(),
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens,
        usageSource: "reported",
        rawUsageJson: stats,
      };
    }
  }

  return null;
}

function parseUsageObject(usage: Record<string, unknown>): { inputTokens: number; cachedInputTokens: number; outputTokens: number; reasoningOutputTokens: number } {
  const normalized = normalizeUsageCounts(usage, {
    promptKeys: ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens", "input"],
    completionKeys: ["output_tokens", "completion_tokens", "outputTokens", "completionTokens", "output", "completion"],
    totalKeys: ["total_tokens", "totalTokens", "totalTokenCount", "total"],
  });
  const inputTokens = normalized.promptTokens;
  let outputTokens = normalized.completionTokens;

  let cachedInputTokens = toNumber(usage.cached_input_tokens ?? 0);
  if (cachedInputTokens === 0) {
    const details = (usage.input_token_details ?? usage.prompt_tokens_details ?? usage.input_tokens_details) as Record<string, unknown> | undefined;
    if (details && typeof details === "object") {
      cachedInputTokens = toNumber(details.cached_tokens ?? 0);
    }
  }

  let reasoningOutputTokens = toNumber(usage.reasoning_output_tokens ?? 0);
  if (reasoningOutputTokens === 0) {
    const details = (usage.output_token_details ?? usage.completion_tokens_details ?? usage.output_tokens_details) as Record<string, unknown> | undefined;
    if (details && typeof details === "object") {
      reasoningOutputTokens = toNumber(details.reasoning_tokens ?? 0);
    }
  }

  // When providers report only total+prompt, infer completion safely.
  if (outputTokens <= 0 && normalized.totalTokens > inputTokens) {
    outputTokens = Math.max(0, normalized.totalTokens - inputTokens);
  }

  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
}

export function parseCodexSessionJson(content: string): ProviderUsageTelemetry | null {
  const session = parseJsonObject(content.trim());
  if (!session) return null;

  // Try top-level cumulative usage fields first
  for (const key of ["total_usage", "usage", "total_token_usage"]) {
    const usageObj = session[key];
    if (!usageObj || typeof usageObj !== "object") continue;
    const parsed = parseUsageObject(usageObj as Record<string, unknown>);
    if (parsed.inputTokens + parsed.outputTokens > 0) {
      return {
        ...emptyTelemetry(),
        ...parsed,
        totalTokens: parsed.inputTokens + parsed.outputTokens,
        usageSource: "reported",
        rawUsageJson: usageObj as Record<string, unknown>,
      };
    }
  }

  // Walk turns/messages/items and aggregate per-turn usage
  const itemsKey = (["turns", "messages", "items", "history"] as const).find(k => Array.isArray(session[k]));
  if (itemsKey) {
    let inputTokens = 0, cachedInputTokens = 0, outputTokens = 0, reasoningOutputTokens = 0;
    for (const item of session[itemsKey] as unknown[]) {
      if (!item || typeof item !== "object") continue;
      const itemUsage = (item as Record<string, unknown>).usage;
      if (!itemUsage || typeof itemUsage !== "object") continue;
      const parsed = parseUsageObject(itemUsage as Record<string, unknown>);
      inputTokens += parsed.inputTokens;
      cachedInputTokens += parsed.cachedInputTokens;
      outputTokens += parsed.outputTokens;
      reasoningOutputTokens += parsed.reasoningOutputTokens;
    }
    if (inputTokens + outputTokens > 0) {
      return {
        ...emptyTelemetry(),
        inputTokens,
        cachedInputTokens,
        outputTokens,
        reasoningOutputTokens,
        totalTokens: inputTokens + outputTokens,
        usageSource: "reported",
        rawUsageJson: session,
      };
    }
  }

  return null;
}

function parseCodexJsonLines(stdout: string): ProviderUsageTelemetry | null {
  let latestUsage: Record<string, unknown> | null = null;
  for (const line of stdout.split("\n")) {
    const parsed = parseJsonObject(line.trim());
    if (!parsed) {
      continue;
    }
    const payload = parsed.payload && typeof parsed.payload === "object" ? parsed.payload as Record<string, unknown> : null;
    const type = typeof parsed.type === "string" ? parsed.type : typeof payload?.type === "string" ? payload.type : null;
    if (type !== "token_count" || !payload) {
      continue;
    }
    const info = payload.info && typeof payload.info === "object" ? payload.info as Record<string, unknown> : null;
    const totalUsage = info?.total_token_usage && typeof info.total_token_usage === "object"
      ? info.total_token_usage as Record<string, unknown>
      : null;
    if (totalUsage) {
      latestUsage = totalUsage;
    }
  }

  if (!latestUsage) {
    return null;
  }
  const parsedUsage = parseUsageObject(latestUsage);

  return {
    ...emptyTelemetry(),
    inputTokens: parsedUsage.inputTokens,
    cachedInputTokens: parsedUsage.cachedInputTokens,
    outputTokens: parsedUsage.outputTokens,
    reasoningOutputTokens: parsedUsage.reasoningOutputTokens,
    totalTokens: parsedUsage.inputTokens + parsedUsage.outputTokens,
    usageSource: "reported",
    rawUsageJson: latestUsage,
  };
}

function parseOpenCodeJsonLines(stdout: string): { transcriptText: string; inputTokens: number; outputTokens: number; nativeSessionId: string | null } | null {
  const textParts: string[] = [];
  let inputTokens = 0;
  let outputTokens = 0;
  let nativeSessionId: string | null = null;
  let foundEvent = false;

  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const parsed = parseJsonObject(trimmed);
    if (!parsed || typeof parsed.type !== "string") {
      continue;
    }
    foundEvent = true;

    const part = parsed.part && typeof parsed.part === "object" ? parsed.part as Record<string, unknown> : null;
    const properties = parsed.properties && typeof parsed.properties === "object" ? parsed.properties as Record<string, unknown> : null;
    const info = properties?.info && typeof properties.info === "object" ? properties.info as Record<string, unknown> : null;

    if (!nativeSessionId && typeof properties?.sessionID === "string") {
      nativeSessionId = properties.sessionID;
    }
    if (!nativeSessionId && typeof info?.id === "string") {
      nativeSessionId = info.id;
    }

    if (parsed.type === "text" && part?.type === "text" && typeof part.text === "string" && part.text.trim()) {
      textParts.push(part.text.trim());
    }

    if (parsed.type === "step_finish" && part) {
      const usage = part.usage && typeof part.usage === "object" ? part.usage as Record<string, unknown> : null;
      if (usage) {
        inputTokens += toNumber(usage.promptTokens ?? usage.inputTokens ?? usage.input_tokens ?? 0);
        outputTokens += toNumber(usage.completionTokens ?? usage.outputTokens ?? usage.output_tokens ?? 0);
      }
    }
  }

  if (!foundEvent) {
    return null;
  }

  return { transcriptText: textParts.join("\n\n").trim(), inputTokens, outputTokens, nativeSessionId };
}

function extractClaudeTranscript(lines: Array<Record<string, unknown>>): string {
  const parts: string[] = [];
  for (const line of lines) {
    const message = line.message && typeof line.message === "object" ? line.message as Record<string, unknown> : null;
    const content = Array.isArray(message?.content) ? message!.content as Array<Record<string, unknown>> : [];
    for (const item of content) {
      if (item?.type === "text" && typeof item.text === "string") {
        parts.push(item.text);
      }
    }
  }
  return parts.join("\n").trim();
}

async function parseClaudeSessionTelemetry(cwd: string, nativeSessionId: string): Promise<ProviderUsageTelemetry | null> {
  // Claude Code slugifies cwd for its projects directory by replacing path
  // separators and drive-letter colons. Handle both Unix ("/") and Windows
  // ("\\", "C:") forms so the lookup works on every host.
  const slug = cwd.replace(/[/\\:]/g, "-");
  const sessionPath = path.join(os.homedir(), ".claude", "projects", slug, `${nativeSessionId}.jsonl`);
  const raw = await fs.readFile(sessionPath, "utf8").catch(() => "");
  return parseClaudeSessionJsonl(raw, nativeSessionId, { sessionPath });
}

function parseClaudeSessionJsonl(
  raw: string,
  nativeSessionId: string,
  rawUsageJson: Record<string, unknown> | null,
): ProviderUsageTelemetry | null {
  if (!raw.trim()) {
    return null;
  }

  const parsedLines = raw.split("\n")
    .map((line) => parseJsonObject(line.trim()))
    .filter((line): line is Record<string, unknown> => Boolean(line));
  if (parsedLines.length === 0) {
    return null;
  }

  let inputTokens = 0;
  let cachedInputTokens = 0;
  let outputTokens = 0;
  for (const line of parsedLines) {
    const message = line.message && typeof line.message === "object" ? line.message as Record<string, unknown> : null;
    const usage = message?.usage && typeof message.usage === "object" ? message.usage as Record<string, unknown> : null;
    if (!usage) {
      continue;
    }
    inputTokens += toNumber(usage.input_tokens);
    cachedInputTokens += toNumber(usage.cache_creation_input_tokens) + toNumber(usage.cache_read_input_tokens);
    outputTokens += toNumber(usage.output_tokens);
  }

  const totalTokens = inputTokens + outputTokens;
  if (totalTokens === 0) {
    return {
      ...emptyTelemetry(),
      transcriptText: extractClaudeTranscript(parsedLines),
      nativeSessionId,
    };
  }

  return {
    ...emptyTelemetry(),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    usageSource: "reported",
    rawUsageJson,
    transcriptText: extractClaudeTranscript(parsedLines),
    nativeSessionId,
  };
}

export interface QwenUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

/**
 * Extracts token usage from a single qwen-code OpenAI log record. Each log file
 * is `{ timestamp, request, response, error, context, system }`, where the
 * provider-reported usage lives on the OpenAI `response.usage` object. Older
 * loggers (and our tests) place a bare `usage` at the top level, so we fall back
 * to that. Returns null when no usage object is present (e.g. error-only logs).
 */
export function extractQwenUsageRecord(record: unknown): QwenUsageTotals | null {
  if (!record || typeof record !== "object") return null;
  const root = record as Record<string, unknown>;
  const response = root.response && typeof root.response === "object"
    ? root.response as Record<string, unknown>
    : null;
  const usage = (response?.usage && typeof response.usage === "object")
    ? response.usage as Record<string, unknown>
    : (root.usage && typeof root.usage === "object")
      ? root.usage as Record<string, unknown>
      : null;
  if (!usage) return null;

  const cachedDetails = usage.prompt_tokens_details && typeof usage.prompt_tokens_details === "object"
    ? usage.prompt_tokens_details as Record<string, unknown>
    : null;

  return {
    inputTokens: toNumber(usage.prompt_tokens ?? usage.input_tokens ?? 0),
    outputTokens: toNumber(usage.completion_tokens ?? usage.output_tokens ?? 0),
    cachedInputTokens: toNumber(cachedDetails?.cached_tokens ?? usage.cached_tokens ?? 0),
  };
}

/** Sums usage across many qwen-code log records. Returns null when none report usage. */
export function sumQwenOpenAiUsage(records: unknown[]): QwenUsageTotals | null {
  const totals: QwenUsageTotals = { inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 };
  let found = false;
  for (const record of records) {
    const usage = extractQwenUsageRecord(record);
    if (usage) {
      totals.inputTokens += usage.inputTokens;
      totals.cachedInputTokens += usage.cachedInputTokens;
      totals.outputTokens += usage.outputTokens;
      found = true;
    }
  }
  return found ? totals : null;
}

/**
 * Reads qwen-code OpenAI log files from a host-visible directory and aggregates
 * their usage. Only files modified at/after the invocation start are counted so
 * stale logs from earlier runs sharing the directory are ignored.
 */
export async function parseQwenOpenAiLogs(
  logDir: string,
  startTimeMs: number,
): Promise<QwenUsageTotals | null> {
  try {
    const files = await fs.readdir(logDir);
    const jsonFiles = files.filter(f => f.endsWith(".json"));
    if (jsonFiles.length === 0) return null;

    const records: unknown[] = [];
    for (const file of jsonFiles) {
      const filePath = path.join(logDir, file);
      const stat = await fs.stat(filePath).catch(() => null);
      if (stat && stat.mtimeMs >= startTimeMs - 2000) {
        const content = await fs.readFile(filePath, "utf8").catch(() => "");
        try {
          records.push(JSON.parse(content));
        } catch {
          // ignore unparseable log files
        }
      }
    }

    return sumQwenOpenAiUsage(records);
  } catch {
    return null;
  }
}

export async function collectProviderUsageTelemetry(args: {
  provider: "gemini" | "codex" | "claude-code" | "qwen-code" | "opencode" | "antigravity";
  model: string;
  prompt: string;
  cwd: string;
  stdout: string;
  stderr: string;
  capturedText?: string;
  nativeSessionId?: string | null;
  claudeSessionJsonl?: string | null;
  codexSessionJson?: string | null;
  qwenReportedUsage?: QwenUsageTotals | null;
  startTimeMs?: number;
  executionMode?: "HOST" | "DOCKER";
}): Promise<ProviderUsageTelemetry> {
  const fallbackOutput = [args.capturedText || "", args.stdout || "", args.stderr || ""].filter(Boolean).join("\n").trim();

  if (args.provider === "gemini") {
    const parsed = parseJsonObject(args.stdout);
    const stats = parsed?.stats && typeof parsed.stats === "object" ? parsed.stats as Record<string, unknown> : null;
    const usage = parseGeminiTokens(stats);
    if (usage) {
      usage.transcriptText = typeof parsed?.response === "string" ? parsed.response : fallbackOutput;
      usage.nativeSessionId = typeof parsed?.session_id === "string" ? parsed.session_id : null;
      return usage;
    }
    const estimated = estimateTelemetry("gemini", args.model, args.prompt, typeof parsed?.response === "string" ? parsed.response : fallbackOutput);
    estimated.nativeSessionId = typeof parsed?.session_id === "string" ? parsed.session_id : null;
    return estimated;
  }

  if (args.provider === "codex") {
    const transcriptText = args.capturedText?.trim() || fallbackOutput;
    const usage = parseCodexJsonLines(args.stdout);
    if (usage) {
      usage.transcriptText = transcriptText;
      return usage;
    }
    if (args.codexSessionJson) {
      const sessionUsage = parseCodexSessionJson(args.codexSessionJson);
      if (sessionUsage) {
        sessionUsage.transcriptText = transcriptText;
        return sessionUsage;
      }
    }
    return estimateTelemetry("codex", args.model, args.prompt, transcriptText);
  }

  if (args.provider === "opencode") {
    const parsed = parseOpenCodeJsonLines(args.stdout);
    if (parsed) {
      const transcriptText = parsed.transcriptText || fallbackOutput;
      if (parsed.inputTokens > 0 || parsed.outputTokens > 0) {
        return {
          ...emptyTelemetry(),
          inputTokens: parsed.inputTokens,
          outputTokens: parsed.outputTokens,
          totalTokens: parsed.inputTokens + parsed.outputTokens,
          usageSource: "reported",
          rawUsageJson: null,
          transcriptText,
          nativeSessionId: parsed.nativeSessionId,
        };
      }
      const estimated = estimateTelemetry("opencode", args.model, args.prompt, transcriptText);
      estimated.nativeSessionId = parsed.nativeSessionId;
      return estimated;
    }
    return estimateTelemetry("opencode", args.model, args.prompt, fallbackOutput);
  }

  if (args.provider === "antigravity") {
    return estimateTelemetry("antigravity", args.model, args.prompt, fallbackOutput);
  }

  if (args.provider === "qwen-code") {
    // Usage is read from the qwen-code OpenAI logs by the caller (provider-runner),
    // which resolves the host-visible log directory for both HOST and DOCKER modes.
    const exactUsage = args.qwenReportedUsage;
    if (exactUsage && (exactUsage.inputTokens > 0 || exactUsage.outputTokens > 0)) {
      return {
        ...emptyTelemetry(),
        inputTokens: exactUsage.inputTokens,
        cachedInputTokens: exactUsage.cachedInputTokens,
        outputTokens: exactUsage.outputTokens,
        totalTokens: exactUsage.inputTokens + exactUsage.outputTokens,
        usageSource: "reported",
        rawUsageJson: null,
        transcriptText: fallbackOutput,
        nativeSessionId: args.nativeSessionId || null,
      };
    }

    const telemetry = estimateTelemetry("qwen-code", args.model, args.prompt, fallbackOutput);
    telemetry.nativeSessionId = args.nativeSessionId || null;
    return telemetry;
  }

  if (args.nativeSessionId) {
    if (args.claudeSessionJsonl) {
      const usage = parseClaudeSessionJsonl(args.claudeSessionJsonl, args.nativeSessionId, { source: "container-session-jsonl" });
      if (usage && usage.totalTokens > 0) {
        return usage;
      }
      if (usage) {
        return estimateTelemetry("claude-code", args.model, args.prompt, usage.transcriptText || fallbackOutput);
      }
    }
    const usage = await parseClaudeSessionTelemetry(args.cwd, args.nativeSessionId);
    if (usage && usage.totalTokens > 0) {
      return usage;
    }
    if (usage) {
      return estimateTelemetry("claude-code", args.model, args.prompt, usage.transcriptText || fallbackOutput);
    }
  }

  return estimateTelemetry("claude-code", args.model, args.prompt, fallbackOutput);
}
