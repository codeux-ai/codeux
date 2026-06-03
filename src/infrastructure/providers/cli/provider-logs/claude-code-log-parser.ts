import type { ParsedConversationTurn } from "./provider-conversation-types.js";
import { parseJsonObject, toNumber } from "./usage-parse-utils.js";

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

export interface ClaudeCodeLogResult {
  usage: ClaudeUsageTotals | null;
  /** Raw object of the last usage seen, for telemetry storage. */
  rawUsageJson: Record<string, unknown> | null;
  conversation: ParsedConversationTurn[];
  nativeSessionId: string | null;
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
  return "";
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
  const seenMessageIds = new Set<string>();
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
    if (!nativeSessionId && typeof entry.sessionId === "string") {
      nativeSessionId = entry.sessionId;
    }

    // Timestamp extraction and filtering (applied to all entry types).
    const timestampMs = typeof entry.timestamp === "string"
      ? (() => { const ms = Date.parse(entry.timestamp as string); return Number.isFinite(ms) ? ms : null; })()
      : null;
    if (minMs !== null && timestampMs !== null && timestampMs < minMs) {
      continue;
    }

    // ── Legacy bare-message format ───────────────────────────────────────────
    // Older Claude Code sessions and container artifact dumps write
    // `{ message: { usage, content } }` with no `type` wrapper. Treat these
    // as assistant turns so we stay backwards-compatible.
    if (!entryType && asRecord(entry.message)) {
      const legacyMessage = asRecord(entry.message)!;
      const usage = asRecord(legacyMessage.usage);
      if (usage) {
        const inp = toNumber(usage.input_tokens);
        const out = toNumber(usage.output_tokens);
        const cacheCreate = toNumber(usage.cache_creation_input_tokens);
        const cacheRead = toNumber(usage.cache_read_input_tokens);
        if (inp > 0 || out > 0 || cacheCreate > 0 || cacheRead > 0) {
          totalInputTokens += inp;
          totalOutputTokens += out;
          totalCacheCreation += cacheCreate;
          totalCacheRead += cacheRead;
          latestRawUsage = usage;
          hasUsage = true;
        }
      }
      const legacyContent = legacyMessage.content;
      const legacyText = flattenClaudeContent(
        Array.isArray(legacyContent)
          ? legacyContent.filter((item) => asRecord(item)?.type === "text")
          : legacyContent,
      );
      if (legacyText) {
        conversation.push({ kind: "assistant", text: legacyText, timestampMs });
      }
      continue;
    }

    // ── Assistant turns ──────────────────────────────────────────────────────
    if (entryType === "assistant") {
      const message = asRecord(entry.message);
      if (!message) continue;

      const messageId = typeof message.id === "string" ? message.id : null;
      // Skip fragments of a message we already processed.
      if (messageId && seenMessageIds.has(messageId)) {
        continue;
      }
      if (messageId) {
        seenMessageIds.add(messageId);
      }

      // ── Token usage ─────────────────────────────────────────────────────
      const usage = asRecord(message.usage);
      if (usage) {
        const inp = toNumber(usage.input_tokens);
        const out = toNumber(usage.output_tokens);
        const cacheCreate = toNumber(usage.cache_creation_input_tokens);
        const cacheRead = toNumber(usage.cache_read_input_tokens);
        if (inp > 0 || out > 0 || cacheCreate > 0 || cacheRead > 0) {
          totalInputTokens += inp;
          totalOutputTokens += out;
          totalCacheCreation += cacheCreate;
          totalCacheRead += cacheRead;
          latestRawUsage = usage;
          hasUsage = true;
        }
      }

      // ── Conversation turns ───────────────────────────────────────────────
      const content = message.content;

      // Thinking blocks → reasoning turns (only if non-empty; Claude often
      // encrypts them and returns an empty string for the `thinking` field).
      const thinkingBlocks = contentItemsOfType(content, "thinking");
      for (const block of thinkingBlocks) {
        const text = typeof block.thinking === "string" ? block.thinking.trim() : "";
        if (text) {
          conversation.push({ kind: "reasoning", text, timestampMs });
        }
      }

      // Text blocks → assistant turns.
      const textContent = flattenClaudeContent(
        Array.isArray(content)
          ? content.filter((item) => asRecord(item)?.type === "text")
          : content,
      );
      if (textContent) {
        conversation.push({ kind: "assistant", text: textContent, timestampMs });
      }

      // Tool-use blocks → tool_call turns.
      const toolUseBlocks = contentItemsOfType(content, "tool_use");
      for (const block of toolUseBlocks) {
        conversation.push({
          kind: "tool_call",
          text: "",
          toolName: typeof block.name === "string" ? block.name : undefined,
          toolCallId: typeof block.id === "string" ? block.id : undefined,
          toolArguments: stringifyInput(block.input),
          timestampMs,
        });
      }
      continue;
    }

    // ── User turns (may carry tool results) ──────────────────────────────────
    if (entryType === "user") {
      const message = asRecord(entry.message);
      if (!message) continue;

      const content = message.content;

      if (Array.isArray(content)) {
        for (const item of content) {
          const rec = asRecord(item);
          if (!rec) continue;

          if (rec.type === "tool_result") {
            // `content` on the tool_result may be a string or array of text blocks.
            const outputText = extractToolResultText(rec.content);
            conversation.push({
              kind: "tool_result",
              text: "",
              toolCallId: typeof rec.tool_use_id === "string" ? rec.tool_use_id : undefined,
              toolOutput: outputText,
              toolStatus: rec.is_error === true ? "error" : "success",
              timestampMs,
            });
          } else if (rec.type === "text" && typeof rec.text === "string" && rec.text.trim()) {
            // Plain text user turns (the original user prompt).
            conversation.push({ kind: "user", text: rec.text.trim(), timestampMs });
          }
        }
      } else if (typeof content === "string" && content.trim()) {
        conversation.push({ kind: "user", text: content.trim(), timestampMs });
      }
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
