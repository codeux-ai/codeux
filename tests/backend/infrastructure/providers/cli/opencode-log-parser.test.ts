import { describe, it, expect } from "vitest";
import { parseOpenCodeJsonLines, parseOpenCodeExport, subtractOpenCodeBaseline } from "../../../../../src/infrastructure/providers/cli/provider-logs/opencode-log-parser.js";

/** Builds an `opencode run --format json` NDJSON stream from flattened events. */
function ndjson(events: Array<Record<string, unknown>>): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("parseOpenCodeJsonLines", () => {
  it("returns normalized empty output when there are no JSON events", () => {
    expect(parseOpenCodeJsonLines("")).toEqual({
      usage: null,
      transcriptText: "",
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cost: 0,
      nativeSessionId: null,
      rawUsageJson: null,
      conversation: [],
    });
    expect(parseOpenCodeJsonLines("not json\n\n  ").conversation).toEqual([]);
  });

  it("extracts reported usage from step-finish parts (input/output/reasoning/cache)", () => {
    const stream = ndjson([
      { type: "reasoning", part: { type: "reasoning", sessionID: "ses_abc123", summary: [{ text: "thinking about it" }] } },
      { type: "text", part: { type: "text", sessionID: "ses_abc123", text: "PONG" } },
      {
        type: "step-finish",
        part: {
          type: "step-finish",
          sessionID: "ses_abc123",
          cost: 0.0123,
          tokens: { input: 1500, output: 42, reasoning: 8, cache: { read: 1200, write: 300 } },
        },
      },
    ]);

    const result = parseOpenCodeJsonLines(stream);
    expect(result.inputTokens).toBe(300);
    expect(result.outputTokens).toBe(42);
    expect(result.reasoningOutputTokens).toBe(8);
    expect(result.cachedInputTokens).toBe(1200);
    expect(result.usage).toEqual({
      inputTokens: 300,
      cachedInputTokens: 1200,
      outputTokens: 42,
      reasoningOutputTokens: 8,
      cost: 0.0123,
    });
    expect(result.cost).toBeCloseTo(0.0123);
    expect(result.nativeSessionId).toBe("ses_abc123");
    expect(result.transcriptText).toBe("PONG");
    expect(result.rawUsageJson).toEqual({
      tokens: { input: 1500, output: 42, reasoning: 8, cache: { read: 1200, write: 300 } },
      cost: 0.0123,
    });
    expect(result.conversation.map((t) => t.kind)).toEqual(["reasoning", "assistant"]);
  });

  it("parses current native streaming envelopes for session, text, reasoning, tools, and top-level step usage", () => {
    const stream = ndjson([
      {
        type: "event",
        event: {
          type: "session.created",
          properties: {
            session: { id: "ses_native1" },
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_reason",
            type: "reasoning",
            content: [{ type: "summary_text", text: "Need the current files." }],
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_text",
            type: "text",
            content: [{ text: "Initial response" }],
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            id: "part_text",
            type: "text",
            content: [{ text: "Final response" }],
          },
        },
      },
      {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            toolName: "shell",
            callId: "call-native",
            status: "completed",
            input: { command: "pnpm test" },
            result: "ok",
          },
        },
      },
      {
        type: "step_finish",
        usage: {
          promptTokens: 120,
          completionTokens: 30,
          reasoningTokens: 4,
          cachedInputTokens: 20,
        },
        cost: 0.05,
      },
    ]);

    const result = parseOpenCodeJsonLines(stream);

    expect(result.nativeSessionId).toBe("ses_native1");
    expect(result.transcriptText).toBe("Final response");
    expect(result.inputTokens).toBe(100);
    expect(result.cachedInputTokens).toBe(20);
    expect(result.outputTokens).toBe(30);
    expect(result.reasoningOutputTokens).toBe(4);
    expect(result.cost).toBeCloseTo(0.05);
    expect(result.conversation.map((turn) => turn.kind)).toEqual(["reasoning", "assistant", "tool_call"]);
    expect(result.conversation[1]).toMatchObject({ kind: "assistant", text: "Final response" });
    expect(result.conversation[2]).toMatchObject({
      kind: "tool_call",
      toolName: "shell",
      toolCallId: "call-native",
      toolArguments: JSON.stringify({ command: "pnpm test" }),
      toolOutput: "ok",
      toolStatus: "completed",
    });
  });

  it("skips malformed JSON lines and preserves partial records", () => {
    const stream = [
      "{\"type\":\"text\",",
      JSON.stringify({ type: "text", part: { type: "text", text: "partial transcript" } }),
    ].join("\n");

    const result = parseOpenCodeJsonLines(stream);
    expect(result.usage).toBeNull();
    expect(result.rawUsageJson).toBeNull();
    expect(result.conversation).toEqual([{ kind: "assistant", text: "partial transcript" }]);
    expect(result.transcriptText).toBe("partial transcript");
  });

  it("extracts visible reasoning from OpenCode reasoning parts that use summary fields", () => {
    const stream = ndjson([
      { type: "reasoning", part: { type: "reasoning", sessionID: "ses_reason", summary: [{ type: "summary_text", text: "I should inspect the logs first." }] } },
      { type: "text", part: { type: "text", sessionID: "ses_reason", text: "I found the issue." } },
    ]);

    const result = parseOpenCodeJsonLines(stream)!;
    expect(result.conversation.map((t) => t.kind)).toEqual(["reasoning", "assistant"]);
    expect(result.conversation[0]).toMatchObject({ kind: "reasoning", text: "I should inspect the logs first." });
  });

  it("sums usage across multiple step-finish parts (one per LLM call)", () => {
    const stream = ndjson([
      { type: "step-finish", part: { type: "step-finish", cost: 0.01, tokens: { input: 1000, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } } },
      { type: "step-finish", part: { type: "step-finish", cost: 0.02, tokens: { input: 500, output: 30, reasoning: 5, cache: { read: 100, write: 0 } } } },
    ]);

    const result = parseOpenCodeJsonLines(stream)!;
    expect(result.inputTokens).toBe(1400);
    expect(result.outputTokens).toBe(50);
    expect(result.reasoningOutputTokens).toBe(5);
    expect(result.cachedInputTokens).toBe(100);
    expect(result.cost).toBeCloseTo(0.03);
  });

  it("collapses streaming tool parts into one tool_call per callID", () => {
    const stream = ndjson([
      { type: "tool", part: { type: "tool", tool: "bash", callID: "call_1", state: { status: "pending", input: { command: "ls" } } } },
      { type: "tool", part: { type: "tool", tool: "bash", callID: "call_1", state: { status: "completed", input: { command: "ls" }, output: "file.txt" } } },
      { type: "text", part: { type: "text", text: "done" } },
    ]);

    const result = parseOpenCodeJsonLines(stream)!;
    const toolCalls = result.conversation.filter((t) => t.kind === "tool_call");
    expect(toolCalls).toHaveLength(1);
    expect(toolCalls[0].toolName).toBe("bash");
    expect(toolCalls[0].toolStatus).toBe("completed");
    expect(toolCalls[0].toolOutput).toBe("file.txt");
  });

  it("falls back to assistant-message usage when no step-finish parts are present", () => {
    const stream = ndjson([
      { type: "text", part: { type: "text", text: "hi" } },
      // message.updated streams the same message id repeatedly; keep the latest.
      { type: "message.updated", properties: { info: { id: "msg_1", role: "assistant", sessionID: "ses_z9", tokens: { input: 100, output: 5, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.001 } } },
      { type: "message.updated", properties: { info: { id: "msg_1", role: "assistant", sessionID: "ses_z9", tokens: { input: 100, output: 11, reasoning: 2, cache: { read: 40, write: 0 } }, cost: 0.004 } } },
    ]);

    const result = parseOpenCodeJsonLines(stream)!;
    expect(result.inputTokens).toBe(60);
    expect(result.outputTokens).toBe(11);
    expect(result.reasoningOutputTokens).toBe(2);
    expect(result.cachedInputTokens).toBe(40);
    expect(result.cost).toBeCloseTo(0.004);
    expect(result.nativeSessionId).toBe("ses_z9");
  });

  it("reports no usage (null rawUsageJson) when the stream carries none", () => {
    const stream = ndjson([
      { type: "text", part: { type: "text", text: "PONG" } },
    ]);
    const result = parseOpenCodeJsonLines(stream)!;
    expect(result.usage).toBeNull();
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.rawUsageJson).toBeNull();
    expect(result.transcriptText).toBe("PONG");
  });

  it("also accepts the nested bus-event shape (properties.part)", () => {
    const stream = ndjson([
      { type: "message.part.updated", properties: { part: { type: "step-finish", sessionID: "ses_nested", tokens: { input: 7, output: 3, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0 } } },
    ]);
    const result = parseOpenCodeJsonLines(stream)!;
    expect(result.inputTokens).toBe(7);
    expect(result.outputTokens).toBe(3);
    expect(result.nativeSessionId).toBe("ses_nested");
  });

  it("skips partial and unknown stream events while preserving recoverable terminal records", () => {
    const stream = [
      "{\"type\":\"step-finish\",\"part\":{\"tokens\":{\"input\":999},\"api_key\":\"sk-test-secret\"",
      JSON.stringify({ type: "session.idle", properties: { sessionID: "session_unknown" } }),
      JSON.stringify({ type: "text", part: { type: "text", sessionID: "ses_recover", text: "final text" } }),
      JSON.stringify({
        type: "tool",
        part: {
          type: "tool",
          sessionID: "ses_recover",
          tool: "bash",
          callID: "call_partial",
          state: { status: "failed", output: "command failed before input was logged" },
        },
      }),
      JSON.stringify({
        type: "step-finish",
        part: {
          type: "step-finish",
          sessionID: "ses_recover",
          tokens: { input: "30", output: -4, cache: { read: 5 } },
          cost: -0.5,
        },
      }),
    ].join("\n");

    const result = parseOpenCodeJsonLines(stream);

    expect(result.nativeSessionId).toBe("ses_recover");
    expect(result.usage).toEqual({
      inputTokens: 25,
      cachedInputTokens: 5,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      cost: 0,
    });
    expect(result.transcriptText).toBe("final text");
    expect(result.conversation.find((turn) => turn.kind === "tool_call")).toMatchObject({
      toolName: "bash",
      toolCallId: "call_partial",
      toolOutput: "command failed before input was logged",
      toolStatus: "failed",
    });
    expect(JSON.stringify(result)).not.toContain("sk-test-secret");
  });
});

