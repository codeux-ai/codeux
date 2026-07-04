import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderTelemetryWatcher } from "../../../../../src/infrastructure/providers/cli/provider-telemetry-watcher.js";
import { collectProviderUsageTelemetry } from "../../../../../src/infrastructure/providers/cli/provider-usage.js";
import * as fs from "fs/promises";

vi.mock("../../../../../src/infrastructure/providers/cli/provider-usage.js", () => ({
  collectProviderUsageTelemetry: vi.fn(),
}));

vi.mock("fs/promises", async () => {
  return {
    rm: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ size: 0, mtimeMs: 0 }),
  };
});

describe("ProviderTelemetryWatcher", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(collectProviderUsageTelemetry).mockResolvedValue({
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: 0,
      totalTokens: 2,
      usageSource: "estimated",
      rawUsageJson: null,
      transcriptText: "ok",
      nativeSessionId: "native-1",
      conversation: [],
    } as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops on abort and cleans up temp db path", async () => {
    const controller = new AbortController();
    const opts = {
      provider: "antigravity" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: null,
      sessionId: "sess-1",
      antigravityLogPath: "/log",
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn(),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn().mockResolvedValue("native-1"),
      readAntigravityTranscript: vi.fn().mockResolvedValue(null),
      resolveAntigravityDatabase: vi.fn().mockResolvedValue(true),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);

    // We mock temp db creation simulation
    (watcher as any).tempDbPath = "/tmp/agy-temp-watcher-native-1-uuid.db";

    watcher.start();
    controller.abort();
    await watcher.stop();

    expect(fs.rm).toHaveBeenCalledWith("/tmp/agy-temp-watcher-native-1-uuid.db", { force: true });
  });

  it("skips expensive reads when source metadata is unchanged after a successful emission", async () => {
    const controller = new AbortController();
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      getCodexLatestSessionJsonMetadata: vi.fn().mockResolvedValue("rollout.jsonl:12:100"),
      readCodexLatestSessionJson: vi.fn().mockResolvedValue("codex transcript"),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await new Promise(r => setTimeout(r, 1200));
    await new Promise(r => setTimeout(r, 1700));

    expect(opts.getCodexLatestSessionJsonMetadata).toHaveBeenCalledTimes(2);
    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(1);
    expect(collectProviderUsageTelemetry).toHaveBeenCalledTimes(1);
    expect(opts.onTelemetry).toHaveBeenCalledTimes(1);

    controller.abort();
    await watcher.stop();
  });

  it("does not reject when a polling read fails", async () => {
    let callCount = 0;
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) throw new Error("File read error");
        return Promise.resolve(null);
      }),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    // allow event loop to run
    await new Promise(r => setTimeout(r, 1500));

    expect(callCount).toBeGreaterThan(0);
    expect(opts.onTelemetry).not.toHaveBeenCalled(); // due to mocked collector dependency or empty
    await watcher.stop();
  });

  it("logs repeated read failures with provider and session context without failing the watcher", async () => {
    const controller = new AbortController();
    const logger = { warn: vi.fn() };
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      logger,
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn().mockRejectedValue(new Error("File read error")),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await new Promise(r => setTimeout(r, 1200));
    await new Promise(r => setTimeout(r, 1700));

    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenCalledWith("Provider telemetry watcher read failed", expect.objectContaining({
      logPurpose: "runtime",
      provider: "codex",
      sessionId: "sess-1",
      nativeSessionId: "native-1",
      failureCount: 2,
      error: "File read error",
    }));
    expect(opts.onTelemetry).not.toHaveBeenCalled();

    controller.abort();
    await watcher.stop();
  });

  it("warns once for repeated transcript read failures and advances only on timer ticks", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const logger = { warn: vi.fn() };
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      logger,
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn().mockRejectedValue(new Error("OPENAI_API_KEY=sk-secret transcript read failed")),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(1000);
    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);

    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(4);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("Provider telemetry watcher read failed", expect.objectContaining({
      logPurpose: "runtime",
      provider: "codex",
      sessionId: "sess-1",
      nativeSessionId: "native-1",
      failureCount: 2,
      error: "OPENAI_API_KEY=[REDACTED] transcript read failed",
    }));

    controller.abort();
    await watcher.stop();
  });

  it("warns once for repeated metadata polling failures without doing transcript reads", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const logger = { warn: vi.fn() };
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      logger,
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      getCodexLatestSessionJsonMetadata: vi.fn().mockRejectedValue(new Error("metadata unavailable")),
      readCodexLatestSessionJson: vi.fn(),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);

    expect(opts.getCodexLatestSessionJsonMetadata).toHaveBeenCalledTimes(3);
    expect(opts.readCodexLatestSessionJson).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith("Provider telemetry watcher read failed", expect.objectContaining({
      logPurpose: "runtime",
      provider: "codex",
      failureCount: 2,
      error: "metadata unavailable",
    }));

    controller.abort();
    await watcher.stop();
  });

  it("forwards collected telemetry, including structured conversation turns, to the callback", async () => {
    vi.mocked(collectProviderUsageTelemetry).mockResolvedValue({
      inputTokens: 2,
      cachedInputTokens: 0,
      outputTokens: 3,
      reasoningOutputTokens: 1,
      totalTokens: 6,
      usageSource: "reported",
      rawUsageJson: { source: "test" },
      transcriptText: "final answer OPENAI_API_KEY=sk-live",
      nativeSessionId: "native-1",
      conversation: [
        { kind: "reasoning", text: "thinking" },
        { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "c1", toolArguments: "{\"authPath\":\"/home/me/.codex/auth.json\"}" },
        { kind: "tool_result", text: "", toolName: "read_file", toolCallId: "c1", toolOutput: "file contents ghp_123456789012345678901234567890123456" },
        { kind: "assistant", text: "final answer" },
      ],
    } as any);

    const opts = {
      provider: "qwen-code" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn(),
      readQwenLogData: vi.fn().mockResolvedValue({
        usage: null,
        conversation: [
          { kind: "reasoning", text: "thinking" },
          { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "c1", toolArguments: "{\"path\":\"src/app.ts\"}" },
          { kind: "tool_result", text: "", toolName: "read_file", toolCallId: "c1", toolOutput: "file contents" },
          { kind: "assistant", text: "final answer" },
        ],
      }),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await new Promise((r) => setTimeout(r, 1300));

    expect(opts.onTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      transcriptText: "final answer OPENAI_API_KEY=[REDACTED]",
      conversation: expect.arrayContaining([
        expect.objectContaining({ kind: "reasoning", text: "thinking" }),
        expect.objectContaining({ kind: "tool_call", toolName: "read_file", toolArguments: "{\"authPath\": \"[REDACTED]\"}" }),
        expect.objectContaining({ kind: "tool_result", toolOutput: "file contents [REDACTED]" }),
      ]),
    }));
    await watcher.stop();
  });
});
