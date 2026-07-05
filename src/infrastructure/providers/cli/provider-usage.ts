import * as fs from "fs/promises";
import { createHash } from "crypto";
import * as os from "os";
import * as path from "path";
import { countTokens as countAnthropicTokens } from "@anthropic-ai/tokenizer";
import { encodingForModel } from "js-tiktoken";
import type { TokenUsageSource } from "../../../contracts/execution-types.js";
import type { ParsedConversationTurn } from "./provider-logs/provider-conversation-types.js";
import { parseCodexRolloutJsonl, parseCodexExecStdout } from "./provider-logs/codex-log-parser.js";
import { parseOpenCodeJsonLines, parseOpenCodeExport, subtractOpenCodeBaseline } from "./provider-logs/opencode-log-parser.js";
import {
  buildQwenConversation,
  parseQwenOpenAiLogs,
  readQwenOpenAiLogRecords,
  sumQwenOpenAiUsage,
  extractQwenUsageRecord,
  type QwenUsageTotals,
} from "./provider-logs/qwen-log-parser.js";
import {
  parseClaudeCodeSessionJsonl,
  type ClaudeCodeLogResult,
} from "./provider-logs/claude-code-log-parser.js";
import {
  parseAntigravityDatabase,
  parseAntigravityTranscript,
  type AntigravityUsageTotals,
} from "./provider-logs/antigravity-log-parser.js";

// Re-export the qwen log helpers so existing importers (provider-runner, tests)
// keep their import paths. The implementations now live in provider-logs/.
export {
  parseQwenOpenAiLogs,
  readQwenOpenAiLogRecords,
  sumQwenOpenAiUsage,
  extractQwenUsageRecord,
  buildQwenConversation,
};
export type { QwenUsageTotals };
export type { ParsedConversationTurn };
// Re-export the Claude Code parser so callers can use it directly.
export { parseClaudeCodeSessionJsonl };
export type { ClaudeCodeLogResult };

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
  /** Ordered conversation parsed from the provider's JSON logs (codex / qwen /
   *  opencode). Empty when the provider does not support structured parsing or
   *  the logs were unavailable (estimated usage). */
  conversation: ParsedConversationTurn[];
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
    conversation: [],
  };
}

/** Ensures the conversation starts with the user prompt so every provider
 *  yields a complete, uniform transcript even when its logs omit the prompt. */
