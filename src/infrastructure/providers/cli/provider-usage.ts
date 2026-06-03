import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { countTokens as countAnthropicTokens } from "@anthropic-ai/tokenizer";
import { encodingForModel } from "js-tiktoken";
import type { TokenUsageSource } from "../../../contracts/execution-types.js";
import type { ParsedConversationTurn } from "./provider-logs/provider-conversation-types.js";
import { parseCodexRolloutJsonl, parseCodexExecStdout } from "./provider-logs/codex-log-parser.js";
import { parseOpenCodeJsonLines } from "./provider-logs/opencode-log-parser.js";
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
  if (conversation[0]?.kind === "user") {
    return conversation;
  }
  const trimmed = prompt.trim();
  if (!trimmed) {
    return conversation;
  }
  return [{ kind: "user", text: trimmed }, ...conversation];
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
    conversation: [],
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
  const sessionPath = path.join(os.homedir(), ".claude", "projects", slug, `${nativeSessionId}.jsonl`);
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
  const totalTokens = inputTokens + outputTokens;

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
    // The rollout JSONL session file is the richest source (usage + full
    // conversation). Fall back to the exec stdout stream for usage only.
    const rollout = args.codexSessionJson
      ? parseCodexRolloutJsonl(args.codexSessionJson, args.startTimeMs)
      : null;
    const stdoutUsage = parseCodexExecStdout(args.stdout);
    const usage = rollout?.usage ?? stdoutUsage.usage;
    const rawUsageJson = rollout?.usage ? rollout.rawUsageJson : stdoutUsage.rawUsageJson;
    const conversation = withLeadingUserTurn(rollout?.conversation ?? [], args.prompt);
    if (usage) {
      return {
        ...emptyTelemetry(),
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        reasoningOutputTokens: usage.reasoningOutputTokens,
        totalTokens: usage.inputTokens + usage.outputTokens,
        usageSource: "reported",
        rawUsageJson,
        transcriptText,
        nativeSessionId: rollout?.nativeSessionId ?? stdoutUsage.nativeSessionId ?? args.nativeSessionId ?? null,
        conversation,
      };
    }
    const estimated = estimateTelemetry("codex", args.model, args.prompt, transcriptText);
    estimated.nativeSessionId = rollout?.nativeSessionId ?? stdoutUsage.nativeSessionId ?? args.nativeSessionId ?? null;
    estimated.conversation = conversation;
    return estimated;
  }

  if (args.provider === "opencode") {
    const parsed = parseOpenCodeJsonLines(args.stdout);
    if (parsed) {
      const transcriptText = parsed.transcriptText || fallbackOutput;
      const conversation = withLeadingUserTurn(parsed.conversation, args.prompt);
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
          conversation,
        };
      }
      const estimated = estimateTelemetry("opencode", args.model, args.prompt, transcriptText);
      estimated.nativeSessionId = parsed.nativeSessionId;
      estimated.conversation = conversation;
      return estimated;
    }
    return estimateTelemetry("opencode", args.model, args.prompt, fallbackOutput);
  }

  if (args.provider === "antigravity") {
    return estimateTelemetry("antigravity", args.model, args.prompt, fallbackOutput);
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
        totalTokens: exactUsage.inputTokens + exactUsage.outputTokens,
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
