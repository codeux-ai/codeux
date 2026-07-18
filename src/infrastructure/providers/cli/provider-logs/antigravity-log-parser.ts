import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import { createHash } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { parseJsonObject } from "./usage-parse-utils.js";
import {
  appendBoundedProviderTurns,
  retainProviderConversationTail,
} from "./provider-conversation-limits.js";

const ANTIGRAVITY_MAX_JSONL_RECORD_CHARS = 2 * 1024 * 1024;
const ANTIGRAVITY_MAX_DEDUPE_ENTRIES = 4_096;
const ANTIGRAVITY_MAX_METADATA_ROW_BYTES = 64 * 1024 * 1024;
const ANTIGRAVITY_MAX_NESTED_ENTRY_DEPTH = 32;
const ANTIGRAVITY_ASSISTANT_ENTRY_TYPES = new Set([
  "PLANNER_RESPONSE",
  "ASSISTANT_RESPONSE",
  "AGENT_RESPONSE",
]);

export interface AntigravityUsageTotals {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export type AntigravityLogResult = ParsedProviderLogResult<AntigravityUsageTotals>;

interface ProtoSlice {
  start: number;
  end: number;
}

interface ProtoVarint {
  value: number;
  pos: number;
}

/**
 * Reads a protobuf varint without 32-bit bitwise coercion. Token counters and
 * length prefixes can exceed 2^31, while all values accepted here must remain
 * exactly representable by JavaScript.
 */
function readProtoVarint(buffer: Buffer, pos: number, limit: number): ProtoVarint | null {
  let value = 0;
  let multiplier = 1;
  for (let byteIndex = 0; byteIndex < 10 && pos < limit; byteIndex += 1) {
    const b = buffer[pos];
    pos += 1;
    value += (b & 0x7f) * multiplier;
    if (!Number.isSafeInteger(value)) return null;
    if (!(b & 0x80)) {
      return { value, pos };
    }
    multiplier *= 128;
  }
  return null;
}

function skipProtoValue(
  buffer: Buffer,
  pos: number,
  limit: number,
  wireType: number,
): number | null {
  if (wireType === 0) {
    return readProtoVarint(buffer, pos, limit)?.pos ?? null;
  }
  if (wireType === 1) {
    return pos + 8 <= limit ? pos + 8 : null;
  }
  if (wireType === 2) {
    const length = readProtoVarint(buffer, pos, limit);
    if (!length) return null;
    const next = length.pos + length.value;
    return Number.isSafeInteger(next) && next <= limit ? next : null;
  }
  if (wireType === 5) {
    return pos + 4 <= limit ? pos + 4 : null;
  }
  return null;
}

/**
 * Locates one known length-delimited field while treating every unrelated
 * field as opaque bytes. The old generic decoder recursively guessed that
 * every length-delimited payload was another protobuf. Arbitrary model
 * metadata can accidentally look protobuf-shaped at many nested offsets,
 * turning a 246 KiB row into gigabytes of temporary objects.
 */
function findLengthDelimitedField(
  buffer: Buffer,
  slice: ProtoSlice,
  targetFieldNumber: number,
): ProtoSlice | null {
  let pos = slice.start;
  while (pos < slice.end) {
    const key = readProtoVarint(buffer, pos, slice.end);
    if (!key || key.value === 0) return null;
    pos = key.pos;
    const fieldNumber = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (wireType === 2) {
      const length = readProtoVarint(buffer, pos, slice.end);
      if (!length) return null;
      const end = length.pos + length.value;
      if (!Number.isSafeInteger(end) || end > slice.end) return null;
      if (fieldNumber === targetFieldNumber) {
        return { start: length.pos, end };
      }
      pos = end;
      continue;
    }
    const next = skipProtoValue(buffer, pos, slice.end, wireType);
    if (next === null) return null;
    pos = next;
  }
  return null;
}

/**
 * Extracts one generation's own token usage from a single `gen_metadata` row's
 * decoded protobuf. Each row is a *separate model call* (one per agent turn,
 * not a running session total) — confirmed empirically against live
 * `~/.gemini/antigravity-cli/conversations/<id>.db` files, where field 2
 * (input) fluctuates non-monotonically across consecutive idx values instead
 * of growing, and a single conversation can carry anywhere from a handful to
 * several hundred rows.
 *
 * Field 5 is treated as cached/reused-context tokens: it is present only on
 * some rows (proto3 omits zero-valued varints, consistent with "no cache hit
 * this turn"), and where present its value closely tracks the *previous*
 * row's input tokens (the prior turn's context, now served from cache) —
 * e.g. row N has input=21647 with no field 5, row N+1 has field 5≈20368 and a
 * much smaller fresh input. No official schema exists for this internal proto,
 * so this mapping is inferred from that pattern rather than documented.
 */
function extractAntigravityUsageFromProto(buffer: Buffer): {
  usage: AntigravityUsageTotals | null;
  rawUsageJson: Record<string, unknown> | null;
} | null {
  const root: ProtoSlice = { start: 0, end: buffer.length };
  const generation = findLengthDelimitedField(buffer, root, 1);
  const response = generation
    ? findLengthDelimitedField(buffer, generation, 17)
    : null;
  const usageMessage = response
    ? findLengthDelimitedField(buffer, response, 2)
    : null;
  if (!usageMessage) return null;

  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let reasoningTokens = 0;
  let candidatesTokens = 0;
  const seen = new Set<number>();
  let pos = usageMessage.start;
  while (pos < usageMessage.end) {
    const key = readProtoVarint(buffer, pos, usageMessage.end);
    if (!key || key.value === 0) return null;
    pos = key.pos;
    const fieldNumber = Math.floor(key.value / 8);
    const wireType = key.value % 8;
    if (wireType === 0) {
      const field = readProtoVarint(buffer, pos, usageMessage.end);
      if (!field) return null;
      pos = field.pos;
      if (seen.has(fieldNumber)) continue;
      seen.add(fieldNumber);
      if (fieldNumber === 2) inputTokens = field.value;
      else if (fieldNumber === 3) outputTokens = field.value;
      else if (fieldNumber === 5) cachedInputTokens = field.value;
      else if (fieldNumber === 9) reasoningTokens = field.value;
      else if (fieldNumber === 10) candidatesTokens = field.value;
      continue;
    }
    const next = skipProtoValue(buffer, pos, usageMessage.end, wireType);
    if (next === null) return null;
    pos = next;
  }

  const usage: AntigravityUsageTotals = {
    inputTokens,
    outputTokens: outputTokens || (reasoningTokens + candidatesTokens),
    reasoningTokens,
    cachedInputTokens,
  };

  if (inputTokens <= 0 && usage.outputTokens <= 0 && reasoningTokens <= 0 && cachedInputTokens <= 0) {
    return { usage: null, rawUsageJson: null };
  }

  const rawUsageJson: Record<string, unknown> = {
    inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens,
    candidatesTokens,
    cachedInputTokens,
  };

  return { usage, rawUsageJson };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function readFirstStringField(value: unknown, fieldNames: string[]): string | undefined {
  const record = asRecord(value);
  if (!record) {
    return undefined;
  }
  for (const fieldName of fieldNames) {
    const fieldValue = record[fieldName];
    if (typeof fieldValue === "string" && fieldValue) {
      return fieldValue;
    }
  }
  return undefined;
}

function extractToolCallId(value: unknown): string | undefined {
  return readFirstStringField(value, [
    "toolCallId",
    "tool_call_id",
    "call_id",
    "callId",
    "toolCallID",
    "tool_callID",
    "id",
  ]);
}

function extractToolName(value: unknown): string | undefined {
  return readFirstStringField(value, [
    "toolName",
    "tool_name",
    "name",
    "functionName",
    "function_name",
  ]);
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

function readTimestampMs(entry: Record<string, unknown>): number | null {
  const raw = entry.created_at ?? entry.createdAt ?? entry.timestamp ?? entry.time;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw > 10_000_000_000 ? raw : raw * 1000;
  }
  if (typeof raw === "string" && raw.trim()) {
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readEntryType(entry: Record<string, unknown>): string {
  const type = readFirstStringField(entry, ["type", "eventType", "event_type", "kind"]);
  return type ? type.toUpperCase() : "";
}

function readEntryActor(entry: Record<string, unknown>): string {
  const actor = readFirstStringField(entry, ["role", "source", "actor", "speaker"]);
  return actor ? actor.toUpperCase() : "";
}

function extractFunctionCall(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return asRecord(record.functionCall)
    ?? asRecord(record.function_call)
    ?? asRecord(record.toolCall)
    ?? asRecord(record.tool_call);
}

function extractFunctionResponse(value: unknown): Record<string, unknown> | null {
  const record = asRecord(value);
  if (!record) return null;
  return asRecord(record.functionResponse)
    ?? asRecord(record.function_response)
    ?? asRecord(record.toolResponse)
    ?? asRecord(record.tool_result)
    ?? asRecord(record.toolResult);
}

function extractParts(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  const record = asRecord(value);
  if (!record) return [];
  const parts = record.parts ?? record.content;
  return Array.isArray(parts) ? parts : [];
}

function extractReasoningTextFromParts(parts: unknown[]): string {
  const text: string[] = [];
  for (const part of parts) {
    const record = asRecord(part);
    if (!record) continue;
    const type = readEntryType(record);
    if (record.thought === true || type === "REASONING" || type === "THOUGHT" || type === "THINKING") {
      const partText = extractVisibleTranscriptText(record.text ?? record.content ?? record.summary ?? record.reasoning ?? record.thinking);
      if (partText) text.push(partText);
    }
  }
  return text.join("\n").trim();
}

function extractAssistantText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const record = asRecord(item);
      if (record && (record.thought === true || extractFunctionCall(record) || extractFunctionResponse(record))) {
        continue;
      }
      const text = extractAssistantText(item);
      if (text) parts.push(text);
    }
    return parts.join("\n").trim();
  }
  const record = asRecord(value);
  if (!record) return "";
  if (record.thought === true || extractFunctionCall(record) || extractFunctionResponse(record)) {
    return "";
  }
  return extractAssistantText(record.text ?? record.content ?? record.message ?? record.value ?? record.parts ?? record.response);
}

function buildToolCallTurn(value: unknown, timestampMs: number | null): ParsedConversationTurn | null {
  const record = extractFunctionCall(value) ?? asRecord(value);
  if (!record) return null;
  const toolName = extractToolName(record);
  const args = record.args ?? record.arguments ?? record.input ?? record.parameters;
  const turn: ParsedConversationTurn = {
    kind: "tool_call",
    text: toolName ? `Calling tool ${toolName}` : "Calling tool",
    toolName,
    toolArguments: args !== undefined ? stringify(args) : "",
    timestampMs,
  };
  const toolCallId = extractToolCallId(record);
  if (toolCallId) {
    turn.toolCallId = toolCallId;
  }
  const status = readFirstStringField(record, ["status", "state"]);
  if (status) turn.toolStatus = status;
  return turn;
}

function buildToolResultTurn(
  value: unknown,
  timestampMs: number | null,
  fallbackToolName?: string,
): ParsedConversationTurn | null {
  const response = extractFunctionResponse(value);
  const record = response ?? asRecord(value);
  if (!record) return null;
  const toolName = extractToolName(record) ?? fallbackToolName;
  const output = record.response ?? record.result ?? record.output ?? record.content ?? record.text ?? record.error;
  const text = extractVisibleTranscriptText(output) || stringify(output);
  const turn: ParsedConversationTurn = {
    kind: "tool_result",
    text,
    toolOutput: text,
    toolName,
    timestampMs,
  };
  const toolCallId = extractToolCallId(record);
  if (toolCallId) {
    turn.toolCallId = toolCallId;
  }
  const status = readFirstStringField(record, ["status", "state"]);
  if (status) {
    turn.toolStatus = status;
  }
  return turn;
}

/**
 * Parses the raw SQLite data from the conversation's DB file to extract token
 * usage totals, summed across every `gen_metadata` row (one per model call —
 * see {@link extractAntigravityUsageFromProto}) rather than just the latest.
 *
 * `agy --conversation=<id>` resumes the *same* conversation db across
 * follow-up/retry invocations, so rows accumulate across separate CLI runs
 * just like Codex's rollout file or OpenCode's session store. When `sinceIdx`
 * is provided, only rows with `idx > sinceIdx` are summed so a follow-up run
 * reports only the generations it added, not the whole conversation's
 * total-to-date — callers get that cutoff by peeking `lastIdx` from this same
 * function *before* a resumed run starts (see `provider-runner.ts`).
 */
export function parseAntigravityDatabase(tempDbPath: string, sinceIdx?: number): {
  usage: AntigravityUsageTotals | null;
  rawUsageJson: Record<string, unknown> | null;
  lastIdx: number | null;
} {
  let db: DatabaseSync | null = null;
  try {
    db = new DatabaseSync(tempDbPath, { readOnly: true });
    const totals: AntigravityUsageTotals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
    let rowsWithUsage = 0;
    let lastIdx: number | null = null;
    let skippedOversizedRow = false;
    const rows = db.prepare(`
      SELECT
        idx,
        length(data) AS data_bytes,
        CASE WHEN length(data) <= ? THEN data ELSE NULL END AS data
      FROM gen_metadata
      WHERE idx > ?
      ORDER BY idx ASC
    `).iterate(
      ANTIGRAVITY_MAX_METADATA_ROW_BYTES,
      typeof sinceIdx === "number" ? sinceIdx : -1,
    ) as Iterable<{ idx: number; data_bytes: number | null; data: Uint8Array | null }>;
    for (const row of rows) {
      lastIdx = row.idx;
      if (
        typeof row.data_bytes === "number"
        && row.data_bytes > ANTIGRAVITY_MAX_METADATA_ROW_BYTES
      ) {
        skippedOversizedRow = true;
        continue;
      }
      if (!(row.data instanceof Uint8Array)) {
        continue;
      }
      const extracted = extractAntigravityUsageFromProto(Buffer.from(row.data));
      if (!extracted?.usage) {
        continue;
      }
      totals.inputTokens += extracted.usage.inputTokens;
      totals.outputTokens += extracted.usage.outputTokens;
      totals.reasoningTokens += extracted.usage.reasoningTokens;
      totals.cachedInputTokens += extracted.usage.cachedInputTokens;
      rowsWithUsage += 1;
    }

    if (skippedOversizedRow) {
      return { usage: null, rawUsageJson: null, lastIdx };
    }
    if (rowsWithUsage === 0) {
      return { usage: null, rawUsageJson: null, lastIdx };
    }

    return {
      usage: totals,
      rawUsageJson: { ...totals, generationCount: rowsWithUsage },
      lastIdx,
    };
  } catch {
    return { usage: null, rawUsageJson: null, lastIdx: null };
  } finally {
    db?.close();
  }
}

/**
 * Parses the transcript JSONL or overview.txt contents into structured turns.
 */
export function parseAntigravityTranscript(
  transcriptContent: string,
  sinceMs?: number,
): ParsedConversationTurn[] {
  const lines = transcriptContent.split("\n");
  const conversation: ParsedConversationTurn[] = [];
  const seenEntries = new Set<string>();
  const minMs = typeof sinceMs === "number" ? sinceMs - 2000 : null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (
      !trimmed.startsWith("{")
      || trimmed.length > ANTIGRAVITY_MAX_JSONL_RECORD_CHARS
    ) continue;

    const entry = parseJsonObject(trimmed);
    if (!entry) continue;

    appendAntigravityEntryTurns(entry, conversation, minMs, seenEntries);
  }