function withLeadingUserTurn(conversation: ParsedConversationTurn[], prompt: string): ParsedConversationTurn[] {
  if (conversation.length === 0) {
    return conversation;
  }
  // Harness-injected `<system-reminder>` context is split into a leading
  // `injected_context` turn ahead of the user prompt; treat it as transparent
  // so we neither miss an existing prompt nor synthesise a duplicate one.
  const firstPromptIndex = conversation.findIndex((turn) => turn.kind !== "injected_context");
  if (firstPromptIndex === -1 || conversation[firstPromptIndex]?.kind === "user") {
    return conversation;
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    return conversation;
  }
  return [
    ...conversation.slice(0, firstPromptIndex),
    { kind: "user", text: trimmed },
    ...conversation.slice(firstPromptIndex),
  ];
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

type TiktokenEncoding = ReturnType<typeof encodingForModel>;

const CODEX_ENCODING_CACHE_LIMIT = 8;
const CODEX_TOKEN_CACHE_LIMIT = 768;
const codexEncodingCache = new Map<string, TiktokenEncoding>();
const codexTokenCountCache = new Map<string, number>();
let codexTokenCountCacheHits = 0;
let codexTokenCountCacheMisses = 0;

function rememberBoundedCacheEntry<Key, Value>(
  cache: Map<Key, Value>,
  cacheKey: Key,
  value: Value,
  limit: number,
): Value {
  if (cache.has(cacheKey)) {
    cache.delete(cacheKey);
  }
  while (cache.size >= limit) {
    const oldest = cache.keys().next();
    if (oldest.done) {
      break;
    }
    cache.delete(oldest.value);
  }
  cache.set(cacheKey, value);
  return value;
}

function hashCodexTokenCacheText(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

function buildCodexTokenCountCacheKey(model: string, text: string): string {
  return `${model}:${text.length}:${hashCodexTokenCacheText(text)}`;
}

function getCodexEncoding(model: string): TiktokenEncoding {
  const cached = codexEncodingCache.get(model);
  if (cached) {
    codexEncodingCache.delete(model);
    codexEncodingCache.set(model, cached);
    return cached;
  }
  const encoding = encodingForModel(model as Parameters<typeof encodingForModel>[0]);
  return rememberBoundedCacheEntry(codexEncodingCache, model, encoding, CODEX_ENCODING_CACHE_LIMIT);
}

export const codexTokenEstimationCacheTestHooks = {
  stats(): {
    encodingCacheLimit: number;
    tokenCountCacheLimit: number;
    encodingCacheSize: number;
    tokenCountCacheSize: number;
    tokenCountCacheHits: number;
    tokenCountCacheMisses: number;
    encodingCacheKeys: string[];
    tokenCountCacheKeys: string[];
  } {
    return {
      encodingCacheLimit: CODEX_ENCODING_CACHE_LIMIT,
      tokenCountCacheLimit: CODEX_TOKEN_CACHE_LIMIT,
      encodingCacheSize: codexEncodingCache.size,
      tokenCountCacheSize: codexTokenCountCache.size,
      tokenCountCacheHits: codexTokenCountCacheHits,
      tokenCountCacheMisses: codexTokenCountCacheMisses,
      encodingCacheKeys: [...codexEncodingCache.keys()],
      tokenCountCacheKeys: [...codexTokenCountCache.keys()],
    };
  },
  reset(): void {
    codexEncodingCache.clear();
    codexTokenCountCache.clear();
    codexTokenCountCacheHits = 0;
    codexTokenCountCacheMisses = 0;
  },
};

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
  const cacheKey = buildCodexTokenCountCacheKey(normalized, text);
  const cached = codexTokenCountCache.get(cacheKey);
  if (cached !== undefined) {
    codexTokenCountCacheHits += 1;
    codexTokenCountCache.delete(cacheKey);
    codexTokenCountCache.set(cacheKey, cached);
    return cached;
  }
  codexTokenCountCacheMisses += 1;

  try {
    return rememberBoundedCacheEntry(codexTokenCountCache, cacheKey, getCodexEncoding(normalized).encode(text).length, CODEX_TOKEN_CACHE_LIMIT);
  } catch {
    return rememberBoundedCacheEntry(codexTokenCountCache, cacheKey, getCodexEncoding("gpt-4o").encode(text).length, CODEX_TOKEN_CACHE_LIMIT);
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
    conversation: [],
  };
}

function totalTrackedTokens(inputTokens: number, cachedInputTokens: number, outputTokens: number): number {
  return inputTokens + cachedInputTokens + outputTokens;
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
    const totalTokens = Math.max(normalized.totalTokens, inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens);
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
    const totalTokens = inputTokens + cachedInputTokens + outputTokens + reasoningOutputTokens;
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

function flattenGeminiText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const rec = item && typeof item === "object" ? item as Record<string, unknown> : null;
      if (rec && typeof rec.text === "string") {
        parts.push(rec.text);
      } else if (rec && typeof rec.output_text === "string") {
        parts.push(rec.output_text);
      } else if (typeof item === "string") {
        parts.push(item);
      }
    }
    return parts.join("").trim();
  }
  return "";
}

function geminiPartIsReasoning(part: Record<string, unknown>): boolean {
  const partType = typeof part.type === "string" ? part.type : null;
  return partType === "thinking"
    || partType === "reasoning"
    || partType === "thought"
    || part.thought === true
    || part.thought === "true"
    || part.reasoning != null
    || part.reasoning_content != null
    || part.thinking != null
    || part.summary != null
    || part.summary_text != null;
}

function geminiPartReasoningText(part: Record<string, unknown>): string {
  return flattenGeminiText(
    part.reasoning_content ?? part.reasoning ?? part.thinking ?? part.summary ?? part.summary_text ?? part.text,
  );
}

function geminiPartAssistantText(part: Record<string, unknown>): string {
  const partType = typeof part.type === "string" ? part.type : null;
  if (partType === "text" || partType === "output_text" || partType === "message") {
    return flattenGeminiText(part.text ?? part.output_text ?? part.content);
  }
  if (typeof part.text === "string" && !geminiPartIsReasoning(part)) {
    return part.text.trim();
  }
  return "";
}

