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
