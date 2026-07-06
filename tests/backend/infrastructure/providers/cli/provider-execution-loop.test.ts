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
    isOpenCodeSessionNotFoundError: vi.fn().mockReturnValue(false),
    buildFreshClaudeSpec: vi.fn().mockReturnValue({ command: "fresh", args: ["freshArg"] }),
    buildFreshOpenCodeSpec: vi.fn().mockReturnValue({ command: "opencode", args: ["run", "--format", "json", "--dir", "/workspace", "freshArg"] }),
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
    expect(JSON.stringify(opts.trackingOnActivity.mock.calls)).not.toContain("error");
    expect(JSON.stringify(opts.trackingOnActivity.mock.calls)).not.toContain("arg1");

    vi.useRealTimers();
  });

  it("classifies command failures through provider activity without raw command payloads", async () => {
    const rawSecret = "sk-loop-secret";
    const rawPrompt = "raw loop prompt";
    const rawCommandPayload = `cmd --prompt "${rawPrompt}" OPENAI_API_KEY=${rawSecret}`;
    const runCmd = vi.fn()
      .mockResolvedValueOnce({ ok: false, stdout: rawCommandPayload, stderr: rawCommandPayload })
      .mockResolvedValueOnce({ ok: true, stdout: "ok", stderr: "" });
    const opts: ProviderExecutionLoopOptions = {
      ...getDefaultOptions(),
      provider: "claude-code",
      args: ["--resume", "native-session", "--prompt", rawPrompt],
      continueSession: true,
      runCmd,
      isClaudeConversationNotFoundError: vi.fn().mockReturnValue(true),
    };

    const result = await runProviderExecutionLoop(opts);

    expect(result.ok).toBe(true);
    expect(opts.trackingOnActivity).toHaveBeenCalledWith(
      "Claude Code could not resume the previous conversation (no conversation found). Retrying once with a fresh session...",
      "provider",
    );
    const activityPayload = JSON.stringify(opts.trackingOnActivity.mock.calls);
    expect(activityPayload).not.toContain(rawPrompt);
    expect(activityPayload).not.toContain(rawSecret);
    expect(activityPayload).not.toContain("OPENAI_API_KEY");
    expect(activityPayload).not.toContain(rawCommandPayload);
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

  it("retries OpenCode with a fresh session when the native session is not found", async () => {
    const runCmd = vi.fn()
      .mockResolvedValueOnce({ ok: false, stdout: "", stderr: "Error: Session not found" })
      .mockResolvedValueOnce({ ok: true, stdout: "ok", stderr: "" });
    const isOpenCodeSessionNotFoundError = vi.fn().mockReturnValue(true);

    const opts: ProviderExecutionLoopOptions = {
      ...getDefaultOptions(),
      provider: "opencode",
      continueSession: true,
      runCmd,
      isOpenCodeSessionNotFoundError,
    };

    const result = await runProviderExecutionLoop(opts);
    expect(result.ok).toBe(true);
    expect(runCmd).toHaveBeenCalledTimes(2);
    expect(runCmd).toHaveBeenNthCalledWith(2, "opencode", ["run", "--format", "json", "--dir", "/workspace", "freshArg"]);
    expect(opts.trackingOnActivity).toHaveBeenCalledWith("OpenCode could not resume the previous session (session not found). Retrying once with a fresh session...", "provider");
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
