import type { ParsedConversationTurn } from "./provider-conversation-types.js";
import { extractJsonContainer, parseJsonObject, toNumber } from "./usage-parse-utils.js";

export interface OpenCodeLogResult {
  transcriptText: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  /** Provider-reported run cost in USD, when available. */
  cost: number;
  nativeSessionId: string | null;
  /** Aggregated usage object stored for raw telemetry. */
  rawUsageJson: Record<string, unknown> | null;
  conversation: ParsedConversationTurn[];
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function flattenVisibleReasoning(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of value) {
    const rec = asRecord(item);
    if (!rec) {
      if (typeof item === "string") {
        parts.push(item);
      }
      continue;
    }
    if (typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (typeof rec.summary_text === "string") {
      parts.push(rec.summary_text);
    } else if (typeof rec.summary === "string") {
      parts.push(rec.summary);
    } else if (typeof rec.reasoning === "string") {
      parts.push(rec.reasoning);
    } else if (typeof rec.thinking === "string") {
      parts.push(rec.thinking);
    }
  }
  return parts.join("").trim();
}

interface OpenCodeTokens {
  input: number;
  rawInput: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
}

/**
 * Reads OpenCode's token shape: `{ input, output, reasoning, cache: { read,
 * write } }` (carried by both `step-finish` parts and assistant messages).
 * Falls back to OpenAI-style aliases so a future schema tweak still resolves.
 */
function readOpenCodeTokens(tokens: Record<string, unknown>): OpenCodeTokens {
  const cache = asRecord(tokens.cache);
  const rawInput = toNumber(tokens.input ?? tokens.inputTokens ?? tokens.promptTokens ?? tokens.prompt_tokens ?? 0);
  const cacheRead = toNumber(cache?.read ?? tokens.cache_read ?? tokens.cachedInputTokens ?? 0);
  return {
    input: Math.max(0, rawInput - cacheRead),
    rawInput,
    output: toNumber(tokens.output ?? tokens.outputTokens ?? tokens.completionTokens ?? tokens.completion_tokens ?? 0),
    reasoning: toNumber(tokens.reasoning ?? tokens.reasoningTokens ?? tokens.reasoning_tokens ?? 0),
    cacheRead,
    cacheWrite: toNumber(cache?.write ?? tokens.cache_write ?? 0),
  };
}

const SESSION_ID_RE = /^ses_[A-Za-z0-9]+$/;

export interface OpenCodeExportUsage {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cost: number;
  rawUsageJson: Record<string, unknown> | null;
}

/**
 * Parses the JSON emitted by `opencode export <sessionID>`. OpenCode does not
 * report token usage on the `run --format json` stdout stream — usage lives in
 * its session store, surfaced here as `info.tokens` (the session-cumulative
 * `{ input, output, reasoning, cache: { read, write } }`) plus `info.cost`.
 */
export function parseOpenCodeExport(exportStdout: string): OpenCodeExportUsage | null {
  // Anchor on the export's `info` object so any wrapper/bootstrap stdout that
  // happens to contain braces can't be mistaken for the payload.
  const infoIndex = exportStdout.search(/\{\s*"info"\s*:/);
  const searchText = infoIndex >= 0 ? exportStdout.slice(infoIndex) : exportStdout;
  const extracted = extractJsonContainer<Record<string, unknown>>(searchText, "object");
  if (!extracted.ok) return null;
  const root = extracted.value;
  const info = asRecord(root?.info);
  const tokens = asRecord(info?.tokens);
  if (!tokens) {
    return null;
  }
  const t = readOpenCodeTokens(tokens);
  if (t.input <= 0 && t.output <= 0) {
    return null;
  }
  const cost = toNumber(info?.cost ?? 0);
  return {
    inputTokens: t.input,
    cachedInputTokens: t.cacheRead,
    outputTokens: t.output,
    reasoningOutputTokens: t.reasoning,
    cost,
    rawUsageJson: {
      tokens: { input: t.rawInput, output: t.output, reasoning: t.reasoning, cache: { read: t.cacheRead, write: t.cacheWrite } },
      cost,
    },
  };
}

/**
 * Subtracts a previous invocation's cumulative export snapshot (the same
 * `rawUsageJson` shape this module persists, i.e. `{ tokens: {...}, cost }`)
 * from a freshly exported cumulative usage. `opencode export` always reports
 * totals for the *whole session*, not just the current run (see
 * {@link parseOpenCodeExport}'s doc comment) — so on a resumed/follow-up run
 * this isolates just the tokens the current run added, matching the numeric
 * fields against what was NOT already persisted by the prior invocation.
 * `rawUsageJson` on the result stays the fresh, unadjusted export snapshot so
 * it can itself serve as the next follow-up's baseline.
 */
export function subtractOpenCodeBaseline(
  current: OpenCodeExportUsage,
  baselineRawUsageJson: Record<string, unknown> | null | undefined,
): OpenCodeExportUsage {
  const baselineRecord = asRecord(baselineRawUsageJson);
  const baselineTokens = asRecord(baselineRecord?.tokens);
  if (!baselineTokens) {
    return current;
  }
  const baseline = readOpenCodeTokens(baselineTokens);
  const baselineCost = toNumber(baselineRecord?.cost ?? 0);
  return {
    inputTokens: Math.max(0, current.inputTokens - baseline.input),
    cachedInputTokens: Math.max(0, current.cachedInputTokens - baseline.cacheRead),
    outputTokens: Math.max(0, current.outputTokens - baseline.output),
    reasoningOutputTokens: Math.max(0, current.reasoningOutputTokens - baseline.reasoning),
    cost: Math.max(0, current.cost - baselineCost),
    rawUsageJson: current.rawUsageJson,
  };
}

/**
 * Parses the `opencode run --format json` event stream (NDJSON). Extracts the
 * assistant transcript, provider-reported usage, native session id, and a
 * structured conversation including tool calls and reasoning, in stream order.
 *
 * OpenCode emits one event per line. The `run` command flattens each bus event
 * to `{ type, part?, properties? }`. Relevant part types: `text` (assistant),
 * `reasoning`, `tool` (a single part carrying both input and, once finished,
 * output/status under `part.state`), and `step-finish` (per-LLM-call usage
 * under `part.tokens`). Assistant messages (`properties.info`, role
 * `assistant`) also carry a cumulative `tokens`/`cost`, used as a fallback when
 * no `step-finish` parts are present.
 */
export function parseOpenCodeJsonLines(stdout: string): OpenCodeLogResult | null {
  const textParts: string[] = [];
  const conversation: ParsedConversationTurn[] = [];
  let nativeSessionId: string | null = null;
  let foundEvent = false;

  // Usage summed across `step-finish` parts (one per completed LLM call).
  const stepTotals: OpenCodeTokens = { input: 0, rawInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
  let stepCost = 0;
  let sawStepFinish = false;
  // Fallback: latest cumulative usage per assistant message id.
  const messageTotals = new Map<string, { tokens: OpenCodeTokens; cost: number }>();

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

    const properties = asRecord(parsed.properties);
    // The `run` formatter flattens parts to `parsed.part`; the raw bus/event
    // shape nests them under `properties.part`. Accept either.
    const part = asRecord(parsed.part) ?? asRecord(properties?.part);
    const info = asRecord(properties?.info) ?? asRecord(parsed.info);

    // Native session id (`ses_...`) appears on parts, messages, and event
    // envelopes. The strict `ses_` regex lets us safely consider `info.id`
    // (which is the session id on `session.created` but a `msg_` id on message
    // events — the latter is simply rejected by the pattern).
    if (!nativeSessionId) {
      for (const candidate of [part?.sessionID, info?.sessionID, properties?.sessionID, parsed.sessionID, info?.id]) {
        if (typeof candidate === "string" && SESSION_ID_RE.test(candidate)) {
          nativeSessionId = candidate;
          break;
        }
      }
    }

    const partType = typeof part?.type === "string" ? part.type : null;

    if (parsed.type === "text" && partType === "text" && typeof part?.text === "string" && part.text.trim()) {
      const text = part.text.trim();
      textParts.push(text);
      conversation.push({ kind: "assistant", text });
      continue;
    }

    if (partType === "reasoning" && part) {
      const visibleReasoning = flattenVisibleReasoning(part.reasoning ?? part.thinking ?? part.summary ?? part.text);
      if (visibleReasoning) {
        conversation.push({ kind: "reasoning", text: visibleReasoning });
      }
      continue;
    }

    if (partType === "tool" && part) {
      const state = asRecord(part.state);
      const status = typeof state?.status === "string" ? state.status : undefined;
      const toolName = typeof part.tool === "string" ? part.tool : undefined;
      const toolCallId = typeof part.callID === "string"
        ? part.callID
        : typeof part.id === "string"
          ? part.id
          : undefined;
      const args = state?.input !== undefined ? stringify(state.input) : undefined;
      const output = state?.output !== undefined ? stringify(state.output) : undefined;
      // OpenCode emits the same tool part multiple times as it transitions
      // (pending -> running -> completed). Collapse to one entry per callID,
      // upgrading it as later states carry the input/output.
      const existing = toolCallId
        ? conversation.find(t => t.kind === "tool_call" && t.toolCallId === toolCallId)
        : undefined;
      if (existing) {
        if (toolName) existing.toolName = toolName;
        if (args !== undefined) existing.toolArguments = args;
        if (output !== undefined) existing.toolOutput = output;
        if (status) existing.toolStatus = status;
      } else {
        conversation.push({
          kind: "tool_call",
          text: "",
          toolName,
          toolCallId,
          toolArguments: args,
          toolOutput: output,
          toolStatus: status,
        });
      }
      continue;
    }

    // Per-LLM-call usage. The step-finish marker can arrive as the part type or
    // the flattened top-level type; the underscore spelling and a legacy
    // `part.usage` object are tolerated for forward/backward compatibility.
    const isStepFinish = partType === "step-finish" || partType === "step_finish"
      || parsed.type === "step-finish" || parsed.type === "step_finish";
    if (isStepFinish && part) {
      const tokens = asRecord(part.tokens) ?? asRecord(part.usage);
      if (tokens) {
        const t = readOpenCodeTokens(tokens);
        stepTotals.input += t.input;
        stepTotals.rawInput += t.rawInput;
        stepTotals.output += t.output;
        stepTotals.reasoning += t.reasoning;
        stepTotals.cacheRead += t.cacheRead;
        stepTotals.cacheWrite += t.cacheWrite;
        stepCost += toNumber(part.cost ?? 0);
        sawStepFinish = true;
      }
      continue;
    }

    // Assistant message carries cumulative usage for the message; message
    // events stream repeatedly, so keep the latest value per message id.
    if (info && info.role === "assistant") {
      const tokens = asRecord(info.tokens);
      if (tokens && typeof info.id === "string") {
        messageTotals.set(info.id, { tokens: readOpenCodeTokens(tokens), cost: toNumber(info.cost ?? 0) });
      }
    }
  }

  if (!foundEvent) {
    return null;
  }

  // Prefer per-step usage; fall back to the sum of final per-message usage.
  let usage: OpenCodeTokens = stepTotals;
  let cost = stepCost;
  if (!sawStepFinish && messageTotals.size > 0) {
    usage = { input: 0, rawInput: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 };
    cost = 0;
    for (const entry of messageTotals.values()) {
      usage.input += entry.tokens.input;
      usage.rawInput += entry.tokens.rawInput;
      usage.output += entry.tokens.output;
      usage.reasoning += entry.tokens.reasoning;
      usage.cacheRead += entry.tokens.cacheRead;
      usage.cacheWrite += entry.tokens.cacheWrite;
      cost += entry.cost;
    }
  }

  const hasUsage = usage.input > 0 || usage.output > 0;
  const rawUsageJson = hasUsage
    ? {
      tokens: {
        input: usage.rawInput,
        output: usage.output,
        reasoning: usage.reasoning,
        cache: { read: usage.cacheRead, write: usage.cacheWrite },
      },
      cost,
    }
    : null;

  return {
    transcriptText: textParts.join("\n\n").trim(),
    inputTokens: usage.input,
    cachedInputTokens: usage.cacheRead,
    outputTokens: usage.output,
    reasoningOutputTokens: usage.reasoning,
    cost,
    nativeSessionId,
    rawUsageJson,
    conversation,
  };
}
