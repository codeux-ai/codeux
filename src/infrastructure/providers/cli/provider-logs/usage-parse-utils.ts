/**
 * Small, dependency-free helpers shared by the per-provider log parsers and
 * the provider-usage orchestrator. Kept here so the parsers and the
 * orchestrator can both import them without a circular dependency.
 */

export function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
  }
  return 0;
}

export type JsonContainerKind = "object" | "array" | "object-or-array";

export type JsonExtractionError =
  | "not_found"
  | "malformed"
  | "unexpected_type";

export interface JsonExtractionSuccess<T> {
  ok: true;
  value: T;
  jsonText: string;
  startIndex: number;
  endIndex: number;
}

export interface JsonExtractionFailure {
  ok: false;
  error: JsonExtractionError;
  jsonText?: string;
  startIndex?: number;
  endIndex?: number;
}

export type JsonExtractionResult<T> = JsonExtractionSuccess<T> | JsonExtractionFailure;

function isExpectedJsonKind(value: unknown, kind: JsonContainerKind): boolean {
  if (kind === "array") {
    return Array.isArray(value);
  }
  if (kind === "object") {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }
  return value !== null && typeof value === "object";
}

function findFirstBalancedJsonContainer(text: string, kind: JsonContainerKind): JsonExtractionFailure | {
  jsonText: string;
  startIndex: number;
  endIndex: number;
} {
  const allowedStarts = kind === "object" ? ["{"] : kind === "array" ? ["["] : ["{", "["];
  let start = -1;
  for (let i = 0; i < text.length; i += 1) {
    if (allowedStarts.includes(text[i])) {
      start = i;
      break;
    }
  }
  if (start < 0) {
    return { ok: false, error: "not_found" };
  }

  const opening = text[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "\"") {
        inString = false;
      }
      continue;
    }

    if (ch === "\"") {
      inString = true;
    } else if (ch === opening) {
      depth += 1;
    } else if (ch === closing) {
      depth -= 1;
      if (depth === 0) {
        return { jsonText: text.slice(start, i + 1), startIndex: start, endIndex: i + 1 };
      }
    }
  }

  return { ok: false, error: "malformed", startIndex: start, endIndex: text.length };
}

export function extractJsonContainer<T = unknown>(
  text: string,
  kind: JsonContainerKind = "object-or-array",
): JsonExtractionResult<T> {
  const extracted = findFirstBalancedJsonContainer(text, kind);
  if ("ok" in extracted) {
    return extracted;
  }

  try {
    const value = JSON.parse(extracted.jsonText) as unknown;
    if (!isExpectedJsonKind(value, kind)) {
      return { ok: false, error: "unexpected_type", startIndex: extracted.startIndex, endIndex: extracted.endIndex };
    }
    return { ok: true, value: value as T, ...extracted };
  } catch {
    return { ok: false, error: "malformed", ...extracted };
  }
}

export function parseJsonContainer<T = unknown>(
  value: string,
  kind: JsonContainerKind = "object-or-array",
): JsonExtractionResult<T> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!isExpectedJsonKind(parsed, kind)) {
      return { ok: false, error: "unexpected_type", startIndex: 0, endIndex: value.length };
    }
    return { ok: true, value: parsed as T, jsonText: value, startIndex: 0, endIndex: value.length };
  } catch {
    return { ok: false, error: "malformed", startIndex: 0, endIndex: value.length };
  }
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  const parsed = parseJsonContainer<Record<string, unknown>>(value, "object");
  return parsed.ok ? parsed.value : null;
}

export function parseJsonArray(value: string): unknown[] | null {
  const parsed = parseJsonContainer<unknown[]>(value, "array");
  return parsed.ok ? parsed.value : null;
}

export interface NormalizedUsageCounts {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export function normalizeUsageCounts(
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

export interface ParsedUsageCounts {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

/** Parses an OpenAI-style usage object, handling the various nested detail
 *  shapes Codex/Qwen emit (input_token_details.cached_tokens,
 *  output_token_details.reasoning_tokens, etc.). */
export function parseUsageObject(usage: Record<string, unknown>): ParsedUsageCounts {
  const normalized = normalizeUsageCounts(usage, {
    promptKeys: ["input_tokens", "prompt_tokens", "inputTokens", "promptTokens", "input"],
    completionKeys: ["output_tokens", "completion_tokens", "outputTokens", "completionTokens", "output", "completion"],
    totalKeys: ["total_tokens", "totalTokens", "totalTokenCount", "total"],
  });
  const promptTokens = normalized.promptTokens;
  let outputTokens = normalized.completionTokens;

  let cachedInputTokens = toNumber(usage.cached_input_tokens ?? 0);
  let cachedTokensIncludedInPrompt = cachedInputTokens > 0;
  if (cachedInputTokens === 0) {
    const details = (usage.input_token_details ?? usage.prompt_tokens_details ?? usage.input_tokens_details) as Record<string, unknown> | undefined;
    if (details && typeof details === "object") {
      cachedInputTokens = toNumber(details.cached_tokens ?? 0);
      cachedTokensIncludedInPrompt = cachedInputTokens > 0;
    }
  }
  if (cachedInputTokens === 0) {
    // Anthropic-shaped usage (e.g. Qwen configured with `qwenProtocol: "anthropic"`
    // against an Anthropic-compatible backend): cache hits and cache writes are
    // reported as separate top-level counters rather than an OpenAI-style
    // `*_details.cached_tokens` object. Both count as "cached" here, matching
    // how the dedicated Claude Code parser treats them.
    cachedInputTokens = toNumber(usage.cache_read_input_tokens ?? 0) + toNumber(usage.cache_creation_input_tokens ?? 0);
  }
  const inputTokens = cachedTokensIncludedInPrompt
    ? Math.max(0, promptTokens - cachedInputTokens)
    : promptTokens;

  let reasoningOutputTokens = toNumber(usage.reasoning_output_tokens ?? 0);
  if (reasoningOutputTokens === 0) {
    const details = (usage.output_token_details ?? usage.completion_tokens_details ?? usage.output_tokens_details) as Record<string, unknown> | undefined;
    if (details && typeof details === "object") {
      reasoningOutputTokens = toNumber(details.reasoning_tokens ?? 0);
    }
  }

  // When providers report only total+prompt, infer completion safely.
  if (outputTokens <= 0 && normalized.totalTokens > promptTokens) {
    outputTokens = Math.max(0, normalized.totalTokens - promptTokens);
  } else if (outputTokens <= 0 && normalized.totalTokens > inputTokens) {
    outputTokens = Math.max(0, normalized.totalTokens - inputTokens);
  }

  return { inputTokens, cachedInputTokens, outputTokens, reasoningOutputTokens };
}

/** Subtracts a baseline snapshot from a later cumulative one, clamping each
 *  field at 0. Used when a provider only reports session-cumulative usage
 *  (e.g. Codex's rollout file) so a resumed/follow-up run can be isolated to
 *  just the tokens it added. */
export function subtractUsageCounts(final: ParsedUsageCounts, baseline: ParsedUsageCounts): ParsedUsageCounts {
  return {
    inputTokens: Math.max(0, final.inputTokens - baseline.inputTokens),
    cachedInputTokens: Math.max(0, final.cachedInputTokens - baseline.cachedInputTokens),
    outputTokens: Math.max(0, final.outputTokens - baseline.outputTokens),
    reasoningOutputTokens: Math.max(0, final.reasoningOutputTokens - baseline.reasoningOutputTokens),
  };
}

/** Parses an ISO timestamp string into epoch ms, or null when absent/invalid. */
export function parseTimestampMs(value: unknown): number | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    return null;
  }
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
