/**
 * Storage caps for persisted invocation messages.
 *
 * Provider transcripts (codex especially) carry tool results that can be
 * hundreds of KB each — full file reads, large `grep`/test output, etc. A
 * single codex run was observed writing ~3 MB of `function_call_output`
 * across a session, with individual outputs up to ~590 KB. Persisting those
 * verbatim as invocation messages bloats the DB and makes the invocation slow
 * to load in the dashboard. The full payload is never needed for display, so
 * we cap message content and tool payloads here, keeping the head and tail
 * (errors usually surface at the end) with a clear elision marker.
 */

/** Cap for a message's human-readable `contentMarkdown`. */
export const MAX_MESSAGE_CONTENT_CHARS = 16_000;
/** Cap for raw tool arguments / output stored in `toolCallsJson`. */
export const MAX_TOOL_PAYLOAD_CHARS = 8_000;

/**
 * Truncates `text` to at most `maxChars`, preserving the head and tail and
 * replacing the elided middle with a marker noting how many characters were
 * omitted. Returns the input unchanged when it is within the cap (or empty).
 */
export function truncateForStorage(text: string, maxChars: number): string {
  if (!text || text.length <= maxChars) {
    return text;
  }
  const omitted = text.length - maxChars;
  const marker = `\n\n… [${omitted.toLocaleString("en-US")} characters truncated] …\n\n`;
  const budget = Math.max(0, maxChars - marker.length);
  const headLen = Math.ceil(budget * 0.7);
  const tailLen = budget - headLen;
  const head = text.slice(0, headLen);
  const tail = tailLen > 0 ? text.slice(text.length - tailLen) : "";
  return `${head}${marker}${tail}`;
}
