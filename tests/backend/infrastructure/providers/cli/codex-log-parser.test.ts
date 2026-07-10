import { describe, it, expect } from "vitest";
import {
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
