import { describe, it, expect } from "vitest";
import {
  truncateForStorage,
  MAX_MESSAGE_CONTENT_CHARS,
  MAX_TOOL_PAYLOAD_CHARS,
} from "../../src/services/invocation-message-limits.js";

describe("truncateForStorage", () => {
  it("returns short text unchanged", () => {
    expect(truncateForStorage("hello", 100)).toBe("hello");
    expect(truncateForStorage("", 100)).toBe("");
  });

  it("caps oversized text and marks the elision", () => {
    const text = "A".repeat(20_000) + "B".repeat(20_000);
    const result = truncateForStorage(text, MAX_TOOL_PAYLOAD_CHARS);
    expect(result.length).toBeLessThanOrEqual(MAX_TOOL_PAYLOAD_CHARS);
    expect(result).toContain("characters truncated");
    // Keeps head and tail.
    expect(result.startsWith("A")).toBe(true);
    expect(result.endsWith("B")).toBe(true);
  });

  it("bounds a huge codex-style tool output well under the message cap", () => {
    const giant = "x".repeat(590_000); // observed largest single function_call_output
    const result = truncateForStorage(giant, MAX_MESSAGE_CONTENT_CHARS);
    expect(result.length).toBeLessThanOrEqual(MAX_MESSAGE_CONTENT_CHARS);
  });
});