describe("parseOpenCodeExport", () => {
  // Mirrors the real `opencode export <sessionID>` output: top-level
  // `info.tokens` holds the session-cumulative usage.
  const realExport = JSON.stringify({
    info: {
      id: "ses_18e9b7f04ffenTE6uMGfRIz12H",
      title: "Greeting",
      model: { id: "gemma-4-26b-a4b-qat", providerID: "google" },
      cost: 0.42,
      tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } },
    },
    messages: [
      { info: { role: "user" }, parts: [] },
      { info: { role: "assistant", tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } } }, parts: [] },
    ],
  });

  it("returns null for empty or non-JSON input", () => {
    expect(parseOpenCodeExport("")).toBeNull();
    expect(parseOpenCodeExport("no json here")).toBeNull();
  });

  it("reads session-cumulative usage from info.tokens", () => {
    const usage = parseOpenCodeExport(realExport)!;
    expect(usage.inputTokens).toBe(87408);
    expect(usage.outputTokens).toBe(10284);
    expect(usage.reasoningOutputTokens).toBe(490);
    expect(usage.cachedInputTokens).toBe(1200);
    expect(usage.cost).toBeCloseTo(0.42);
    expect(usage.rawUsageJson).toEqual({
      tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } },
      cost: 0.42,
    });
  });

  it("tolerates incidental wrapper output around the JSON object", () => {
    const noisy = `provider-runner: warning: something\n${realExport}\n`;
    const usage = parseOpenCodeExport(noisy)!;
    expect(usage.inputTokens).toBe(87408);
    expect(usage.outputTokens).toBe(10284);
  });

  it("returns null when the export carries no usable token counts", () => {
    const empty = JSON.stringify({ info: { tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, messages: [] });
    expect(parseOpenCodeExport(empty)).toBeNull();
  });

  it("returns null for truncated exports without leaking raw fragments", () => {
    const usage = parseOpenCodeExport("prefix {\"info\":{\"tokens\":{\"input\":99},\"api_key\":\"sk-test-secret\"");
    expect(usage).toBeNull();
  });

  it("extracts usage from nested current export payloads wrapped in noisy stdout", () => {
    const noisy = [
      "bootstrap log line",
      JSON.stringify({
        data: {
          session: {
            id: "ses_nested_export",
            cost: 0.09,
            tokens: {
              input: 700,
              output: 80,
              reasoning: 12,
              cache: { read: 200, write: 10 },
            },
          },
        },
      }),
    ].join("\n");

    const usage = parseOpenCodeExport(noisy)!;
    expect(usage).toEqual({
      inputTokens: 500,
      cachedInputTokens: 200,
      outputTokens: 80,
      reasoningOutputTokens: 12,
      cost: 0.09,
      rawUsageJson: {
        tokens: { input: 700, output: 80, reasoning: 12, cache: { read: 200, write: 10 } },
        cost: 0.09,
      },
    });
  });
});

