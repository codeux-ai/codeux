import type { ParsedConversationTurn } from "./provider-conversation-types.js";
import { DatabaseSync } from "node:sqlite";

export interface AntigravityUsageTotals {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens: number;
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
  const f_reasoning = f2Msg.find(f => f.fieldNumber === 9);
  const f_candidates = f2Msg.find(f => f.fieldNumber === 10);
  
  const inputTokens = f_input && f_input.type === "varint" ? f_input.value : 0;
  const outputTokens = f_output && f_output.type === "varint" ? f_output.value : 0;
  const reasoningTokens = f_reasoning && f_reasoning.type === "varint" ? f_reasoning.value : 0;
  const candidatesTokens = f_candidates && f_candidates.type === "varint" ? f_candidates.value : 0;
  
  const usage: AntigravityUsageTotals = {
    inputTokens,
    outputTokens: outputTokens || (reasoningTokens + candidatesTokens),
    reasoningTokens,
  };

  const rawUsageJson: Record<string, unknown> = {
    inputTokens,
    outputTokens: usage.outputTokens,
    reasoningTokens,
    candidatesTokens,
  };

  return { usage, rawUsageJson };
}

/**
 * Parses the raw SQLite data from the conversation's DB file to extract token usage totals.
 */
export function parseAntigravityDatabase(tempDbPath: string): {
  usage: AntigravityUsageTotals | null;
  rawUsageJson: Record<string, unknown> | null;
} | null {
  try {
    const db = new DatabaseSync(tempDbPath, { readOnly: true });
    const rows = db.prepare("SELECT data FROM gen_metadata ORDER BY idx DESC LIMIT 1").all() as { data: Buffer }[];
    if (rows.length === 0) {
      return null;
    }
    const fields = decodeProto(rows[0].data);
    return extractAntigravityUsageFromProto(fields);
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

    try {
      const entry = JSON.parse(trimmed);
      if (!entry) continue;

      const timestampMs = entry.created_at ? Date.parse(entry.created_at) : null;
      if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
        continue;
      }

      if (entry.type === "USER_INPUT") {
        let text = entry.content || "";
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
            const toolCall = tc && typeof tc === "object" ? tc as Record<string, unknown> : null;
            if (!toolCall) {
              continue;
            }
            const toolName = extractToolName(toolCall);
            const toolCallId = extractCorrelationId(toolCall);
            const toolArguments = stringifyToolArguments(toolCall.args ?? toolCall.arguments ?? toolCall.input);
            if (!toolName && !toolCallId && !toolArguments) {
              continue;
            }
            const turn: ParsedConversationTurn = {
              kind: "tool_call",
              text: toolName ? `Calling tool ${toolName}` : "Calling tool",
              timestampMs,
            };
            if (toolName) {
              turn.toolName = toolName;
            }
            if (toolCallId) {
              turn.toolCallId = toolCallId;
            }
            if (toolArguments !== undefined) {
              turn.toolArguments = toolArguments;
            }
            conversation.push(turn);
          }
        }
      } else if (entry.type === "RUN_COMMAND" || entry.type === "TOOL_RESPONSE") {
        const text = extractVisibleTranscriptText(entry.content);
        const toolCallId = extractCorrelationId(entry);
        const toolName = extractToolName(entry);
        if (text || toolCallId || toolName) {
          const turn: ParsedConversationTurn = {
            kind: "tool_result",
            text,
            timestampMs,
          };
          if (toolCallId) {
            turn.toolCallId = toolCallId;
          }
          if (toolName) {
            turn.toolName = toolName;
          }
          if (text) {
            turn.toolOutput = text;
          }
          conversation.push(turn);
        }
      } else if (entry.source === "SYSTEM" && entry.content) {
        const text = extractVisibleTranscriptText(entry.content);
        if (text) {
          conversation.push({
            kind: "reasoning",
            text,
            timestampMs,
          });
        }
      }
    } catch {
      // Ignore parse errors for malformed entries
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

function firstStringField(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value;
    }
  }
  return undefined;
}

function extractCorrelationId(record: Record<string, unknown>): string | undefined {
  return firstStringField(record, [
    "toolCallId",
    "tool_call_id",
    "callId",
    "call_id",
    "callID",
    "id",
  ]);
}

function extractToolName(record: Record<string, unknown>): string | undefined {
  return firstStringField(record, [
    "toolName",
    "tool_name",
    "name",
    "tool",
  ]);
}

function stringifyToolArguments(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
