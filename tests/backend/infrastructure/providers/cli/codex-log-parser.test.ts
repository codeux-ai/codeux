import { describe, it, expect } from "vitest";
import { parseCodexRolloutJsonl } from "../../../../../src/infrastructure/providers/cli/provider-logs/codex-log-parser.js";

// ─── Test fixture helpers ────────────────────────────────────────────────────

function sessionMeta(id: string): string {
  return JSON.stringify({ type: "session_meta", payload: { id } });
}

function tokenCount(timestamp: string, totalTokenUsage: Record<string, unknown>): string {
  return JSON.stringify({
    type: "event_msg",
    timestamp,
    payload: {
      type: "token_count",
      info: { total_token_usage: totalTokenUsage },
    },
  });
}

function userMessage(timestamp: string, text: string): string {
  return JSON.stringify({
    type: "response_item",
    timestamp,
    payload: { type: "message", role: "user", content: [{ type: "input_text", text }] },
  });
}

function usage(input: number, output: number): Record<string, unknown> {
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseCodexRolloutJsonl", () => {
  it("returns null usage and empty conversation for empty input", () => {
    const result = parseCodexRolloutJsonl("");
    expect(result.usage).toBeNull();
    expect(result.conversation).toHaveLength(0);
    expect(result.nativeSessionId).toBeNull();
  });

  it("returns the raw cumulative usage when no sinceMs window is given (first run)", () => {
    const jsonl = [
      sessionMeta("sess-1"),
      userMessage("2026-06-01T10:00:00.000Z", "hello"),
      tokenCount("2026-06-01T10:00:05.000Z", usage(100, 50)),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl);
    expect(result.usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
      reasoningOutputTokens: 0,
    });
  });

  it("isolates usage to just the current run when sinceMs is given but no prior token_count exists", () => {
    const jsonl = [
      sessionMeta("sess-1"),
      userMessage("2026-06-01T10:00:00.000Z", "hello"),
      tokenCount("2026-06-01T10:00:05.000Z", usage(100, 50)),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl, Date.parse("2026-06-01T10:00:00.000Z"));
    expect(result.usage).toEqual({
      inputTokens: 100,
      cachedInputTokens: 0,
      outputTokens: 50,
      reasoningOutputTokens: 0,
    });
  });

  it("subtracts the pre-window cumulative snapshot so a resumed/follow-up run reports only its own tokens", () => {
    // First invocation's turn + cumulative usage snapshot.
    const firstRunTokenCount = tokenCount("2026-06-01T10:00:05.000Z", usage(100, 50));
    // Follow-up invocation resumes the same rollout file; codex keeps writing
    // the *cumulative* total for the whole session, not just the new turn.
    const followUpStart = "2026-06-01T10:05:00.000Z";
    const jsonl = [
      sessionMeta("sess-1"),
      userMessage("2026-06-01T10:00:00.000Z", "hello"),
      firstRunTokenCount,
      userMessage(followUpStart, "follow up please"),
      tokenCount("2026-06-01T10:05:10.000Z", usage(100 + 20, 50 + 10)),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl, Date.parse(followUpStart));

    // Only the follow-up run's incremental tokens should be reported, not the
    // full session-cumulative total (which would double-count the first run's
    // tokens against its own already-persisted usage).
    expect(result.usage).toEqual({
      inputTokens: 20,
      cachedInputTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 0,
    });

    // The conversation is still correctly windowed to just the follow-up turn.
    expect(result.conversation).toHaveLength(1);
    expect(result.conversation[0]).toMatchObject({ kind: "user", text: "follow up please" });
  });

  it("subtracts cached and reasoning token details too", () => {
    const baseline = {
      input_tokens: 1000,
      output_tokens: 200,
      input_token_details: { cached_tokens: 300 },
      output_token_details: { reasoning_tokens: 40 },
    };
    const cumulative = {
      input_tokens: 1500,
      output_tokens: 260,
      input_token_details: { cached_tokens: 450 },
      output_token_details: { reasoning_tokens: 55 },
    };
    const followUpStart = "2026-06-01T10:05:00.000Z";
    const jsonl = [
      sessionMeta("sess-1"),
      userMessage("2026-06-01T10:00:00.000Z", "hello"),
      tokenCount("2026-06-01T10:00:05.000Z", baseline),
      userMessage(followUpStart, "follow up please"),
      tokenCount("2026-06-01T10:05:10.000Z", cumulative),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl, Date.parse(followUpStart));

    expect(result.usage).toEqual({
      inputTokens: 350,
      cachedInputTokens: 150,
      outputTokens: 60,
      reasoningOutputTokens: 15,
    });
  });

  it("never returns negative deltas even if the baseline is somehow larger", () => {
    const followUpStart = "2026-06-01T10:05:00.000Z";
    const jsonl = [
      sessionMeta("sess-1"),
      userMessage("2026-06-01T10:00:00.000Z", "hello"),
      tokenCount("2026-06-01T10:00:05.000Z", usage(500, 200)),
      userMessage(followUpStart, "follow up please"),
      tokenCount("2026-06-01T10:05:10.000Z", usage(400, 150)),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl, Date.parse(followUpStart));

    expect(result.usage).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
    });
  });

  it("extracts the native session id from session_meta", () => {
    const jsonl = [sessionMeta("sess-abc-123"), userMessage("2026-06-01T10:00:00.000Z", "hi")].join("\n");
    const result = parseCodexRolloutJsonl(jsonl);
    expect(result.nativeSessionId).toBe("sess-abc-123");
  });
});
