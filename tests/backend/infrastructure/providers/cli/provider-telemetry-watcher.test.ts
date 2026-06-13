import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import { ProviderTelemetryWatcher, type IProviderLogReaders } from "../../../../../src/infrastructure/providers/cli/provider-telemetry-watcher.js";
import { collectProviderUsageTelemetry } from "../../../../../src/infrastructure/providers/cli/provider-usage.js";

vi.mock("../../../../../src/infrastructure/providers/cli/provider-usage.js", () => ({
  collectProviderUsageTelemetry: vi.fn(async () => ({
    inputTokens: 10,
    outputTokens: 20,
    totalTokens: 30,
    usageSource: "reported",
  })),
}));

describe("ProviderTelemetryWatcher", () => {
  let readers: IProviderLogReaders;
  let onTelemetry: any;
  let abortController: AbortController;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    readers = {
      readClaudeSessionJsonl: vi.fn().mockResolvedValue(null),
      readCodexLatestSessionJson: vi.fn().mockResolvedValue(null),
      readQwenLogData: vi.fn().mockResolvedValue(null),
      parseAntigravityConversationId: vi.fn().mockResolvedValue(null),
      readAntigravityTranscript: vi.fn().mockResolvedValue(null),
      resolveAntigravityDatabase: vi.fn().mockResolvedValue(true),
    };
    onTelemetry = vi.fn();
    abortController = new AbortController();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits telemetry periodically", async () => {
    const watcher = new ProviderTelemetryWatcher({
      provider: "claude-code",
      model: "sonnet",
      prompt: "hello",
      cwd: "/repo",
      sessionId: "session-1",
      startedMs: Date.now(),
      executionMode: "HOST",
      signal: abortController.signal,
      nativeSessionId: "native-1",
      antigravityLogPath: null,
      getAccumulatedStdout: () => "stdout",
      getAccumulatedStderr: () => "stderr",
      onTelemetry,
      readers,
    });

    watcher.start();

    // Initial delay (1s)
    await vi.advanceTimersByTimeAsync(1100);
    expect(onTelemetry).toHaveBeenCalledTimes(1);
    expect(readers.readClaudeSessionJsonl).toHaveBeenCalledWith("/repo", "native-1", "HOST");

    // Second poll (1.5s)
    await vi.advanceTimersByTimeAsync(1600);
    expect(onTelemetry).toHaveBeenCalledTimes(2);

    await watcher.stop();
  });

  it("swallows read errors and continues polling", async () => {
    readers.readClaudeSessionJsonl = vi.fn().mockRejectedValue(new Error("read failed"));

    const watcher = new ProviderTelemetryWatcher({
      provider: "claude-code",
      model: "sonnet",
      prompt: "hello",
      cwd: "/repo",
      sessionId: "session-1",
      startedMs: Date.now(),
      executionMode: "HOST",
      signal: abortController.signal,
      nativeSessionId: "native-1",
      antigravityLogPath: null,
      getAccumulatedStdout: () => "stdout",
      getAccumulatedStderr: () => "stderr",
      onTelemetry,
      readers,
    });

    watcher.start();

    // Initial poll fails
    await vi.advanceTimersByTimeAsync(1100);
    expect(onTelemetry).not.toHaveBeenCalled();

    // Recover on next poll
    readers.readClaudeSessionJsonl = vi.fn().mockResolvedValue("some logs");
    await vi.advanceTimersByTimeAsync(1600);
    expect(onTelemetry).toHaveBeenCalledTimes(1);

    await watcher.stop();
  });

  it("stops polling when AbortSignal is triggered", async () => {
    const watcher = new ProviderTelemetryWatcher({
      provider: "claude-code",
      model: "sonnet",
      prompt: "hello",
      cwd: "/repo",
      sessionId: "session-1",
      startedMs: Date.now(),
      executionMode: "HOST",
      signal: abortController.signal,
      nativeSessionId: "native-1",
      antigravityLogPath: null,
      getAccumulatedStdout: () => "stdout",
      getAccumulatedStderr: () => "stderr",
      onTelemetry,
      readers,
    });

    watcher.start();

    await vi.advanceTimersByTimeAsync(1100);
    expect(onTelemetry).toHaveBeenCalledTimes(1);

    abortController.abort();
    await vi.advanceTimersByTimeAsync(1600);
    
    // Should not have called onTelemetry again
    expect(onTelemetry).toHaveBeenCalledTimes(1);

    await watcher.stop();
  });

  it("resolves antigravity session ID and creates/cleans up temp database", async () => {
    readers.parseAntigravityConversationId = vi.fn().mockResolvedValue("conv-123");
    vi.spyOn(fs, "rm").mockResolvedValue(undefined);

    const watcher = new ProviderTelemetryWatcher({
      provider: "antigravity",
      model: "default",
      prompt: "hello",
      cwd: "/repo",
      sessionId: "session-1",
      startedMs: Date.now(),
      executionMode: "HOST",
      signal: abortController.signal,
      nativeSessionId: null, // Test session resolution
      antigravityLogPath: "/tmp/agy.log",
      getAccumulatedStdout: () => "stdout",
      getAccumulatedStderr: () => "stderr",
      onTelemetry,
      readers,
    });

    watcher.start();

    await vi.advanceTimersByTimeAsync(1100);
    expect(readers.parseAntigravityConversationId).toHaveBeenCalled();
    expect(readers.resolveAntigravityDatabase).toHaveBeenCalledWith(
      "/repo",
      "conv-123",
      "HOST",
      expect.stringContaining("agy-temp-watcher-conv-123")
    );
    expect(onTelemetry).toHaveBeenCalledWith(expect.objectContaining({
        inputTokens: 10
    }));

    await watcher.stop();
    expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining("agy-temp-watcher-conv-123"), expect.any(Object));
  });

  it("stops immediately and does not hang if watcher loop is slow", async () => {
    // Mock collectProviderUsageTelemetry to be very slow
    vi.mocked(collectProviderUsageTelemetry).mockImplementationOnce(async () => {
        await new Promise(resolve => setTimeout(resolve, 5000));
        return { totalTokens: 0 } as any;
    });

    const watcher = new ProviderTelemetryWatcher({
      provider: "claude-code",
      model: "sonnet",
      prompt: "hello",
      cwd: "/repo",
      sessionId: "session-1",
      startedMs: Date.now(),
      executionMode: "HOST",
      signal: abortController.signal,
      nativeSessionId: "native-1",
      antigravityLogPath: null,
      getAccumulatedStdout: () => "stdout",
      getAccumulatedStderr: () => "stderr",
      onTelemetry,
      readers,
    });

    watcher.start();
    
    // Start the first poll
    vi.advanceTimersByTime(1100);
    
    const stopPromise = watcher.stop();
    
    // Stop should resolve because of the Promise.race timeout even if loop is "stuck"
    // In our test, we use fake timers, so we need to advance them to hit the timeout in stop()
    await vi.advanceTimersByTimeAsync(2100);
    
    await stopPromise;
  });
});
