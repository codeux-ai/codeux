import { describe, it, expect } from "vitest";
import {
  CODEX_MAX_JSONL_RECORD_CHARS,
  CODEX_MAX_RETAINED_CONVERSATION_GROUPS,
  CODEX_MAX_RETAINED_TOOL_PAYLOAD_CHARS,
  CodexRolloutAccumulator,
  parseCodexExecStdout,
  parseCodexRolloutJsonl,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/codex-log-parser.js";

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

function responseItem(timestamp: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ type: "response_item", timestamp, payload });
}

function usage(input: number, output: number): Record<string, unknown> {
  return { input_tokens: input, output_tokens: output, total_tokens: input + output };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseCodexRolloutJsonl", () => {
  it("returns null usage and empty conversation for empty input", () => {
    const result = parseCodexRolloutJsonl("");
    expect(result.usage).toBeNull();
    expect(result.rawUsageJson).toBeNull();
    expect(result.conversation).toHaveLength(0);
    expect(result.nativeSessionId).toBeNull();
  });

  it("skips malformed JSON lines while preserving normalized empty/null fields", () => {
    const result = parseCodexRolloutJsonl([
      "not json",
      "{\"type\":\"response_item\",",
      userMessage("2026-06-01T10:00:00.000Z", "valid prompt"),
    ].join("\n"));

    expect(result.usage).toBeNull();
    expect(result.rawUsageJson).toBeNull();
    expect(result.conversation).toEqual([
      { kind: "user", text: "valid prompt", timestampMs: Date.parse("2026-06-01T10:00:00.000Z") },
    ]);
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
      JSON.stringify({
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "unscoped history" }] },
      }),
      JSON.stringify({
        type: "event_msg",
        payload: { type: "token_count", info: { total_token_usage: usage(900, 400) } },
      }),
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

  it("normalizes rollout response items while ignoring duplicate event_msg transcript rows", () => {
    const jsonl = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-from-rollout" }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-01T10:00:00.500Z",
        payload: { type: "user_message", message: "duplicate user prompt" },
      }),
      responseItem("2026-06-01T10:00:01.000Z", {
        type: "message",
        role: "developer",
        content: [{ type: "input_text", text: "internal scaffolding" }],
      }),
      userMessage("2026-06-01T10:00:02.000Z", "real prompt"),
      responseItem("2026-06-01T10:00:03.000Z", {
        type: "reasoning",
        summary: [{ type: "summary_text", text: "Check the command first." }],
      }),
      responseItem("2026-06-01T10:00:04.000Z", {
        type: "custom_tool_call",
        name: "repo_search",
        call_id: "call_custom",
        input: "{\"query\":\"parser\"}",
        status: "completed",
      }),
      responseItem("2026-06-01T10:00:04.500Z", {
        type: "custom_tool_call_output",
        call_id: "call_custom",
        output: { output: "found parser" },
      }),
      responseItem("2026-06-01T10:00:05.000Z", {
        type: "local_shell_call",
        call_id: "call_shell",
        action: { type: "exec", command: "pnpm test" },
        status: "completed",
      }),
      responseItem("2026-06-01T10:00:05.500Z", {
        type: "local_shell_call_output",
        call_id: "call_shell",
        output: "ok",
      }),
      responseItem("2026-06-01T10:00:06.000Z", {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Done." }],
      }),
      tokenCount("2026-06-01T10:00:07.000Z", {
        input_tokens: 100,
        input_token_details: { cached_tokens: 25 },
        output_tokens: 30,
      }),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl);

    expect(result.nativeSessionId).toBe("thread-from-rollout");
    expect(result.usage).toEqual({
      inputTokens: 75,
      cachedInputTokens: 25,
      outputTokens: 30,
      reasoningOutputTokens: 0,
    });
    expect(result.conversation.map((turn) => turn.kind)).toEqual([
      "user",
      "reasoning",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result.conversation[0]).toMatchObject({ kind: "user", text: "real prompt" });
    expect(result.conversation[3]).toMatchObject({
      kind: "tool_result",
      toolName: "repo_search",
      toolCallId: "call_custom",
      toolOutput: "found parser",
    });
    expect(result.conversation[5]).toMatchObject({
      kind: "tool_result",
      toolName: "shell",
      toolCallId: "call_shell",
      toolOutput: "ok",
    });
    expect(result.conversation.map((turn) => turn.text).join("\n")).not.toContain("duplicate user prompt");
    expect(result.conversation.map((turn) => turn.text).join("\n")).not.toContain("internal scaffolding");
  });

  it("falls back to event_msg transcript rows only when canonical rollout items are unavailable", () => {
    const jsonl = [
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-01T10:00:00.000Z",
        payload: { type: "user_message", message: "fallback prompt" },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-01T10:00:01.000Z",
        payload: { type: "agent_message", message: "fallback answer" },
      }),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl);

    expect(result.conversation).toEqual([
      { kind: "user", text: "fallback prompt", timestampMs: Date.parse("2026-06-01T10:00:00.000Z") },
      { kind: "assistant", text: "fallback answer", timestampMs: Date.parse("2026-06-01T10:00:01.000Z") },
    ]);
  });

  it("replaces repeated rollout items in place and preserves per-turn token metadata", () => {
    const jsonl = [
      responseItem("2026-06-01T10:00:00.000Z", {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Draft answer" }],
      }),
      responseItem("2026-06-01T10:00:01.000Z", {
        id: "call_1",
        type: "function_call",
        name: "read_file",
        call_id: "call_1",
        arguments: "{\"path\":\"src/index.ts\"}",
        status: "in_progress",
      }),
      responseItem("2026-06-01T10:00:02.000Z", {
        id: "msg_1",
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Final answer" }],
        usage: {
          input_tokens: 14,
          input_token_details: { cached_tokens: 4 },
          output_tokens: 6,
          output_token_details: { reasoning_tokens: 2 },
        },
      }),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl);

    expect(result.conversation).toHaveLength(2);
    expect(result.conversation[0]).toEqual({
      kind: "assistant",
      text: "Final answer",
      tokens: { input: 10, cached: 4, output: 6, reasoning: 2, total: 20 },
      timestampMs: Date.parse("2026-06-01T10:00:02.000Z"),
    });
    expect(result.conversation[1]).toMatchObject({
      kind: "tool_call",
      toolName: "read_file",
      toolStatus: "in_progress",
    });
  });

  it("surfaces readable reasoning summaries but skips opaque reasoning payloads", () => {
    const result = parseCodexRolloutJsonl([
      responseItem("2026-06-01T10:00:00.000Z", {
        id: "reasoning_opaque",
        type: "reasoning",
        reasoning: "opaque-provider-payload",
        encrypted_content: "encrypted-provider-payload",
        summary: [],
      }),
      responseItem("2026-06-01T10:00:01.000Z", {
        id: "reasoning_visible",
        type: "reasoning",
        encrypted_content: "encrypted-provider-payload",
        summary: [
          { type: "summary_text", text: "Inspect the parser." },
          { type: "summary_text", text: "Then run the focused test." },
        ],
      }),
    ].join("\n"));

    expect(result.conversation).toEqual([{
      kind: "reasoning",
      text: "Inspect the parser.\n\nThen run the focused test.",
      timestampMs: Date.parse("2026-06-01T10:00:01.000Z"),
    }]);
    expect(JSON.stringify(result.conversation)).not.toContain("provider-payload");
  });

  it("uses in-window turn.completed usage when a resumed rollout only has an older cumulative token snapshot", () => {
    const followUpStart = "2026-06-01T10:05:00.000Z";
    const jsonl = [
      userMessage("2026-06-01T10:00:00.000Z", "old prompt"),
      tokenCount("2026-06-01T10:00:05.000Z", usage(100, 50)),
      userMessage(followUpStart, "new prompt"),
      JSON.stringify({
        type: "turn.completed",
        timestamp: "2026-06-01T10:05:03.000Z",
        usage: {
          input_tokens: 40,
          input_token_details: { cached_tokens: 10 },
          output_tokens: 12,
          output_token_details: { reasoning_tokens: 3 },
        },
      }),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl, Date.parse(followUpStart));

    expect(result.usage).toEqual({
      inputTokens: 30,
      cachedInputTokens: 10,
      outputTokens: 12,
      reasoningOutputTokens: 3,
    });
    expect(result.rawUsageJson).toEqual({
      input_tokens: 40,
      input_token_details: { cached_tokens: 10 },
      output_tokens: 12,
      output_token_details: { reasoning_tokens: 3 },
    });
    expect(result.conversation).toHaveLength(1);
    expect(result.conversation[0]).toMatchObject({ kind: "user", text: "new prompt" });
  });
});

