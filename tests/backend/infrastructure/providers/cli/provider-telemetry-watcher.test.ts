import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import {
  ProviderTelemetryWatcher,
  type TelemetryWatcherOptions,
} from "../../../../../src/infrastructure/providers/cli/provider-telemetry-watcher.js";

vi.mock("fs/promises", async () => {
  return {
    rm: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockRejectedValue(new Error("not found")),
  };
});

function buildOptions(overrides: Partial<TelemetryWatcherOptions> = {}): TelemetryWatcherOptions {
  return {
    provider: "codex",
    model: "test-model",
    prompt: "test prompt",
    cwd: "/cwd",
    startedMs: 123,
    workflowSettings: { executionMode: "HOST" },
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
    logger: { warn: vi.fn() },
    ...overrides,
  };
}

describe("ProviderTelemetryWatcher", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("stops promptly during the initial delay and cleans up temp db path", async () => {
    vi.useFakeTimers();
    const opts = buildOptions({
      provider: "antigravity",
      nativeSessionId: null,
      antigravityLogPath: "/log",
      parseAntigravityConversationId: vi.fn().mockResolvedValue("native-1"),
      readAntigravityTranscript: vi.fn().mockResolvedValue(null),
      resolveAntigravityDatabase: vi.fn().mockResolvedValue(true),
    });
    const watcher = new ProviderTelemetryWatcher(opts);
    Object.assign(watcher, { tempDbPath: "/tmp/agy-temp-watcher-native-1-uuid.db" });

    watcher.start();
    await watcher.stop();

    expect(opts.parseAntigravityConversationId).not.toHaveBeenCalled();
    expect(fs.rm).toHaveBeenCalledWith("/tmp/agy-temp-watcher-native-1-uuid.db", { force: true });
  });

  it("logs repeated polling errors at a rate-limited warning level without failing the watcher", async () => {
    vi.useFakeTimers();
    const logger = { warn: vi.fn() };
    const opts = buildOptions({
      provider: "codex",
      nativeSessionId: "native-1",
      sessionId: "sess-1",
      readCodexLatestSessionJson: vi.fn().mockRejectedValue(new Error("contains /sensitive/path")),
      logger,
    });
    const watcher = new ProviderTelemetryWatcher(opts);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);
    await vi.advanceTimersByTimeAsync(30_000);
    await watcher.stop();

    expect(opts.readCodexLatestSessionJson).toHaveBeenCalledTimes(22);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.warn).toHaveBeenNthCalledWith(1, "Provider telemetry watcher polling failed", {
      provider: "codex",
      sessionId: "sess-1",
      nativeSessionId: "native-1",
      errorName: "Error",
      suppressedPollingErrors: 0,
      logPurpose: "invocation",
    });
    expect(logger.warn).toHaveBeenNthCalledWith(2, "Provider telemetry watcher polling failed", {
      provider: "codex",
      sessionId: "sess-1",
      nativeSessionId: "native-1",
      errorName: "Error",
      suppressedPollingErrors: 19,
      logPurpose: "invocation",
    });
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain("sensitive");
  });

  it("avoids repeated Antigravity database resolution while source inputs are unchanged", async () => {
    vi.useFakeTimers();
    let transcript = JSON.stringify({
      type: "PLANNER_RESPONSE",
      message: { content: "first response" },
      timestamp: "2026-01-01T00:00:00.000Z",
    });
    const opts = buildOptions({
      provider: "antigravity",
      nativeSessionId: null,
      antigravityLogPath: "/log",
      getAccumulatedRawStdout: () => "stdout changed",
      getAccumulatedStderr: () => "stderr changed",
      parseAntigravityConversationId: vi.fn().mockResolvedValue("native-1"),
      readAntigravityTranscript: vi.fn().mockImplementation(() => Promise.resolve(transcript)),
      resolveAntigravityDatabase: vi.fn().mockResolvedValue(true),
    });
    const watcher = new ProviderTelemetryWatcher(opts);

    watcher.start();
    await vi.advanceTimersByTimeAsync(1000);
    await vi.advanceTimersByTimeAsync(1500);

    transcript = JSON.stringify({
      type: "PLANNER_RESPONSE",
      message: { content: "second response" },
      timestamp: "2026-01-01T00:00:01.000Z",
    });
    await vi.advanceTimersByTimeAsync(1500);
    await watcher.stop();

    expect(opts.parseAntigravityConversationId).toHaveBeenCalledTimes(3);
    expect(opts.readAntigravityTranscript).toHaveBeenCalledTimes(3);
    expect(opts.resolveAntigravityDatabase).toHaveBeenCalledTimes(2);
    expect(opts.onTelemetry).toHaveBeenCalledTimes(3);
  });
});
