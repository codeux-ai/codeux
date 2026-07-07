import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  collectProviderUsageTelemetry,
  codexTokenEstimationCacheTestHooks,
  parseQwenOpenAiLogs,
  sumQwenOpenAiUsage,
  extractQwenUsageRecord,
  buildQwenConversation,
} from "../../../../../src/infrastructure/providers/cli/provider-usage.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;
const originalUserProfile = process.env.USERPROFILE;

afterEach(async () => {
  process.env.HOME = originalHome;
  process.env.USERPROFILE = originalUserProfile;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("collectProviderUsageTelemetry", () => {
  beforeEach(() => {
    process.env.HOME = originalHome;
    process.env.USERPROFILE = originalUserProfile;
    codexTokenEstimationCacheTestHooks.reset();
  });

  it("parses provider-reported Gemini token usage", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "gemini-2.5-pro",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
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
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 18,
      outputTokens: 42,
      reasoningOutputTokens: 7,
      totalTokens: 187,
      usageSource: "reported",
      transcriptText: "Applied the edit.",
      nativeSessionId: "gemini-session-1",
    });
  });

  it("parses provider-reported Gemini token usage with explicit total field", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "gemini-2.5-pro",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        response: "Applied the edit.",
        stats: {
          tokens: {
            input: 80,
            candidates: 20,
            thoughts: 10,
            total: 140,
          },
        },
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      totalTokens: 140,
      usageSource: "reported",
      transcriptText: "Applied the edit.",
    });
  });

  it("extracts Gemini reasoning turns only from structured transcript parts", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "gemini-2.5-pro",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
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
        stats: {
          tokens: {
            input: 90,
            cached: 10,
            candidates: 20,
            thoughts: 4,
          },
        },
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 90,
      cachedInputTokens: 10,
      outputTokens: 20,
      reasoningOutputTokens: 4,
      totalTokens: 124,
      usageSource: "reported",
      transcriptText: "Applied the edit.",
    });
    expect(result.conversation.map((t) => t.kind)).toEqual(["reasoning", "assistant"]);
    expect(result.conversation[0]).toMatchObject({ kind: "reasoning", text: "I should inspect the change first." });
  });

  it("does not synthesize Gemini reasoning turns from a plain response string", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "gemini-2.5-pro",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        response: "Applied the edit.",
        stats: {
          tokens: {
            input: 50,
            cached: 0,
            candidates: 12,
            thoughts: 3,
          },
        },
      }),
      stderr: "",
    });

    expect(result.conversation).toEqual([]);
    expect(result.reasoningOutputTokens).toBe(3);
  });

  it("parses provider-reported Gemini usage across model stats", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "default",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        response: "ok",
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
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 12322,
      cachedInputTokens: 2859,
      outputTokens: 34,
      reasoningOutputTokens: 202,
      totalTokens: 15417,
      usageSource: "reported",
      transcriptText: "ok",
    });
  });

  it("estimates Gemini token usage when structured stats are unavailable", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "default",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: "Applied the edit without JSON stats.",
      stderr: "",
    });

    expect(result).toMatchObject({
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      usageSource: "estimated",
      transcriptText: "Applied the edit without JSON stats.",
    });
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.inputTokens + result.outputTokens);
  });

  it("parses provider-reported Codex token usage from JSONL output", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-5.3-codex",
      prompt: "Fix the failing test.",
      cwd: "/workspace/repo",
      stdout: [
        JSON.stringify({ type: "status", payload: { type: "status", message: "running" } }),
        JSON.stringify({
          type: "token_count",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 210,
                cached_input_tokens: 35,
                output_tokens: 84,
                reasoning_output_tokens: 16,
                total_tokens: 345,
              },
            },
          },
        }),
      ].join("\n"),
      stderr: "",
      capturedText: "Updated the implementation and tests.",
    });

    expect(result).toMatchObject({
      inputTokens: 175,
      cachedInputTokens: 35,
      outputTokens: 84,
      reasoningOutputTokens: 16,
      totalTokens: 294,
      usageSource: "reported",
      transcriptText: "Updated the implementation and tests.",
    });
  });

  it("falls back to estimated Codex tokens when JSONL usage is unavailable", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-5.3-codex",
      prompt: "Refactor the helper.",
      cwd: "/workspace/repo",
      stdout: "plain text output",
      stderr: "",
      capturedText: "Refactor complete.",
    });

    expect(result.usageSource).toBe("estimated");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.inputTokens + result.outputTokens);
    expect(result.transcriptText).toBe("Refactor complete.");
  }, 15000);

  it("reuses cached Codex token counts for repeated large texts without retaining the text in keys", async () => {
    const largePrompt = `Refactor this module:\n${"function example() { return true; }\n".repeat(400)}`;
    const largeOutput = `Done:\n${"updated call site\n".repeat(400)}`;

    const first = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: largePrompt,
      cwd: "/workspace/repo",
      stdout: "plain output",
      stderr: "",
      capturedText: largeOutput,
    });
    const afterFirst = codexTokenEstimationCacheTestHooks.stats();

    const second = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: largePrompt,
      cwd: "/workspace/repo",
      stdout: "plain output",
      stderr: "",
      capturedText: largeOutput,
    });
    const afterSecond = codexTokenEstimationCacheTestHooks.stats();

    expect(second.inputTokens).toBe(first.inputTokens);
    expect(second.outputTokens).toBe(first.outputTokens);
    expect(afterFirst.tokenCountCacheMisses).toBe(2);
    expect(afterSecond.tokenCountCacheHits).toBe(2);
    expect(afterSecond.tokenCountCacheMisses).toBe(afterFirst.tokenCountCacheMisses);
    expect(afterSecond.tokenCountCacheKeys).toHaveLength(2);
    expect(afterSecond.tokenCountCacheKeys.join("\n")).not.toContain("function example");
    expect(afterSecond.tokenCountCacheKeys.join("\n")).not.toContain("updated call site");
  }, 15000);

  it("evicts Codex token counts and encodings at the configured cache limits", async () => {
    const { tokenCountCacheLimit } = codexTokenEstimationCacheTestHooks.stats();
    let firstCacheKey: string | undefined;

    for (let index = 0; index <= tokenCountCacheLimit; index += 1) {
      await collectProviderUsageTelemetry({
        provider: "codex",
        model: "gpt-4o-codex",
        prompt: `Unique prompt ${index}: ${"x".repeat(64)}`,
        cwd: "/workspace/repo",
        stdout: "",
        stderr: "",
      });
      if (index === 0) {
        firstCacheKey = codexTokenEstimationCacheTestHooks.stats().tokenCountCacheKeys[0];
      }
    }

    const stats = codexTokenEstimationCacheTestHooks.stats();
    expect(stats.tokenCountCacheSize).toBe(tokenCountCacheLimit);
    expect(firstCacheKey).toBeDefined();
    expect(stats.tokenCountCacheKeys).not.toContain(firstCacheKey);

    codexTokenEstimationCacheTestHooks.reset();
    const knownModels = [
      "gpt-4o",
      "gpt-4o-mini",
      "gpt-4",
      "gpt-4-turbo",
      "gpt-3.5-turbo",
      "text-davinci-003",
      "text-embedding-ada-002",
      "text-embedding-3-small",
      "text-embedding-3-large",
    ];
    const { encodingCacheLimit } = codexTokenEstimationCacheTestHooks.stats();
    expect(knownModels.length).toBeGreaterThan(encodingCacheLimit);

    for (const model of knownModels) {
      await collectProviderUsageTelemetry({
        provider: "codex",
        model,
        prompt: `Estimate with ${model}.`,
        cwd: "/workspace/repo",
        stdout: "",
        stderr: "",
      });
    }

    const encodingStats = codexTokenEstimationCacheTestHooks.stats();
    expect(encodingStats.encodingCacheSize).toBe(encodingCacheLimit);
    expect(encodingStats.encodingCacheKeys).not.toContain(knownModels[0]);
  }, 30000);

  it("uses the fallback Codex encoding when model-specific encoding fails", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "not-a-js-tiktoken-model",
      prompt: "Estimate this with the fallback encoder.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
    });
    const stats = codexTokenEstimationCacheTestHooks.stats();

    expect(result.usageSource).toBe("estimated");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.inputTokens);
    expect(stats.encodingCacheSize).toBe(1);
    expect(stats.tokenCountCacheSize).toBe(1);
  }, 15000);

  it("parses OpenCode JSON event output and captures the native session id", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
      prompt: "Plan the sprint.",
      cwd: "/workspace/repo",
      stdout: [
        JSON.stringify({
          type: "session.created",
          properties: {
            info: {
              id: "ses_19151020bffeNmMNdnhmFM3fA5",
            },
          },
        }),
        JSON.stringify({
          type: "text",
          part: {
            type: "text",
            text: "{\"goal\":\"ok\",\"tasks\":[]}",
          },
        }),
        JSON.stringify({
          type: "step_finish",
          part: {
            usage: {
              promptTokens: 123,
              completionTokens: 45,
            },
          },
        }),
      ].join("\n"),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 168,
      usageSource: "reported",
      transcriptText: "{\"goal\":\"ok\",\"tasks\":[]}",
      nativeSessionId: "ses_19151020bffeNmMNdnhmFM3fA5",
    });
  });

  it("extracts OpenCode tool calls and reasoning into the conversation", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
      prompt: "Run the tests.",
      cwd: "/workspace/repo",
      stdout: [
        JSON.stringify({ type: "reasoning", part: { type: "reasoning", text: "I should run the suite." } }),
        // Tool part emitted twice (running, then completed) — collapsed by callID.
        JSON.stringify({ type: "tool", part: { type: "tool", tool: "bash", callID: "c1", state: { status: "running", input: { command: "npm test" } } } }),
        JSON.stringify({ type: "tool", part: { type: "tool", tool: "bash", callID: "c1", state: { status: "completed", input: { command: "npm test" }, output: "ok" } } }),
        JSON.stringify({ type: "text", part: { type: "text", text: "Tests pass." } }),
        JSON.stringify({ type: "step_finish", part: { usage: { promptTokens: 10, completionTokens: 5 } } }),
      ].join("\n"),
      stderr: "",
    });

    expect(result.conversation.map((t) => t.kind)).toEqual(["user", "reasoning", "tool_call", "assistant"]);
    const toolCall = result.conversation[2];
    expect(toolCall).toMatchObject({ kind: "tool_call", toolName: "bash", toolCallId: "c1", toolStatus: "completed" });
    expect(toolCall.toolArguments).toContain("npm test");
    expect(toolCall.toolOutput).toBe("ok");
  });

  it("prefers opencode export usage over the stdout stream", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
      prompt: "Write unit tests.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
      opencodeExportJson: JSON.stringify({
        info: {
          id: "ses_18e9b7f04ffe",
          cost: 0.42,
          tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } },
        },
      }),
    });

    expect(result).toMatchObject({
      inputTokens: 87408,
      cachedInputTokens: 1200,
      outputTokens: 10284,
      reasoningOutputTokens: 490,
      totalTokens: 98892,
      usageSource: "reported",
    });
  });

  it("isolates a follow-up opencode run's tokens from the session-cumulative export using the prior invocation's baseline", async () => {
    // The first invocation on this session already persisted this snapshot.
    const baselineRawUsageJson = {
      tokens: { input: 50000, output: 6000, reasoning: 200, cache: { read: 800, write: 0 } },
      cost: 0.20,
    };
    // The follow-up resumes the same opencode session; `opencode export` now
    // reports the whole session's cumulative total, including the baseline.
    const result = await collectProviderUsageTelemetry({
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
      prompt: "One more fix please.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
      opencodeExportJson: JSON.stringify({
        info: {
          id: "ses_18e9b7f04ffe",
          cost: 0.42,
          tokens: { input: 88608, output: 10284, reasoning: 490, cache: { read: 1200, write: 0 } },
        },
      }),
      opencodeBaselineUsage: baselineRawUsageJson,
    });

    expect(result).toMatchObject({
      inputTokens: 38208,
      cachedInputTokens: 400,
      outputTokens: 4284,
      reasoningOutputTokens: 290,
      totalTokens: 42892,
      usageSource: "reported",
    });
  });

  const buildCodexRollout = (lines: Array<{ timestamp?: string; type: string; payload: Record<string, unknown> }>): string =>
    lines.map((line) => JSON.stringify({ timestamp: line.timestamp ?? "2026-06-02T10:00:00.000Z", type: line.type, payload: line.payload })).join("\n");

  const realisticCodexRollout = buildCodexRollout([
    { timestamp: "2026-06-02T10:00:00.000Z", type: "session_meta", payload: { id: "0199codex-uuid", cwd: "/workspace/repo" } },
    { timestamp: "2026-06-02T10:00:01.000Z", type: "response_item", payload: { type: "message", role: "developer", content: [{ type: "input_text", text: "permissions scaffolding" }] } },
    { timestamp: "2026-06-02T10:00:02.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Write unit tests." }] } },
    { timestamp: "2026-06-02T10:00:03.000Z", type: "response_item", payload: { type: "reasoning", summary: [{ type: "summary_text", text: "Plan the test layout." }], encrypted_content: "xxx" } },
    { timestamp: "2026-06-02T10:00:04.000Z", type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"npm test\"}", call_id: "call_1" } },
    { timestamp: "2026-06-02T10:00:04.500Z", type: "response_item", payload: { type: "function_call_output", call_id: "call_1", output: "All tests passed" } },
    { timestamp: "2026-06-02T10:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 80, output_tokens: 120, reasoning_output_tokens: 10, total_tokens: 620 } } } },
    { timestamp: "2026-06-02T10:00:06.000Z", type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Tests written." }] } },
  ]);

  it("parses reported usage and the full conversation from a Codex rollout JSONL file", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Write unit tests.",
      cwd: "/workspace/repo",
      stdout: "plain text output no json",
      stderr: "",
      capturedText: "Tests written.",
      codexSessionJson: realisticCodexRollout,
    });

    expect(result).toMatchObject({
      inputTokens: 420,
      cachedInputTokens: 80,
      outputTokens: 120,
      reasoningOutputTokens: 10,
      totalTokens: 620,
      usageSource: "reported",
      transcriptText: "Tests written.",
      nativeSessionId: "0199codex-uuid",
    });

    // Developer scaffolding is excluded; the rest of the turns are ordered.
    expect(result.conversation.map((t) => t.kind)).toEqual([
      "user",
      "reasoning",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result.conversation[0]).toMatchObject({ kind: "user", text: "Write unit tests." });
    expect(result.conversation[1]).toMatchObject({ kind: "reasoning", text: "Plan the test layout." });
    expect(result.conversation[2]).toMatchObject({ kind: "tool_call", toolName: "exec_command", toolCallId: "call_1", toolArguments: "{\"cmd\":\"npm test\"}" });
    expect(result.conversation[3]).toMatchObject({ kind: "tool_result", toolCallId: "call_1", toolOutput: "All tests passed" });
    expect(result.conversation[4]).toMatchObject({ kind: "assistant", text: "Tests written." });
  });

  it("prefers Codex rollout usage over the exec stdout stream", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Fix the bug.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({ type: "turn.completed", usage: { input_tokens: 9999, cached_input_tokens: 9999, output_tokens: 9999 } }),
      stderr: "",
      capturedText: "Bug fixed.",
      codexSessionJson: realisticCodexRollout,
    });

    expect(result).toMatchObject({
      inputTokens: 420,
      cachedInputTokens: 80,
      outputTokens: 120,
      usageSource: "reported",
    });
  });

  it("falls back to the exec stdout turn.completed usage when no rollout file is available", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Fix the bug.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({ type: "turn.completed", usage: { input_tokens: 210, cached_input_tokens: 35, output_tokens: 84, reasoning_output_tokens: 16 } }),
      stderr: "",
      capturedText: "Bug fixed.",
    });

    expect(result).toMatchObject({
      inputTokens: 175,
      cachedInputTokens: 35,
      outputTokens: 84,
      usageSource: "reported",
    });
  });

  it("parses the exec --json thread/item stream into turns when no rollout file exists", async () => {
    const stdout = [
      JSON.stringify({ type: "thread.started", thread_id: "thr_abc" }),
      JSON.stringify({ type: "turn.started" }),
      JSON.stringify({ type: "item.completed", item: { id: "item_0", type: "agent_message", text: "Let me inspect the layout." } }),
      JSON.stringify({ type: "item.started", item: { id: "item_1", type: "command_execution", command: "ls -la", aggregated_output: "", exit_code: null, status: "in_progress" } }),
      JSON.stringify({ type: "item.completed", item: { id: "item_1", type: "command_execution", command: "ls -la", aggregated_output: "file-a\nfile-b", exit_code: 0, status: "completed" } }),
      JSON.stringify({ type: "item.completed", item: { id: "item_2", type: "agent_message", text: "{\"plan\":\"done\"}" } }),
      JSON.stringify({ type: "turn.completed", usage: { input_tokens: 300, cached_input_tokens: 40, output_tokens: 60 } }),
    ].join("\n");

    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-5.5",
      prompt: "Make a plan.",
      cwd: "/workspace/repo",
      stdout,
      stderr: "",
      // No capturedText and no rollout file — the previous behaviour dumped the
      // entire JSON stream as one assistant message.
    });

    expect(result.usageSource).toBe("reported");
    expect(result.nativeSessionId).toBe("thr_abc");
    // Conversation is broken into proper turns (not one raw JSON blob).
    expect(result.conversation.map((t) => t.kind)).toEqual([
      "user",
      "assistant",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
    expect(result.conversation[2]).toMatchObject({ kind: "tool_call", toolName: "shell", toolArguments: "ls -la" });
    expect(result.conversation[3]).toMatchObject({ kind: "tool_result", toolOutput: "file-a\nfile-b", toolStatus: "completed" });
    // Transcript is the clean final agent_message, not the raw event stream.
    expect(result.transcriptText).toBe("{\"plan\":\"done\"}");
    expect(result.transcriptText).not.toContain("thread.started");
  });

  it("isolates the current run's conversation turns using startTimeMs", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Latest follow-up.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
      capturedText: "Resumed answer.",
      codexSessionJson: realisticCodexRollout,
      // After all the rollout turns above; only the prompt should remain.
      startTimeMs: Date.parse("2026-06-02T11:00:00.000Z"),
    });

    // Prior-session turns are filtered out; with no turns from this run the
    // conversation stays empty (the caller then keeps its single assistant
    // message rather than storing a user-only transcript).
    expect(result.conversation).toEqual([]);
    // Usage is isolated the same way: the only token_count snapshot in the
    // fixture predates this run's window, so it becomes the baseline and is
    // subtracted from itself, leaving 0 rather than re-reporting the prior
    // run's 500 tokens (which would double-count them against that run's
    // already-persisted usage).
    expect(result.usageSource).toBe("reported");
    expect(result.inputTokens).toBe(0);
    expect(result.totalTokens).toBe(0);
  });

  it("reports only the follow-up run's incremental tokens, not the whole resumed session's cumulative total", async () => {
    // Codex keeps appending to the same rollout file across `resume --last`,
    // and each token_count event is cumulative for the whole session. A
    // follow-up run must report only what it added on top of the baseline
    // captured by the prior run, or the two runs' persisted usage rows would
    // both include the first run's 500/80/120/10 tokens.
    const followUpRollout = buildCodexRollout([
      { timestamp: "2026-06-02T10:00:00.000Z", type: "session_meta", payload: { id: "0199codex-uuid", cwd: "/workspace/repo" } },
      { timestamp: "2026-06-02T10:00:02.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Write unit tests." }] } },
      { timestamp: "2026-06-02T10:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 500, cached_input_tokens: 80, output_tokens: 120, reasoning_output_tokens: 10, total_tokens: 620 } } } },
      { timestamp: "2026-06-02T11:00:02.000Z", type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Latest follow-up." }] } },
      { timestamp: "2026-06-02T11:00:05.000Z", type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 560, cached_input_tokens: 90, output_tokens: 145, reasoning_output_tokens: 14, total_tokens: 705 } } } },
    ]);

    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Latest follow-up.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
      capturedText: "Resumed answer.",
      codexSessionJson: followUpRollout,
      startTimeMs: Date.parse("2026-06-02T11:00:00.000Z"),
    });

    expect(result.usageSource).toBe("reported");
    expect(result.inputTokens).toBe(50);
    expect(result.cachedInputTokens).toBe(10);
    expect(result.outputTokens).toBe(25);
    expect(result.reasoningOutputTokens).toBe(4);
    expect(result.totalTokens).toBe(85);
  });

  it("parses Codex token_count usage with camelCase fields", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Fix the bug.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              inputTokens: 144,
              cached_input_tokens: 12,
              outputTokens: 56,
            },
          },
        },
      }),
      stderr: "",
      capturedText: "Bug fixed.",
    });

    expect(result).toMatchObject({
      inputTokens: 132,
      cachedInputTokens: 12,
      outputTokens: 56,
      totalTokens: 200,
      usageSource: "reported",
    });
  });

  it("parses Codex usage when only total and prompt tokens are reported", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Generate tests.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              prompt_tokens: 300,
              total_tokens: 470,
            },
          },
        },
      }),
      stderr: "",
      capturedText: "Generated tests.",
    });

    expect(result).toMatchObject({
      inputTokens: 300,
      outputTokens: 170,
      totalTokens: 470,
      usageSource: "reported",
    });
  });

  it("infers Codex output from total when total excludes cached input", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Generate tests.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 1000,
              cached_input_tokens: 800,
              total_tokens: 250,
            },
          },
        },
      }),
      stderr: "",
      capturedText: "Generated tests.",
    });

    expect(result).toMatchObject({
      inputTokens: 200,
      cachedInputTokens: 800,
      outputTokens: 50,
      totalTokens: 1050,
      usageSource: "reported",
    });
  });

  it("falls back to estimation when both Codex stdout and session file lack usage", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Explain the code.",
      cwd: "/workspace/repo",
      stdout: "some output",
      stderr: "",
      capturedText: "Explanation here.",
      codexSessionJson: JSON.stringify({ id: "sess-empty", model: "gpt-4o-codex" }),
    });

    expect(result.usageSource).toBe("estimated");
    expect(result.inputTokens).toBeGreaterThan(0);
  }, 15000);

  it("parses Claude session artifacts for reported usage", async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-usage-home-"));
    tempDirs.push(fakeHome);
    process.env.HOME = fakeHome;
    process.env.USERPROFILE = fakeHome;

    const cwd = "/workspace/repo";
    const slug = cwd.replace(/[/\\:]/g, "-");
    const sessionId = "f060b6ff-b942-4d7f-a5d3-d6ad8af102f8";
    const sessionDir = path.join(fakeHome, ".claude", "projects", slug);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          message: {
            usage: {
              input_tokens: 91,
              cache_creation_input_tokens: 12,
              cache_read_input_tokens: 7,
              output_tokens: 33,
            },
            content: [{ type: "text", text: "Implemented the requested fix." }],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await collectProviderUsageTelemetry({
      provider: "claude-code",
      model: "claude-sonnet-4-6",
      prompt: "Resolve the merge conflict.",
      cwd,
      stdout: "",
      stderr: "",
      nativeSessionId: sessionId,
    });

    expect(result).toMatchObject({
      inputTokens: 91,
      cachedInputTokens: 19,
      outputTokens: 33,
      totalTokens: 143,
      usageSource: "reported",
      transcriptText: "Implemented the requested fix.",
      nativeSessionId: sessionId,
    });
  });

  it("parses Claude container session artifacts for reported usage", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "claude-code",
      model: "claude-sonnet-4-6",
      prompt: "Resolve the merge conflict.",
      cwd: "docker-volume://workspace-1",
      stdout: "",
      stderr: "",
      nativeSessionId: "container-native-1",
      claudeSessionJsonl: [
        JSON.stringify({
          message: {
            usage: {
              input_tokens: 44,
              cache_creation_input_tokens: 5,
              cache_read_input_tokens: 6,
              output_tokens: 22,
            },
            content: [{ type: "text", text: "Container fix complete." }],
          },
        }),
      ].join("\n"),
    });

    expect(result).toMatchObject({
      inputTokens: 44,
      cachedInputTokens: 11,
      outputTokens: 22,
      totalTokens: 77,
      usageSource: "reported",
      transcriptText: "Container fix complete.",
      nativeSessionId: "container-native-1",
    });
  });

  it("estimates telemetry for qwen-code when logs are not found", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "qwen-code",
      model: "qwen3-coder-plus",
      prompt: "Implement binary search.",
      cwd: "/workspace",
      stdout: "Here is the binary search implementation.",
      stderr: "",
      nativeSessionId: "qwen-session-123",
    });

    expect(result).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      usageSource: "estimated",
      nativeSessionId: "qwen-session-123",
    });
  });

  it("reports Qwen Code usage supplied from parsed OpenAI logs", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "qwen-code",
      model: "qwen3-coder-plus",
      prompt: "Implement binary search.",
      cwd: "/workspace",
      stdout: "Here is the binary search implementation.",
      stderr: "",
      nativeSessionId: "qwen-session-123",
      qwenReportedUsage: { inputTokens: 1450, cachedInputTokens: 50, outputTokens: 450, reasoningOutputTokens: 0 },
    });

    expect(result).toMatchObject({
      inputTokens: 1450,
      cachedInputTokens: 50,
      outputTokens: 450,
      totalTokens: 1950,
      usageSource: "reported",
      nativeSessionId: "qwen-session-123",
    });
  });
});