describe("CodexRolloutAccumulator", () => {
  it("keeps unchanged snapshots stable and parses appended records cumulatively", () => {
    const accumulator = new CodexRolloutAccumulator();
    const initial = [
      sessionMeta("incremental-session"),
      userMessage("2026-06-01T10:00:00.000Z", "first"),
      tokenCount("2026-06-01T10:00:01.000Z", usage(10, 2)),
    ].join("\n");

    const first = accumulator.update(initial);
    expect(accumulator.update(initial)).toBe(first);

    const appended = `${initial}\n${responseItem("2026-06-01T10:00:02.000Z", {
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "second" }],
    })}\n${tokenCount("2026-06-01T10:00:03.000Z", usage(14, 5))}`;
    const second = accumulator.update(appended);

    expect(second.nativeSessionId).toBe("incremental-session");
    expect(second.usage).toMatchObject({ inputTokens: 14, outputTokens: 5 });
    expect(second.conversation.map((turn) => turn.text)).toEqual(["first", "second"]);
  });

  it("updates repeated lifecycle items in place instead of duplicating them", () => {
    const accumulator = new CodexRolloutAccumulator();
    const started = responseItem("2026-06-01T10:00:00.000Z", {
      type: "local_shell_call",
      id: "command-1",
      command: "pnpm test",
      status: "in_progress",
    });
    accumulator.update(started);

    const completed = responseItem("2026-06-01T10:00:01.000Z", {
      type: "local_shell_call",
      id: "command-1",
      command: "pnpm test",
      status: "completed",
      output: "passed",
      exit_code: 0,
    });
    const result = accumulator.update(`${started}\n${completed}`);

    expect(result.conversation.map((turn) => turn.kind)).toEqual(["tool_call", "tool_result"]);
    expect(result.conversation[0]).toMatchObject({ toolCallId: "command-1", toolStatus: "completed" });
    expect(result.conversation[1]).toMatchObject({ toolOutput: "passed", toolStatus: "completed" });
  });

  it("stops retaining duplicate event messages after canonical turns arrive", () => {
    const accumulator = new CodexRolloutAccumulator();
    const fallback = JSON.stringify({
      type: "event_msg",
      timestamp: "2026-06-01T10:00:00.000Z",
      payload: { type: "agent_message", message: "fallback draft" },
    });
    const canonical = responseItem("2026-06-01T10:00:01.000Z", {
      id: "msg-1",
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "canonical answer" }],
    });
    const first = accumulator.update(`${fallback}\n${canonical}`);
    const revision = first.conversationRevision;

    const duplicateAfterCanonical = JSON.stringify({
      type: "event_msg",
      timestamp: "2026-06-01T10:00:02.000Z",
      payload: { type: "agent_message", message: "duplicate canonical answer" },
    });
    const second = accumulator.update(`${fallback}\n${canonical}\n${duplicateAfterCanonical}`);

    expect(second.conversation).toEqual([
      expect.objectContaining({ kind: "assistant", text: "canonical answer" }),
    ]);
    expect(second.conversationRevision).toBe(revision);
  });

  it("resets safely after truncation or source rotation", () => {
    const accumulator = new CodexRolloutAccumulator();
    const first = [sessionMeta("old"), userMessage("2026-06-01T10:00:00.000Z", "old prompt")].join("\n");
    accumulator.update(first, "rollout-old");

    const truncated = sessionMeta("new");
    expect(accumulator.update(truncated, "rollout-new")).toMatchObject({
      nativeSessionId: "new",
      conversation: [],
    });

    const rotated = [
      sessionMeta("rotated"),
      userMessage("2026-06-01T10:01:00.000Z", "rotated prompt"),
      userMessage("2026-06-01T10:01:01.000Z", "rotated follow-up"),
    ].join("\n");
    const result = accumulator.update(rotated, "rollout-rotated");
    expect(result.nativeSessionId).toBe("rotated");
    expect(result.conversation.map((turn) => turn.text)).toEqual(["rotated prompt", "rotated follow-up"]);
  });

  it("recovers a JSON record split across snapshots", () => {
    const accumulator = new CodexRolloutAccumulator();
    const record = userMessage("2026-06-01T10:00:00.000Z", "complete later");
    const splitAt = Math.floor(record.length / 2);

    expect(accumulator.update(record.slice(0, splitAt)).conversation).toEqual([]);
    expect(accumulator.update(record).conversation).toEqual([
      expect.objectContaining({ kind: "user", text: "complete later" }),
    ]);
  });

  it("discards an oversized split JSONL record and resumes at the next record", () => {
    const accumulator = new CodexRolloutAccumulator();
    const oversizedPrefix = JSON.stringify({
      type: "response_item",
      timestamp: "2026-06-01T10:00:00.000Z",
      payload: { type: "function_call_output", call_id: "huge-output" },
    }).slice(0, -2) + ',"output":"';
    const oversized = oversizedPrefix + "x".repeat(CODEX_MAX_JSONL_RECORD_CHARS);
    const splitAt = Math.floor(oversized.length / 2);

    accumulator.appendChunk(oversized.slice(0, splitAt), "rollout-large", true);
    const result = accumulator.appendChunk([
      oversized.slice(splitAt),
      userMessage("2026-06-01T10:00:01.000Z", "parser recovered"),
      "",
    ].join("\n"), "rollout-large");

    expect(result.conversation).toEqual([
      expect.objectContaining({ kind: "user", text: "parser recovered" }),
    ]);
  });

  it("bounds retained Codex tool payloads before live persistence", () => {
    const largeOutput = `head-${"x".repeat(50_000)}-tail`;
    const result = parseCodexRolloutJsonl(responseItem(
      "2026-06-01T10:00:00.000Z",
      {
        type: "function_call_output",
        call_id: "large-tool",
        output: largeOutput,
      },
    ));

    expect(result.conversation[0]?.toolOutput?.length)
      .toBeLessThanOrEqual(CODEX_MAX_RETAINED_TOOL_PAYLOAD_CHARS);
    expect(result.conversation[0]?.toolOutput).toContain("head-");
    expect(result.conversation[0]?.toolOutput).toContain("-tail");
    expect(result.conversation[0]?.toolOutput).toContain("characters truncated");
  });

  it("retains only the newest bounded window of Codex conversation groups", () => {
    const extraGroups = 12;
    const jsonl = Array.from(
      { length: CODEX_MAX_RETAINED_CONVERSATION_GROUPS + extraGroups },
      (_, index) => responseItem(
        "2026-06-01T10:00:00.000Z",
        {
          id: `message-${index}`,
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: `answer-${index}` }],
        },
      ),
    ).join("\n");

    const result = parseCodexRolloutJsonl(jsonl);

    expect(result.conversation).toHaveLength(CODEX_MAX_RETAINED_CONVERSATION_GROUPS);
    expect(result.conversation[0]?.text).toBe(`answer-${extraGroups}`);
    expect(result.conversation.at(-1)?.text)
      .toBe(`answer-${CODEX_MAX_RETAINED_CONVERSATION_GROUPS + extraGroups - 1}`);
    expect(result.conversationChangedFromIndex).toBe(0);
  });
});

