import { describe, it, expect } from "vitest";
import { parseOpenCodeJsonLines, parseOpenCodeExport, subtractOpenCodeBaseline } from "../../../../../src/infrastructure/providers/cli/provider-logs/opencode-log-parser.js";

/** Builds an `opencode run --format json` NDJSON stream from flattened events. */
function ndjson(events: Array<Record<string, unknown>>): string {
  return events.map((e) => JSON.stringify(e)).join("\n") + "\n";
}

describe("parseOpenCodeJsonLines", () => {
  it("returns null when there are no JSON events", () => {
    expect(parseOpenCodeJsonLines("")).toBeNull();
    expect(parseOpenCodeJsonLines("not json\n\n  ")).toBeNull();
  });

  it("extracts reported usage from step-finish parts (input/output/reasoning/cache)", () => {
    const stream = ndjson([
      { type: "reasoning", part: { type: "reasoning", sessionID: "ses_abc123", text: "thinking about it" } },
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
    expect(result).not.toBeNull();
    expect(result!.inputTokens).toBe(1500);
    expect(result!.outputTokens).toBe(42);
    expect(result!.reasoningOutputTokens).toBe(8);
    expect(result!.cachedInputTokens).toBe(1200);
    expect(result!.cost).toBeCloseTo(0.0123);
    expect(result!.nativeSessionId).toBe("ses_abc123");
    expect(result!.transcriptText).toBe("PONG");
    expect(result!.rawUsageJson).toEqual({
      tokens: { input: 1500, output: 42, reasoning: 8, cache: { read: 1200, write: 300 } },
      cost: 0.0123,
    });
    expect(result!.conversation.map((t) => t.kind)).toEqual(["reasoning", "assistant"]);
  });

  it("sums usage across multiple step-finish parts (one per LLM call)", () => {
    const stream = ndjson([
      { type: "step-finish", part: { type: "step-finish", cost: 0.01, tokens: { input: 1000, output: 20, reasoning: 0, cache: { read: 0, write: 0 } } } },
      { type: "step-finish", part: { type: "step-finish", cost: 0.02, tokens: { input: 500, output: 30, reasoning: 5, cache: { read: 100, write: 0 } } } },
    ]);

    const result = parseOpenCodeJsonLines(stream)!;
    expect(result.inputTokens).toBe(1500);
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
    expect(result.inputTokens).toBe(100);
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
    expect(usage.inputTokens).toBe(88608);
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
    expect(usage.inputTokens).toBe(88608);
    expect(usage.outputTokens).toBe(10284);
  });

  it("returns null when the export carries no usable token counts", () => {
    const empty = JSON.stringify({ info: { tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } } }, messages: [] });
    expect(parseOpenCodeExport(empty)).toBeNull();
  });
});

describe("subtractOpenCodeBaseline", () => {
  it("returns the usage unchanged when there is no baseline", () => {
    const current = {
      inputTokens: 88608, cachedInputTokens: 1200, outputTokens: 10284, reasoningOutputTokens: 490,
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
      inputTokens: 88608,
      cachedInputTokens: 1200,
      outputTokens: 10284,
      reasoningOutputTokens: 490,
      cost: 0.42,
      rawUsageJson: { tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } }, cost: 0.42 },
    };

    const result = subtractOpenCodeBaseline(current, baseline);

    expect(result.inputTokens).toBe(38608);
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
      inputTokens: 88608, cachedInputTokens: 1200, outputTokens: 10284, reasoningOutputTokens: 490,
      cost: 0.42, rawUsageJson: null,
    };

    const result = subtractOpenCodeBaseline(current, baseline);

    expect(result).toMatchObject({
      inputTokens: 0, cachedInputTokens: 0, outputTokens: 0, reasoningOutputTokens: 0, cost: 0,
    });
  });
});
