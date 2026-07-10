import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildQwenConversation,
  extractQwenUsageRecord,
  parseQwenOpenAiLogs,
  readQwenOpenAiLogRecords,
  sumQwenOpenAiUsage,
  turnsFromOpenAiMessage,
} from "../../../../../src/infrastructure/providers/cli/provider-logs/qwen-log-parser.js";

describe("qwen-code OpenAI log parser", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
    tempDirs.length = 0;
  });

  it("returns null when a record has no usage fields", () => {
    expect(extractQwenUsageRecord({ response: { choices: [] } })).toBeNull();
    expect(sumQwenOpenAiUsage([{ response: { choices: [] } }])).toBeNull();
  });

  it("deduplicates repeated usage records with the same response id", () => {
    const records = [
      { response: { id: "resp_dup", usage: { prompt_tokens: 10, completion_tokens: 2 } } },
      { response: { id: "resp_dup", usage: { prompt_tokens: 10, completion_tokens: 2 } } },
      { response: { id: "resp_next", usage: { input_tokens: 4, output_tokens: 1 } } },
    ];

    expect(sumQwenOpenAiUsage(records)).toEqual({
      inputTokens: 14,
      cachedInputTokens: 0,
      outputTokens: 3,
      reasoningOutputTokens: 0,
    });
  });

  it("returns an empty conversation for empty or malformed record lists", () => {
    expect(buildQwenConversation([])).toEqual([]);
    expect(buildQwenConversation([{ response: { usage: { prompt_tokens: 10, completion_tokens: 2 } } }])).toEqual([]);
  });

  it("keeps usage-only records as null conversation and reported usage", () => {
    const records = [{ response: { usage: { prompt_tokens: 10, completion_tokens: 2 } } }];

    expect(sumQwenOpenAiUsage(records)).toEqual({
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 2,
      reasoningOutputTokens: 0,
    });
    expect(buildQwenConversation(records)).toEqual([]);
  });

  it("extracts usage from response bodies and Anthropic-shaped fields", () => {
    expect(extractQwenUsageRecord({
      response: {
        body: {
          usage: {
            input_tokens: 100,
            output_tokens: 25,
            cache_read_input_tokens: 10,
            cache_creation_input_tokens: 5,
            reasoning_output_tokens: 3,
          },
        },
      },
    })).toEqual({
      inputTokens: 100,
      cachedInputTokens: 15,
      outputTokens: 25,
      reasoningOutputTokens: 3,
    });
  });

  it("reads valid provider payloads from noisy log files and skips malformed files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-log-parser-"));
    tempDirs.push(dir);
    const now = Date.now();

    await fs.writeFile(
      path.join(dir, "valid.json"),
      `provider bootstrap output\n${JSON.stringify({
        timestamp: "2026-07-03T00:00:00.000Z",
        response: {
          usage: {
            prompt_tokens: 11,
            completion_tokens: 7,
            prompt_tokens_details: { cached_tokens: 3 },
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        },
      })}\n`,
    );
    await fs.writeFile(path.join(dir, "malformed.json"), "provider bootstrap output\n{\"response\":{\"usage\":");
    await fs.utimes(path.join(dir, "valid.json"), now / 1000, now / 1000);
    await fs.utimes(path.join(dir, "malformed.json"), now / 1000, now / 1000);

    const records = await readQwenOpenAiLogRecords(dir, now - 1000);
    const usage = sumQwenOpenAiUsage(records);

    expect(records).toHaveLength(1);
    expect(usage).toEqual({
      inputTokens: 8,
      cachedInputTokens: 3,
      outputTokens: 7,
      reasoningOutputTokens: 2,
    });
  });

  it("returns null usage for empty directories and malformed-only files", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-log-parser-empty-"));
    tempDirs.push(dir);
    const now = Date.now();
    await fs.writeFile(path.join(dir, "malformed.json"), "{\"response\":{\"usage\":");
    await fs.utimes(path.join(dir, "malformed.json"), now / 1000, now / 1000);

    expect(await readQwenOpenAiLogRecords(dir, now - 1000)).toEqual([]);
    expect(await parseQwenOpenAiLogs(dir, now - 1000)).toBeNull();
  });

  it("skips partial log files and aggregates recoverable records with missing token fields", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qwen-log-parser-partial-"));
    tempDirs.push(dir);
    const now = Date.now();

    await fs.writeFile(path.join(dir, "partial.json"), "{\"api_key\":\"sk-test-secret\",\"response\":{\"usage\":{\"prompt_tokens\":999");
    await fs.writeFile(path.join(dir, "unknown-event.json"), JSON.stringify({
      timestamp: "2026-07-03T00:00:01.000Z",
      event: "provider.debug",
      response: {
        usage: {
          prompt_tokens: "40",
          total_tokens: 55,
          completion_tokens: -2,
        },
      },
    }));
    await fs.writeFile(path.join(dir, "conversation.json"), JSON.stringify({
      timestamp: "2026-07-03T00:00:02.000Z",
      request: {
        messages: [
          { role: "system", content: "internal setup" },
          { role: "user", content: "Please continue" },
          { role: "assistant", content: "", tool_calls: [{ id: "call_1", function: { name: "shell", arguments: "{\"cmd\":\"test\"}" } }] },
          { role: "tool", tool_call_id: "call_1", content: "partial output" },
        ],
      },
      response: {
        usage: { prompt_tokens: 10, completion_tokens: 3 },
        choices: [{ message: { role: "assistant", content: "Done" } }],
      },
    }));
    await Promise.all(["partial.json", "unknown-event.json", "conversation.json"].map((file) => (
      fs.utimes(path.join(dir, file), now / 1000, now / 1000)
    )));

    const records = await readQwenOpenAiLogRecords(dir, now - 1000);
    const usage = sumQwenOpenAiUsage(records);
    const conversation = buildQwenConversation(records);

    expect(records).toHaveLength(2);
    expect(usage).toEqual({
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 18,
      reasoningOutputTokens: 0,
    });
    expect(conversation.map((turn) => turn.kind)).toEqual(["user", "tool_call", "tool_result", "assistant"]);
    expect(conversation.find((turn) => turn.kind === "tool_result")).toMatchObject({
      toolCallId: "call_1",
      toolOutput: "partial output",
    });
    expect(JSON.stringify(records)).not.toContain("sk-test-secret");
  });

  it("builds conversation from request history plus response across OpenAI-compatible shapes", () => {
    const records = [
      {
        timestamp: "2026-07-03T00:00:00.000Z",
        request: { messages: [{ role: "user", content: "Inspect the project." }] },
        response: {
          id: "resp_step_1",
          usage: {
            prompt_tokens: 30,
            completion_tokens: 8,
            completion_tokens_details: { reasoning_tokens: 4 },
          },
          choices: [{
            message: {
              role: "assistant",
              content: [{ type: "text", text: "" }],
              reasoning: [{ summary_text: "Need to read package metadata." }],
              tool_calls: [{ id: "call_read", function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" } }],
            },
          }],
        },
      },
      {
        timestamp: "2026-07-03T00:00:02.000Z",
        request: {
          history: [
            {
              role: "user",
              content: [
                { type: "text", text: "<system-reminder>Injected registry</system-reminder>\n" },
                { type: "text", text: "Inspect the project." },
              ],
            },
            {
              role: "assistant",
              content: "",
              tool_calls: [{ id: "call_read", function: { name: "read_file", arguments: "{\"path\":\"package.json\"}" } }],
            },
            { role: "tool", tool_call_id: "call_read", content: [{ type: "text", text: "{\"name\":\"demo\"}" }] },
          ],
        },
        response: {
          id: "resp_final",
          usage: {
            prompt_tokens: 50,
            completion_tokens: 12,
            total_tokens: 62,
            completion_tokens_details: { reasoning_tokens: 2 },
          },
          message: {
            role: "assistant",
            reasoning_content: { text: "The package metadata is enough." },
            content: [{ type: "output_text", text: "Project inspected." }],
          },
        },
      },
    ];

    const conversation = buildQwenConversation(records);

    expect(conversation.map((turn) => turn.kind)).toEqual([
      "injected_context",
      "user",
      "reasoning",
      "tool_call",
      "tool_result",
      "reasoning",
      "assistant",
    ]);
    expect(conversation[0]).toMatchObject({ kind: "injected_context", text: "<system-reminder>Injected registry</system-reminder>" });
    expect(conversation[1]).toMatchObject({ kind: "user", text: "Inspect the project." });
    expect(conversation[2]).toMatchObject({ kind: "reasoning", text: "Need to read package metadata." });
    expect(conversation[3]).toMatchObject({
      kind: "tool_call",
      toolName: "read_file",
      toolCallId: "call_read",
      toolArguments: "{\"path\":\"package.json\"}",
      tokens: { input: 30, output: 8, reasoning: 4 },
    });
    expect(conversation[4]).toMatchObject({ kind: "tool_result", toolCallId: "call_read", toolOutput: "{\"name\":\"demo\"}" });
    expect(conversation[6]).toMatchObject({
      kind: "assistant",
      text: "Project inspected.",
      tokens: { input: 50, output: 12, reasoning: 2, total: 62 },
    });
  });

  it("filters usage and conversation records outside the invocation window", () => {
    const records = [
      {
        timestamp: "2026-07-03T00:00:00.000Z",
        request: { messages: [{ role: "user", content: "Old prompt" }] },
        response: {
          id: "old",
          usage: { prompt_tokens: 100, completion_tokens: 20 },
          choices: [{ message: { role: "assistant", content: "Old answer" } }],
        },
      },
      {
        timestamp: "2026-07-03T00:01:00.000Z",
        request: { messages: [{ role: "user", content: "New prompt" }] },
        response: {
          id: "new",
          usage: { prompt_tokens: 10, completion_tokens: 2 },
          choices: [{ message: { role: "assistant", content: "New answer" } }],
        },
      },
    ];
    const sinceMs = Date.parse("2026-07-03T00:00:59.000Z");

    expect(sumQwenOpenAiUsage(records, sinceMs)).toEqual({
      inputTokens: 10,
      cachedInputTokens: 0,
      outputTokens: 2,
      reasoningOutputTokens: 0,
    });
    expect(buildQwenConversation(records, sinceMs).map((turn) => turn.text)).toEqual(["New prompt", "New answer"]);
  });

  it("maps standalone OpenAI function call and result messages into tool turns", () => {
    expect(turnsFromOpenAiMessage({
      role: "assistant",
      content: "",
      function_call: { name: "search", arguments: "{\"q\":\"tests\"}" },
    })).toEqual([
      expect.objectContaining({
        kind: "tool_call",
        toolName: "search",
        toolArguments: "{\"q\":\"tests\"}",
      }),
    ]);
    expect(turnsFromOpenAiMessage({ role: "function", name: "search", content: "result text" })).toEqual([
      expect.objectContaining({
        kind: "tool_result",
        toolName: "search",
        toolOutput: "result text",
      }),
    ]);
  });
});
