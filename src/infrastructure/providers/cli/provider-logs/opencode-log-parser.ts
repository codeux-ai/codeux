import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import { extractJsonContainer, parseJsonObject, toNumber } from "./usage-parse-utils.js";

export interface OpenCodeUsageTotals {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  cost: number;
}

export interface OpenCodeLogResult extends ParsedProviderLogResult<OpenCodeUsageTotals> {
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

function readFirstStringField(value: unknown, fieldNames: string[]): string | undefined {
  const record = asRecord(value);
  if (!record) return undefined;
  for (const fieldName of fieldNames) {
    const fieldValue = record[fieldName];
    if (typeof fieldValue === "string" && fieldValue) {
      return fieldValue;
    }
  }
  return undefined;
}

function readTimestampMs(...values: unknown[]): number | null {
  for (const value of values) {
    const record = asRecord(value);
    const raw = record
      ? record.timestamp ?? record.createdAt ?? record.created_at ?? record.time
      : value;
    if (typeof raw === "number" && Number.isFinite(raw)) {
      return raw > 10_000_000_000 ? raw : raw * 1000;
    }
    if (typeof raw === "string" && raw.trim()) {
      const parsed = Date.parse(raw);
      if (Number.isFinite(parsed)) return parsed;
    }
    const time = asRecord(record?.time);
    const nested = time?.completed ?? time?.end ?? time?.start ?? time?.created;
    if (typeof nested === "number" && Number.isFinite(nested)) {
      return nested > 10_000_000_000 ? nested : nested * 1000;
    }
  }
  return null;
}

function extractVisibleText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return value.map(extractVisibleText).filter(Boolean).join("\n").trim();
  }
  const record = asRecord(value);
  if (!record) {
    return "";
  }
  const candidate = record.text
    ?? record.content
    ?? record.message
    ?? record.value
    ?? record.delta;
  return extractVisibleText(candidate);
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

