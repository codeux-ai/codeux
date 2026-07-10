import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import { DatabaseSync } from "node:sqlite";
import { parseJsonObject } from "./usage-parse-utils.js";

export interface AntigravityUsageTotals {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export type AntigravityLogResult = ParsedProviderLogResult<AntigravityUsageTotals>;

type ProtoField =
  | { fieldNumber: number; type: "varint"; value: number }
  | { fieldNumber: number; type: "fixed64"; value: number }
  | { fieldNumber: number; type: "fixed32"; value: number }
  | { fieldNumber: number; type: "string"; value: string }
  | { fieldNumber: number; type: "bytes"; value: Buffer }
  | { fieldNumber: number; type: "message"; value: ProtoField[] };

function decodeVarint(buffer: Buffer, pos: number): { value: number; pos: number } {
  let value = 0;
  let shift = 0;
  while (true) {
    if (pos >= buffer.length) {
      throw new Error("Varint out of bounds");
    }
    const b = buffer[pos];
    pos++;
    value |= (b & 0x7f) << shift;
    if (!(b & 0x80)) {
      break;
    }
    shift += 7;
  }
  return { value, pos };
}

function decodeProto(buffer: Buffer, pos = 0, end?: number): ProtoField[] {
  const limit = end ?? buffer.length;
  const fields: ProtoField[] = [];
  while (pos < limit) {
    try {
      const keyResult = decodeVarint(buffer, pos);
      const key = keyResult.value;
      pos = keyResult.pos;
      
      const fieldNumber = key >> 3;
      const wireType = key & 7;
      
      if (wireType === 0) {
        const varintResult = decodeVarint(buffer, pos);
        fields.push({ fieldNumber, type: "varint", value: varintResult.value });
        pos = varintResult.pos;
      } else if (wireType === 1) {
        if (pos + 8 > buffer.length) break;
        const val = buffer.readBigUInt64LE(pos);
        fields.push({ fieldNumber, type: "fixed64", value: Number(val) });
        pos += 8;
      } else if (wireType === 2) {
        const lenResult = decodeVarint(buffer, pos);
        const len = lenResult.value;
        pos = lenResult.pos;
        if (pos + len > buffer.length) break;
        const val = buffer.subarray(pos, pos + len);
        pos += len;
        
        try {
          const sub = decodeProto(val);
          if (sub.length > 0) {
            fields.push({ fieldNumber, type: "message", value: sub });
          } else {
            throw new Error();
          }
        } catch {
          try {
            const str = val.toString("utf8");
            let isPrintable = true;
            for (let i = 0; i < str.length; i++) {
              const code = str.charCodeAt(i);
              if (code < 32 && code !== 9 && code !== 10 && code !== 13) {
                isPrintable = false;
                break;
              }
            }
            if (isPrintable) {
              fields.push({ fieldNumber, type: "string", value: str });
            } else {
              throw new Error();
            }
          } catch {
            fields.push({ fieldNumber, type: "bytes", value: val });
          }
        }
      } else if (wireType === 5) {
        if (pos + 4 > buffer.length) break;
        const val = buffer.readUInt32LE(pos);
        fields.push({ fieldNumber, type: "fixed32", value: val });
        pos += 4;
      } else {
        break;
      }
    } catch {
      break;
    }
  }
  return fields;
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
function extractAntigravityUsageFromProto(fields: ProtoField[]): {
  usage: AntigravityUsageTotals | null;
  rawUsageJson: Record<string, unknown> | null;
} | null {
  const f1 = fields.find(f => f.fieldNumber === 1);
  if (!f1 || f1.type !== "message") return null;

  const f17 = f1.value.find(f => f.fieldNumber === 17);
  if (!f17 || f17.type !== "message") return null;

  const f2 = f17.value.find(f => f.fieldNumber === 2);
  if (!f2 || f2.type !== "message") return null;

  const f2Msg = f2.value;
  const f_input = f2Msg.find(f => f.fieldNumber === 2);
  const f_output = f2Msg.find(f => f.fieldNumber === 3);
  const f_cached = f2Msg.find(f => f.fieldNumber === 5);
  const f_reasoning = f2Msg.find(f => f.fieldNumber === 9);
  const f_candidates = f2Msg.find(f => f.fieldNumber === 10);

  const inputTokens = f_input && f_input.type === "varint" ? f_input.value : 0;
  const outputTokens = f_output && f_output.type === "varint" ? f_output.value : 0;
  const cachedInputTokens = f_cached && f_cached.type === "varint" ? f_cached.value : 0;
  const reasoningTokens = f_reasoning && f_reasoning.type === "varint" ? f_reasoning.value : 0;
  const candidatesTokens = f_candidates && f_candidates.type === "varint" ? f_candidates.value : 0;

  const usage: AntigravityUsageTotals = {
    inputTokens,
    outputTokens: outputTokens || (reasoningTokens + candidatesTokens),
    reasoningTokens,
    cachedInputTokens,
  };

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
  return turn;
}

function buildToolResultTurn(value: unknown, timestampMs: number | null): ParsedConversationTurn | null {
  const response = extractFunctionResponse(value);
  const record = response ?? asRecord(value);
  if (!record) return null;
  const toolName = extractToolName(record);
  const output = record.response ?? record.result ?? record.output ?? record.content ?? record.text ?? record.error;
  const turn: ParsedConversationTurn = {
    kind: "tool_result",
    text: extractVisibleTranscriptText(output) || stringify(output),
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
    const rows = db.prepare("SELECT idx, data FROM gen_metadata WHERE idx > ? ORDER BY idx ASC")
      .all(typeof sinceIdx === "number" ? sinceIdx : -1) as { idx: number; data: Buffer }[];
    if (rows.length === 0) {
      return { usage: null, rawUsageJson: null, lastIdx: null };
    }

    const totals: AntigravityUsageTotals = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cachedInputTokens: 0 };
    let rowsWithUsage = 0;
    let lastIdx: number | null = null;
    for (const row of rows) {
      lastIdx = row.idx;
      const fields = decodeProto(row.data);
      const extracted = extractAntigravityUsageFromProto(fields);
      if (!extracted?.usage) {
        continue;
      }
      totals.inputTokens += extracted.usage.inputTokens;
      totals.outputTokens += extracted.usage.outputTokens;
      totals.reasoningTokens += extracted.usage.reasoningTokens;
      totals.cachedInputTokens += extracted.usage.cachedInputTokens;
      rowsWithUsage += 1;
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
  const minMs = typeof sinceMs === "number" ? sinceMs - 2000 : null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) continue;

    const entry = parseJsonObject(trimmed);
    if (!entry) continue;

    appendAntigravityEntryTurns(entry, conversation, minMs);
  }

  return conversation;
}

function appendAntigravityEntryTurns(
  entry: Record<string, unknown>,
  conversation: ParsedConversationTurn[],
  minMs: number | null,
): void {
  const timestampMs = readTimestampMs(entry);
  if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
    return;
  }

