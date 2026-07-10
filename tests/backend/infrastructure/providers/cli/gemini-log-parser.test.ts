import { describe, expect, it } from "vitest";
import {
  parseGeminiConversation,
  parseGeminiLog,
  parseGeminiTokens,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/gemini-log-parser.js";

describe("Gemini log parser", () => {
  it("parses direct reported stats and session metadata", () => {
    const result = parseGeminiLog(JSON.stringify({
      response: "Applied the edit.",
      session_id: "gemini-session-1",
      stats: {
        tokens: {
          input: 120,
          cached: 18,
          candidates: 42,
          thoughts: 7,
        },
      },
    }));

    expect(result.usage).toEqual({
      inputTokens: 120,
      cachedInputTokens: 18,
      outputTokens: 42,
      reasoningOutputTokens: 7,
      totalTokens: 187,
    });
    expect(result.rawUsageJson).toEqual({
      tokens: {
        input: 120,
        cached: 18,
        candidates: 42,
        thoughts: 7,
      },
    });
    expect(result.nativeSessionId).toBe("gemini-session-1");
    expect(result.transcriptText).toBe("Applied the edit.");
    expect(result.conversation).toEqual([]);
  });

  it("extracts a valid plain-response record from noisy stdout", () => {
    const result = parseGeminiLog([
      "Starting Gemini CLI...",
      JSON.stringify({ level: "debug", message: "bootstrap complete" }),
      JSON.stringify({
        response: "Applied the edit.",
        session_id: "wrapped-session",
        stats: { tokens: { input: 12, candidates: 4 } },
      }),
      "Container cleanup complete.",
    ].join("\n"));

    expect(result).toMatchObject({
      usage: {
        inputTokens: 12,
        cachedInputTokens: 0,
        outputTokens: 4,
        reasoningOutputTokens: 0,
        totalTokens: 16,
      },
      nativeSessionId: "wrapped-session",
      transcriptText: "Applied the edit.",
      conversation: [],
    });
  });

  it("normalizes standard usage metadata without double-counting cached prompt tokens", () => {
    expect(parseGeminiTokens({
      promptTokenCount: 100,
      cachedContentTokenCount: 20,
      candidatesTokenCount: 30,
      thoughtsTokenCount: 10,
      totalTokenCount: 140,
    })).toEqual({
      inputTokens: 80,
      cachedInputTokens: 20,
      outputTokens: 30,
      reasoningOutputTokens: 10,
      totalTokens: 140,
    });
  });

  it("honors explicit total fields for direct stats", () => {
    expect(parseGeminiTokens({
      tokens: {
        input: 80,
        candidates: 20,
        thoughts: 10,
        total: 140,
      },
    })).toEqual({
      inputTokens: 80,
      cachedInputTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      totalTokens: 140,
    });
  });

  it("aggregates model-level stats and top-level candidates", () => {
    const result = parseGeminiLog(JSON.stringify({
      candidates: [
        {
          content: {
            parts: [
              { text: "Model-level answer." },
            ],
          },
        },
      ],
      stats: {
        models: {
          router: {
            tokens: {
              input: 57,
              cached: 2859,
              candidates: 33,
              thoughts: 123,
            },
          },
          main: {
            tokens: {
              input: 12265,
              cached: 0,
              candidates: 1,
              thoughts: 79,
            },
          },
        },
      },
    }));

    expect(result.usage).toEqual({
      inputTokens: 12322,
      cachedInputTokens: 2859,
      outputTokens: 34,
      reasoningOutputTokens: 202,
      totalTokens: 15417,
    });
    expect(result.transcriptText).toBe("Model-level answer.");
    expect(result.conversation).toEqual([{ kind: "assistant", text: "Model-level answer." }]);
  });

  it("parses visible reasoning and assistant text from response candidates", () => {
    const result = parseGeminiLog(JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { thought: true, text: "I should inspect the change first." },
                { text: "Applied the edit." },
              ],
            },
          },
        ],
      },
    }));

    expect(result.transcriptText).toBe("Applied the edit.");
    expect(result.conversation).toEqual([
      { kind: "reasoning", text: "I should inspect the change first." },
      { kind: "assistant", text: "Applied the edit." },
    ]);
  });

  it("uses response.content.parts as a structured fallback", () => {
    const result = parseGeminiLog(JSON.stringify({
      response: {
        content: {
          parts: [
            { type: "thinking", summary_text: "Check the constraints." },
            { type: "text", text: "Done." },
          ],
        },
      },
    }));

    expect(result.transcriptText).toBe("Done.");
    expect(result.conversation).toEqual([
      { kind: "reasoning", text: "Check the constraints." },
      { kind: "assistant", text: "Done." },
    ]);
  });

  it("does not fabricate reasoning for plain response strings", () => {
    const result = parseGeminiLog(JSON.stringify({
      response: "Applied the edit.",
      stats: {
        tokens: {
          input: 50,
          candidates: 12,
          thoughts: 3,
        },
      },
    }));

    expect(result.transcriptText).toBe("Applied the edit.");
    expect(result.usage?.reasoningOutputTokens).toBe(3);
    expect(result.conversation).toEqual([]);
  });

  it("parses function-call and function-response parts as tool turns", () => {
    const result = parseGeminiLog(JSON.stringify({
      response: {
        candidates: [
          {
            content: {
              parts: [
                { text: "I will inspect the file." },
                { functionCall: { id: "call_1", name: "read_file", args: { path: "README.md" } } },
                { functionResponse: { id: "call_1", name: "read_file", response: { content: "hello" }, status: "completed" } },
                { text: "Done." },
              ],
            },
          },
        ],
      },
    }));

    expect(result.transcriptText).toBe("I will inspect the file.\nDone.");
    expect(result.conversation.map((turn) => turn.kind)).toEqual(["assistant", "tool_call", "tool_result", "assistant"]);
    expect(result.conversation[1]).toMatchObject({
      kind: "tool_call",
      toolName: "read_file",
      toolCallId: "call_1",
      toolArguments: "{\"path\":\"README.md\"}",
    });
    expect(result.conversation[2]).toMatchObject({
      kind: "tool_result",
      toolName: "read_file",
      toolCallId: "call_1",
      toolOutput: "{\"content\":\"hello\"}",
      toolStatus: "completed",
    });
  });

  it("preserves ordered roles, timestamps, per-turn tokens, and tool metadata", () => {
    const result = parseGeminiLog(JSON.stringify({
      request: {
        contents: [{
          role: "user",
          timestamp: "2026-07-10T10:00:00.000Z",
          parts: [{ text: "Inspect README.md" }],
        }],
      },
      response: {
        candidates: [{
          timestamp_ms: 1_752_140_401_000,
          content: {
            role: "model",
            parts: [
              { thought: true, text: "I should read it.", tokens: { reasoning: 3 } },
              { functionCall: { id: "call_1", name: "read_file", args: { path: "README.md" }, status: "running" } },
              { functionResponse: { id: "call_1", name: "read_file", response: "contents", status: "completed" } },
              { text: "The file is current.", usage: { outputTokens: 5, totalTokens: 5 } },
            ],
          },
        }],
        usageMetadata: {
          promptTokenCount: 20,
          cachedContentTokenCount: 4,
          candidatesTokenCount: 8,
          thoughtsTokenCount: 3,
          totalTokenCount: 31,
        },
      },
    }));

    expect(result.usage).toEqual({
      inputTokens: 16,
      cachedInputTokens: 4,
      outputTokens: 8,
      reasoningOutputTokens: 3,
      totalTokens: 31,
    });
    expect(result.conversation.map((turn) => turn.kind)).toEqual([
      "user",
      "reasoning",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result.conversation[0]).toMatchObject({
      text: "Inspect README.md",
      timestampMs: Date.parse("2026-07-10T10:00:00.000Z"),
    });
    expect(result.conversation[1]).toMatchObject({ tokens: { reasoning: 3 }, timestampMs: 1_752_140_401_000 });
    expect(result.conversation[2]).toMatchObject({
      toolName: "read_file",
      toolCallId: "call_1",
      toolStatus: "running",
      timestampMs: 1_752_140_401_000,
    });
    expect(result.conversation[3]).toMatchObject({ toolStatus: "completed" });
    expect(result.conversation[4]).toMatchObject({ tokens: { output: 5, total: 5 } });
  });

  it("keeps structured conversation when usage is missing", () => {
    const result = parseGeminiLog(JSON.stringify({
      candidates: [{ content: { role: "model", parts: [{ text: "No stats available." }] } }],
    }));

    expect(result.usage).toBeNull();
    expect(result.rawUsageJson).toBeNull();
    expect(result.transcriptText).toBe("No stats available.");
    expect(result.conversation).toEqual([{ kind: "assistant", text: "No stats available." }]);
  });

  it("returns empty structured data for noisy or invalid stdout", () => {
    expect(parseGeminiLog("provider warning\nnot json")).toEqual({
      usage: null,
      rawUsageJson: null,
      nativeSessionId: null,
      transcriptText: "",
      conversation: [],
    });
    expect(parseGeminiLog("{\"response\":{\"candidates\":[")).toMatchObject({
      usage: null,
      transcriptText: "",
      conversation: [],
    });
    expect(parseGeminiLog("[1,2,3]")).toEqual({
      usage: null,
      rawUsageJson: null,
      nativeSessionId: null,
      transcriptText: "",
      conversation: [],
    });
  });

  it("skips malformed or partial parts without throwing", () => {
    expect(parseGeminiConversation({
      response: {
        candidates: [
          {
            content: {
              parts: [
                null,
                "not an object",
                { thought: true },
                { functionCall: "not an object" },
                { text: "Recoverable text." },
              ],
            },
          },
        ],
      },
    })).toEqual([{ kind: "assistant", text: "Recoverable text." }]);
  });
});