  return retainProviderConversationTail(conversation);
}

function appendAntigravityEntryTurns(
  entry: Record<string, unknown>,
  conversation: ParsedConversationTurn[],
  minMs: number | null,
  seenEntries: Set<string>,
  depth = 0,
): void {
  if (depth > ANTIGRAVITY_MAX_NESTED_ENTRY_DEPTH) return;
  const entryKey = createHash("sha256")
    .update(JSON.stringify(entry))
    .digest("hex");
  if (seenEntries.has(entryKey)) return;
  if (seenEntries.size < ANTIGRAVITY_MAX_DEDUPE_ENTRIES) {
    seenEntries.add(entryKey);
  }
  const timestampMs = readTimestampMs(entry);
  if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
    return;
  }

  const nestedEntries = entry.entries ?? entry.items ?? entry.turns;
  if (Array.isArray(nestedEntries)) {
    for (const nested of nestedEntries) {
      const nestedRecord = asRecord(nested);
      if (nestedRecord) {
        appendAntigravityEntryTurns(
          nestedRecord,
          conversation,
          minMs,
          seenEntries,
          depth + 1,
        );
      }
    }
    return;
  }

  const entryType = readEntryType(entry);
  const actor = readEntryActor(entry);
  const parts = extractParts(entry.parts ?? entry.content ?? entry);

  const partToolResults = parts
    .filter((part) => extractFunctionResponse(part))
    .map((part) => buildToolResultTurn(part, timestampMs))
    .filter((turn): turn is ParsedConversationTurn => Boolean(turn));
  if (partToolResults.length > 0) {
    appendBoundedProviderTurns(conversation, partToolResults);
    return;
  }

  if (entryType === "USER_INPUT" || actor === "USER" || actor === "HUMAN") {
    let text = extractVisibleTranscriptText(entry.content ?? entry.text ?? entry.message ?? entry.parts);
    const requestMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    if (requestMatch) {
      text = requestMatch[1].trim();
    }
    if (text) {
      appendBoundedProviderTurns(conversation, [{ kind: "user", text, timestampMs }]);
    }
    return;
  }

  const explicitToolResult = entryType === "RUN_COMMAND"
    || entryType === "TOOL_RESPONSE"
    || entryType === "TOOL_RESULT"
    || entryType === "FUNCTION_RESPONSE";
  const nonAssistantModelEvent = Boolean(entryType)
    && (actor === "ASSISTANT" || actor === "MODEL" || actor === "AGENT" || actor === "PLANNER")
    && !ANTIGRAVITY_ASSISTANT_ENTRY_TYPES.has(entryType);
  if (explicitToolResult || nonAssistantModelEvent) {
    const toolResult = buildToolResultTurn(
      entry,
      timestampMs,
      entryType ? entryType.toLowerCase() : undefined,
    );
    if (toolResult) {
      appendBoundedProviderTurns(conversation, [toolResult]);
    }
    return;
  }

  const isAssistant = ANTIGRAVITY_ASSISTANT_ENTRY_TYPES.has(entryType)
    || (!entryType && (
      actor === "ASSISTANT"
      || actor === "MODEL"
      || actor === "AGENT"
      || actor === "PLANNER"
    ));

  if (isAssistant) {
    const reasoningText = extractVisibleTranscriptText(entry.reasoning ?? entry.planner_reasoning ?? entry.summary ?? entry.thinking)
      || extractReasoningTextFromParts(parts);
    if (reasoningText) {
      appendBoundedProviderTurns(
        conversation,
        [{ kind: "reasoning", text: reasoningText, timestampMs }],
      );
    }

    const text = extractAssistantText(entry.content ?? entry.text ?? entry.message ?? entry.parts ?? entry.response);
    if (text) {
      appendBoundedProviderTurns(
        conversation,
        [{ kind: "assistant", text, timestampMs }],
      );
    }

    const toolCalls = Array.isArray(entry.tool_calls)
      ? entry.tool_calls
      : Array.isArray(entry.toolCalls)
        ? entry.toolCalls
        : Array.isArray(entry.function_calls)
          ? entry.function_calls
          : [];
    for (const tc of toolCalls) {
      const toolCall = buildToolCallTurn(tc, timestampMs);
      if (toolCall) {
        appendBoundedProviderTurns(conversation, [toolCall]);
      }
    }
    for (const part of parts.filter((item) => extractFunctionCall(item))) {
      const toolCall = buildToolCallTurn(part, timestampMs);
      if (toolCall) {
        appendBoundedProviderTurns(conversation, [toolCall]);
      }
    }
    return;
  }

  if (actor === "SYSTEM" && entry.content) {
    const text = extractVisibleTranscriptText(entry.content);
    if (text) {
      appendBoundedProviderTurns(conversation, [{
        kind: "reasoning",
        text,
        timestampMs,
      }]);
    }
  }
}

function extractVisibleTranscriptText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (const item of value) {
      const text = extractVisibleTranscriptText(item);
      if (text) {
        parts.push(text);
      }
    }
    return parts.join("\n").trim();
  }
  if (value && typeof value === "object") {
    const rec = value as Record<string, unknown>;
    const candidate = rec.reasoning ?? rec.summary ?? rec.text ?? rec.content ?? rec.thinking ?? rec.planner_reasoning;
    const text = extractVisibleTranscriptText(candidate);
    if (text) {
      return text;
    }
  }
  return "";
}
