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
export function parseClaudeCodeSessionJsonl(
  jsonl: string,
  sinceMs?: number,
): ClaudeCodeLogResult {
  const lines = jsonl.split("\n");
  const usageByMessageId = new Map<string, ClaudeUsageTotals>();
  const assistantMessageRanges = new Map<string, { start: number; count: number; signature: string }>();
  const conversation: ParsedConversationTurn[] = [];

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreation = 0;
  let totalCacheRead = 0;
  let latestRawUsage: Record<string, unknown> | null = null;
  let nativeSessionId: string | null = null;
  let hasUsage = false;

  const applyUsage = (messageId: string | null, usage: Record<string, unknown> | null): void => {
    if (!usage || !claudeUsageHasTokens(usage)) return;
    const next = {
      inputTokens: toNumber(usage.input_tokens),
      outputTokens: toNumber(usage.output_tokens),
      cacheCreationTokens: toNumber(usage.cache_creation_input_tokens),
      cacheReadTokens: toNumber(usage.cache_read_input_tokens),
    };
    const previous = messageId ? usageByMessageId.get(messageId) : undefined;
    totalInputTokens += next.inputTokens - (previous?.inputTokens ?? 0);
    totalOutputTokens += next.outputTokens - (previous?.outputTokens ?? 0);
    totalCacheCreation += next.cacheCreationTokens - (previous?.cacheCreationTokens ?? 0);
    totalCacheRead += next.cacheReadTokens - (previous?.cacheReadTokens ?? 0);
    if (messageId) usageByMessageId.set(messageId, next);
    latestRawUsage = usage;
    hasUsage = true;
  };

  const upsertAssistantTurns = (messageId: string | null, turns: ParsedConversationTurn[]): void => {
    if (!messageId || turns.length === 0) {
      conversation.push(...turns);
      return;
    }
    const signature = turnSignature(turns);
    const existing = assistantMessageRanges.get(messageId);
    if (!existing) {
      assistantMessageRanges.set(messageId, { start: conversation.length, count: turns.length, signature });
      conversation.push(...turns);
      return;
    }
    if (existing.signature === signature) return;
    conversation.splice(existing.start, existing.count, ...turns);
    const delta = turns.length - existing.count;
    for (const [id, range] of assistantMessageRanges.entries()) {
      if (id !== messageId && range.start > existing.start) {
        assistantMessageRanges.set(id, { ...range, start: range.start + delta });
      }
    }
    assistantMessageRanges.set(messageId, { start: existing.start, count: turns.length, signature });
  };

  // 2-second grace window, same as codex / qwen parsers.
  const minMs = typeof sinceMs === "number" ? sinceMs - 2000 : null;

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed.startsWith("{")) continue;

    const entry = parseJsonObject(trimmed);
    if (!entry) continue;

    const entryType = typeof entry.type === "string" ? entry.type : null;

    // Timestamp extraction and filtering (applied to all entry types).
    const timestampMs = parseTimestampMs(entry.timestamp);
    if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
      continue;
    }

    // Capture the session id only from records eligible for this invocation.
    if (!nativeSessionId) {
      nativeSessionId = claudeSessionId(entry);
    }

    // ── Legacy bare-message format ───────────────────────────────────────────
    // Older Claude Code sessions and container artifact dumps write
    // `{ message: { usage, content } }` with no `type` wrapper. Treat these
    // as assistant turns so we stay backwards-compatible.
    if (!entryType && asRecord(entry.message)) {
      const legacyMessage = asRecord(entry.message)!;
      const messageId = typeof legacyMessage.id === "string" ? legacyMessage.id : null;
      applyUsage(messageId, claudeMessageUsage(legacyMessage));
      const role = typeof legacyMessage.role === "string" ? legacyMessage.role : "assistant";
      if (role === "user") {
        conversation.push(...claudeUserTurns(legacyMessage, timestampMs));
      } else {
        upsertAssistantTurns(messageId, claudeAssistantTurns(legacyMessage, timestampMs));
      }
      continue;
    }

    // ── Assistant turns ──────────────────────────────────────────────────────
    if (entryType === "assistant") {
      const message = asRecord(entry.message);
      if (!message) continue;

      const messageId = typeof message.id === "string" ? message.id : null;

      // ── Token usage ─────────────────────────────────────────────────────
      applyUsage(messageId, claudeMessageUsage(message));

      // ── Conversation turns ───────────────────────────────────────────────
      const turns = claudeAssistantTurns(message, timestampMs);
      upsertAssistantTurns(messageId, turns);
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
