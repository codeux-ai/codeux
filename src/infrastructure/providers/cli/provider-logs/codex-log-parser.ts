import type {
  ParsedConversationTurn,
  ParsedProviderLogResult,
  ParsedTurnTokens,
} from "./provider-conversation-types.js";
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
  conversationRevision?: number;
  conversationChangedFromIndex?: number;
}

/**
 * Rollout records can contain raw command output or generated binary assets in
 * one JSONL line. Keep parser state comfortably below V8's heap ceiling even
 * when a provider emits an unexpectedly large record.
 */
export const CODEX_MAX_JSONL_RECORD_CHARS = 2 * 1024 * 1024;
export const CODEX_MAX_RETAINED_CONVERSATION_GROUPS = 256;
export const CODEX_MAX_RETAINED_TURN_TEXT_CHARS = 16_000;
export const CODEX_MAX_RETAINED_TOOL_PAYLOAD_CHARS = 8_000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? value as Record<string, unknown> : null;
}

function truncateRetainedField(value: string, maxChars: number): string {
  if (!value || value.length <= maxChars) {
    return value;
  }
  const omitted = value.length - maxChars;
  const marker = `\n\n… [${omitted.toLocaleString("en-US")} characters truncated] …\n\n`;
  const budget = Math.max(0, maxChars - marker.length);
  const headChars = Math.ceil(budget * 0.7);
  const tailChars = budget - headChars;
  return `${value.slice(0, headChars)}${marker}${tailChars > 0 ? value.slice(-tailChars) : ""}`;
}