function parseGeminiConversation(parsed: Record<string, unknown>): ParsedConversationTurn[] {
  const response = parsed.response && typeof parsed.response === "object" ? parsed.response as Record<string, unknown> : null;
  const candidates = Array.isArray(response?.candidates)
    ? response!.candidates
    : Array.isArray(parsed.candidates)
      ? parsed.candidates
      : [];
  const conversation: ParsedConversationTurn[] = [];

  for (const candidate of candidates) {
    const candidateRec = candidate && typeof candidate === "object" ? candidate as Record<string, unknown> : null;
    const content = candidateRec?.content && typeof candidateRec.content === "object"
      ? candidateRec.content as Record<string, unknown>
      : null;
    const parts = Array.isArray(content?.parts)
      ? content!.parts
      : Array.isArray(candidateRec?.parts)
        ? candidateRec!.parts
        : [];
    if (parts.length === 0) {
      continue;
    }

    let assistantText = "";
    for (const part of parts) {
      const rec = part && typeof part === "object" ? part as Record<string, unknown> : null;
      if (!rec) {
        continue;
      }
      const reasoningText = geminiPartReasoningText(rec);
      if (geminiPartIsReasoning(rec) && reasoningText) {
        conversation.push({ kind: "reasoning", text: reasoningText });
        continue;
      }
      const assistantPartText = geminiPartAssistantText(rec);
      if (assistantPartText) {
        assistantText += assistantPartText;
      }
    }

    if (assistantText.trim()) {
      conversation.push({ kind: "assistant", text: assistantText.trim() });
    }
  }

  if (conversation.length > 0) {
    return conversation;
  }

  const fallbackContent = response?.content && typeof response.content === "object" ? response.content as Record<string, unknown> : null;
  const fallbackParts = Array.isArray(fallbackContent?.parts) ? fallbackContent!.parts : [];
  if (fallbackParts.length === 0) {
    return conversation;
  }

  let assistantText = "";
  for (const part of fallbackParts) {
    const rec = part && typeof part === "object" ? part as Record<string, unknown> : null;
    if (!rec) continue;
    const reasoningText = geminiPartReasoningText(rec);
    if (geminiPartIsReasoning(rec) && reasoningText) {
      conversation.push({ kind: "reasoning", text: reasoningText });
      continue;
    }
    const assistantPartText = geminiPartAssistantText(rec);
    if (assistantPartText) {
      assistantText += assistantPartText;
    }
  }
  if (assistantText.trim()) {
    conversation.push({ kind: "assistant", text: assistantText.trim() });
  }

  return conversation;
}

/**
 * Reads the Claude Code session JSONL from the host ~/.claude/projects directory
 * and delegates to the dedicated parser (now in claude-code-log-parser.ts).
 * Kept here as a private async wrapper so the public API surface is unchanged.
 */
async function parseClaudeSessionTelemetry(
  cwd: string,
  nativeSessionId: string,
  sinceMs?: number,
): Promise<ProviderUsageTelemetry | null> {
  // Claude Code slugifies cwd for its projects directory by replacing path
  // separators and drive-letter colons. Handle both Unix ("/") and Windows
  // ("\\", "C:") forms so the lookup works on every host.
  const slug = cwd.replace(/[/\\:]/g, "-");
  const homeDir = process.env.HOME || process.env.USERPROFILE || os.homedir();
  const sessionPath = path.join(homeDir, ".claude", "projects", slug, `${nativeSessionId}.jsonl`);
  const raw = await fs.readFile(sessionPath, "utf8").catch(() => "");
  if (!raw.trim()) return null;
  return claudeJsonlToTelemetry(raw, nativeSessionId, { sessionPath }, sinceMs);
}

/**
 * Converts a raw Claude Code session JSONL string to a `ProviderUsageTelemetry`
 * record using the dedicated `parseClaudeCodeSessionJsonl` parser.
 */
