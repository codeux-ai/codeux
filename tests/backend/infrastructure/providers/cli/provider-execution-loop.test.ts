import { describe, expect, it, vi } from "vitest";
import { runProviderExecutionLoop, ProviderExecutionLoopOptions } from "../../../../../src/infrastructure/providers/cli/provider-execution-loop.js";

describe("ProviderExecutionLoop", () => {
  const getDefaultOptions = (): ProviderExecutionLoopOptions => ({
    provider: "gemini",
    command: "cmd",
    args: ["arg1"],
    continueSession: false,
    antigravityLogPath: null,
    runCmd: vi.fn().mockResolvedValue({ ok: true, stdout: "ok", stderr: "" }),
    trackingOnActivity: vi.fn(),
    isTransientCodexTransportError: vi.fn().mockReturnValue(false),
    isClaudeConversationNotFoundError: vi.fn().mockReturnValue(false),
    buildFreshClaudeSpec: vi.fn().mockReturnValue({ command: "fresh", args: ["freshArg"] }),
    readAntigravityDiagnostics: vi.fn().mockResolvedValue(null),
  });

  it("returns result without retries on success", async () => {
    const opts = getDefaultOptions();
    const result = await runProviderExecutionLoop(opts);
    expect(result.ok).toBe(true);
    expect(opts.runCmd).toHaveBeenCalledTimes(1);
    expect(opts.runCmd).toHaveBeenCalledWith("cmd", ["arg1"]);
  });

  it("retries Codex once on transient transport error", async () => {
    vi.useFakeTimers();
    const runCmd = vi.fn()
      .mockResolvedValueOnce({ ok: false, stdout: "error", stderr: "error" })
      .mockResolvedValueOnce({ ok: true, stdout: "ok", stderr: "" });
    const isTransientCodexTransportError = vi.fn().mockReturnValue(true);

    const opts: ProviderExecutionLoopOptions = {
      ...getDefaultOptions(),
      provider: "codex",
      runCmd,
      isTransientCodexTransportError,
    };

    const promise = runProviderExecutionLoop(opts);

    // Fast-forward the setTimeout
    await vi.runAllTimersAsync();

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(runCmd).toHaveBeenCalledTimes(2);
    expect(opts.trackingOnActivity).toHaveBeenCalledWith("Codex transport disconnected. Retrying once automatically...");

    vi.useRealTimers();
  });

  it("retries Claude Code with a fresh session when conversation is not found", async () => {
    const runCmd = vi.fn()
      .mockResolvedValueOnce({ ok: false, stdout: "error", stderr: "error" })
      .mockResolvedValueOnce({ ok: true, stdout: "ok", stderr: "" });
    const isClaudeConversationNotFoundError = vi.fn().mockReturnValue(true);

    const opts: ProviderExecutionLoopOptions = {
      ...getDefaultOptions(),
      provider: "claude-code",
      continueSession: true,
      runCmd,
      isClaudeConversationNotFoundError,
    };

    const result = await runProviderExecutionLoop(opts);
    expect(result.ok).toBe(true);
    expect(runCmd).toHaveBeenCalledTimes(2);
    expect(runCmd).toHaveBeenNthCalledWith(2, "fresh", ["freshArg"]);
    expect(opts.trackingOnActivity).toHaveBeenCalledWith("Claude Code could not resume the previous conversation (no conversation found). Retrying once with a fresh session...", "provider");
  });

  it("demotes Antigravity run to failure when diagnostics indicate an error", async () => {
    const runCmd = vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    const readAntigravityDiagnostics = vi.fn().mockResolvedValue("Executor error: INTERNAL_ERROR");

    const opts: ProviderExecutionLoopOptions = {
      ...getDefaultOptions(),
      provider: "antigravity",
      antigravityLogPath: "/tmp/agy.log",
      runCmd,
      readAntigravityDiagnostics,
    };

    const result = await runProviderExecutionLoop(opts);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Executor error: ");
    expect(opts.trackingOnActivity).toHaveBeenCalledWith(expect.stringContaining("Provider reported an error; provider stopped before completing the task."), "provider");
  });

  it("demotes Antigravity run to failure when diagnostics indicate quota limit reached", async () => {
    const runCmd = vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "" });
    const readAntigravityDiagnostics = vi.fn().mockResolvedValue("Executor error: RESOURCE_EXHAUSTED (code 429)");

    const opts: ProviderExecutionLoopOptions = {
      ...getDefaultOptions(),
      provider: "antigravity",
      antigravityLogPath: "/tmp/agy.log",
      runCmd,
      readAntigravityDiagnostics,
    };

    const result = await runProviderExecutionLoop(opts);
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Executor error: ");
    expect(opts.trackingOnActivity).toHaveBeenCalledWith(expect.stringContaining("Quota limit reached; provider stopped before completing the task."), "provider");
  });
});
