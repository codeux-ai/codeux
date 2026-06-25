import { describe, expect, it, vi } from "vitest";
import { ProviderTelemetryWatcher } from "../../../../../src/infrastructure/providers/cli/provider-telemetry-watcher.js";
import * as fs from "fs/promises";

vi.mock("fs/promises", async () => {
  return {
    rm: vi.fn().mockResolvedValue(undefined),
  };
});

describe("ProviderTelemetryWatcher", () => {
  it("stops on abort and cleans up temp db path", async () => {
    const opts = {
      provider: "antigravity" as const,
      model: "test-model",
      prompt: "test",
      cwd: "/cwd",
      startedMs: 123,
      workflowSettings: { executionMode: "HOST" as const },
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

    await watcher.stop();

    expect(fs.rm).toHaveBeenCalledWith("/tmp/agy-temp-watcher-native-1-uuid.db", { force: true });
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
});
