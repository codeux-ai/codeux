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
      providerEnv: expect.objectContaining({
        GEMINI_CLI_TRUST_WORKSPACE: "true",
      }),
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

  it("keeps JSON output enabled for Gemini when MCP config is injected", async () => {
    await runner.runProvider({
      provider: "gemini",
      prompt: "hello",
      cwd: "/repo",
      model: "gemini-3-flash-preview",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      mcpConnection: { url: "http://127.0.0.1:4444/mcp", authToken: "token" },
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "gemini",
      args: ["--yolo", "--output-format", "json", "--p", "hello"],
    }));
  });

  it("builds Qwen Code commands with Coding Plan auth metadata", async () => {
    await runner.runProvider({
      provider: "qwen-code",
      prompt: "ship it",
      cwd: "/repo",
      model: "qwen3-coder-plus",
      apiKey: "sk-sp-test",
      qwenAuthMode: "ALIBABA_CODING_PLAN",
      qwenRegion: "international",
      qwenProtocol: "openai",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "qwen",
      args: ["--auth-type", "openai", "--yolo", "--model", "qwen3-coder-plus", "-p", "ship it"],
      providerEnv: expect.objectContaining({
        BAILIAN_CODING_PLAN_API_KEY: "sk-sp-test",
        OPENAI_BASE_URL: "https://coding-intl.dashscope.aliyuncs.com/v1",
      }),
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
    expect(result.usageTelemetry.transcriptText).toBe("captured text");
  });

  it("collects Claude usage from the isolated workspace session artifact", async () => {
    dockerRunner.readWorkspaceFile = vi.fn(async (_cwd: string, targetPath: string) => {
      if (targetPath.includes("/.claude/projects/-workspace/native-123.jsonl")) {
        return JSON.stringify({
          message: {
            usage: {
              input_tokens: 12,
              cache_creation_input_tokens: 3,
              cache_read_input_tokens: 4,
              output_tokens: 8,
            },
            content: [{ type: "text", text: "Finished in container." }],
          },
        });
      }
      return null;
    });

    const result = await runner.runProvider({
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

    expect(dockerRunner.readWorkspaceFile).toHaveBeenCalledWith(
      "docker-volume://workspace-1",
      "/workspace/.sprint-os-home/.claude/projects/-workspace/native-123.jsonl",
    );
    expect(result.usageTelemetry).toMatchObject({
      inputTokens: 12,
      cachedInputTokens: 7,
      outputTokens: 8,
      totalTokens: 20,
      usageSource: "reported",
      transcriptText: "Finished in container.",
    });
  });
});
