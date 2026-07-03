import type { ParsedConversationTurn } from "./provider-conversation-types.js";
import { DatabaseSync } from "node:sqlite";
import { parseJsonObject } from "./usage-parse-utils.js";

export interface AntigravityUsageTotals {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
  cachedInputTokens: number;
}

export interface AntigravityLogResult {
  usage: AntigravityUsageTotals | null;
  rawUsageJson: Record<string, unknown> | null;
  conversation: ParsedConversationTurn[];
  nativeSessionId: string | null;
}

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
  ]);
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
} | null {
  try {
    const db = new DatabaseSync(tempDbPath, { readOnly: true });
    const rows = db.prepare("SELECT idx, data FROM gen_metadata WHERE idx > ? ORDER BY idx ASC")
      .all(typeof sinceIdx === "number" ? sinceIdx : -1) as { idx: number; data: Buffer }[];
    if (rows.length === 0) {
      return null;
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
    return null;
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

    const timestampMs = typeof entry.created_at === "string" ? Date.parse(entry.created_at) : null;
    if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
      continue;
    }

    if (entry.type === "USER_INPUT") {
      let text = typeof entry.content === "string" ? entry.content : "";
      const requestMatch = text.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/);
      if (requestMatch) {
        text = requestMatch[1].trim();
      }
      conversation.push({ kind: "user", text, timestampMs });
    } else if (entry.type === "PLANNER_RESPONSE") {
      const reasoningText = extractVisibleTranscriptText(entry.reasoning ?? entry.planner_reasoning ?? entry.summary ?? entry.thinking);
      if (reasoningText) {
        conversation.push({ kind: "reasoning", text: reasoningText, timestampMs });
      }
      if (entry.content) {
        const text = extractVisibleTranscriptText(entry.content);
        if (text) {
          conversation.push({ kind: "assistant", text, timestampMs });
        }
      }
      if (Array.isArray(entry.tool_calls)) {
        for (const tc of entry.tool_calls) {
          const tcRecord = asRecord(tc);
          const toolName = extractToolName(tcRecord);
          const toolCall: ParsedConversationTurn = {
            kind: "tool_call",
            text: toolName ? `Calling tool ${toolName}` : "Calling tool",
            toolName,
            toolArguments: typeof tcRecord?.args === "object" ? JSON.stringify(tcRecord.args) : String(tcRecord?.args || ""),
            timestampMs,
          };
          const toolCallId = extractToolCallId(tcRecord);
          if (toolCallId) {
            toolCall.toolCallId = toolCallId;
          }
          conversation.push(toolCall);
        }
      }
    } else if (entry.type === "RUN_COMMAND" || entry.type === "TOOL_RESPONSE" || (entry.source === "SYSTEM" && entry.content)) {
      const text = typeof entry.content === "string" ? entry.content : "";
      if (entry.type === "RUN_COMMAND" || entry.type === "TOOL_RESPONSE") {
        const toolResult: ParsedConversationTurn = {
          kind: "tool_result",
          text,
          timestampMs,
        };
        const toolCallId = extractToolCallId(entry);
        if (toolCallId) {
          toolResult.toolCallId = toolCallId;
        }
        const toolName = extractToolName(entry);
        if (toolName) {
          toolResult.toolName = toolName;
        }
        conversation.push(toolResult);
      } else if (text) {
        conversation.push({
          kind: "reasoning",
          text,
          timestampMs,
        });
      }
    }
  }

  return conversation;
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