describe("parseQwenOpenAiLogs", () => {
  it("aggregates usage from response.usage across multiple log files", async () => {
    const logDir = path.join(os.tmpdir(), `code-ux-qwen-logs-${Date.now().toString(36)}`);
    tempDirs.push(logDir);
    await fs.mkdir(logDir, { recursive: true });

    await fs.writeFile(
      path.join(logDir, "openai-1.json"),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        request: { model: "qwen3-coder-plus" },
        response: {
          usage: {
            prompt_tokens: 1500,
            completion_tokens: 450,
            prompt_tokens_details: { cached_tokens: 50 },
          },
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(logDir, "openai-2.json"),
      JSON.stringify({
        response: { usage: { prompt_tokens: 200, completion_tokens: 80 } },
      }),
      "utf8",
    );

    const usage = await parseQwenOpenAiLogs(logDir, Date.now() - 500);

    expect(usage).toEqual({ inputTokens: 1650, cachedInputTokens: 50, outputTokens: 530, reasoningOutputTokens: 0 });
  });

  it("returns null when no log file reports usage", async () => {
    const logDir = path.join(os.tmpdir(), `code-ux-qwen-empty-${Date.now().toString(36)}`);
    tempDirs.push(logDir);
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(path.join(logDir, "openai-err.json"), JSON.stringify({ error: { message: "boom" } }), "utf8");

    expect(await parseQwenOpenAiLogs(logDir, Date.now() - 500)).toBeNull();
  });

  it("falls back to a top-level usage object (legacy logs)", () => {
    expect(sumQwenOpenAiUsage([{ usage: { input_tokens: 10, output_tokens: 4 } }]))
      .toEqual({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 4, reasoningOutputTokens: 0 });
  });

  it("detects cached tokens reported in Anthropic shape (qwenProtocol: anthropic backends)", () => {
    // Some qwen-code backends (qwenProtocol: "anthropic") log usage with
    // Anthropic's separate cache_read/cache_creation counters instead of
    // OpenAI's prompt_tokens_details.cached_tokens.
    expect(extractQwenUsageRecord({
      response: {
        usage: {
          input_tokens: 1000,
          output_tokens: 200,
          cache_read_input_tokens: 300,
          cache_creation_input_tokens: 50,
        },
      },
    })).toEqual({ inputTokens: 1000, outputTokens: 200, cachedInputTokens: 350, reasoningOutputTokens: 0 });
  });

  it("detects reasoning tokens via output_token_details", () => {
    expect(extractQwenUsageRecord({
      response: {
        usage: {
          prompt_tokens: 100,
          completion_tokens: 40,
          completion_tokens_details: { reasoning_tokens: 15 },
        },
      },
    })).toEqual({ inputTokens: 100, outputTokens: 40, cachedInputTokens: 0, reasoningOutputTokens: 15 });
  });
});

describe("buildQwenConversation", () => {
  it("builds a conversation from the newest record's request history plus its response", () => {
    const records = [
      {
        timestamp: "2026-06-02T10:00:00.000Z",
        request: { messages: [{ role: "system", content: "scaffolding" }, { role: "user", content: "Add a test." }] },
        response: { usage: { prompt_tokens: 10, completion_tokens: 3 } },
      },
      {
        timestamp: "2026-06-02T10:00:05.000Z",
        request: {
          messages: [
            { role: "system", content: "scaffolding" },
            { role: "user", content: "Add a test." },
            { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "run_shell", arguments: "{\"cmd\":\"npm test\"}" } }] },
            { role: "tool", tool_call_id: "t1", content: "passed" },
          ],
        },
        response: {
          usage: { prompt_tokens: 200, completion_tokens: 60 },
          choices: [{ message: { role: "assistant", content: "Test added." } }],
        },
      },
    ];

    const conversation = buildQwenConversation(records);
    // System scaffolding is skipped; tool call/result and final answer are included.
    expect(conversation.map((t) => t.kind)).toEqual(["user", "tool_call", "tool_result", "assistant"]);
    expect(conversation[1]).toMatchObject({ kind: "tool_call", toolName: "run_shell", toolCallId: "t1" });
    expect(conversation[2]).toMatchObject({ kind: "tool_result", toolCallId: "t1", toolOutput: "passed" });
    expect(conversation[3]).toMatchObject({ kind: "assistant", text: "Test added." });
    expect(conversation[3].tokens).toMatchObject({ input: 200, output: 60 });
  });

  it("splits qwen harness-injected <system-reminder> blocks out of the user prompt", () => {
    const records = [
      {
        timestamp: "2026-06-02T10:00:00.000Z",
        request: {
          messages: [
            {
              role: "user",
              content:
                "<system-reminder>\nThe following tools are reachable via tool_search.\n- \"computer_use__click\": \"Left-click...\"\n</system-reminder>\n<system-reminder>\nThe following skills are available.\n</system-reminder>\n## Objective\nUpdate the file.",
            },
          ],
        },
        response: {
          usage: { prompt_tokens: 100, completion_tokens: 10 },
          choices: [{ message: { role: "assistant", content: "Done." } }],
        },
      },
    ];

    const conversation = buildQwenConversation(records);
    expect(conversation.map((t) => t.kind)).toEqual(["injected_context", "user", "assistant"]);
    // The harness registry is isolated; our prompt is clean.
    expect(conversation[0].text).toContain("computer_use__click");
    expect(conversation[0].text).toContain("</system-reminder>");
    expect(conversation[1]).toMatchObject({ kind: "user", text: "## Objective\nUpdate the file." });
    expect(conversation[1].text).not.toContain("system-reminder");
    expect(conversation[1].text).not.toContain("computer_use__");
  });

  it("leaves an ordinary user prompt untouched when there is no injected context", () => {
    const records = [
      {
        timestamp: "2026-06-02T10:00:00.000Z",
        request: { messages: [{ role: "user", content: "Just a normal prompt." }] },
        response: { usage: { prompt_tokens: 5, completion_tokens: 2 }, choices: [{ message: { role: "assistant", content: "ok" } }] },
      },
    ];
    const conversation = buildQwenConversation(records);
    expect(conversation.map((t) => t.kind)).toEqual(["user", "assistant"]);
    expect(conversation[0]).toMatchObject({ kind: "user", text: "Just a normal prompt." });
  });

  it("captures per-step and final reasoning_content from thinking models", () => {
    const records = [
      {
        // Step 1: the model thought, then called a tool. Its reasoning lives on
        // this record's response, keyed by tool-call id t1.
        timestamp: "2026-06-02T10:00:00.000Z",
        request: { messages: [{ role: "user", content: "Add a test." }] },
        response: {
          usage: { prompt_tokens: 10, completion_tokens: 3 },
          choices: [{ message: {
            role: "assistant",
            content: "",
            reasoning_content: "I should run the existing tests first.",
            tool_calls: [{ id: "t1", function: { name: "run_shell", arguments: "{\"cmd\":\"npm test\"}" } }],
          } }],
        },
      },
      {
        // Newest record: history has the t1 call (reasoning stripped) + result,
        // and the final response carries its own reasoning_content.
        timestamp: "2026-06-02T10:00:05.000Z",
        request: {
          messages: [
            { role: "user", content: "Add a test." },
            { role: "assistant", content: "", tool_calls: [{ id: "t1", function: { name: "run_shell", arguments: "{\"cmd\":\"npm test\"}" } }] },
            { role: "tool", tool_call_id: "t1", content: "passed" },
          ],
        },
        response: {
          usage: { prompt_tokens: 200, completion_tokens: 60 },
          choices: [{ message: { role: "assistant", content: "Test added.", reasoning_content: "Tests pass, so I'm done." } }],
        },
      },
    ];

    const conversation = buildQwenConversation(records);
    // Intermediate reasoning is recovered before the tool call it produced, and
    // the final turn's own reasoning precedes the answer.
    expect(conversation.map((t) => t.kind)).toEqual([
      "user", "reasoning", "tool_call", "tool_result", "reasoning", "assistant",
    ]);
    expect(conversation[1]).toMatchObject({ kind: "reasoning", text: "I should run the existing tests first." });
    expect(conversation[4]).toMatchObject({ kind: "reasoning", text: "Tests pass, so I'm done." });
    expect(conversation[5]).toMatchObject({ kind: "assistant", text: "Test added." });
  });

  it("threads qwen conversation through collectProviderUsageTelemetry", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "qwen-code",
      model: "qwen3-coder-plus",
      prompt: "Add a test.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
      qwenReportedUsage: { inputTokens: 200, cachedInputTokens: 0, outputTokens: 60, reasoningOutputTokens: 0 },
      qwenConversation: [
        { kind: "assistant", text: "Test added." },
      ],
    });

    expect(result.usageSource).toBe("reported");
    // The prompt is prepended since the parsed conversation lacks a leading user turn.
    expect(result.conversation.map((t) => t.kind)).toEqual(["user", "assistant"]);
    expect(result.conversation[0]).toMatchObject({ kind: "user", text: "Add a test." });
  });
});
