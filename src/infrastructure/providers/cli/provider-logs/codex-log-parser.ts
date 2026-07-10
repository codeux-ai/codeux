import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import {
  parseJsonObject,
  parseTimestampMs,
  parseUsageObject,
  subtractUsageCounts,
  type ParsedUsageCounts,
} from "./usage-parse-utils.js";

export interface CodexLogResult extends ParsedProviderLogResult<ParsedUsageCounts> {
  /** The usage object the counts were read from, for raw telemetry storage. */
  rawUsageJson: Record<string, unknown> | null;
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
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    const rec = asRecord(item);
    if (rec && typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (rec && typeof rec.input_text === "string") {
      parts.push(rec.input_text);
    } else if (rec && typeof rec.output_text === "string") {
      parts.push(rec.output_text);
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

function extractVisibleReasoningText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  return flattenReasoningSummary(value) || flattenContent(value);
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

function extractSessionId(record: Record<string, unknown>, payload: Record<string, unknown> | null): string | null {
  for (const value of [
    record.thread_id,
    record.threadId,
    record.session_id,
    record.sessionId,
    payload?.thread_id,
    payload?.threadId,
    payload?.session_id,
    payload?.sessionId,
    payload?.id,
    record.id,
  ]) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }
  }
  return null;
}

function getUsagePayload(record: Record<string, unknown>, payload: Record<string, unknown> | null): Record<string, unknown> | null {
  const usage = asRecord(record.usage) ?? asRecord(payload?.usage);
  if (usage) {
    return usage;
  }
  const info = asRecord(record.info) ?? asRecord(payload?.info);
  return asRecord(info?.total_token_usage);
}

function addUsageCounts(total: ParsedUsageCounts, next: ParsedUsageCounts): ParsedUsageCounts {
  return {
    inputTokens: total.inputTokens + next.inputTokens,
    cachedInputTokens: total.cachedInputTokens + next.cachedInputTokens,
    outputTokens: total.outputTokens + next.outputTokens,
    reasoningOutputTokens: total.reasoningOutputTokens + next.reasoningOutputTokens,
  };
}

function emptyUsageCounts(): ParsedUsageCounts {
  return {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
  };
}

function extractToolArguments(item: Record<string, unknown>): string | undefined {
  const action = asRecord(item.action);
  const command = item.command ?? action?.command;
  if (typeof command === "string") {
    return command;
  }
  if (Array.isArray(command)) {
    return command.map((part) => typeof part === "string" ? part : stringifyOutput(part)).join(" ");
  }
  if (typeof item.arguments === "string") {
    return item.arguments;
  }
  if (item.arguments !== undefined) {
    return stringifyOutput(item.arguments);
  }
  if (typeof item.input === "string") {
    return item.input;
  }
  if (item.input !== undefined) {
    return stringifyOutput(item.input);
  }
  if (action) {
    return stringifyOutput(action);
  }
  return undefined;
}

function extractToolOutput(item: Record<string, unknown>): string {
  if (item.output !== undefined) {
    return stringifyOutput(item.output);
  }
  if (item.result !== undefined) {
    return stringifyOutput(item.result);
  }
  if (item.aggregated_output !== undefined) {
    return stringifyOutput(item.aggregated_output);
  }
  const stdout = typeof item.stdout === "string" ? item.stdout : "";
  const stderr = typeof item.stderr === "string" ? item.stderr : "";
  return [stdout, stderr].filter(Boolean).join("\n");
}

function appendWithToolNames(
  conversation: ParsedConversationTurn[],
  turns: ParsedConversationTurn[],
  toolNamesById: Map<string, string>,
): void {
  for (const turn of turns) {
    if (turn.kind === "tool_call" && turn.toolCallId && turn.toolName) {
      toolNamesById.set(turn.toolCallId, turn.toolName);
    }
    if (turn.kind === "tool_result" && turn.toolCallId && !turn.toolName) {
      const toolName = toolNamesById.get(turn.toolCallId);
      conversation.push(toolName ? { ...turn, toolName } : turn);
      continue;
    }
    conversation.push(turn);
  }
}

function eventMsgToTurns(payload: Record<string, unknown>, timestampMs: number | null): ParsedConversationTurn[] {
  const type = typeof payload.type === "string" ? payload.type : null;
  if (type !== "agent_message" && type !== "assistant_message" && type !== "user_message") {
    return [];
  }
  const text = flattenContent(payload.content)
    || stringifyOutput(payload.message ?? payload.text ?? payload.output).trim();
  if (!text) {
    return [];
  }
  return [{
    kind: type === "user_message" ? "user" : "assistant",
    text,
    timestampMs,
  }];
}

/**
 * Maps a Codex transcript item to normalized conversation turns. This accepts
 * both rollout `response_item.payload` entries and `codex exec --json`
 * `item.*.item` entries.
 */
export function turnsFromCodexItem(item: Record<string, unknown>, timestampMs: number | null): ParsedConversationTurn[] {
  const type = typeof item.type === "string" ? item.type : null;
  const id = typeof item.id === "string" ? item.id : undefined;
  const callId = typeof item.call_id === "string"
    ? item.call_id
    : typeof item.callId === "string"
      ? item.callId
      : id;

  if (type === "message") {
    const role = typeof item.role === "string" ? item.role : "";
    // Skip developer/system scaffolding (permissions, collaboration mode, etc.).
    if (role !== "user" && role !== "assistant") {
      return [];
    }
    const text = flattenContent(item.content);
    return text ? [{ kind: role === "user" ? "user" : "assistant", text, timestampMs }] : [];
  }

  if (type === "agent_message" || type === "assistant_message") {
    const text = flattenContent(item.content) || (typeof item.text === "string" ? item.text.trim() : "");
    return text ? [{ kind: "assistant", text, timestampMs }] : [];
  }

  if (type === "user_message") {
    const text = flattenContent(item.content) || (typeof item.text === "string" ? item.text.trim() : "");
    return text ? [{ kind: "user", text, timestampMs }] : [];
  }

  if (type === "reasoning") {
    const text = extractVisibleReasoningText(item.text ?? item.summary ?? item.summary_text ?? item.reasoning ?? item.content);
    return text ? [{ kind: "reasoning", text, timestampMs }] : [];
  }

  if (type === "function_call" || type === "custom_tool_call") {
    const toolName = typeof item.name === "string"
      ? item.name
      : type === "custom_tool_call"
        ? "custom_tool"
        : "function";
    return [{
      kind: "tool_call",
      text: "",
      toolName,
      toolCallId: callId,
      toolArguments: extractToolArguments(item),
      toolStatus: typeof item.status === "string" ? item.status : undefined,
      timestampMs,
    }];
  }

  if (
    type === "function_call_output"
    || type === "custom_tool_call_output"
    || type === "tool_output"
    || type === "tool_result"
  ) {
    return [{
      kind: "tool_result",
      text: "",
      toolCallId: callId,
      toolOutput: extractToolOutput(item),
      toolStatus: typeof item.status === "string" ? item.status : undefined,
      timestampMs,
    }];
  }

  if (type === "command_execution" || type === "local_shell_call") {
    const status = typeof item.status === "string" ? item.status : undefined;
    const exitCode = typeof item.exit_code === "number"
      ? item.exit_code
      : typeof item.exitCode === "number"
        ? item.exitCode
        : null;
    const output = extractToolOutput(item);
    const turns: ParsedConversationTurn[] = [{
      kind: "tool_call",
      text: "",
      toolName: "shell",
      toolCallId: callId,
      toolArguments: extractToolArguments(item),
      toolStatus: status,
      timestampMs,
    }];
    // Only emit a result once the command has produced output / an exit code
    // (i.e. the completed event), not the in-progress start event.
    if (output || exitCode !== null) {
      turns.push({
        kind: "tool_result",
        text: "",
        toolCallId: callId,
        toolName: "shell",
        toolOutput: output,
        toolStatus: status ?? (exitCode === 0 ? "completed" : "failed"),
        timestampMs,
      });
    }
    return turns;
  }

  if (type === "local_shell_call_output") {
    return [{
      kind: "tool_result",
      text: "",
      toolCallId: callId,
      toolName: "shell",
      toolOutput: extractToolOutput(item),
      toolStatus: typeof item.status === "string" ? item.status : undefined,
      timestampMs,
    }];
  }

  if (type === "file_change" || type === "patch" || type === "patch_apply") {
    const changes = item.changes ?? item.path ?? item.unified_diff ?? item;
    return [{
      kind: "tool_call",
      text: "",
      toolName: "apply_patch",
      toolCallId: callId,
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
      toolCallId: callId,
      toolArguments: extractToolArguments(item),
      timestampMs,
    }];
    if (item.result !== undefined || item.output !== undefined) {
      turns.push({
        kind: "tool_result",
        text: "",
        toolCallId: callId,
        toolName: name,
        toolOutput: extractToolOutput(item),
        timestampMs,
      });
    }
    return turns;
  }

  if (type === "web_search") {
    const query = typeof item.query === "string" ? item.query : "";
    return [{ kind: "tool_call", text: "", toolName: "web_search", toolCallId: callId, toolArguments: query, timestampMs }];
  }

  return [];
}

/**
 * Parses a Codex rollout JSONL file (one JSON object per line) into both the
 * cumulative token usage and the ordered conversation. Codex writes these to
 * `~/.codex/sessions/YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl`.
 *
 * - Token usage: the LAST `event_msg`/`token_count` event's
 *   `payload.info.total_token_usage` (cumulative for the session). When
 *   `sinceMs` is provided, this cumulative total is reduced by the most
 *   recent `total_token_usage` snapshot seen *before* the window opened, so a
 *   resumed session reports only the tokens the current run added instead of
 *   re-reporting every prior turn's tokens too (which would double-count them
 *   against the earlier run's already-persisted usage).
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
  let latestCumulativeUsage: Record<string, unknown> | null = null;
  let baselineUsage: Record<string, unknown> | null = null;
  let directUsage: ParsedUsageCounts | null = null;
  let latestDirectUsageJson: Record<string, unknown> | null = null;
  let hasCumulativeUsageInWindow = false;
  let nativeSessionId: string | null = null;
  const conversation: ParsedConversationTurn[] = [];
  const fallbackEventConversation: ParsedConversationTurn[] = [];
  const toolNamesById = new Map<string, string>();
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

    if (type === "session_meta" || type === "thread.started" || type === "session.created") {
      nativeSessionId = extractSessionId(line, payload) ?? nativeSessionId;
      continue;
    }

    if ((type === "event_msg" && payload && payload.type === "token_count") || type === "token_count") {
      const totalUsage = getUsagePayload(line, payload);
      if (totalUsage) {
        latestCumulativeUsage = totalUsage;
        // Keep the latest snapshot seen strictly before this run's window as
        // the baseline to subtract out below.
        if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
          baselineUsage = totalUsage;
        } else {
          hasCumulativeUsageInWindow = true;
        }
      }
      continue;
    }

    if (type === "turn.completed") {
      const usagePayload = getUsagePayload(line, payload);
      if (usagePayload && (minMs === null || timestampMs === null || timestampMs >= minMs)) {
        directUsage = addUsageCounts(directUsage ?? emptyUsageCounts(), parseUsageObject(usagePayload));
        latestDirectUsageJson = usagePayload;
      }
      continue;
    }

    if (type === "event_msg" && payload) {
      const turns = eventMsgToTurns(payload, timestampMs);
      if (turns.length > 0 && (minMs === null || timestampMs === null || timestampMs >= minMs)) {
        fallbackEventConversation.push(...turns);
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

    appendWithToolNames(conversation, turnsFromCodexItem(payload, timestampMs), toolNamesById);
  }

  let usage: ParsedUsageCounts | null = null;
  let rawUsageJson: Record<string, unknown> | null = null;
  if (latestCumulativeUsage && (hasCumulativeUsageInWindow || !directUsage)) {
    usage = parseUsageObject(latestCumulativeUsage);
    rawUsageJson = latestCumulativeUsage;
  } else if (directUsage) {
    usage = directUsage;
    rawUsageJson = latestDirectUsageJson;
  } else if (latestCumulativeUsage) {
    usage = parseUsageObject(latestCumulativeUsage);
    rawUsageJson = latestCumulativeUsage;
  }
  if (usage && rawUsageJson === latestCumulativeUsage && baselineUsage) {
    usage = subtractUsageCounts(usage, parseUsageObject(baselineUsage));
  }
  return {
    usage,
    rawUsageJson,
    conversation: conversation.length > 0 ? conversation : fallbackEventConversation,
    nativeSessionId,
  };
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
export function parseCodexExecStdout(stdout: string): CodexLogResult {
  let directUsage: ParsedUsageCounts | null = null;
  let latestDirectUsageJson: Record<string, unknown> | null = null;
  let legacyUsage: ParsedUsageCounts | null = null;
  let latestLegacyUsageJson: Record<string, unknown> | null = null;
  let nativeSessionId: string | null = null;
  const conversation: ParsedConversationTurn[] = [];
  const fallbackEventConversation: ParsedConversationTurn[] = [];
  const toolNamesById = new Map<string, string>();
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

    if (type === "thread.started" || type === "session.created" || type === "session_meta") {
      nativeSessionId = extractSessionId(parsed, payload) ?? nativeSessionId;
      continue;
    }

    // New schema: turn.completed carries the per-turn usage directly.
    if (type === "turn.completed") {
      const usage = getUsagePayload(parsed, payload);
      if (usage) {
        directUsage = addUsageCounts(directUsage ?? emptyUsageCounts(), parseUsageObject(usage));
        latestDirectUsageJson = usage;
      }
      continue;
    }

    // Legacy schema: event_msg/token_count with cumulative total_token_usage.
    if ((type === "token_count" && payload) || (type === "event_msg" && payload?.type === "token_count")) {
      const totalUsage = getUsagePayload(parsed, payload);
      if (totalUsage) {
        legacyUsage = parseUsageObject(totalUsage);
        latestLegacyUsageJson = totalUsage;
      }
      continue;
    }

    if (type === "event_msg" && payload) {
      fallbackEventConversation.push(...eventMsgToTurns(payload, timestampMs));
      continue;
    }

    if (type === "response_item") {
      const item = asRecord(payload) ?? asRecord(parsed.item);
      if (item) {
        appendWithToolNames(conversation, turnsFromCodexItem(item, timestampMs), toolNamesById);
      }
      continue;
    }

    if (type === "item.completed" || type === "item.updated" || type === "item.started") {
      const item = asRecord(parsed.item) ?? asRecord(payload?.item);
      if (!item) {
        continue;
      }
      const itemId = typeof item.id === "string" ? item.id : null;
      const turns = turnsFromCodexItem(item, timestampMs);
      if (type === "item.completed") {
        if (itemId && completedItemIds.has(itemId)) {
          continue;
        }
        if (itemId) {
          completedItemIds.add(itemId);
          startedOnlyTurns.delete(itemId);
        }
        appendWithToolNames(conversation, turns, toolNamesById);
      } else if (itemId && !completedItemIds.has(itemId)) {
        // Remember the latest started/updated state so an item that never
        // completes (e.g. the process is killed mid-run) is still represented.
        startedOnlyTurns.set(itemId, turns);
      } else if (!itemId) {
        appendWithToolNames(conversation, turns, toolNamesById);
      }
    }
  }

  // Append any items that started/updated but never completed, in insertion order.
  for (const turns of startedOnlyTurns.values()) {
    appendWithToolNames(conversation, turns, toolNamesById);
  }

  const usage = directUsage ?? legacyUsage;
  const rawUsageJson = latestDirectUsageJson ?? latestLegacyUsageJson;
  return {
    usage,
    rawUsageJson,
    nativeSessionId,
    conversation: conversation.length > 0 ? conversation : fallbackEventConversation,
  };
}
