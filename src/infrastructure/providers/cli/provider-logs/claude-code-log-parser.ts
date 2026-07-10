import type { ParsedConversationTurn, ParsedProviderLogResult } from "./provider-conversation-types.js";
import { parseJsonObject, parseTimestampMs, toNumber } from "./usage-parse-utils.js";

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
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
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

/**
 * Extracts all `content` items of a given type from a Claude message content
 * array. Used to pull `tool_use` and `thinking` blocks separately.
 */
function contentItemsOfType(content: unknown, type: string): Record<string, unknown>[] {
  if (!Array.isArray(content)) return [];
  const result: Record<string, unknown>[] = [];
  for (const item of content) {
    const rec = asRecord(item);
    if (rec && rec.type === type) {
      result.push(rec);
    }
  }
  return result;
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
  const rec = asRecord(content);
  if (rec) {
    return extractVisibleClaudeText(rec);
  }
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

  // Thinking/reasoning blocks -> reasoning turns. Redacted/opaque blocks are
  // intentionally skipped because they do not expose readable text.
  for (const block of [
    ...contentItemsOfType(content, "thinking"),
    ...contentItemsOfType(content, "reasoning"),
  ]) {
    const text = extractVisibleClaudeText(block.thinking ?? block.reasoning ?? block.summary ?? block.content ?? block.text);
    if (text) {
      turns.push({ kind: "reasoning", text, timestampMs });
    }
  }

  const directThinking = extractVisibleClaudeText(
    message.thinking ?? message.reasoning ?? message.reasoning_content ?? message.summary,
  );
  if (directThinking && !turns.some((turn) => turn.kind === "reasoning" && turn.text === directThinking)) {
    turns.push({ kind: "reasoning", text: directThinking, timestampMs });
  }

  const textContent = flattenClaudeContent(
    Array.isArray(content)
      ? content.filter((item) => asRecord(item)?.type === "text")
      : content,
  );
  if (textContent) {
    turns.push({ kind: "assistant", text: textContent, timestampMs });
  }

  for (const block of contentItemsOfType(content, "tool_use")) {
    turns.push({
      kind: "tool_call",
      text: "",
      toolName: typeof block.name === "string" ? block.name : undefined,
      toolCallId: typeof block.id === "string" ? block.id : undefined,
      toolArguments: stringifyInput(block.input),
      timestampMs,
    });
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
export function parseClaudeCodeSessionJsonl(
  jsonl: string,
  sinceMs?: number,
): ClaudeCodeLogResult {
  const lines = jsonl.split("\n");
  const usageCountedMessageIds = new Set<string>();
  const assistantMessageRanges = new Map<string, { start: number; count: number; signature: string }>();
  const conversation: ParsedConversationTurn[] = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let latestRawUsage: Record<string, unknown> | null = null;
  let nativeSessionId: string | null = null;
  let hasUsage = false;

  // 2-second grace window, same as codex / qwen parsers.
  const minMs = typeof sinceMs === "number" ? sinceMs - 2000 : null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) continue;

    const entry = parseJsonObject(trimmed);
    if (!entry) continue;

    const entryType = typeof entry.type === "string" ? entry.type : null;

    // Capture the session id from any entry that carries it.
    if (!nativeSessionId) {
      nativeSessionId = claudeSessionId(entry);
    }

    // Timestamp extraction and filtering (applied to all entry types).
    const timestampMs = parseTimestampMs(entry.timestamp);
    if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
      continue;
    }

    // ── Legacy bare-message format ───────────────────────────────────────────
    // Older Claude Code sessions and container artifact dumps write
    // `{ message: { usage, content } }` with no `type` wrapper. Treat these
    // as assistant turns so we stay backwards-compatible.
    if (!entryType && asRecord(entry.message)) {
      const legacyMessage = asRecord(entry.message)!;
      const messageId = typeof legacyMessage.id === "string" ? legacyMessage.id : null;
      const usage = claudeMessageUsage(legacyMessage);
      if (usage && (!messageId || !usageCountedMessageIds.has(messageId))) {
        const inp = toNumber(usage.input_tokens);
        const out = toNumber(usage.output_tokens);
        const cacheCreate = toNumber(usage.cache_creation_input_tokens);
        const cacheRead = toNumber(usage.cache_read_input_tokens);
        if (claudeUsageHasTokens(usage)) {
          totalInputTokens += inp;
          totalOutputTokens += out;
          totalCacheCreation += cacheCreate;
          totalCacheRead += cacheRead;
          latestRawUsage = usage;
          hasUsage = true;
          if (messageId) usageCountedMessageIds.add(messageId);
        }
      }
      const role = typeof legacyMessage.role === "string" ? legacyMessage.role : "assistant";
      conversation.push(...(role === "user"
        ? claudeUserTurns(legacyMessage, timestampMs)
        : claudeAssistantTurns(legacyMessage, timestampMs)));
      continue;
    }

    // ── Assistant turns ──────────────────────────────────────────────────────
    if (entryType === "assistant") {
      const message = asRecord(entry.message);
      if (!message) continue;

      const messageId = typeof message.id === "string" ? message.id : null;

      // ── Token usage ─────────────────────────────────────────────────────
      const usage = claudeMessageUsage(message);
      if (usage && (!messageId || !usageCountedMessageIds.has(messageId))) {
        const inp = toNumber(usage.input_tokens);
        const out = toNumber(usage.output_tokens);
        const cacheCreate = toNumber(usage.cache_creation_input_tokens);
        const cacheRead = toNumber(usage.cache_read_input_tokens);
        if (claudeUsageHasTokens(usage)) {
          totalInputTokens += inp;
          totalOutputTokens += out;
          totalCacheCreation += cacheCreate;
          totalCacheRead += cacheRead;
          latestRawUsage = usage;
          hasUsage = true;
          if (messageId) usageCountedMessageIds.add(messageId);
        }
      }

      // ── Conversation turns ───────────────────────────────────────────────
      const turns = claudeAssistantTurns(message, timestampMs);
      if (messageId && turns.length > 0) {
        const signature = turnSignature(turns);
        const existing = assistantMessageRanges.get(messageId);
        if (!existing) {
          assistantMessageRanges.set(messageId, { start: conversation.length, count: turns.length, signature });
          conversation.push(...turns);
        } else if (existing.signature !== signature) {
          conversation.splice(existing.start, existing.count, ...turns);
          const delta = turns.length - existing.count;
          for (const [id, range] of assistantMessageRanges.entries()) {
            if (id !== messageId && range.start > existing.start) {
              assistantMessageRanges.set(id, { ...range, start: range.start + delta });
            }
          }
          assistantMessageRanges.set(messageId, { start: existing.start, count: turns.length, signature });
        }
      } else if (turns.length > 0) {
        conversation.push(...turns);
      }
      continue;
    }

    // ── User turns (may carry tool results) ──────────────────────────────────
    if (entryType === "user") {
      const message = asRecord(entry.message);
      if (!message) continue;

      conversation.push(...claudeUserTurns(message, timestampMs));
      continue;
    }
  }

  const usage: ClaudeUsageTotals | null = hasUsage
    ? {
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        cacheCreationTokens: totalCacheCreation,
        cacheReadTokens: totalCacheRead,
      }
    : null;

  return { usage, rawUsageJson: latestRawUsage, conversation, nativeSessionId };
}