function boundConversationTurn(turn: ParsedConversationTurn): ParsedConversationTurn {
  return {
    ...turn,
    text: truncateRetainedField(turn.text, CODEX_MAX_RETAINED_TURN_TEXT_CHARS),
    ...(turn.toolArguments !== undefined
      ? {
          toolArguments: truncateRetainedField(
            turn.toolArguments,
            CODEX_MAX_RETAINED_TOOL_PAYLOAD_CHARS,
          ),
        }
      : {}),
    ...(turn.toolOutput !== undefined
      ? {
          toolOutput: truncateRetainedField(
            turn.toolOutput,
            CODEX_MAX_RETAINED_TOOL_PAYLOAD_CHARS,
          ),
        }
      : {}),
  };
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

function extractVisibleReasoningText(item: Record<string, unknown>): string {
  // Codex rollout reasoning records may also carry `encrypted_content` or
  // provider-internal opaque payloads. Only fields explicitly intended for
  // readable display are eligible for transcript reconstruction.
  return flattenReasoningSummary(item.summary)
    || (typeof item.summary_text === "string" ? item.summary_text.trim() : "")
    || (typeof item.text === "string" ? item.text.trim() : "")
    || flattenContent(item.content);
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

function extractTurnTokens(item: Record<string, unknown>): ParsedTurnTokens | undefined {
  const raw = asRecord(item.tokens) ?? asRecord(item.usage) ?? asRecord(item.token_usage);
  if (!raw) {
    return undefined;
  }
  const parsed = parseUsageObject(raw);
  return {
    input: parsed.inputTokens,
    cached: parsed.cachedInputTokens,
    output: parsed.outputTokens,
    reasoning: parsed.reasoningOutputTokens,
    total: parsed.inputTokens + parsed.cachedInputTokens + parsed.outputTokens,
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

interface ConversationTurnGroup {
  key: string | null;
  turns: ParsedConversationTurn[];
}

function conversationItemKey(item: Record<string, unknown>): string | null {
  const type = typeof item.type === "string" ? item.type : "unknown";
  const id = typeof item.id === "string"
    ? item.id
    : typeof item.call_id === "string"
      ? item.call_id
      : typeof item.callId === "string"
        ? item.callId
        : null;
  return id ? `${type}:${id}` : null;
}

/** Replaces repeated lifecycle records in place, preserving first-seen order. */
function upsertConversationGroup(
  groups: ConversationTurnGroup[],
  groupIndexes: Map<string, number>,
  item: Record<string, unknown>,
  turns: ParsedConversationTurn[],
): number | null {
  if (turns.length === 0) {
    return null;
  }
  const boundedTurns = turns.map(boundConversationTurn);
  const key = conversationItemKey(item);
  if (key) {
    const existingIndex = groupIndexes.get(key);
    if (existingIndex !== undefined) {
      groups[existingIndex] = { key, turns: boundedTurns };
      return existingIndex;
    }
    groupIndexes.set(key, groups.length);
  }
  groups.push({ key, turns: boundedTurns });
  if (groups.length <= CODEX_MAX_RETAINED_CONVERSATION_GROUPS) {
    return groups.length - 1;
  }

  groups.splice(0, groups.length - CODEX_MAX_RETAINED_CONVERSATION_GROUPS);
  groupIndexes.clear();
  for (let index = 0; index < groups.length; index += 1) {
    const retainedKey = groups[index]?.key;
    if (retainedKey) {
      groupIndexes.set(retainedKey, index);
    }
  }
  return 0;
}

function appendBoundedFallbackTurns(
  conversation: ParsedConversationTurn[],
  turns: ParsedConversationTurn[],
): number {
  const changedFrom = conversation.length;
  conversation.push(...turns.map(boundConversationTurn));
  if (conversation.length <= CODEX_MAX_RETAINED_CONVERSATION_GROUPS) {
    return changedFrom;
  }
  conversation.splice(0, conversation.length - CODEX_MAX_RETAINED_CONVERSATION_GROUPS);
  return 0;
}

function flattenConversationGroups(groups: ConversationTurnGroup[]): ParsedConversationTurn[] {
  const conversation: ParsedConversationTurn[] = [];
  const toolNamesById = new Map<string, string>();
  for (const group of groups) {
    appendWithToolNames(conversation, group.turns, toolNamesById);
  }
  return conversation;
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
  const tokens = extractTurnTokens(item);

  if (type === "message") {
    const role = typeof item.role === "string" ? item.role : "";
    // Skip developer/system scaffolding (permissions, collaboration mode, etc.).
    if (role !== "user" && role !== "assistant") {
      return [];
    }
    const text = flattenContent(item.content);
    return text ? [{ kind: role === "user" ? "user" : "assistant", text, tokens, timestampMs }] : [];
  }

  if (type === "agent_message" || type === "assistant_message") {
    const text = flattenContent(item.content) || (typeof item.text === "string" ? item.text.trim() : "");
    return text ? [{ kind: "assistant", text, tokens, timestampMs }] : [];
  }

  if (type === "user_message") {
    const text = flattenContent(item.content) || (typeof item.text === "string" ? item.text.trim() : "");
    return text ? [{ kind: "user", text, tokens, timestampMs }] : [];
  }

  if (type === "reasoning") {
    const text = extractVisibleReasoningText(item);
    return text ? [{ kind: "reasoning", text, tokens, timestampMs }] : [];
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
      tokens,
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
      tokens,
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
        tokens,
        timestampMs,
      });
    } else if (tokens) {
      turns[0].tokens = tokens;
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
      tokens,
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
      toolStatus: typeof item.status === "string" ? item.status : undefined,
      tokens,
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
      toolStatus: typeof item.status === "string" ? item.status : undefined,
      timestampMs,
    }];
    if (item.result !== undefined || item.output !== undefined) {
      turns.push({
        kind: "tool_result",
        text: "",
        toolCallId: callId,
        toolName: name,
        toolOutput: extractToolOutput(item),
        toolStatus: typeof item.status === "string" ? item.status : undefined,
        tokens,
        timestampMs,
      });
    } else if (tokens) {
      turns[0].tokens = tokens;
    }
    return turns;
  }

  if (type === "web_search") {
    const query = typeof item.query === "string" ? item.query : "";
    return [{
      kind: "tool_call",
      text: "",
      toolName: "web_search",
      toolCallId: callId,
      toolArguments: query,
      toolStatus: typeof item.status === "string" ? item.status : undefined,
      tokens,
      timestampMs,
    }];
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
interface CodexRolloutParserState {
  latestCumulativeUsage: Record<string, unknown> | null;
  baselineUsage: Record<string, unknown> | null;
  directUsage: ParsedUsageCounts | null;
  latestDirectUsageJson: Record<string, unknown> | null;
  hasCumulativeUsageInWindow: boolean;
  nativeSessionId: string | null;
  conversationGroups: ConversationTurnGroup[];
  fallbackEventConversation: ParsedConversationTurn[];
  conversationGroupIndexes: Map<string, number>;
  minMs: number | null;
  conversationRevision: number;
  conversationChangedFromIndex: number | null;
}

function createCodexRolloutParserState(sinceMs?: number): CodexRolloutParserState {
  return {
    latestCumulativeUsage: null,
    baselineUsage: null,
    directUsage: null,
    latestDirectUsageJson: null,
    hasCumulativeUsageInWindow: false,
    nativeSessionId: null,
    conversationGroups: [],
    fallbackEventConversation: [],
    conversationGroupIndexes: new Map<string, number>(),
    minMs: typeof sinceMs === "number" ? sinceMs - 2000 : null,
    conversationRevision: 0,
    conversationChangedFromIndex: null,
  };
}

function processCodexRolloutLine(state: CodexRolloutParserState, rawLine: string): boolean {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith("{")) {
    return false;
  }
  const line = parseJsonObject(trimmed);
  if (!line) {
    return false;
  }
  const type = typeof line.type === "string" ? line.type : null;
  const payload = asRecord(line.payload);
  const timestampMs = parseTimestampMs(line.timestamp);
  const isInWindow = (value: number | null): boolean =>
    state.minMs === null || (value !== null && value >= state.minMs);

  if (type === "session_meta" || type === "thread.started" || type === "session.created") {
    state.nativeSessionId = extractSessionId(line, payload) ?? state.nativeSessionId;
    return true;
  }

  if ((type === "event_msg" && payload && payload.type === "token_count") || type === "token_count") {
    const totalUsage = getUsagePayload(line, payload);
    if (totalUsage) {
      if (state.minMs === null) {
        state.latestCumulativeUsage = totalUsage;
        state.hasCumulativeUsageInWindow = true;
      } else if (timestampMs === null) {
        return true;
      } else if (timestampMs < state.minMs) {
        state.baselineUsage = totalUsage;
        if (!state.hasCumulativeUsageInWindow) {
          state.latestCumulativeUsage = totalUsage;
        }
      } else {
        state.latestCumulativeUsage = totalUsage;
        state.hasCumulativeUsageInWindow = true;
      }
    }
    return true;
  }

  if (type === "turn.completed") {
    const usagePayload = getUsagePayload(line, payload);
    if (usagePayload && isInWindow(timestampMs)) {
      state.directUsage = addUsageCounts(state.directUsage ?? emptyUsageCounts(), parseUsageObject(usagePayload));
      state.latestDirectUsageJson = usagePayload;
    }
    return true;
  }

  if (type === "event_msg" && payload) {
    // event_msg user/assistant rows duplicate the canonical response_item
    // stream. Keep them only until the first canonical turn arrives so
    // fallback-only Codex versions still work without retaining a second copy
    // of every message for the lifetime of a long invocation.
    if (state.conversationGroups.length > 0) {
      return true;
    }
    const turns = eventMsgToTurns(payload, timestampMs);
    if (turns.length > 0 && isInWindow(timestampMs)) {
      const changedFrom = appendBoundedFallbackTurns(state.fallbackEventConversation, turns);
      state.conversationRevision += 1;
      state.conversationChangedFromIndex = state.conversationChangedFromIndex === null
        ? changedFrom
        : Math.min(state.conversationChangedFromIndex, changedFrom);
    }
    return true;
  }

  if (type !== "response_item" || !payload || !isInWindow(timestampMs)) {
    return true;
  }
  const changedGroupIndex = upsertConversationGroup(
    state.conversationGroups,
    state.conversationGroupIndexes,
    payload,
    turnsFromCodexItem(payload, timestampMs),
  );
  if (changedGroupIndex !== null) {
    if (state.fallbackEventConversation.length > 0) {
      state.fallbackEventConversation = [];
    }
    let changedFrom = 0;
    for (let index = 0; index < changedGroupIndex; index += 1) {
      changedFrom += state.conversationGroups[index]!.turns.length;
    }
    state.conversationRevision += 1;
    state.conversationChangedFromIndex = state.conversationChangedFromIndex === null
      ? changedFrom
      : Math.min(state.conversationChangedFromIndex, changedFrom);
  }
  return true;
}

function buildCodexRolloutResult(state: CodexRolloutParserState): CodexLogResult {
  let usage: ParsedUsageCounts | null = null;
  let rawUsageJson: Record<string, unknown> | null = null;
  if (state.latestCumulativeUsage && (state.hasCumulativeUsageInWindow || !state.directUsage)) {
    usage = parseUsageObject(state.latestCumulativeUsage);
    rawUsageJson = state.latestCumulativeUsage;
  } else if (state.directUsage) {
    usage = state.directUsage;
    rawUsageJson = state.latestDirectUsageJson;
  } else if (state.latestCumulativeUsage) {
    usage = parseUsageObject(state.latestCumulativeUsage);
    rawUsageJson = state.latestCumulativeUsage;
  }
  if (usage && rawUsageJson === state.latestCumulativeUsage && state.baselineUsage) {
    usage = subtractUsageCounts(usage, parseUsageObject(state.baselineUsage));
  }
  const conversation = flattenConversationGroups(state.conversationGroups);
  return {
    usage,
    rawUsageJson,
    conversation: conversation.length > 0 ? conversation : [...state.fallbackEventConversation],
    nativeSessionId: state.nativeSessionId,
    conversationRevision: state.conversationRevision,
    ...(state.conversationChangedFromIndex !== null
      ? { conversationChangedFromIndex: state.conversationChangedFromIndex }
      : {}),
  };
}

interface CodexRolloutChunkState {
  pendingLine: string;
  discardingOversizedLine: boolean;
}

function processCodexRolloutChunk(
  state: CodexRolloutParserState,
  chunk: string,
  pendingLine: string,
  discardingOversizedLine: boolean,
): CodexRolloutChunkState {
  let cursor = 0;
  let retainedPendingLine = pendingLine;
  let discarding = discardingOversizedLine;

  while (cursor < chunk.length) {
    const newlineIndex = chunk.indexOf("\n", cursor);
    const segmentEnd = newlineIndex >= 0 ? newlineIndex : chunk.length;
    const segment = chunk.slice(cursor, segmentEnd);

    if (discarding) {
      if (newlineIndex < 0) {
        return { pendingLine: "", discardingOversizedLine: true };
      }
      discarding = false;
      cursor = newlineIndex + 1;
      continue;
    }

    if (retainedPendingLine.length + segment.length > CODEX_MAX_JSONL_RECORD_CHARS) {
      retainedPendingLine = "";
      if (newlineIndex < 0) {
        return { pendingLine: "", discardingOversizedLine: true };
      }
      cursor = newlineIndex + 1;
      continue;
    }

    const record = retainedPendingLine ? retainedPendingLine + segment : segment;
    retainedPendingLine = "";
    if (newlineIndex < 0) {
      retainedPendingLine = processCodexRolloutLine(state, record) ? "" : record;
      break;
    }
    processCodexRolloutLine(state, record);
    cursor = newlineIndex + 1;
  }

  return {
    pendingLine: retainedPendingLine,
    discardingOversizedLine: discarding,
  };
}

/** Incremental parser for the append-only Codex rollout used by live telemetry. */
export class CodexRolloutAccumulator {
  private state: CodexRolloutParserState;
  private previousLength = 0;
  private previousHead = "";
  private previousBoundary = "";
  private pendingLine = "";
  private discardingOversizedLine = false;
  private sourceId: string | null = null;
  private lastResult: CodexLogResult | null = null;

  constructor(private readonly sinceMs?: number) {
    this.state = createCodexRolloutParserState(sinceMs);
  }

  update(jsonl: string, sourceId?: string | null): CodexLogResult {
    const normalizedSourceId = sourceId || null;
    const canAppend = this.canAppend(jsonl, normalizedSourceId);
    if (!canAppend) {
      this.reset(normalizedSourceId);
    } else if (jsonl.length === this.previousLength && this.lastResult) {
      return this.lastResult;
    }

    const chunk = canAppend ? jsonl.slice(this.previousLength) : jsonl;
    this.state.conversationChangedFromIndex = null;
    const chunkState = processCodexRolloutChunk(
      this.state,
      chunk,
      this.pendingLine,
      this.discardingOversizedLine,
    );
    this.pendingLine = chunkState.pendingLine;
    this.discardingOversizedLine = chunkState.discardingOversizedLine;
    this.previousLength = jsonl.length;
    this.previousHead = jsonl.slice(0, Math.min(4096, jsonl.length));
    this.previousBoundary = jsonl.slice(Math.max(0, jsonl.length - 4096));
    this.sourceId = normalizedSourceId;
    this.lastResult = buildCodexRolloutResult(this.state);
    return this.lastResult;
  }

  appendChunk(text: string, sourceId: string, reset = false): CodexLogResult {
    if (reset || (this.sourceId !== null && this.sourceId !== sourceId)) {
      this.reset(sourceId);
    }
    this.state.conversationChangedFromIndex = null;
    const chunkState = processCodexRolloutChunk(
      this.state,
      text,
      this.pendingLine,
      this.discardingOversizedLine,
    );
    this.pendingLine = chunkState.pendingLine;
    this.discardingOversizedLine = chunkState.discardingOversizedLine;
    this.sourceId = sourceId;
    // Full-snapshot prefix checks do not apply while consuming byte deltas.
    this.previousLength = 0;
    this.previousHead = "";
    this.previousBoundary = "";
    this.lastResult = buildCodexRolloutResult(this.state);
    return this.lastResult;
  }

  private canAppend(jsonl: string, sourceId: string | null): boolean {
    if (this.previousLength === 0 || jsonl.length < this.previousLength) {
      return false;
    }
    if (this.sourceId && sourceId && this.sourceId !== sourceId) {
      return false;
    }
    if (jsonl.slice(0, this.previousHead.length) !== this.previousHead) {
      return false;
    }
    const boundaryStart = Math.max(0, this.previousLength - this.previousBoundary.length);
    return jsonl.slice(boundaryStart, this.previousLength) === this.previousBoundary;
  }

  private reset(sourceId: string | null): void {
    this.state = createCodexRolloutParserState(this.sinceMs);
    this.previousLength = 0;
    this.previousHead = "";
    this.previousBoundary = "";
    this.pendingLine = "";
    this.discardingOversizedLine = false;
    this.sourceId = sourceId;
    this.lastResult = null;
  }
}

export function parseCodexRolloutJsonl(jsonl: string, sinceMs?: number): CodexLogResult {
  return new CodexRolloutAccumulator(sinceMs).update(jsonl);
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
  const conversationGroups: ConversationTurnGroup[] = [];
  const fallbackEventConversation: ParsedConversationTurn[] = [];
  const conversationGroupIndexes = new Map<string, number>();

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
      appendBoundedFallbackTurns(
        fallbackEventConversation,
        eventMsgToTurns(payload, timestampMs),
      );
      continue;
    }

    if (type === "response_item") {
      const item = asRecord(payload) ?? asRecord(parsed.item);
      if (item) {
        upsertConversationGroup(
          conversationGroups,
          conversationGroupIndexes,
          item,
          turnsFromCodexItem(item, timestampMs),
        );
      }
      continue;
    }

    if (type === "item.completed" || type === "item.updated" || type === "item.started") {
      const item = asRecord(parsed.item) ?? asRecord(payload?.item);
      if (!item) {
        continue;
      }
      upsertConversationGroup(
        conversationGroups,
        conversationGroupIndexes,
        item,
        turnsFromCodexItem(item, timestampMs),
      );
    }
  }

  const usage = directUsage ?? legacyUsage;
  const rawUsageJson = latestDirectUsageJson ?? latestLegacyUsageJson;
  const conversation = flattenConversationGroups(conversationGroups);
  return {
    usage,
    rawUsageJson,
    nativeSessionId,
    conversation: conversation.length > 0 ? conversation : fallbackEventConversation,
  };
}
