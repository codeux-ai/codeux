/**
 * Small, dependency-free helpers shared by the per-provider log parsers and
 * the provider-usage orchestrator. Kept here so the parsers and the
 * orchestrator can both import them without a circular dependency.
 */

export function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

export function parseJsonObject(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
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