describe("parseCodexExecStdout", () => {
  it("returns null usage and empty conversation for empty stdout", () => {
    const result = parseCodexExecStdout("");
    expect(result).toEqual({
      usage: null,
      rawUsageJson: null,
      nativeSessionId: null,
      conversation: [],
    });
  });

  it("parses usage-only records without synthesizing conversation turns", () => {
    const result = parseCodexExecStdout(JSON.stringify({
      type: "turn.completed",
      usage: { input_tokens: 25, output_tokens: 9 },
    }));

    expect(result.usage).toEqual({
      inputTokens: 25,
      cachedInputTokens: 0,
      outputTokens: 9,
      reasoningOutputTokens: 0,
    });
    expect(result.rawUsageJson).toEqual({ input_tokens: 25, output_tokens: 9 });
    expect(result.conversation).toEqual([]);
  });

  it("skips partial JSON and unknown events while preserving recoverable stream metadata", () => {
    const stdout = [
      "{\"type\":\"turn.completed\",\"usage\":{\"input_tokens\":99,\"api_key\":\"sk-test-secret\"",
      JSON.stringify({ type: "thread.started", thread_id: "thread-safe-id" }),
      JSON.stringify({ type: "provider.debug", message: "ignored event" }),
      JSON.stringify({
        type: "item.started",
        timestamp: "2026-06-01T10:00:00.000Z",
        item: { id: "cmd_1", type: "command_execution", command: "pnpm test", status: "running" },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 12, total_tokens: 20 },
      }),
    ].join("\n");

    const result = parseCodexExecStdout(stdout);

    expect(result.nativeSessionId).toBe("thread-safe-id");
    expect(result.usage).toMatchObject({ inputTokens: 12, outputTokens: 8 });
    expect(result.rawUsageJson).toEqual({ input_tokens: 12, total_tokens: 20 });
    expect(result.conversation).toHaveLength(1);
    expect(result.conversation[0]).toMatchObject({
      kind: "tool_call",
      toolName: "shell",
      toolCallId: "cmd_1",
      toolArguments: "pnpm test",
      toolStatus: "running",
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });

  it("normalizes missing and negative token fields in rollout usage records", () => {
    const jsonl = [
      sessionMeta("sess-missing-fields"),
      tokenCount("2026-06-01T10:00:05.000Z", {
        input_tokens: "30",
        output_tokens: -10,
        total_tokens: 45,
        input_token_details: { cached_tokens: -3 },
      }),
    ].join("\n");

    const result = parseCodexRolloutJsonl(jsonl);

    expect(result.usage).toEqual({
      inputTokens: 30,
      cachedInputTokens: 0,
      outputTokens: 15,
      reasoningOutputTokens: 0,
    });
    expect(result.nativeSessionId).toBe("sess-missing-fields");
  });

  it("parses mixed exec response_item and item streams with paired tools and duplicate completions removed", () => {
    const stdout = [
      JSON.stringify({ type: "session.created", session_id: "sess-exec-1" }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-06-01T10:00:00.000Z",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Inspecting." }] },
      }),
      JSON.stringify({
        type: "event_msg",
        timestamp: "2026-06-01T10:00:00.100Z",
        payload: { type: "agent_message", message: "duplicate inspecting" },
      }),
      JSON.stringify({
        type: "item.started",
        timestamp: "2026-06-01T10:00:01.000Z",
        item: { id: "cmd_1", type: "command_execution", command: "ls", status: "running" },
      }),
      JSON.stringify({
        type: "item.completed",
        timestamp: "2026-06-01T10:00:02.000Z",
        item: { id: "cmd_1", type: "command_execution", command: "ls", aggregated_output: "a.ts", exit_code: 0, status: "completed" },
      }),
      JSON.stringify({
        type: "item.completed",
        timestamp: "2026-06-01T10:00:02.500Z",
        item: { id: "cmd_1", type: "command_execution", command: "ls", aggregated_output: "a.ts", exit_code: 0, status: "completed" },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-06-01T10:00:03.000Z",
        payload: { type: "function_call", name: "read_file", call_id: "call_read", arguments: "{\"path\":\"a.ts\"}" },
      }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-06-01T10:00:03.500Z",
        payload: { type: "function_call_output", call_id: "call_read", output: "contents" },
      }),
      JSON.stringify({
        type: "item.completed",
        timestamp: "2026-06-01T10:00:04.000Z",
        item: { id: "msg_2", type: "agent_message", text: "Finished." },
      }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 60, cached_input_tokens: 10, output_tokens: 20 } }),
    ].join("\n");

    const result = parseCodexExecStdout(stdout);

    expect(result.nativeSessionId).toBe("sess-exec-1");
    expect(result.usage).toEqual({
      inputTokens: 50,
      cachedInputTokens: 10,
      outputTokens: 20,
      reasoningOutputTokens: 0,
    });
    expect(result.conversation.map((turn) => turn.kind)).toEqual([
      "assistant",
      "tool_call",
      "tool_result",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result.conversation[2]).toMatchObject({ kind: "tool_result", toolName: "shell", toolCallId: "cmd_1", toolOutput: "a.ts" });
    expect(result.conversation[4]).toMatchObject({ kind: "tool_result", toolName: "read_file", toolCallId: "call_read", toolOutput: "contents" });
    expect(result.conversation.map((turn) => turn.text).join("\n")).not.toContain("duplicate inspecting");
  });

  it("keeps updated live items at their first-seen position and emits only their latest state", () => {
    const stdout = [
      JSON.stringify({
        type: "item.started",
        timestamp: "2026-06-01T10:00:00.000Z",
        item: { id: "cmd_live", type: "command_execution", command: "pnpm test", status: "in_progress" },
      }),
      JSON.stringify({
        type: "item.completed",
        timestamp: "2026-06-01T10:00:01.000Z",
        item: { id: "msg_after", type: "agent_message", text: "Waiting for the test." },
      }),
      JSON.stringify({
        type: "item.updated",
        timestamp: "2026-06-01T10:00:02.000Z",
        item: {
          id: "cmd_live",
          type: "command_execution",
          command: "pnpm test",
          aggregated_output: "still running",
          status: "in_progress",
          usage: { input_tokens: 5, output_tokens: 2 },
        },
      }),
    ].join("\n");

    const result = parseCodexExecStdout(stdout);

    expect(result.conversation.map((turn) => turn.kind)).toEqual([
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result.conversation[0]).toMatchObject({
      toolCallId: "cmd_live",
      toolStatus: "in_progress",
      timestampMs: Date.parse("2026-06-01T10:00:02.000Z"),
    });
    expect(result.conversation[1]).toMatchObject({
      toolCallId: "cmd_live",
      toolOutput: "still running",
      toolStatus: "in_progress",
      tokens: { input: 5, cached: 0, output: 2, reasoning: 0, total: 7 },
    });
    expect(result.conversation[2]).toMatchObject({ kind: "assistant", text: "Waiting for the test." });
  });

  it("falls back to exec event_msg transcript rows when no item stream is available", () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thread-fallback" }),
      JSON.stringify({ type: "event_msg", payload: { type: "user_message", message: "fallback exec prompt" } }),
      JSON.stringify({ type: "event_msg", payload: { type: "agent_message", message: "fallback exec answer" } }),
      JSON.stringify({ type: "turn.completed", payload: { usage: { prompt_tokens: 11, completion_tokens: 4 } } }),
    ].join("\n");

    const result = parseCodexExecStdout(stdout);

    expect(result.nativeSessionId).toBe("thread-fallback");
    expect(result.usage).toEqual({
      inputTokens: 11,
      cachedInputTokens: 0,
      outputTokens: 4,
      reasoningOutputTokens: 0,
    });
    expect(result.conversation).toEqual([
      { kind: "user", text: "fallback exec prompt", timestampMs: null },
      { kind: "assistant", text: "fallback exec answer", timestampMs: null },
    ]);
  });

  it("prefers direct exec turn.completed usage over duplicate legacy token_count usage", () => {
    const stdout = [
      JSON.stringify({
        type: "token_count",
        payload: {
          type: "token_count",
          info: { total_token_usage: { input_tokens: 1000, output_tokens: 500 } },
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 70, cached_input_tokens: 20, output_tokens: 15 },
      }),
    ].join("\n");

    const result = parseCodexExecStdout(stdout);

    expect(result.usage).toEqual({
      inputTokens: 50,
      cachedInputTokens: 20,
      outputTokens: 15,
      reasoningOutputTokens: 0,
    });
    expect(result.rawUsageJson).toEqual({
      input_tokens: 70,
      cached_input_tokens: 20,
      output_tokens: 15,
    });
  });
});
