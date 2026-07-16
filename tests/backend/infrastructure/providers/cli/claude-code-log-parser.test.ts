import { describe, it, expect } from "vitest";
import {
  ClaudeCodeLogAccumulator,
  parseClaudeCodeSessionJsonl,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/claude-code-log-parser.js";

// ─── Test fixture helpers ────────────────────────────────────────────────────

function makeAssistantEntry(opts: {
  sessionId?: string;
  messageId?: string;
  timestamp?: string;
  content: unknown[];
  usage?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: "assistant",
    sessionId: opts.sessionId ?? "test-session",
    timestamp: opts.timestamp ?? "2026-06-01T10:00:00.000Z",
    message: {
      id: opts.messageId ?? "msg_001",
      role: "assistant",
      type: "message",
      model: "claude-opus-4-5",
      content: opts.content,
      stop_reason: "end_turn",
      usage: opts.usage ?? {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    },
  });
}

function makeUserEntry(opts: {
  sessionId?: string;
  timestamp?: string;
  content: unknown;
}): string {
  return JSON.stringify({
    type: "user",
    sessionId: opts.sessionId ?? "test-session",
    timestamp: opts.timestamp ?? "2026-06-01T10:00:00.000Z",
    message: {
      role: "user",
      content: opts.content,
    },
  });
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("parseClaudeCodeSessionJsonl", () => {
  it("returns empty result for empty input", () => {
    const result = parseClaudeCodeSessionJsonl("");
    expect(result.usage).toBeNull();
    expect(result.rawUsageJson).toBeNull();
    expect(result.conversation).toEqual([]);
    expect(result.nativeSessionId).toBeNull();
  });

  it("returns empty result for whitespace-only input", () => {
    const result = parseClaudeCodeSessionJsonl("   \n  \n  ");
    expect(result.usage).toBeNull();
    expect(result.rawUsageJson).toBeNull();
    expect(result.conversation).toEqual([]);
  });

  it("keeps partial user-only records as conversation turns with null usage", () => {
    const result = parseClaudeCodeSessionJsonl(makeUserEntry({
      content: [{ type: "text", text: "Only the prompt was logged." }],
    }));

    expect(result.usage).toBeNull();
    expect(result.rawUsageJson).toBeNull();
    expect(result.conversation).toEqual([
      {
        kind: "user",
        text: "Only the prompt was logged.",
        timestampMs: Date.parse("2026-06-01T10:00:00.000Z"),
      },
    ]);
  });

  it("parses nativeSessionId from any entry", () => {
    const jsonl = makeAssistantEntry({
      sessionId: "session-abc",
      content: [{ type: "text", text: "Hello" }],
    });
    const result = parseClaudeCodeSessionJsonl(jsonl);
    expect(result.nativeSessionId).toBe("session-abc");
  });

  it("accumulates token usage across multiple assistant messages", () => {
    const lines = [
      makeAssistantEntry({
        messageId: "msg_001",
        content: [{ type: "text", text: "First response" }],
        usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
      makeAssistantEntry({
        messageId: "msg_002",
        content: [{ type: "text", text: "Second response" }],
        usage: { input_tokens: 200, output_tokens: 75, cache_creation_input_tokens: 20, cache_read_input_tokens: 10 },
      }),
    ].join("\n");

    const result = parseClaudeCodeSessionJsonl(lines);

    expect(result.usage).not.toBeNull();
    expect(result.usage!.inputTokens).toBe(300);
    expect(result.usage!.outputTokens).toBe(125);
    expect(result.usage!.cacheCreationTokens).toBe(20);
    expect(result.usage!.cacheReadTokens).toBe(10);
  });

  it("deduplicates usage from the same message id (streaming fragments)", () => {
    const fragment = makeAssistantEntry({
      messageId: "msg_dup",
      content: [{ type: "text", text: "Partial" }],
      usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    // Same message id emitted twice (streaming duplicate)
    const jsonl = [fragment, fragment].join("\n");

    const result = parseClaudeCodeSessionJsonl(jsonl);

    expect(result.usage!.inputTokens).toBe(100); // counted only once
    expect(result.usage!.outputTokens).toBe(30);
  });

  it("keeps the fuller duplicate assistant message while counting usage once", () => {
    const lines = [
      makeAssistantEntry({
        sessionId: "native-from-entry",
        messageId: "msg_stream",
        content: [{ type: "text", text: "Partial" }],
        usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 },
      }),
      makeAssistantEntry({
        sessionId: "native-from-entry",
        messageId: "msg_stream",
        content: [
          { type: "reasoning", text: "Now I have the full answer." },
          { type: "text", text: "Complete answer." },
          { type: "tool_use", id: "toolu_stream", name: "Read", input: { file_path: "src/file.ts" } },
        ],
        usage: { input_tokens: 100, output_tokens: 30, cache_creation_input_tokens: 5, cache_read_input_tokens: 0 },
      }),
    ].join("\n");

    const result = parseClaudeCodeSessionJsonl(lines);

    expect(result.nativeSessionId).toBe("native-from-entry");
    expect(result.usage).toEqual({
      inputTokens: 100,
      outputTokens: 30,
      cacheCreationTokens: 5,
      cacheReadTokens: 0,
    });
    expect(result.conversation.map((turn) => turn.kind)).toEqual(["reasoning", "assistant", "tool_call"]);
    expect(result.conversation[1]).toMatchObject({ kind: "assistant", text: "Complete answer." });
    expect(result.conversation[2]).toMatchObject({ kind: "tool_call", toolName: "Read", toolCallId: "toolu_stream" });
    expect(result.conversation.map((turn) => turn.text).join("\n")).not.toContain("Partial");
  });

  it("extracts assistant text turns from content array", () => {
    const jsonl = makeAssistantEntry({
      messageId: "msg_text",
      content: [
        { type: "text", text: "Hello world." },
      ],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const assistantTurns = result.conversation.filter((t) => t.kind === "assistant");
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].text).toBe("Hello world.");
  });

  it("extracts thinking blocks as reasoning turns", () => {
    const jsonl = makeAssistantEntry({
      messageId: "msg_think",
      content: [
        { type: "thinking", thinking: "Let me reason about this..." },
        { type: "text", text: "Here is my answer." },
      ],
      usage: { input_tokens: 50, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const reasoningTurns = result.conversation.filter((t) => t.kind === "reasoning");
    const assistantTurns = result.conversation.filter((t) => t.kind === "assistant");
    expect(reasoningTurns).toHaveLength(1);
    expect(reasoningTurns[0].text).toBe("Let me reason about this...");
    expect(assistantTurns).toHaveLength(1);
    expect(assistantTurns[0].text).toBe("Here is my answer.");
  });

  it("extracts direct visible thinking fields on assistant messages", () => {
    const jsonl = JSON.stringify({
      type: "assistant",
      sessionId: "test-session",
      timestamp: "2026-06-01T10:00:00.000Z",
      message: {
        id: "msg_direct_thinking",
        role: "assistant",
        content: [{ type: "text", text: "I have a plan." }],
        thinking: "I should inspect the failing test first.",
        usage: { input_tokens: 15, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      },
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);
    expect(result.conversation.map((t) => t.kind)).toEqual(["reasoning", "assistant"]);
    expect(result.conversation[0]).toMatchObject({ kind: "reasoning", text: "I should inspect the failing test first." });
  });

  it("preserves structured assistant content block order and skips redacted thinking", () => {
    const result = parseClaudeCodeSessionJsonl(makeAssistantEntry({
      messageId: "msg_ordered",
      content: [
        { type: "text", text: "First." },
        { type: "tool_use", id: "toolu_ordered", name: "Read", input: { file_path: "a.ts" } },
        { type: "redacted_thinking", data: "opaque-ciphertext" },
        { type: "thinking", thinking: "Now inspect the result." },
        { type: "text", text: "Second." },
      ],
    }));

    expect(result.conversation.map((turn) => turn.kind)).toEqual([
      "assistant",
      "tool_call",
      "reasoning",
      "assistant",
    ]);
    expect(result.conversation.map((turn) => turn.text).join(" ")).not.toContain("opaque-ciphertext");
  });

  it("skips encrypted (empty) thinking blocks", () => {
    const jsonl = makeAssistantEntry({
      messageId: "msg_enc",
      content: [
        { type: "thinking", thinking: "", signature: "some-base64-here" },
        { type: "text", text: "Answer without visible thinking." },
      ],
      usage: { input_tokens: 30, output_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const reasoningTurns = result.conversation.filter((t) => t.kind === "reasoning");
    expect(reasoningTurns).toHaveLength(0); // empty thinking not surfaced
  });

  it("extracts tool_use blocks as tool_call turns", () => {
    const jsonl = makeAssistantEntry({
      messageId: "msg_tool",
      content: [
        {
          type: "tool_use",
          id: "toolu_abc123",
          name: "Bash",
          input: { command: "ls -la", description: "List files" },
        },
      ],
      usage: { input_tokens: 80, output_tokens: 40, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const toolCallTurns = result.conversation.filter((t) => t.kind === "tool_call");
    expect(toolCallTurns).toHaveLength(1);
    expect(toolCallTurns[0].toolName).toBe("Bash");
    expect(toolCallTurns[0].toolCallId).toBe("toolu_abc123");
    expect(toolCallTurns[0].toolArguments).toContain("ls -la");
  });

  it("extracts tool_result from user entries", () => {
    const jsonl = makeUserEntry({
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_abc123",
          content: "stdout output here",
          is_error: false,
        },
      ],
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const toolResultTurns = result.conversation.filter((t) => t.kind === "tool_result");
    expect(toolResultTurns).toHaveLength(1);
    expect(toolResultTurns[0].toolCallId).toBe("toolu_abc123");
    expect(toolResultTurns[0].toolOutput).toBe("stdout output here");
    expect(toolResultTurns[0].toolStatus).toBe("success");
  });

  it("extracts tool_result text from object content blocks", () => {
    const jsonl = makeUserEntry({
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_obj",
          content: { type: "text", text: "object output" },
          is_error: false,
        },
      ],
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    expect(result.conversation).toEqual([
      expect.objectContaining({
        kind: "tool_result",
        toolCallId: "toolu_obj",
        toolOutput: "object output",
        toolStatus: "success",
      }),
    ]);
  });

  it("extracts tool_result text from structured content arrays", () => {
    const result = parseClaudeCodeSessionJsonl(makeUserEntry({
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_array",
        content: [{ type: "text", text: "first line" }, "second line"],
      }],
    }));

    expect(result.conversation[0]).toMatchObject({
      kind: "tool_result",
      toolCallId: "toolu_array",
      toolOutput: "first line\nsecond line",
    });
  });

  it("marks tool_result as error when is_error is true", () => {
    const jsonl = makeUserEntry({
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_err",
          content: "Command failed: exit code 1",
          is_error: true,
        },
      ],
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const toolResultTurns = result.conversation.filter((t) => t.kind === "tool_result");
    expect(toolResultTurns[0].toolStatus).toBe("error");
  });

  it("extracts plain user text from user entries", () => {
    const jsonl = makeUserEntry({
      content: [
        { type: "text", text: "Please fix the bug." },
      ],
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const userTurns = result.conversation.filter((t) => t.kind === "user");
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0].text).toBe("Please fix the bug.");
  });

  it("handles user content as string", () => {
    const jsonl = JSON.stringify({
      type: "user",
      sessionId: "sess",
      timestamp: "2026-06-01T10:00:00.000Z",
      message: { role: "user", content: "Plain text prompt" },
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    const userTurns = result.conversation.filter((t) => t.kind === "user");
    expect(userTurns).toHaveLength(1);
    expect(userTurns[0].text).toBe("Plain text prompt");
  });

  it("filters entries before the sinceMs window", () => {
    const oldEntry = makeAssistantEntry({
      sessionId: "old-session",
      messageId: "msg_old",
      timestamp: "2026-06-01T08:00:00.000Z", // 2 hours before
      content: [{ type: "text", text: "Old response" }],
      usage: { input_tokens: 999, output_tokens: 999, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    const newEntry = makeAssistantEntry({
      sessionId: "current-session",
      messageId: "msg_new",
      timestamp: "2026-06-01T10:01:00.000Z", // 1 min after sinceMs
      content: [{ type: "text", text: "New response" }],
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const sinceMs = Date.parse("2026-06-01T10:00:00.000Z");
    const result = parseClaudeCodeSessionJsonl([oldEntry, newEntry].join("\n"), sinceMs);

    // Only new entry should be included (old is 2 hours before sinceMs - 2s grace)
    expect(result.usage!.inputTokens).toBe(10);
    expect(result.nativeSessionId).toBe("current-session");
    expect(result.conversation.filter((t) => t.kind === "assistant")).toHaveLength(1);
    expect(result.conversation.find((t) => t.kind === "assistant")!.text).toBe("New response");
  });

  it("includes entries within the 2-second grace window", () => {
    const edgeEntry = makeAssistantEntry({
      messageId: "msg_grace",
      timestamp: "2026-06-01T09:59:59.000Z", // 1s before sinceMs but within 2s grace
      content: [{ type: "text", text: "Grace response" }],
      usage: { input_tokens: 50, output_tokens: 25, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });

    const sinceMs = Date.parse("2026-06-01T10:00:00.000Z");
    const result = parseClaudeCodeSessionJsonl(edgeEntry, sinceMs);

    // sinceMs - 2000ms = 09:59:58; 09:59:59 is within the grace window
    expect(result.usage).not.toBeNull();
    expect(result.usage!.inputTokens).toBe(50);
  });

  it("builds rawUsageJson from last seen usage", () => {
    const jsonl = makeAssistantEntry({
      messageId: "msg_raw",
      content: [{ type: "text", text: "Done." }],
      usage: { input_tokens: 42, output_tokens: 17, cache_creation_input_tokens: 5, cache_read_input_tokens: 3 },
    });

    const result = parseClaudeCodeSessionJsonl(jsonl);

    expect(result.rawUsageJson).not.toBeNull();
    expect(result.rawUsageJson!.input_tokens).toBe(42);
  });

  it("parses a realistic multi-turn session with tools", () => {
    const lines = [
      // User prompt
      makeUserEntry({
        timestamp: "2026-06-01T10:00:00.000Z",
        content: [{ type: "text", text: "Fix the failing test." }],
      }),
      // Assistant reasoning + tool call
      makeAssistantEntry({
        messageId: "msg_a1",
        timestamp: "2026-06-01T10:00:01.000Z",
        content: [
          { type: "thinking", thinking: "I should look at the test first." },
          { type: "text", text: "I'll examine the failing test." },
          { type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: "test.ts" } },
        ],
        usage: { input_tokens: 200, output_tokens: 80, cache_creation_input_tokens: 500, cache_read_input_tokens: 0 },
      }),
      // Tool result (user turn)
      makeUserEntry({
        timestamp: "2026-06-01T10:00:02.000Z",
        content: [
          { type: "tool_result", tool_use_id: "toolu_read", content: "const x = 1;", is_error: false },
        ],
      }),
      // Assistant writes the fix
      makeAssistantEntry({
        messageId: "msg_a2",
        timestamp: "2026-06-01T10:00:03.000Z",
        content: [
          { type: "text", text: "I found the issue. The test expects 2 but got 1." },
        ],
        usage: { input_tokens: 300, output_tokens: 60, cache_creation_input_tokens: 0, cache_read_input_tokens: 500 },
      }),
    ].join("\n");

    const result = parseClaudeCodeSessionJsonl(lines);

    // Usage totals
    expect(result.usage!.inputTokens).toBe(500);
    expect(result.usage!.outputTokens).toBe(140);
    expect(result.usage!.cacheCreationTokens).toBe(500);
    expect(result.usage!.cacheReadTokens).toBe(500);

    // Conversation structure
    const kinds = result.conversation.map((t) => t.kind);
    expect(kinds).toContain("user");
    expect(kinds).toContain("reasoning");
    expect(kinds).toContain("assistant");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("tool_result");

    // Specific turn content
    const toolCall = result.conversation.find((t) => t.kind === "tool_call");
    expect(toolCall?.toolName).toBe("Read");
    expect(toolCall?.toolCallId).toBe("toolu_read");

    const toolResult = result.conversation.find((t) => t.kind === "tool_result");
    expect(toolResult?.toolCallId).toBe("toolu_read");
    expect(toolResult?.toolOutput).toBe("const x = 1;");
  });

  it("ignores non-assistant non-user entry types", () => {
    const lines = [
      JSON.stringify({ type: "mode", mode: "normal", sessionId: "s1" }),
      JSON.stringify({ type: "file-history-snapshot", sessionId: "s1" }),
      JSON.stringify({ type: "permission-mode", permissionMode: "bypassPermissions", sessionId: "s1" }),
      makeAssistantEntry({
        messageId: "msg_x",
        content: [{ type: "text", text: "The actual response." }],
        usage: { input_tokens: 5, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
    ].join("\n");

    const result = parseClaudeCodeSessionJsonl(lines);

    // Only the assistant turn should appear in the conversation.
    expect(result.conversation.filter((t) => t.kind === "assistant")).toHaveLength(1);
    expect(result.usage!.inputTokens).toBe(5);
  });

  it("handles malformed JSON lines gracefully", () => {
    const lines = [
      "not json at all",
      "{broken: json}",
      makeAssistantEntry({
        messageId: "msg_ok",
        content: [{ type: "text", text: "Fine." }],
        usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
      }),
    ].join("\n");

    const result = parseClaudeCodeSessionJsonl(lines);

    expect(result.usage!.inputTokens).toBe(10);
    expect(result.conversation).toHaveLength(1);
  });

  it("parses usage-only assistant records without synthesizing text turns", () => {
    const result = parseClaudeCodeSessionJsonl(JSON.stringify({
      type: "assistant",
      sessionId: "usage-only",
      timestamp: "2026-06-01T10:00:00.000Z",
      message: {
        id: "msg_usage_only",
        role: "assistant",
        content: [],
        usage: {
          input_tokens: 31,
          output_tokens: 11,
          cache_creation_input_tokens: 7,
          cache_read_input_tokens: 5,
        },
      },
    }));

    expect(result.usage).toEqual({
      inputTokens: 31,
      outputTokens: 11,
      cacheCreationTokens: 7,
      cacheReadTokens: 5,
    });
    expect(result.rawUsageJson).toEqual({
      input_tokens: 31,
      output_tokens: 11,
      cache_creation_input_tokens: 7,
      cache_read_input_tokens: 5,
    });
    expect(result.conversation).toEqual([]);
  });

  it("parses legacy bare message content arrays with reasoning and tool calls", () => {
    const result = parseClaudeCodeSessionJsonl(JSON.stringify({
      session_id: "legacy-session",
      timestamp: "2026-06-01T10:00:00.000Z",
      message: {
        id: "legacy_msg",
        role: "assistant",
        usage: { input_tokens: 12, output_tokens: 6, cache_creation_input_tokens: 0, cache_read_input_tokens: 2 },
        content: [
          { type: "thinking", thinking: "Visible legacy reasoning." },
          { type: "text", text: "Legacy answer." },
          { type: "tool_use", id: "toolu_legacy", name: "Bash", input: { command: "pwd" } },
        ],
      },
    }));

    expect(result.nativeSessionId).toBe("legacy-session");
    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 6,
      cacheCreationTokens: 0,
      cacheReadTokens: 2,
    });
    expect(result.conversation.map((turn) => turn.kind)).toEqual(["reasoning", "assistant", "tool_call"]);
    expect(result.conversation[0]).toMatchObject({ kind: "reasoning", text: "Visible legacy reasoning." });
    expect(result.conversation[2]).toMatchObject({ kind: "tool_call", toolName: "Bash", toolCallId: "toolu_legacy" });
  });

  it("replaces updated message usage and legacy content instead of double-counting", () => {
    const result = parseClaudeCodeSessionJsonl([
      JSON.stringify({
        timestamp: "2026-06-01T10:00:00.000Z",
        message: {
          id: "legacy_updated",
          role: "assistant",
          content: [{ type: "text", text: "Partial" }],
          usage: { input_tokens: 10, output_tokens: 2 },
        },
      }),
      JSON.stringify({
        timestamp: "2026-06-01T10:00:01.000Z",
        message: {
          id: "legacy_updated",
          role: "assistant",
          content: [{ type: "text", text: "Complete" }],
          usage: {
            input_tokens: 12,
            output_tokens: 5,
            cache_creation_input_tokens: 3,
            cache_read_input_tokens: 4,
          },
        },
      }),
    ].join("\n"));

    expect(result.usage).toEqual({
      inputTokens: 12,
      outputTokens: 5,
      cacheCreationTokens: 3,
      cacheReadTokens: 4,
    });
    expect(result.conversation).toEqual([
      expect.objectContaining({ kind: "assistant", text: "Complete" }),
    ]);
  });

  it("skips partial JSON and unknown entries while preserving recoverable usage and partial tool results", () => {
    const lines = [
      "{\"type\":\"assistant\",\"sessionId\":\"secret-session\",\"message\":{\"usage\":{\"input_tokens\":999,\"api_key\":\"sk-test-secret\"",
      JSON.stringify({ type: "permission-mode", sessionId: "safe-session", permissionMode: "default" }),
      makeUserEntry({
        sessionId: "safe-session",
        timestamp: "2026-06-01T10:00:01.000Z",
        content: [
          {
            type: "tool_result",
            tool_use_id: "toolu_partial",
            content: [{ type: "text", text: "truncated command output kept" }],
            is_error: true,
          },
        ],
      }),
      makeAssistantEntry({
        sessionId: "safe-session",
        messageId: "msg_missing_tokens",
        timestamp: "2026-06-01T10:00:02.000Z",
        content: [],
        usage: {
          input_tokens: "21",
          output_tokens: -4,
          cache_read_input_tokens: undefined,
        },
      }),
    ].join("\n");

    const result = parseClaudeCodeSessionJsonl(lines);

    expect(result.nativeSessionId).toBe("safe-session");
    expect(result.usage).toEqual({
      inputTokens: 21,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
    });
    expect(result.conversation).toHaveLength(1);
    expect(result.conversation[0]).toMatchObject({
      kind: "tool_result",
      toolCallId: "toolu_partial",
      toolOutput: "truncated command output kept",
      toolStatus: "error",
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });
});

describe("ClaudeCodeLogAccumulator", () => {
  it("parses only appended chunks and reports the changed turn suffix", () => {
    const first = makeUserEntry({ content: "Inspect the project." });
    const second = makeAssistantEntry({
      messageId: "msg_incremental",
      content: [{ type: "text", text: "Inspection complete." }],
    });
    const accumulator = new ClaudeCodeLogAccumulator();

    const partial = accumulator.appendChunk(`${first}\n${second.slice(0, 20)}`, "session-file");
    expect(partial.conversation.map((turn) => turn.text)).toEqual(["Inspect the project."]);

    const completed = accumulator.appendChunk(`${second.slice(20)}\n`, "session-file");
    expect(completed.conversation.map((turn) => turn.text)).toEqual([
      "Inspect the project.",
      "Inspection complete.",
    ]);
    expect(completed.conversationRevision).toBe(2);
    expect(completed.conversationChangedFromIndex).toBe(1);
  });

  it("resets retained state when the transcript source changes", () => {
    const accumulator = new ClaudeCodeLogAccumulator();
    accumulator.appendChunk(`${makeUserEntry({ content: "Old source" })}\n`, "old-source");

    const result = accumulator.appendChunk(
      `${makeUserEntry({ content: "New source" })}\n`,
      "new-source",
    );

    expect(result.conversation.map((turn) => turn.text)).toEqual(["New source"]);
    expect(result.conversationRevision).toBe(1);
  });
});
