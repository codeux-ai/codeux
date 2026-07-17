import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import { parseJsonObject, parseTimestampMs, toNumber } from "./usage-parse-utils.js";
import {
  boundProviderConversationTurn,
  MAX_RETAINED_PROVIDER_TURNS,
} from "./provider-conversation-limits.js";

export const CLAUDE_MAX_JSONL_RECORD_CHARS = 2 * 1024 * 1024;
const CLAUDE_MAX_TRACKED_USAGE_MESSAGES = 50_000;

/**
 * Token-usage totals aggregated across all assistant turns in a Claude Code
 * session. All values are cumulative for the session (or filtered to a single
 * run's window when `sinceMs` is provided).
 *
 * `cacheCreationTokens` + `cacheReadTokens` together form the "cached" bucket
 * so callers can derive the unified `cachedInputTokens` used by the shared
 * telemetry interface.
 */
export interface ClaudeUsageTotals {
  inputTokens: number;
  outputTokens: number;
  /** Cache-write (creation) tokens billed at the creation rate. */
  cacheCreationTokens: number;
  /** Cache-read (hit) tokens billed at the read rate. */
  cacheReadTokens: number;
}

export interface ClaudeCodeLogResult extends ParsedProviderLogResult<ClaudeUsageTotals> {
  /** Raw object of the last usage seen, for telemetry storage. */
  rawUsageJson: Record<string, unknown> | null;
  /** Monotonic revision for append-efficient downstream message mapping. */
  conversationRevision?: number;
  /** First normalized turn changed by the latest append. */
  conversationChangedFromIndex?: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** Flatten a Claude message `content` array into plain text. */
function flattenClaudeContent(content: unknown): string {
  if (typeof content === "string") {
    return content.trim();
  }
  if (!Array.isArray(content)) {
    const rec = asRecord(content);
    if (rec) {
      if (typeof rec.text === "string") {
        return rec.text.trim();
      }
      return flattenClaudeContent(rec.content);
    }
    return "";
  }
  const parts: string[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (!rec) continue;
    if (rec.type === "text" && typeof rec.text === "string") {
      parts.push(rec.text);
    } else if (typeof rec.text === "string") {
      parts.push(rec.text);
    }
  }
  return parts.join("\n").trim();
}

function extractVisibleClaudeText(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (Array.isArray(value)) {
    return flattenClaudeContent(value).trim();
  }
  const rec = asRecord(value);
  if (!rec) {
    return "";
  }
  for (const key of ["text", "thinking", "reasoning", "summary", "content"]) {
    const text = extractVisibleClaudeText(rec[key]);
    if (text) {
      return text;
    }
  }
  return "";
}

/** Stringify a tool-call input object into a compact JSON string. */
function stringifyInput(input: unknown): string | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input);
  } catch {
    return String(input);
  }
}

/** Extract tool-result text from a `tool_result` content block. */
function extractToolResultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const item of content) {
      const rec = asRecord(item);
      if (rec?.type === "text" && typeof rec.text === "string") {
        parts.push(rec.text);
      } else if (typeof item === "string") {
        parts.push(item);
      }
    }
    return parts.join("\n").trim();
  }
  const rec = asRecord(content);
  if (rec) {
    return extractVisibleClaudeText(rec);
  }
  return "";
}

function claudeSessionId(entry: Record<string, unknown>): string | null {
  const value = entry.sessionId ?? entry.session_id;
  return typeof value === "string" && value.trim() ? value : null;
}

function claudeMessageUsage(message: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(message.usage);
}

function claudeUsageHasTokens(usage: Record<string, unknown>): boolean {
  return toNumber(usage.input_tokens) > 0
    || toNumber(usage.output_tokens) > 0
    || toNumber(usage.cache_creation_input_tokens) > 0
    || toNumber(usage.cache_read_input_tokens) > 0;
}