function extractOpenCodeReasoning(part: Record<string, unknown>): string {
  return flattenVisibleReasoning(part.reasoning ?? part.thinking ?? part.summary ?? part.text ?? part.content);
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
  const root = findOpenCodeExportRoot(searchText)
    ?? (searchText === exportStdout ? null : findOpenCodeExportRoot(exportStdout));
  if (!root) return null;
  const info = findOpenCodeExportInfo(root);
  const tokens = asRecord(info?.tokens) ?? asRecord(info?.usage);
  if (!tokens) {
    return null;
  }
  const t = readOpenCodeTokens(tokens);
  if (t.rawInput <= 0 && t.output <= 0 && t.reasoning <= 0 && t.cacheRead <= 0) {
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

function findOpenCodeExportRoot(text: string): Record<string, unknown> | unknown[] | null {
  let offset = 0;
  while (offset < text.length) {
    const extracted = extractJsonContainer<Record<string, unknown> | unknown[]>(text.slice(offset), "object-or-array");
    if (extracted.ok) {
      if (findOpenCodeExportInfo(extracted.value)) return extracted.value;
      offset += extracted.endIndex;
      continue;
    }
    const relativeStart = extracted.startIndex ?? 0;
    offset += Math.max(relativeStart + 1, 1);
  }
  return null;
}

function findOpenCodeExportInfo(root: unknown): Record<string, unknown> | null {
  const queue: unknown[] = [root];
  while (queue.length > 0) {
    const current = queue.shift();
    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = asRecord(current);
    if (!record) {
      continue;
    }

    const directTokens = asRecord(record.tokens) ?? asRecord(record.usage);
    if (directTokens) {
      return record;
    }

    for (const field of ["info", "session", "data", "result", "message"]) {
      const nested = asRecord(record[field]);
      const nestedTokens = asRecord(nested?.tokens) ?? asRecord(nested?.usage);
      if (nested && nestedTokens) {
        return nested;
      }
      if (nested) {
        queue.push(nested);
      }
    }

    const messages = record.messages;
    if (Array.isArray(messages)) {
      queue.push(...messages);
    }
  }

  return null;
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
function emptyOpenCodeLogResult(): OpenCodeLogResult {
  return {
    usage: null,
    transcriptText: "",
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    cost: 0,
    nativeSessionId: null,
    rawUsageJson: null,
    conversation: [],
  };
}

export function parseOpenCodeJsonLines(stdout: string): OpenCodeLogResult {
  const textParts: string[] = [];
  const conversation: ParsedConversationTurn[] = [];
  const textPartIndexes = new Map<string, number>();
  const textPartTextIndexes = new Map<string, number>();
  const assistantMessageIndexes = new Map<string, number>();
  const assistantMessageTextIndexes = new Map<string, number>();
  const reasoningPartIndexes = new Map<string, number>();
  const stepFinishTotals = new Map<string, { tokens: OpenCodeTokens; cost: number }>();
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
    if (!parsed) {
      continue;
    }
    const event = asRecord(parsed.event) ?? asRecord(parsed.payload) ?? parsed;
    const eventType = typeof event.type === "string" ? event.type : "";
    if (!eventType) continue;
    foundEvent = true;

    const properties = asRecord(event.properties) ?? asRecord(parsed.properties);
    // The `run` formatter flattens parts to `parsed.part`; the raw bus/event
    // shape nests them under `properties.part`. Accept either.
    const part = asRecord(event.part) ?? asRecord(parsed.part) ?? asRecord(properties?.part);
    const info = asRecord(properties?.info) ?? asRecord(event.info) ?? asRecord(parsed.info) ?? asRecord(event.message);
    const session = asRecord(properties?.session) ?? asRecord(event.session);

    // Native session id (`ses_...`) appears on parts, messages, and event
    // envelopes. The strict `ses_` regex lets us safely consider `info.id`
    // (which is the session id on `session.created` but a `msg_` id on message
    // events — the latter is simply rejected by the pattern).
    if (!nativeSessionId) {
      for (const candidate of [
        part?.sessionID,
        part?.sessionId,
        part?.session_id,
        info?.sessionID,
        info?.sessionId,
        info?.session_id,
        properties?.sessionID,
        properties?.sessionId,
        properties?.session_id,
        event.sessionID,
        event.sessionId,
        event.session_id,
        parsed.sessionID,
        parsed.sessionId,
        parsed.session_id,
        session?.id,
        info?.id,
      ]) {
        if (typeof candidate === "string" && SESSION_ID_RE.test(candidate)) {
          nativeSessionId = candidate;
          break;
        }
      }
    }

    const partType = typeof part?.type === "string" ? part.type : null;
    const timestampMs = readTimestampMs(part, info, event, properties, parsed);

    if (partType === "text" && part) {
      const text = extractVisibleText(part.text ?? part.content ?? part.delta);
      if (text) {
        const partId = readFirstStringField(part, ["id", "partID", "partId", "part_id"]);
        if (partId && textPartTextIndexes.has(partId)) {
          textParts[textPartTextIndexes.get(partId)!] = text;
        } else {
          if (partId) textPartTextIndexes.set(partId, textParts.length);
          textParts.push(text);
        }
        if (partId && textPartIndexes.has(partId)) {
          const existing = conversation[textPartIndexes.get(partId)!];
          conversation[textPartIndexes.get(partId)!] = {
            kind: "assistant",
            text,
            ...(timestampMs != null || existing.timestampMs != null
              ? { timestampMs: timestampMs ?? existing.timestampMs }
              : {}),
          };
        } else {
          if (partId) textPartIndexes.set(partId, conversation.length);
          conversation.push({ kind: "assistant", text, ...(timestampMs != null ? { timestampMs } : {}) });
        }
      }
      continue;
    }

    if (partType === "reasoning" && part) {
      const visibleReasoning = extractOpenCodeReasoning(part);
      if (visibleReasoning) {
        const partId = readFirstStringField(part, ["id", "partID", "partId", "part_id"]);
        if (partId && reasoningPartIndexes.has(partId)) {
          const index = reasoningPartIndexes.get(partId)!;
          const existing = conversation[index];
          conversation[index] = {
            kind: "reasoning",
            text: visibleReasoning,
            ...(timestampMs != null || existing.timestampMs != null
              ? { timestampMs: timestampMs ?? existing.timestampMs }
              : {}),
          };
        } else {
          if (partId) reasoningPartIndexes.set(partId, conversation.length);
          conversation.push({ kind: "reasoning", text: visibleReasoning, ...(timestampMs != null ? { timestampMs } : {}) });
        }
      }
      continue;
    }

    if (partType === "tool" && part) {
      const state = asRecord(part.state);
      const status = readFirstStringField(state, ["status"]) ?? readFirstStringField(part, ["status"]);
      const toolName = readFirstStringField(part, ["tool", "toolName", "tool_name", "name"]);
      const toolCallId = readFirstStringField(part, ["callID", "callId", "call_id", "toolCallId", "tool_call_id", "id"]);
      const argsValue = state?.input ?? state?.args ?? state?.arguments ?? part.input ?? part.args ?? part.arguments;
      const outputValue = state?.output ?? state?.result ?? state?.error ?? part.output ?? part.result ?? part.error;
      const args = argsValue !== undefined ? stringify(argsValue) : undefined;
      const output = outputValue !== undefined ? stringify(outputValue) : undefined;
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
        if (existing.timestampMs == null && timestampMs != null) existing.timestampMs = timestampMs;
      } else {
        conversation.push({
          kind: "tool_call",
          text: toolName ? `Calling tool ${toolName}` : "Calling tool",
          toolName,
          toolCallId,
          toolArguments: args,
          toolOutput: output,
          toolStatus: status,
          ...(timestampMs != null ? { timestampMs } : {}),
        });
      }
      continue;
    }

    // Per-LLM-call usage. The step-finish marker can arrive as the part type or
    // the flattened top-level type; the underscore spelling and a legacy
    // `part.usage` object are tolerated for forward/backward compatibility.
    const isStepFinish = partType === "step-finish" || partType === "step_finish"
      || eventType === "step-finish" || eventType === "step_finish";
    if (isStepFinish) {
      const stepId = readFirstStringField(part, ["id", "partID", "partId", "part_id"])
        ?? readFirstStringField(event, ["id", "eventID", "eventId", "event_id"]);
      const tokens = asRecord(part?.tokens) ?? asRecord(part?.usage) ?? asRecord(event.tokens) ?? asRecord(event.usage) ?? asRecord(properties?.tokens) ?? asRecord(properties?.usage);
      if (tokens) {
        const t = readOpenCodeTokens(tokens);
        const cost = toNumber(part?.cost ?? event.cost ?? properties?.cost ?? 0);
        const prior = stepId ? stepFinishTotals.get(stepId) : undefined;
        if (prior) {
          stepTotals.input -= prior.tokens.input;
          stepTotals.rawInput -= prior.tokens.rawInput;
          stepTotals.output -= prior.tokens.output;
          stepTotals.reasoning -= prior.tokens.reasoning;
          stepTotals.cacheRead -= prior.tokens.cacheRead;
          stepTotals.cacheWrite -= prior.tokens.cacheWrite;
          stepCost -= prior.cost;
        }
        stepTotals.input += t.input;
        stepTotals.rawInput += t.rawInput;
        stepTotals.output += t.output;
        stepTotals.reasoning += t.reasoning;
        stepTotals.cacheRead += t.cacheRead;
        stepTotals.cacheWrite += t.cacheWrite;
        stepCost += cost;
        if (stepId) stepFinishTotals.set(stepId, { tokens: t, cost });
        sawStepFinish = true;
      }
      continue;
    }

    // Assistant message carries cumulative usage for the message; message
    // events stream repeatedly, so keep the latest value per message id.
    if (info && info.role === "assistant") {
      const messageId = readFirstStringField(info, ["id", "messageID", "messageId", "message_id"]);
      const tokens = asRecord(info.tokens) ?? asRecord(info.usage);
      if (tokens && messageId) {
        messageTotals.set(messageId, { tokens: readOpenCodeTokens(tokens), cost: toNumber(info.cost ?? 0) });
      }

      const text = extractVisibleText(info.content ?? info.parts ?? info.text ?? event.content ?? event.text);
      if (text) {
        if (messageId && assistantMessageTextIndexes.has(messageId)) {
          textParts[assistantMessageTextIndexes.get(messageId)!] = text;
        } else {
          if (messageId) assistantMessageTextIndexes.set(messageId, textParts.length);
          textParts.push(text);
        }
        if (messageId && assistantMessageIndexes.has(messageId)) {
          const existing = conversation[assistantMessageIndexes.get(messageId)!];
          conversation[assistantMessageIndexes.get(messageId)!] = {
            kind: "assistant",
            text,
            ...(timestampMs != null || existing.timestampMs != null
              ? { timestampMs: timestampMs ?? existing.timestampMs }
              : {}),
          };
        } else {
          if (messageId) assistantMessageIndexes.set(messageId, conversation.length);
          conversation.push({ kind: "assistant", text, ...(timestampMs != null ? { timestampMs } : {}) });
        }
      }
    }
  }

  if (!foundEvent) {
    return emptyOpenCodeLogResult();
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

  const hasUsage = usage.rawInput > 0 || usage.output > 0 || usage.reasoning > 0 || usage.cacheRead > 0;
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
  const parsedUsage: OpenCodeUsageTotals | null = hasUsage
    ? {
      inputTokens: usage.input,
      cachedInputTokens: usage.cacheRead,
      outputTokens: usage.output,
      reasoningOutputTokens: usage.reasoning,
      cost,
    }
    : null;

  return {
    usage: parsedUsage,
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