  const nestedEntries = entry.entries ?? entry.items ?? entry.turns;
  if (Array.isArray(nestedEntries)) {
    for (const nested of nestedEntries) {
      const nestedRecord = asRecord(nested);
      if (nestedRecord) {
        appendAntigravityEntryTurns(nestedRecord, conversation, minMs);
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
    conversation.push(...partToolResults);
    return;
  }

  if (entryType === "USER_INPUT" || actor === "USER" || actor === "HUMAN") {
    let text = extractVisibleTranscriptText(entry.content ?? entry.text ?? entry.message ?? entry.parts);
    const requestMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
    if (requestMatch) {
      text = requestMatch[1].trim();
    }
    if (text) {
      conversation.push({ kind: "user", text, timestampMs });
    }
    return;
  }

  if (
    entryType === "RUN_COMMAND"
    || entryType === "TOOL_RESPONSE"
    || entryType === "TOOL_RESULT"
    || entryType === "FUNCTION_RESPONSE"
  ) {
    const toolResult = buildToolResultTurn(entry, timestampMs);
    if (toolResult) {
      conversation.push(toolResult);
    }
    return;
  }

  const isAssistant = entryType === "PLANNER_RESPONSE"
    || entryType === "ASSISTANT_RESPONSE"
    || entryType === "AGENT_RESPONSE"
    || actor === "ASSISTANT"
    || actor === "MODEL"
    || actor === "AGENT"
    || actor === "PLANNER";

  if (isAssistant) {
    const reasoningText = extractVisibleTranscriptText(entry.reasoning ?? entry.planner_reasoning ?? entry.summary ?? entry.thinking)
      || extractReasoningTextFromParts(parts);
    if (reasoningText) {
      conversation.push({ kind: "reasoning", text: reasoningText, timestampMs });
    }

    const text = extractAssistantText(entry.content ?? entry.text ?? entry.message ?? entry.parts ?? entry.response);
    if (text) {
      conversation.push({ kind: "assistant", text, timestampMs });
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
        conversation.push(toolCall);
      }
    }
    for (const part of parts.filter((item) => extractFunctionCall(item))) {
      const toolCall = buildToolCallTurn(part, timestampMs);
      if (toolCall) {
        conversation.push(toolCall);
      }
    }
    return;
  }

  if (actor === "SYSTEM" && entry.content) {
    const text = extractVisibleTranscriptText(entry.content);
    if (text) {
      conversation.push({
        kind: "reasoning",
        text,
        timestampMs,
      });
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