function claudeJsonlToTelemetry(
  raw: string,
  nativeSessionId: string,
  rawUsageJson: Record<string, unknown> | null,
  sinceMs?: number,
): ProviderUsageTelemetry | null {
  if (!raw.trim()) return null;

  const parsed = parseClaudeCodeSessionJsonl(raw, sinceMs);

  // Prefer the session id embedded in the JSONL entries over the caller-supplied one.
  const resolvedSessionId = parsed.nativeSessionId ?? nativeSessionId;

  // Extract a plain-text transcript from the parsed conversation turns.
  const transcriptText = parsed.conversation
    .filter((t) => t.kind === "assistant")
    .map((t) => t.text)
    .filter(Boolean)
    .join("\n")
    .trim();

  const conversation = withLeadingUserTurn(parsed.conversation, "");

  if (!parsed.usage) {
    return {
      ...emptyTelemetry(),
      transcriptText,
      nativeSessionId: resolvedSessionId,
      conversation,
    };
  }

  const { inputTokens, outputTokens, cacheCreationTokens, cacheReadTokens } = parsed.usage;
  const cachedInputTokens = cacheCreationTokens + cacheReadTokens;
  const totalTokens = totalTrackedTokens(inputTokens, cachedInputTokens, outputTokens);

  return {
    ...emptyTelemetry(),
    inputTokens,
    cachedInputTokens,
    outputTokens,
    totalTokens,
    usageSource: totalTokens > 0 ? "reported" : "unavailable",
    rawUsageJson: parsed.rawUsageJson ?? rawUsageJson,
    transcriptText,
    nativeSessionId: resolvedSessionId,
    conversation,
  };
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
  qwenConversation?: ParsedConversationTurn[] | null;
  startTimeMs?: number;
  executionMode?: "HOST" | "DOCKER";
  antigravitySessionDbPath?: string | null;
  antigravityTranscriptJsonl?: string | null;
  /** The highest `gen_metadata` idx already summed by a previous invocation of
   *  this same antigravity conversation (when `--conversation=<id>` resumes
   *  it). Only rows with a higher idx are summed, so a follow-up run reports
   *  only the generations it added — the conversation db otherwise
   *  accumulates rows across resumes just like Codex's rollout file. */
  antigravitySinceIdx?: number | null;
  /** stdout of `opencode export <sessionID>`, the authoritative usage source for
   *  opencode (the `run --format json` stream carries no token usage). */
  opencodeExportJson?: string | null;
  /** The previous invocation's raw `{ tokens, cost }` export snapshot for this
   *  same opencode session (when this run resumes/continues it). Subtracted
   *  from the freshly exported cumulative usage so a follow-up run reports
   *  only its own tokens instead of the whole session's total-to-date. */
  opencodeBaselineUsage?: Record<string, unknown> | null;
}): Promise<ProviderUsageTelemetry> {
  const fallbackOutput = [args.capturedText || "", args.stdout || "", args.stderr || ""].filter(Boolean).join("\n").trim();

  if (args.provider === "gemini") {
    const parsed = parseJsonObject(args.stdout);
    const stats = parsed?.stats && typeof parsed.stats === "object" ? parsed.stats as Record<string, unknown> : null;
    const usage = parseGeminiTokens(stats);
    const structuredConversation = parsed ? parseGeminiConversation(parsed) : [];
    const transcriptFromStructuredConversation = structuredConversation
      .filter((turn) => turn.kind === "assistant")
      .map((turn) => turn.text)
      .filter(Boolean)
      .join("\n")
      .trim();
    if (usage) {
      usage.transcriptText = typeof parsed?.response === "string"
        ? parsed.response
        : transcriptFromStructuredConversation || fallbackOutput;
      usage.nativeSessionId = typeof parsed?.session_id === "string" ? parsed.session_id : null;
      if (structuredConversation.length > 0) {
        usage.conversation = structuredConversation;
      }
      return usage;
    }
    const estimated = estimateTelemetry(
      "gemini",
      args.model,
      args.prompt,
      typeof parsed?.response === "string"
        ? parsed.response
        : transcriptFromStructuredConversation || fallbackOutput,
    );
    estimated.nativeSessionId = typeof parsed?.session_id === "string" ? parsed.session_id : null;
    if (structuredConversation.length > 0) {
      estimated.conversation = structuredConversation;
    }
    return estimated;
  }

  if (args.provider === "codex") {
    // The rollout JSONL session file is the richest source (usage + full
    // conversation). The exec `--json` stdout stream is parsed as a fallback so
    // the transcript is broken into proper turns even when the rollout file is
    // unavailable — otherwise the raw JSON event stream would be persisted as a
    // single unreadable message.
    const rollout = args.codexSessionJson
      ? parseCodexRolloutJsonl(args.codexSessionJson, args.startTimeMs)
      : null;
    const stdout = parseCodexExecStdout(args.stdout);
    const parsedConversation = (rollout?.conversation && rollout.conversation.length > 0)
      ? rollout.conversation
      : stdout.conversation;
    const conversation = withLeadingUserTurn(parsedConversation, args.prompt);
    // Prefer the captured `--output-last-message` file; otherwise derive a clean
    // assistant transcript from the parsed turns rather than dumping raw stdout.
    const lastAssistantText = [...parsedConversation].reverse().find((t) => t.kind === "assistant")?.text?.trim();
    const transcriptText = args.capturedText?.trim() || lastAssistantText || fallbackOutput;
    const usage = rollout?.usage ?? stdout.usage;
    const rawUsageJson = rollout?.usage ? rollout.rawUsageJson : stdout.rawUsageJson;
    const nativeSessionId = rollout?.nativeSessionId ?? stdout.nativeSessionId ?? args.nativeSessionId ?? null;
    if (usage) {
      return {
        ...emptyTelemetry(),
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        reasoningOutputTokens: usage.reasoningOutputTokens,
        totalTokens: totalTrackedTokens(usage.inputTokens, usage.cachedInputTokens, usage.outputTokens),
        usageSource: "reported",
        rawUsageJson,
        transcriptText,
        nativeSessionId,
        conversation,
      };
    }
    const estimated = estimateTelemetry("codex", args.model, args.prompt, transcriptText);
    estimated.nativeSessionId = nativeSessionId;
    estimated.conversation = conversation;
    return estimated;
  }

  if (args.provider === "opencode") {
    const parsed = parseOpenCodeJsonLines(args.stdout);
    // The `run --format json` stream carries the transcript, conversation, and
    // session id but no token usage. Authoritative usage comes from
    // `opencode export <sessionID>` (info.tokens), captured post-run. That
    // export is cumulative for the whole session, so on a resumed/follow-up
    // run it's reduced by the baseline snapshot from the prior invocation —
    // otherwise a follow-up would re-report every earlier turn's tokens too.
    const rawExportUsage = args.opencodeExportJson ? parseOpenCodeExport(args.opencodeExportJson) : null;
    const exportUsage = rawExportUsage
      ? subtractOpenCodeBaseline(rawExportUsage, args.opencodeBaselineUsage)
      : null;
    if (parsed) {
      const transcriptText = parsed.transcriptText || fallbackOutput;
      const conversation = withLeadingUserTurn(parsed.conversation, args.prompt);
      // Prefer exported session usage, then any usage the stream happened to
      // carry (older opencode builds), then estimation.
      const reported = exportUsage
        ?? ((parsed.inputTokens > 0 || parsed.outputTokens > 0)
          ? {
            inputTokens: parsed.inputTokens,
            cachedInputTokens: parsed.cachedInputTokens,
            outputTokens: parsed.outputTokens,
            reasoningOutputTokens: parsed.reasoningOutputTokens,
            rawUsageJson: parsed.rawUsageJson,
          }
          : null);
      if (reported) {
        return {
          ...emptyTelemetry(),
          inputTokens: reported.inputTokens,
          cachedInputTokens: reported.cachedInputTokens,
          outputTokens: reported.outputTokens,
          reasoningOutputTokens: reported.reasoningOutputTokens,
          totalTokens: totalTrackedTokens(reported.inputTokens, reported.cachedInputTokens, reported.outputTokens),
          usageSource: "reported",
          rawUsageJson: reported.rawUsageJson,
          transcriptText,
          nativeSessionId: parsed.nativeSessionId,
          conversation,
        };
      }
      const estimated = estimateTelemetry("opencode", args.model, args.prompt, transcriptText);
      estimated.nativeSessionId = parsed.nativeSessionId;
      estimated.conversation = conversation;
      return estimated;
    }
    if (exportUsage) {
      return {
        ...emptyTelemetry(),
        inputTokens: exportUsage.inputTokens,
        cachedInputTokens: exportUsage.cachedInputTokens,
        outputTokens: exportUsage.outputTokens,
        reasoningOutputTokens: exportUsage.reasoningOutputTokens,
        totalTokens: totalTrackedTokens(exportUsage.inputTokens, exportUsage.cachedInputTokens, exportUsage.outputTokens),
        usageSource: "reported",
        rawUsageJson: exportUsage.rawUsageJson,
        transcriptText: fallbackOutput,
        nativeSessionId: args.nativeSessionId || null,
        conversation: [],
      };
    }
    return estimateTelemetry("opencode", args.model, args.prompt, fallbackOutput);
  }

  if (args.provider === "antigravity") {
    let usage: AntigravityUsageTotals | null = null;
    let rawUsageJson: Record<string, unknown> | null = null;
    let conversation: ParsedConversationTurn[] = [];

    if (args.antigravityTranscriptJsonl) {
      conversation = parseAntigravityTranscript(args.antigravityTranscriptJsonl, args.startTimeMs);
    }

    if (args.antigravitySessionDbPath) {
      const dbResult = parseAntigravityDatabase(args.antigravitySessionDbPath, args.antigravitySinceIdx ?? undefined);
      if (dbResult) {
        usage = dbResult.usage;
        rawUsageJson = dbResult.rawUsageJson;
      }
    }

    const transcriptText = conversation
      .filter((t) => t.kind === "assistant")
      .map((t) => t.text)
      .filter(Boolean)
      .join("\n")
      .trim() || fallbackOutput;

    const fullConversation = withLeadingUserTurn(conversation, args.prompt);

    if (usage && (usage.inputTokens > 0 || usage.outputTokens > 0)) {
      return {
        ...emptyTelemetry(),
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        reasoningOutputTokens: usage.reasoningTokens,
        totalTokens: totalTrackedTokens(usage.inputTokens, usage.cachedInputTokens, usage.outputTokens),
        usageSource: "reported",
        rawUsageJson,
        transcriptText,
        nativeSessionId: args.nativeSessionId || null,
        conversation: fullConversation,
      };
    }

    const estimated = estimateTelemetry("antigravity", args.model, args.prompt, transcriptText);
    estimated.nativeSessionId = args.nativeSessionId || null;
    estimated.conversation = fullConversation;
    return estimated;
  }

  if (args.provider === "qwen-code") {
    // Usage and conversation are read from the qwen-code OpenAI logs by the
    // caller (provider-runner), which resolves the host-visible log directory
    // for both HOST and DOCKER modes.
    const conversation = withLeadingUserTurn(args.qwenConversation ?? [], args.prompt);
    const exactUsage = args.qwenReportedUsage;
    if (exactUsage && (exactUsage.inputTokens > 0 || exactUsage.outputTokens > 0)) {
      return {
        ...emptyTelemetry(),
        inputTokens: exactUsage.inputTokens,
        cachedInputTokens: exactUsage.cachedInputTokens,
        outputTokens: exactUsage.outputTokens,
        reasoningOutputTokens: exactUsage.reasoningOutputTokens,
        totalTokens: totalTrackedTokens(exactUsage.inputTokens, exactUsage.cachedInputTokens, exactUsage.outputTokens),
        usageSource: "reported",
        rawUsageJson: null,
        transcriptText: fallbackOutput,
        nativeSessionId: args.nativeSessionId || null,
        conversation,
      };
    }

    const telemetry = estimateTelemetry("qwen-code", args.model, args.prompt, fallbackOutput);
    telemetry.nativeSessionId = args.nativeSessionId || null;
    telemetry.conversation = conversation;
    return telemetry;
  }

  if (args.nativeSessionId) {
    if (args.claudeSessionJsonl) {
      const usage = claudeJsonlToTelemetry(
        args.claudeSessionJsonl,
        args.nativeSessionId,
        { source: "container-session-jsonl" },
        args.startTimeMs,
      );
      if (usage) {
        const conversation = withLeadingUserTurn(usage.conversation, args.prompt);
        if (usage.totalTokens > 0) {
          return { ...usage, conversation };
        }
        return estimateTelemetry("claude-code", args.model, args.prompt, usage.transcriptText || fallbackOutput);
      }
    }
    const usage = await parseClaudeSessionTelemetry(args.cwd, args.nativeSessionId, args.startTimeMs);
    if (usage) {
      const conversation = withLeadingUserTurn(usage.conversation, args.prompt);
      if (usage.totalTokens > 0) {
        return { ...usage, conversation };
      }
      return estimateTelemetry("claude-code", args.model, args.prompt, usage.transcriptText || fallbackOutput);
    }
  }

  return estimateTelemetry("claude-code", args.model, args.prompt, fallbackOutput);
}