function claudeAssistantTurns(message: Record<string, unknown>, timestampMs: number | null): ParsedConversationTurn[] {
  const content = message.content;
  const turns: ParsedConversationTurn[] = [];

  const directThinking = extractVisibleClaudeText(
    message.thinking ?? message.reasoning ?? message.reasoning_content ?? message.summary,
  );
  if (directThinking) {
    turns.push({ kind: "reasoning", text: directThinking, timestampMs });
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      const block = asRecord(item);
      if (!block) continue;

      if (block.type === "thinking" || block.type === "reasoning") {
        const text = extractVisibleClaudeText(
          block.thinking ?? block.reasoning ?? block.summary ?? block.content ?? block.text,
        );
        if (text && !turns.some((turn) => turn.kind === "reasoning" && turn.text === text)) {
          turns.push({ kind: "reasoning", text, timestampMs });
        }
      } else if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
        turns.push({ kind: "assistant", text: block.text.trim(), timestampMs });
      } else if (block.type === "tool_use") {
        turns.push({
          kind: "tool_call",
          text: "",
          toolName: typeof block.name === "string" ? block.name : undefined,
          toolCallId: typeof block.id === "string" ? block.id : undefined,
          toolArguments: stringifyInput(block.input),
          timestampMs,
        });
      }
      // `redacted_thinking` and other opaque blocks are intentionally ignored.
    }
  } else {
    const textContent = flattenClaudeContent(content);
    if (textContent) {
      turns.push({ kind: "assistant", text: textContent, timestampMs });
    }
  }

  return turns;
}

function claudeUserTurns(message: Record<string, unknown>, timestampMs: number | null): ParsedConversationTurn[] {
  const content = message.content;
  const turns: ParsedConversationTurn[] = [];

  if (Array.isArray(content)) {
    for (const item of content) {
      const rec = asRecord(item);
      if (!rec) continue;

      if (rec.type === "tool_result") {
        turns.push({
          kind: "tool_result",
          text: "",
          toolCallId: typeof rec.tool_use_id === "string" ? rec.tool_use_id : undefined,
          toolOutput: extractToolResultText(rec.content),
          toolStatus: rec.is_error === true ? "error" : "success",
          timestampMs,
        });
      } else if (rec.type === "text" && typeof rec.text === "string" && rec.text.trim()) {
        turns.push({ kind: "user", text: rec.text.trim(), timestampMs });
      }
    }
    return turns;
  }

  if (typeof content === "string" && content.trim()) {
    turns.push({ kind: "user", text: content.trim(), timestampMs });
  }

  return turns;
}

function turnSignature(turns: ParsedConversationTurn[]): string {
  return JSON.stringify(turns.map((turn) => ({
    kind: turn.kind,
    text: turn.text,
    toolName: turn.toolName,
    toolCallId: turn.toolCallId,
    toolArguments: turn.toolArguments,
    toolOutput: turn.toolOutput,
    toolStatus: turn.toolStatus,
  })));
}

/**
 * Parses a Claude Code session JSONL file (one JSON object per line) into
 * cumulative token usage and an ordered conversation transcript.
 *
 * Claude Code writes these to:
 *   `~/.claude/projects/<cwd-slug>/<sessionId>.jsonl`
 *
 * Entry types relevant to this parser:
 *   - `"assistant"` – assistant turns carrying `message.content` (text,
 *     thinking, tool_use) and `message.usage`.
 *   - `"user"` – user turns that may carry `tool_result` content items
 *     (tool outputs) in addition to the original prompt.
 *
 * Key guarantees:
 *   - Claude Code re-emits the same `message.id` across multiple JSONL lines
 *     when a streaming response arrives in fragments. We deduplicate by
 *     `message.id` so each logical API response is counted only once.
 *   - Token usage is accumulated across all unique assistant messages that
 *     fall within the optional `sinceMs` window.
 *   - `thinking` blocks are surfaced as `reasoning` turns; `tool_use` blocks
 *     become `tool_call` turns; `tool_result` user blocks become `tool_result`
 *     turns.
 *
 * @param jsonl - Raw content of the session JSONL file.
 * @param sinceMs - Optional epoch-ms lower bound to restrict the run window
 *   (matches codex / qwen conventions). Entries older than `sinceMs - 2000ms`
 *   are skipped so only the current invocation's turns are included.
 */
interface ClaudeCodeParserState {
  usageByMessageId: Map<string, ClaudeUsageTotals>;
  assistantMessageRanges: Map<string, { start: number; count: number; signature: string }>;
  conversation: ParsedConversationTurn[];
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreation: number;
  totalCacheRead: number;
  latestRawUsage: Record<string, unknown> | null;
  nativeSessionId: string | null;
  hasUsage: boolean;
  minMs: number | null;
  conversationRevision: number;
  conversationChangedFromIndex: number | null;
}

function createClaudeCodeParserState(sinceMs?: number): ClaudeCodeParserState {
  return {
    usageByMessageId: new Map(),
    assistantMessageRanges: new Map(),
    conversation: [],
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreation: 0,
    totalCacheRead: 0,
    latestRawUsage: null,
    nativeSessionId: null,
    hasUsage: false,
    minMs: typeof sinceMs === "number" ? sinceMs - 2000 : null,
    conversationRevision: 0,
    conversationChangedFromIndex: null,
  };
}

