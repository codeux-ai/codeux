import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderTelemetryWatcher } from "../../../../../src/infrastructure/providers/cli/provider-telemetry-watcher.js";
import { collectProviderUsageTelemetry } from "../../../../../src/infrastructure/providers/cli/provider-usage.js";
import { runWithCorrelationId } from "../../../../../src/shared/logging/correlation-id.js";
import * as fs from "fs/promises";

async function waitForExpect(assertion: () => void, timeoutMs = 200): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  assertion();
}

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
    await watcher.stop();
    expect(fs.rm).toHaveBeenCalledTimes(1);
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

  it("consumes Docker Codex byte deltas and skips a zero-byte unchanged poll", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const rollout = [
      JSON.stringify({ type: "session_meta", payload: { id: "chunk-session" } }),
      JSON.stringify({
        type: "response_item",
        timestamp: "2026-07-14T00:00:00.000Z",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "delta" }] },
      }),
    ].join("\n");
    const bytes = Buffer.from(rollout);
    const readChunk = vi.fn(async (cursor: { sourceId: string | null; offset: number }) => cursor.offset === 0
      ? {
          sourceId: "9:100",
          startOffset: 0,
          nextOffset: bytes.length,
          totalBytes: bytes.length,
          contentBase64: bytes.toString("base64"),
          reset: true,
        }
      : {
          sourceId: "9:100",
          startOffset: bytes.length,
          nextOffset: bytes.length,
          totalBytes: bytes.length,
          contentBase64: "",
          reset: false,
        });
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: Date.parse("2026-07-14T00:00:00.000Z"),
      workflowSettings: { executionMode: "DOCKER" as const },
      signal: controller.signal,
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: null,
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn(),
      readCodexLatestSessionChunk: readChunk,
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

    expect(readChunk).toHaveBeenNthCalledWith(1, { sourceId: null, offset: 0 });
    expect(readChunk).toHaveBeenNthCalledWith(2, { sourceId: "9:100", offset: bytes.length });
    expect(opts.readCodexLatestSessionJson).not.toHaveBeenCalled();
    expect(collectProviderUsageTelemetry).toHaveBeenCalledTimes(1);
    expect(collectProviderUsageTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      codexSessionJson: null,
      codexRollout: expect.objectContaining({
        nativeSessionId: "chunk-session",
        conversation: [expect.objectContaining({ text: "delta" })],
      }),
    }));

    controller.abort();
    await watcher.stop();
  });

  it.each([
    {
      provider: "claude-code" as const,
      metadataKey: "getClaudeSessionJsonlMetadata",
      readKey: "readClaudeSessionJsonl",
      metadata: "claude.jsonl:12:100",
      readResult: "claude transcript",
    },
    {
      provider: "qwen-code" as const,
      metadataKey: "getQwenLogDataMetadata",
      readKey: "readQwenLogData",
      metadata: "qwen-log:12:100",
      readResult: { usage: null, conversation: [] },
    },
  ])("skips expensive $provider reads when metadata is unchanged", async ({ provider, metadataKey, readKey, metadata, readResult }) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const opts = {
      provider,
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
      getClaudeSessionJsonlMetadata: vi.fn().mockResolvedValue(metadata),
      readClaudeSessionJsonl: vi.fn().mockResolvedValue(readResult),
      getCodexLatestSessionJsonMetadata: vi.fn(),
      readCodexLatestSessionJson: vi.fn(),
      getQwenLogDataMetadata: vi.fn().mockResolvedValue(metadata),
      readQwenLogData: vi.fn().mockResolvedValue(readResult),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);

    expect(opts[metadataKey]).toHaveBeenCalledTimes(2);
    expect(opts[readKey]).toHaveBeenCalledTimes(1);
    expect(collectProviderUsageTelemetry).toHaveBeenCalledTimes(1);
    expect(opts.onTelemetry).toHaveBeenCalledTimes(1);

    controller.abort();
    await watcher.stop();
  });

  it("runs expensive reads when provider metadata changes", async () => {
    vi.useFakeTimers();
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
      getCodexLatestSessionJsonMetadata: vi.fn()
        .mockResolvedValueOnce("rollout.jsonl:12:100")
        .mockResolvedValueOnce("rollout.jsonl:24:200"),
      readCodexLatestSessionJson: vi.fn()
        .mockResolvedValueOnce("codex transcript")
        .mockResolvedValueOnce("codex transcript updated"),
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

    expect(opts.getCodexLatestSessionJsonMetadata).toHaveBeenCalledTimes(2);
    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(2);
    expect(collectProviderUsageTelemetry).toHaveBeenCalledTimes(2);
    expect(opts.onTelemetry).toHaveBeenCalledTimes(2);

    controller.abort();
    await watcher.stop();
  });

  it("logs successful telemetry polls with invocation metadata and active correlation id", async () => {
    vi.useFakeTimers();
    vi.mocked(collectProviderUsageTelemetry).mockResolvedValue({
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      reasoningOutputTokens: 1,
      totalTokens: 17,
      usageSource: "reported",
      rawUsageJson: { totals: "present", apiKey: "raw-usage-secret", transcript: "raw usage transcript" },
      transcriptText: "final answer with apiKey=transcript-secret",
      nativeSessionId: "native-1",
      conversation: [
        { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "call-1", toolArguments: "{}" },
        { kind: "assistant", text: "raw assistant transcript" },
      ],
    } as any);
    const controller = new AbortController();
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      logger,
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      purpose: "task_coding",
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn().mockResolvedValue("transcript with apiKey=super-secret"),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = runWithCorrelationId("corr-telemetry-success", () => {
      const created = new ProviderTelemetryWatcher(opts as any);
      created.start();
      return created;
    });

    await vi.advanceTimersByTimeAsync(1000);

    const successMetadata = logger.debug.mock.calls.find((call) =>
      call[0] === "Provider telemetry watcher poll"
      && call[1]?.eventType === "provider_telemetry_poll_succeeded"
    )?.[1];
    expect(successMetadata).toEqual(expect.objectContaining({
      logPurpose: "invocation",
      eventType: "provider_telemetry_poll_succeeded",
      provider: "codex",
      purpose: "task_coding",
      sessionId: "sess-1",
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      nativeSessionId: "native-1",
      correlationId: "corr-telemetry-success",
      transcriptChars: "final answer with apiKey=transcript-secret".length,
      conversationTurnCount: 2,
      toolCallCount: 1,
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 4,
      reasoningOutputTokens: 1,
      totalTokens: 17,
      hasRawUsageJson: true,
    }));
    expect(successMetadata).not.toHaveProperty("rawUsageJson");
    expect(successMetadata).not.toHaveProperty("transcriptText");
    expect(successMetadata).not.toHaveProperty("conversation");
    const loggedMetadata = JSON.stringify(logger.debug.mock.calls);
    expect(loggedMetadata).not.toContain("super-secret");
    expect(loggedMetadata).not.toContain("raw-usage-secret");
    expect(loggedMetadata).not.toContain("raw usage transcript");
    expect(loggedMetadata).not.toContain("transcript-secret");
    expect(loggedMetadata).not.toContain("raw assistant transcript");

    controller.abort();
    await watcher.stop();
  });

  it("logs partial telemetry polls when usage is estimated", async () => {
    vi.useFakeTimers();
    vi.mocked(collectProviderUsageTelemetry).mockResolvedValue({
      inputTokens: 1,
      cachedInputTokens: 0,
      outputTokens: 1,
      reasoningOutputTokens: 0,
      totalTokens: 2,
      usageSource: "estimated",
      rawUsageJson: null,
      transcriptText: "",
      nativeSessionId: "native-1",
      conversation: [],
    } as any);
    const controller = new AbortController();
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      logger,
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      purpose: "task_coding",
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn().mockResolvedValue(null),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(1000);

    expect(logger.debug).toHaveBeenCalledWith("Provider telemetry watcher poll", expect.objectContaining({
      eventType: "provider_telemetry_poll_partial",
      provider: "codex",
      usageSource: "estimated",
      totalTokens: 2,
    }));

    controller.abort();
    await watcher.stop();
  });

  it("logs no-new-data telemetry polls without rereading unchanged provider transcripts", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const opts = {
      provider: "codex" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
      signal: controller.signal,
      logger,
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      purpose: "task_coding",
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

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(1500);

    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(1);
    expect(logger.debug).toHaveBeenCalledWith("Provider telemetry watcher poll", expect.objectContaining({
      eventType: "provider_telemetry_poll_no_new_data",
      provider: "codex",
      purpose: "task_coding",
      sessionId: "sess-1",
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      nativeSessionId: "native-1",
    }));

    controller.abort();
    await watcher.stop();
  });

  it("keeps skipping expensive Antigravity reads after resolving the native session id later", async () => {
    vi.useFakeTimers();
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
      getAntigravityLogMetadata: vi.fn().mockResolvedValue("log:12:100"),
      getAntigravityTranscriptMetadata: vi.fn().mockResolvedValue("transcript:20:101"),
      getAntigravityDatabaseMetadata: vi.fn().mockResolvedValue("database:30:102"),
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn(),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn().mockResolvedValue("native-1"),
      readAntigravityTranscript: vi.fn().mockResolvedValue("antigravity transcript"),
      resolveAntigravityDatabase: vi.fn().mockResolvedValue(true),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);

    expect(opts.parseAntigravityConversationId).toHaveBeenCalledTimes(1);
    expect(opts.getAntigravityLogMetadata).toHaveBeenCalledTimes(3);
    expect(opts.getAntigravityTranscriptMetadata).toHaveBeenCalledTimes(2);
    expect(opts.getAntigravityDatabaseMetadata).toHaveBeenCalledTimes(2);
    expect(opts.readAntigravityTranscript).toHaveBeenCalledTimes(1);
    expect(opts.resolveAntigravityDatabase).toHaveBeenCalledTimes(1);
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

  it("rate-limits repeated read failures with provider and session context without failing the watcher", async () => {
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
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      purpose: "task_coding",
      getAccumulatedRawStdout: () => "",
      getAccumulatedStderr: () => "",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: null,
      initialPollDelayMs: 1,
      pollIntervalMs: 1,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn().mockRejectedValue(new Error("File read error apiKey=super-secret raw provider transcript")),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = runWithCorrelationId("corr-telemetry-failure", () => {
      const created = new ProviderTelemetryWatcher(opts as any);
      created.start();
      return created;
    });

    await waitForExpect(() => {
      // The watcher runs concurrently, and we want to ensure it has failed twice
      // and logged two warnings.
      expect(logger.warn).toHaveBeenCalledTimes(2);
    });
    controller.abort();
    await watcher.stop();
    expect(logger.warn).toHaveBeenCalledWith("Provider telemetry watcher read failed", expect.objectContaining({
      logPurpose: "invocation",
      eventType: "provider_telemetry_poll_failed",
      provider: "codex",
      purpose: "task_coding",
      sessionId: "sess-1",
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      nativeSessionId: "native-1",
      correlationId: "corr-telemetry-failure",
      failureCount: 2,
      errorName: "Error",
    }));
    expect(logger.warn.mock.calls.map((call) => call[1].failureCount)).toEqual([1, 2]);
    const warningMetadata = logger.warn.mock.calls[0][1];
    expect(warningMetadata).not.toHaveProperty("error");
    const warningOutput = JSON.stringify(logger.warn.mock.calls);
    expect(warningOutput).not.toContain("super-secret");
    expect(warningOutput).not.toContain("raw provider transcript");
    expect(opts.onTelemetry).not.toHaveBeenCalled();
  });

  it("rate-limits repeated metadata failures before full reads run", async () => {
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
      initialPollDelayMs: 1,
      pollIntervalMs: 1,
      readClaudeSessionJsonl: vi.fn(),
      getCodexLatestSessionJsonMetadata: vi.fn().mockRejectedValue(new Error("Metadata unavailable")),
      readCodexLatestSessionJson: vi.fn().mockResolvedValue("codex transcript"),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(3);

    expect(opts.getCodexLatestSessionJsonMetadata).toHaveBeenCalledTimes(2);
    controller.abort();
    await watcher.stop();

    expect(opts.getCodexLatestSessionJsonMetadata.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(opts.readCodexLatestSessionJson).not.toHaveBeenCalled();
    expect(logger.warn.mock.calls.map((call) => call[1].failureCount).slice(0, 2)).toEqual([1, 2]);
    expect(opts.onTelemetry).not.toHaveBeenCalled();
  });

  it("resets failure backoff and warning counts after a successful read", async () => {
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
      initialPollDelayMs: 1,
      pollIntervalMs: 1,
      readClaudeSessionJsonl: vi.fn(),
      getCodexLatestSessionJsonMetadata: vi.fn()
        .mockResolvedValueOnce("rollout.jsonl:12:100")
        .mockResolvedValueOnce("rollout.jsonl:24:200")
        .mockResolvedValue("rollout.jsonl:36:300"),
      readCodexLatestSessionJson: vi.fn()
        .mockRejectedValueOnce(new Error("First read failed"))
        .mockResolvedValueOnce("codex transcript")
        .mockRejectedValue(new Error("Second read failed")),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn(),
      resolveAntigravityDatabase: vi.fn(),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(4);

    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(3);
    controller.abort();
    await watcher.stop();

    expect(opts.readCodexLatestSessionJson.mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(opts.onTelemetry).toHaveBeenCalledTimes(1);
    expect(logger.warn.mock.calls.map((call) => call[1].failureCount).slice(0, 2)).toEqual([1, 1]);
  });

  it("cleans up an Antigravity watcher temp db path once after an aborted error path", async () => {
    vi.useFakeTimers();
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
      getAntigravityLogMetadata: vi.fn().mockResolvedValue("log:12:100"),
      getAntigravityTranscriptMetadata: vi.fn().mockResolvedValue("transcript:20:101"),
      getAntigravityDatabaseMetadata: vi.fn().mockResolvedValue("database:30:102"),
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn(),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn().mockResolvedValue("native-1"),
      readAntigravityTranscript: vi.fn().mockResolvedValue("antigravity transcript"),
      resolveAntigravityDatabase: vi.fn().mockRejectedValue(new Error("db unavailable")),
      onTelemetry: vi.fn(),
    };

    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(1000);
    controller.abort();
    await watcher.stop();
    await watcher.stop();

    expect(opts.resolveAntigravityDatabase).toHaveBeenCalledTimes(1);
    expect(fs.rm).toHaveBeenCalledTimes(1);
    expect(fs.rm).toHaveBeenCalledWith(expect.stringMatching(/^\/tmp\/agy-temp-watcher-native-1-.+\.db$/), { force: true });
    expect(opts.onTelemetry).not.toHaveBeenCalled();
  });

  it("forwards the Antigravity invocation baseline to live telemetry collection", async () => {
    vi.useFakeTimers();
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
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      antigravityLogPath: "/log",
      antigravitySinceIdx: 41,
      initialPollDelayMs: 1,
      pollIntervalMs: 10,
      readClaudeSessionJsonl: vi.fn(),
      readCodexLatestSessionJson: vi.fn(),
      readQwenLogData: vi.fn(),
      parseAntigravityConversationId: vi.fn(),
      readAntigravityTranscript: vi.fn().mockResolvedValue("antigravity transcript"),
      resolveAntigravityDatabase: vi.fn().mockResolvedValue(true),
      onTelemetry: vi.fn(),
    };
    const watcher = new ProviderTelemetryWatcher(opts as any);
    watcher.start();

    await vi.advanceTimersByTimeAsync(2);
    expect(collectProviderUsageTelemetry).toHaveBeenCalledWith(expect.objectContaining({
      antigravitySinceIdx: 41,
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
      transcriptText: "final answer",
      nativeSessionId: "native-1",
      conversation: [
        { kind: "reasoning", text: "thinking" },
        { kind: "tool_call", text: "", toolName: "read_file", toolCallId: "c1", toolArguments: "{\"path\":\"src/app.ts\"}" },
        { kind: "tool_result", text: "", toolName: "read_file", toolCallId: "c1", toolOutput: "file contents" },
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
      transcriptText: "final answer",
      conversation: expect.arrayContaining([
        expect.objectContaining({ kind: "reasoning", text: "thinking" }),
        expect.objectContaining({ kind: "tool_call", toolName: "read_file" }),
      ]),
    }));
    await watcher.stop();
  });
});