describe("subtractOpenCodeBaseline", () => {
  it("returns the usage unchanged when there is no baseline", () => {
    const current = {
      inputTokens: 87408, cachedInputTokens: 1200, outputTokens: 10284, reasoningOutputTokens: 490,
      cost: 0.42, rawUsageJson: { tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } }, cost: 0.42 },
    };
    expect(subtractOpenCodeBaseline(current, null)).toEqual(current);
    expect(subtractOpenCodeBaseline(current, undefined)).toEqual(current);
    expect(subtractOpenCodeBaseline(current, {})).toEqual(current);
  });

  it("isolates a follow-up run's own tokens from the session-cumulative export", () => {
    // A prior invocation on this same opencode session already persisted this
    // snapshot as its raw usage.
    const baseline = {
      tokens: { input: 50000, output: 6000, reasoning: 200, cache: { read: 800, write: 0 } },
      cost: 0.20,
    };
    // The follow-up run resumes the session; `opencode export` now reports the
    // whole session's cumulative total, including the baseline above.
    const current = {
      inputTokens: 87408,
      cachedInputTokens: 1200,
      outputTokens: 10284,
      reasoningOutputTokens: 490,
      cost: 0.42,
      rawUsageJson: { tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } }, cost: 0.42 },
    };

    const result = subtractOpenCodeBaseline(current, baseline);

    expect(result.inputTokens).toBe(38208);
    expect(result.cachedInputTokens).toBe(400);
    expect(result.outputTokens).toBe(4284);
    expect(result.reasoningOutputTokens).toBe(290);
    expect(result.cost).toBeCloseTo(0.22);
    // rawUsageJson stays the fresh, unadjusted snapshot so it can serve as the
    // baseline for a subsequent follow-up.
    expect(result.rawUsageJson).toEqual(current.rawUsageJson);
  });

  it("never returns negative deltas even if the baseline is inconsistent", () => {
    const baseline = { tokens: { input: 90000, output: 11000, reasoning: 500, cache: { read: 1300, write: 0 } }, cost: 0.5 };
    const current = {
      inputTokens: 87408, cachedInputTokens: 1200, outputTokens: 10284, reasoningOutputTokens: 490,
      cost: 0.42, rawUsageJson: null,
    };

    const result = subtractOpenCodeBaseline(current, baseline);

    expect(result).toMatchObject({
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, cost: 0,
    });
  });

  it("subtracts baseline snapshots that use OpenAI-style token aliases", () => {
    const current = {
      inputTokens: 250,
      cachedInputTokens: 50,
      outputTokens: 90,
      reasoningOutputTokens: 10,
      cost: 0.12,
      rawUsageJson: { tokens: { input: 300, output: 90, reasoning: 10, cache: { read: 50, write: 0 } }, cost: 0.12 },
    };
    const baseline = {
      tokens: {
        promptTokens: 120,
        completionTokens: 40,
        reasoningTokens: 3,
        cachedInputTokens: 20,
      },
      cost: 0.05,
    };

    const result = subtractOpenCodeBaseline(current, baseline);

    expect(result.inputTokens).toBe(150);
    expect(result.cachedInputTokens).toBe(30);
    expect(result.outputTokens).toBe(50);
    expect(result.reasoningOutputTokens).toBe(7);
    expect(result.cost).toBeCloseTo(0.07);
    expect(result.rawUsageJson).toEqual(current.rawUsageJson);
  });
});
