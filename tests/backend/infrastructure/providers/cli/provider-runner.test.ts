import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProviderRunner } from "../../../../../src/infrastructure/providers/cli/provider-runner.js";

describe("ProviderRunner", () => {
  let dockerRunner: any;
  let runner: ProviderRunner;

  beforeEach(() => {
    dockerRunner = {
      ensureWorkspace: vi.fn(async ({ cwd }: { cwd: string }) => ({ cwd: cwd === "/repo" ? "docker-volume://workspace-1" : cwd, cleanup: vi.fn() })),
      runProviderInDocker: vi.fn(async () => ({
        ok: true,
        stdout: "provider stdout",
        stderr: "",
        code: 0,
        signal: null,
      })),
      readWorkspaceFile: vi.fn(async () => "captured text"),
    };
    runner = new ProviderRunner(dockerRunner);
  });

  it("prepares an isolated workspace before Docker execution", async () => {
    await runner.runProvider({
      provider: "gemini",
      prompt: "hello",
      cwd: "/repo",
      model: "gemini-2.5-pro",
      apiKey: "key",
      sessionId: "session-1",
      workspaceSessionId: "workspace-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/repo",
      repoPath: "/repo",
      sessionId: "workspace-1",
    });
    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "docker-volume://workspace-1",
      command: "gemini",
      args: ["--yolo", "--output-format", "json", "--p", "hello"],
    }));
  });

  it("forwards continueSessionId into Docker provider commands", async () => {
    await runner.runProvider({
      provider: "claude-code",
      prompt: "continue",
      cwd: "/repo",
      model: "sonnet",
      apiKey: "key",
      sessionId: "session-1",
      continueSessionId: "native-123",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.arrayContaining(["--session-id", "native-123"]),
    }));
  });

  it("captures Codex text output from the isolated workspace", async () => {
    const result = await runner.runProviderForText({
      provider: "codex",
      prompt: "hello",
      cwd: "/repo",
      model: "gpt-5.3-codex",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.readWorkspaceFile).toHaveBeenCalledWith(
      "docker-volume://workspace-1",
      "/workspace/provider-last-message-session-1.txt",
    );
    expect(result.text).toBe("captured text");
  });
});
