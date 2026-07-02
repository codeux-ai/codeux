import { describe, expect, it, vi } from "vitest";
import { ProviderTelemetryWatcher } from "../../../../../src/infrastructure/providers/cli/provider-telemetry-watcher.js";
import { collectProviderUsageTelemetry } from "../../../../../src/infrastructure/providers/cli/provider-usage.js";
import * as fs from "fs/promises";

vi.mock("../../../../../src/infrastructure/providers/cli/provider-usage.js", () => ({
  collectProviderUsageTelemetry: vi.fn(),
}));

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
