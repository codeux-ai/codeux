import type { ParsedConversationTurn } from "./provider-conversation-types.js";
import {
  parseJsonObject,
  parseTimestampMs,
  parseUsageObject,
  type ParsedUsageCounts,
} from "./usage-parse-utils.js";

export interface CodexLogResult {
  usage: ParsedUsageCounts | null;
  /** The usage object the counts were read from, for raw telemetry storage. */
  rawUsageJson: Record<string, unknown> | null;
  conversation: ParsedConversationTurn[];
  nativeSessionId: string | null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

/** Flattens a Codex message `content` array (input_text / output_text / text parts) to plain text. */
function flattenContent(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (rec && typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  return parts.join("").trim();
}

/** Reasoning summaries are an array of `{ type: "summary_text", text }` entries. */
function flattenReasoningSummary(summary: unknown): string {
  if (!Array.isArray(summary)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of summary) {
    const rec = asRecord(item);
    if (rec && typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (typeof item === "string") {
      parts.push(item);
    }
  }
  return parts.join("\n\n").trim();
}

function stringifyOutput(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value === null || value === undefined) {
    return "";
  }
  // function_call_output.output is sometimes an object { output, metadata }.
  const rec = asRecord(value);
  if (rec && typeof rec.output === "string") {
    return rec.output;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Parses a Codex rollout JSONL file (one JSON object per line) into both the
 * cumulative token usage and the ordered conversation. Codex writes these to
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`.
 *
 * - Token usage: the LAST `event_msg`/`token_count` event's
 *   `payload.info.total_token_usage` (cumulative for the session).
 * - Conversation: built from `response_item` payloads (the canonical model
 *   transcript): `message`, `reasoning`, `function_call`(+output),
 *   `custom_tool_call`(+output). `event_msg` duplicates (agent_message /
 *   user_message) are ignored to avoid double-counting.
 *
 * When `sinceMs` is provided, only turns at/after that time are kept so a
 * resumed session contributes only the current run's turns.
 */
export function parseCodexRolloutJsonl(jsonl: string, sinceMs?: number): CodexLogResult {
  const lines = jsonl.split("\n");
  let latestUsage: Record<string, unknown> | null = null;
  let nativeSessionId: string | null = null;
  const conversation: ParsedConversationTurn[] = [];
  const minMs = typeof sinceMs === "number" ? sinceMs - 200 : null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const line = parseJsonObject(trimmed);
    if (!line) {
      continue;
    }
    const type = typeof line.type === "string" ? line.type : null;
    const payload = asRecord(line.payload);
    const timestampMs = parseTimestampMs(line.timestamp);

    if (type === "session_meta" && payload && typeof payload.id === "string") {
      nativeSessionId = payload.id;
      continue;
    }

    if (type === "event_msg" && payload && payload.type === "token_count") {
      const info = asRecord(payload.info);
      const totalUsage = asRecord(info?.total_token_usage);
      if (totalUsage) {
        latestUsage = totalUsage;
      }
      continue;
    }

    if (type !== "response_item" || !payload) {
      continue;
    }

    // Beyond this point we build the conversation. Honour the run-isolation window.
    if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
      continue;
    }

    const payloadType = typeof payload.type === "string" ? payload.type : null;

    if (payloadType === "message") {
      const role = typeof payload.role === "string" ? payload.role : "";
      // Skip developer/system scaffolding (permissions, collaboration mode, etc.).
      if (role !== "user" && role !== "assistant") {
        continue;
      }
      const text = flattenContent(payload.content);
      if (text) {
        conversation.push({ kind: role === "user" ? "user" : "assistant", text, timestampMs });
      }
      continue;
    }

    if (payloadType === "reasoning") {
      const text = flattenReasoningSummary(payload.summary) || flattenContent(payload.content);
      // Reasoning is encrypted by default (empty summary); only surface readable summaries.
      if (text) {
        conversation.push({ kind: "reasoning", text, timestampMs });
      }
      continue;
    }

    if (payloadType === "function_call" || payloadType === "custom_tool_call") {
      conversation.push({
        kind: "tool_call",
        text: "",
        toolName: typeof payload.name === "string" ? payload.name : undefined,
        toolCallId: typeof payload.call_id === "string" ? payload.call_id : undefined,
        toolArguments: typeof payload.arguments === "string"
          ? payload.arguments
          : typeof payload.input === "string"
            ? payload.input
            : undefined,
        toolStatus: typeof payload.status === "string" ? payload.status : undefined,
        timestampMs,
      });
      continue;
    }

    if (payloadType === "function_call_output" || payloadType === "custom_tool_call_output") {
      conversation.push({
        kind: "tool_result",
        text: "",
        toolCallId: typeof payload.call_id === "string" ? payload.call_id : undefined,
        toolOutput: stringifyOutput(payload.output),
        timestampMs,
      });
      continue;
    }
  }

  const usage = latestUsage ? parseUsageObject(latestUsage) : null;
  return { usage, rawUsageJson: latestUsage, conversation, nativeSessionId };
}

/**
 * Parses `codex exec --json` stdout for token usage. Handles both the legacy
 * experimental schema (`event_msg`/`token_count` with `info.total_token_usage`)
 * and the newer thread/turn schema (`turn.completed` carrying a `usage` object,
 * `thread.started` carrying a `thread_id`). Conversation is intentionally read
 * from the richer rollout file, not stdout.
 */
export function parseCodexExecStdout(stdout: string): { usage: ParsedUsageCounts | null; rawUsageJson: Record<string, unknown> | null; nativeSessionId: string | null } {
  let latestUsage: Record<string, unknown> | null = null;
  let nativeSessionId: string | null = null;

  for (const rawLine of stdout.split("\n")) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) {
      continue;
    }
    const parsed = parseJsonObject(trimmed);
    if (!parsed) {
      continue;
    }
    const payload = asRecord(parsed.payload);
    const type = typeof parsed.type === "string" ? parsed.type : typeof payload?.type === "string" ? payload!.type : null;

    if ((type === "thread.started" || type === "session.created") && typeof parsed.thread_id === "string") {
      nativeSessionId = parsed.thread_id;
      continue;
    }

    // New schema: turn.completed carries the per-turn usage directly.
    if (type === "turn.completed") {
      const usage = asRecord(parsed.usage) ?? asRecord(payload?.usage);
      if (usage) {
        latestUsage = usage;
      }
      continue;
    }

    // Legacy schema: event_msg/token_count with cumulative total_token_usage.
    if (type === "token_count" && payload) {
      const info = asRecord(payload.info);
      const totalUsage = asRecord(info?.total_token_usage);
      if (totalUsage) {
        latestUsage = totalUsage;
      }
      continue;
    }
  }

  const usage = latestUsage ? parseUsageObject(latestUsage) : null;
  return { usage, rawUsageJson: latestUsage, nativeSessionId };
}