function markClaudeConversationChanged(state: ClaudeCodeParserState, changedFrom: number): void {
  state.conversationRevision += 1;
  state.conversationChangedFromIndex = state.conversationChangedFromIndex === null
    ? changedFrom
    : Math.min(state.conversationChangedFromIndex, changedFrom);
}

function applyClaudeUsage(
  state: ClaudeCodeParserState,
  messageId: string | null,
  usage: Record<string, unknown> | null,
): void {
  if (!usage || !claudeUsageHasTokens(usage)) return;
  const next = {
    inputTokens: toNumber(usage.input_tokens),
    outputTokens: toNumber(usage.output_tokens),
    cacheCreationTokens: toNumber(usage.cache_creation_input_tokens),
    cacheReadTokens: toNumber(usage.cache_read_input_tokens),
  };
  const previous = messageId ? state.usageByMessageId.get(messageId) : undefined;
  state.totalInputTokens += next.inputTokens - (previous?.inputTokens ?? 0);
  state.totalOutputTokens += next.outputTokens - (previous?.outputTokens ?? 0);
  state.totalCacheCreation += next.cacheCreationTokens - (previous?.cacheCreationTokens ?? 0);
  state.totalCacheRead += next.cacheReadTokens - (previous?.cacheReadTokens ?? 0);
  if (messageId) {
    if (previous) {
      state.usageByMessageId.delete(messageId);
    } else if (state.usageByMessageId.size >= CLAUDE_MAX_TRACKED_USAGE_MESSAGES) {
      const oldestMessageId = state.usageByMessageId.keys().next().value;
      if (typeof oldestMessageId === "string") {
        state.usageByMessageId.delete(oldestMessageId);
      }
    }
    state.usageByMessageId.set(messageId, next);
  }
  state.latestRawUsage = usage;
  state.hasUsage = true;
}

function appendClaudeTurns(state: ClaudeCodeParserState, turns: ParsedConversationTurn[]): void {
  if (turns.length === 0) return;
  const changedFrom = state.conversation.length;
  state.conversation.push(...turns.map(boundProviderConversationTurn));
  markClaudeConversationChanged(state, changedFrom);
  trimClaudeConversation(state);
}

function upsertClaudeAssistantTurns(
  state: ClaudeCodeParserState,
  messageId: string | null,
  turns: ParsedConversationTurn[],
): void {
  const boundedTurns = turns.map(boundProviderConversationTurn);
  if (!messageId || turns.length === 0) {
    appendClaudeTurns(state, boundedTurns);
    return;
  }
  const signature = turnSignature(boundedTurns);
  const existing = state.assistantMessageRanges.get(messageId);
  if (!existing) {
    const start = state.conversation.length;
    state.assistantMessageRanges.set(messageId, { start, count: boundedTurns.length, signature });
    state.conversation.push(...boundedTurns);
    markClaudeConversationChanged(state, start);
    trimClaudeConversation(state);
    return;
  }
  if (existing.signature === signature) return;
  state.conversation.splice(existing.start, existing.count, ...boundedTurns);
  const delta = boundedTurns.length - existing.count;
  for (const [id, range] of state.assistantMessageRanges.entries()) {
    if (id !== messageId && range.start > existing.start) {
      state.assistantMessageRanges.set(id, { ...range, start: range.start + delta });
    }
  }
  state.assistantMessageRanges.set(messageId, {
    start: existing.start,
    count: boundedTurns.length,
    signature,
  });
  markClaudeConversationChanged(state, existing.start);
  trimClaudeConversation(state);
}

function trimClaudeConversation(state: ClaudeCodeParserState): void {
  const removed = state.conversation.length - MAX_RETAINED_PROVIDER_TURNS;
  if (removed <= 0) return;
  state.conversation.splice(0, removed);
  for (const [id, range] of state.assistantMessageRanges.entries()) {
    if (range.start < removed) {
      state.assistantMessageRanges.delete(id);
    } else {
      state.assistantMessageRanges.set(id, { ...range, start: range.start - removed });
    }
  }
  markClaudeConversationChanged(state, 0);
}

