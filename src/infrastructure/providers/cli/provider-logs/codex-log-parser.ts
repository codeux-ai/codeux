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
  const minMs = typeof sinceMs === "number" ? sinceMs - 2000 : null;

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

/** Maps a single `codex exec --json` stream item (the public thread/item schema)
 *  to conversation turns. `command_execution` yields a tool_call + tool_result
 *  pair; `agent_message`/`reasoning` yield text turns; tool-style items become a
 *  tool_call. Returns [] for items we don't surface (e.g. internal todo lists). */
function streamItemToTurns(item: Record<string, unknown>, timestampMs: number | null): ParsedConversationTurn[] {
  const type = typeof item.type === "string" ? item.type : null;
  const id = typeof item.id === "string" ? item.id : undefined;

  if (type === "agent_message") {
    const text = typeof item.text === "string" ? item.text.trim() : "";
    return text ? [{ kind: "assistant", text, timestampMs }] : [];
  }

  if (type === "reasoning") {
    const text = typeof item.text === "string"
      ? item.text.trim()
      : flattenReasoningSummary(item.summary);
    return text ? [{ kind: "reasoning", text, timestampMs }] : [];
  }

  if (type === "command_execution") {
    const command = typeof item.command === "string" ? item.command : "";
    const status = typeof item.status === "string" ? item.status : undefined;
    const exitCode = typeof item.exit_code === "number" ? item.exit_code : null;
    const output = typeof item.aggregated_output === "string"
      ? item.aggregated_output
      : typeof item.output === "string"
        ? item.output
        : "";
    const turns: ParsedConversationTurn[] = [{
      kind: "tool_call",
      text: "",
      toolName: "shell",
      toolCallId: id,
      toolArguments: command,
      toolStatus: status,
      timestampMs,
    }];
    // Only emit a result once the command has produced output / an exit code
    // (i.e. the completed event), not the in-progress start event.
    if (output || exitCode !== null) {
      turns.push({
        kind: "tool_result",
        text: "",
        toolCallId: id,
        toolName: "shell",
        toolOutput: output,
        toolStatus: status ?? (exitCode === 0 ? "completed" : "failed"),
        timestampMs,
      });
    }
    return turns;
  }

  if (type === "file_change" || type === "patch" || type === "patch_apply") {
    const changes = item.changes ?? item.path ?? item.unified_diff ?? item;
    return [{
      kind: "tool_call",
      text: "",
      toolName: "apply_patch",
      toolCallId: id,
      toolArguments: stringifyOutput(changes),
      timestampMs,
    }];
  }

  if (type === "mcp_tool_call") {
    const server = typeof item.server === "string" ? item.server : "";
    const tool = typeof item.tool === "string" ? item.tool : "";
    const name = [server, tool].filter(Boolean).join(".") || "mcp_tool";
    const turns: ParsedConversationTurn[] = [{
      kind: "tool_call",
      text: "",
      toolName: name,
      toolCallId: id,
      toolArguments: typeof item.arguments === "string" ? item.arguments : stringifyOutput(item.arguments),
      timestampMs,
    }];
    if (item.result !== undefined || item.output !== undefined) {
      turns.push({
        kind: "tool_result",
        text: "",
        toolCallId: id,
        toolName: name,
        toolOutput: stringifyOutput(item.result ?? item.output),
        timestampMs,
      });
    }
    return turns;
  }

  if (type === "web_search") {
    const query = typeof item.query === "string" ? item.query : "";
    return [{ kind: "tool_call", text: "", toolName: "web_search", toolCallId: id, toolArguments: query, timestampMs }];
  }

  return [];
}

/**
 * Parses `codex exec --json` stdout for token usage **and** the conversation.
 * Handles the legacy experimental schema (`event_msg`/`token_count` with
 * `info.total_token_usage`) and the public thread/item schema:
 *   - `thread.started` carries a `thread_id`
 *   - `turn.completed` carries a `usage` object
 *   - `item.completed` (and trailing `item.started`) carry `item` payloads:
 *     `agent_message`, `reasoning`, `command_execution`, `file_change`,
 *     `mcp_tool_call`, `web_search`.
 *
 * The conversation is parsed here so that when the richer rollout JSONL file is
 * unavailable, the dashboard still renders proper per-turn messages instead of a
 * single raw JSON blob. The stdout stream is naturally scoped to the current
 * invocation (unlike the rollout file, which accumulates across resumes), so no
 * time-window isolation is applied.
 */
export function parseCodexExecStdout(stdout: string): {
  usage: ParsedUsageCounts | null;
  rawUsageJson: Record<string, unknown> | null;
  nativeSessionId: string | null;
  conversation: ParsedConversationTurn[];
} {
  let latestUsage: Record<string, unknown> | null = null;
  let nativeSessionId: string | null = null;
  const conversation: ParsedConversationTurn[] = [];
  // Track which item ids have been fully emitted (on item.completed) so a
  // trailing item.started for the same id isn't surfaced as a duplicate.
  const completedItemIds = new Set<string>();
  const startedOnlyTurns = new Map<string, ParsedConversationTurn[]>();

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
    const timestampMs = parseTimestampMs(parsed.timestamp);

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

    if (type === "item.completed" || type === "item.updated" || type === "item.started") {
      const item = asRecord(parsed.item);
      if (!item) {
        continue;
      }
      const itemId = typeof item.id === "string" ? item.id : null;
      const turns = streamItemToTurns(item, timestampMs);
      if (type === "item.completed") {
        if (itemId) {
          completedItemIds.add(itemId);
          startedOnlyTurns.delete(itemId);
        }
        conversation.push(...turns);
      } else if (itemId && !completedItemIds.has(itemId)) {
        // Remember the latest started/updated state so an item that never
        // completes (e.g. the process is killed mid-run) is still represented.
        startedOnlyTurns.set(itemId, turns);
      } else if (!itemId) {
        conversation.push(...turns);
      }
    }
  }

  // Append any items that started/updated but never completed, in insertion order.
  for (const turns of startedOnlyTurns.values()) {
    conversation.push(...turns);
  }

  const usage = latestUsage ? parseUsageObject(latestUsage) : null;
  return { usage, rawUsageJson: latestUsage, nativeSessionId, conversation };
}