function processClaudeCodeLine(state: ClaudeCodeParserState, rawLine: string): boolean {
  const trimmed = rawLine.trim();
  if (!trimmed.startsWith("{")) return false;
  const entry = parseJsonObject(trimmed);
  if (!entry) return false;

  const entryType = typeof entry.type === "string" ? entry.type : null;
  const timestampMs = parseTimestampMs(entry.timestamp);
  if (state.minMs !== null && timestampMs !== null && timestampMs < state.minMs) return true;
  if (!state.nativeSessionId) state.nativeSessionId = claudeSessionId(entry);

  if (!entryType && asRecord(entry.message)) {
    const message = asRecord(entry.message)!;
    const messageId = typeof message.id === "string" ? message.id : null;
    applyClaudeUsage(state, messageId, claudeMessageUsage(message));
    if (message.role === "user") {
      appendClaudeTurns(state, claudeUserTurns(message, timestampMs));
    } else {
      upsertClaudeAssistantTurns(state, messageId, claudeAssistantTurns(message, timestampMs));
    }
    return true;
  }

  if (entryType === "assistant") {
    const message = asRecord(entry.message);
    if (!message) return true;
    const messageId = typeof message.id === "string" ? message.id : null;
    applyClaudeUsage(state, messageId, claudeMessageUsage(message));
    upsertClaudeAssistantTurns(state, messageId, claudeAssistantTurns(message, timestampMs));
    return true;
  }

  if (entryType === "user") {
    const message = asRecord(entry.message);
    if (message) appendClaudeTurns(state, claudeUserTurns(message, timestampMs));
  }
  return true;
}

function processClaudeCodeChunk(
  state: ClaudeCodeParserState,
  chunk: string,
  pendingLine: string,
  discardingOversizedLine: boolean,
): { pendingLine: string; discardingOversizedLine: boolean } {
  const value = pendingLine + chunk;
  let cursor = 0;
  let discarding = discardingOversizedLine;
  while (cursor < value.length) {
    const newline = value.indexOf("\n", cursor);
    if (newline < 0) break;
    const line = value.slice(cursor, newline);
    cursor = newline + 1;
    if (discarding) {
      discarding = false;
    } else if (line.length <= CLAUDE_MAX_JSONL_RECORD_CHARS) {
      processClaudeCodeLine(state, line);
    }
  }
  if (cursor >= value.length) {
    return { pendingLine: "", discardingOversizedLine: discarding };
  }
  const finalLine = value.slice(cursor);
  if (discarding || finalLine.length > CLAUDE_MAX_JSONL_RECORD_CHARS) {
    return { pendingLine: "", discardingOversizedLine: true };
  }
  return processClaudeCodeLine(state, finalLine)
    ? { pendingLine: "", discardingOversizedLine: false }
    : { pendingLine: finalLine, discardingOversizedLine: false };
}

function buildClaudeCodeLogResult(state: ClaudeCodeParserState): ClaudeCodeLogResult {
  const usage: ClaudeUsageTotals | null = state.hasUsage
    ? {
        inputTokens: state.totalInputTokens,
        outputTokens: state.totalOutputTokens,
        cacheCreationTokens: state.totalCacheCreation,
        cacheReadTokens: state.totalCacheRead,
      }
    : null;
  return {
    usage,
    rawUsageJson: state.latestRawUsage,
    conversation: state.conversation,
    nativeSessionId: state.nativeSessionId,
    conversationRevision: state.conversationRevision,
    ...(state.conversationChangedFromIndex !== null
      ? { conversationChangedFromIndex: state.conversationChangedFromIndex }
      : {}),
  };
}

/** Append-only parser used by live Claude telemetry to avoid full-history joins and reparses. */
export class ClaudeCodeLogAccumulator {
  private state: ClaudeCodeParserState;
  private pendingLine = "";
  private discardingOversizedLine = false;
  private sourceId: string | null = null;

  constructor(private readonly sinceMs?: number) {
    this.state = createClaudeCodeParserState(sinceMs);
  }

  appendChunk(text: string, sourceId: string, reset = false): ClaudeCodeLogResult {
    if (reset || (this.sourceId !== null && this.sourceId !== sourceId)) {
      this.state = createClaudeCodeParserState(this.sinceMs);
      this.pendingLine = "";
      this.discardingOversizedLine = false;
    }
    this.state.conversationChangedFromIndex = null;
    const parsed = processClaudeCodeChunk(
      this.state,
      text,
      this.pendingLine,
      this.discardingOversizedLine,
    );
    this.pendingLine = parsed.pendingLine;
    this.discardingOversizedLine = parsed.discardingOversizedLine;
    this.sourceId = sourceId;
    return buildClaudeCodeLogResult(this.state);
  }

  getCurrentResult(): ClaudeCodeLogResult {
    return buildClaudeCodeLogResult(this.state);
  }
}

export function parseClaudeCodeSessionJsonl(jsonl: string, sinceMs?: number): ClaudeCodeLogResult {
  return new ClaudeCodeLogAccumulator(sinceMs).appendChunk(jsonl, "full");
}
