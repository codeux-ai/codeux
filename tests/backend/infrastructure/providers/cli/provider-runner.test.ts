import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";
import { ProviderRunner } from "../../../../../src/infrastructure/providers/cli/provider-runner.js";

vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runStreamingCommand: vi.fn(async () => ({
    ok: true,
    stdout: "provider stdout",
    stderr: "",
    code: 0,
    signal: null,
  })),
}));

describe("ProviderRunner", () => {
  let dockerRunner: any;
  let runner: ProviderRunner;

  beforeEach(() => {
    vi.clearAllMocks();
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

  it("uses the configured Qwen custom model and rewrites local Docker endpoints", async () => {
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = "1";
    try {
      await runner.runProvider({
        provider: "qwen-code",
        prompt: "hello",
        cwd: "/repo",
        model: "custom/model",
        apiKey: "sk-qwen-test",
        qwenAuthMode: "MODEL_PROVIDER",
        qwenModelId: "glm-4.7-flash",
        qwenBaseUrl: "http://127.0.0.1:11434/v1",
        qwenEnvKey: "OLLAMA_API_KEY",
        qwenProtocol: "openai",
        sessionId: "session-1",
        workflowSettings: { executionMode: "DOCKER" } as any,
        repoPath: "/repo",
        mcpConnection: { url: "http://127.0.0.1:4445/mcp", authToken: null },
        onActivity: vi.fn(),
      });
    } finally {
      if (originalRewrite === undefined) {
        delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
      } else {
        process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = originalRewrite;
      }
    }

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "qwen",
      args: ["--auth-type", "openai", "--yolo", "--model", "glm-4.7-flash", "-p", "hello"],
      providerEnv: expect.objectContaining({
        OLLAMA_API_KEY: "sk-qwen-test",
        OPENAI_BASE_URL: "http://host.docker.internal:11434/v1",
        CODE_UX_PROVIDER_ENV_KEYS: "OLLAMA_API_KEY",
      }),
    }));
    const env = dockerRunner.runProviderInDocker.mock.calls[0][0].providerEnv;
    expect(JSON.parse(env.QWEN_SETTINGS_CONTENT)).toMatchObject({
      modelProviders: {
        openai: [
          {
            id: "glm-4.7-flash",
            baseUrl: "http://host.docker.internal:11434/v1",
            envKey: "OLLAMA_API_KEY",
          },
        ],
      },
      model: {
        name: "glm-4.7-flash",
      },
      mcpServers: {
        code_ux: {
          httpUrl: "http://host.docker.internal:4445/mcp",
        },
      },
    });
  });

  it("builds OpenCode run commands with generated config content", async () => {
    await runner.runProvider({
      provider: "opencode",
      prompt: "review this",
      cwd: "/repo",
      model: "custom/model",
      apiKey: "sk-open-test",
      openCodeAuthMode: "CUSTOM_PROVIDER",
      openCodeProviderId: "custom",
      openCodeModelId: "model",
      openCodeBaseUrl: "https://llm.example.com/v1",
      openCodeEnvKey: "CUSTOM_LLM_API_KEY",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      mcpConnection: { url: "http://127.0.0.1:4444/mcp", authToken: "token" },
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "opencode",
      args: ["run", "--format", "json", "--dir", "/workspace", "--model", "custom/model", "review this"],
      providerEnv: expect.objectContaining({
        OPENCODE_API_KEY: "sk-open-test",
        OPENCODE_CONFIG_CONTENT: expect.stringContaining("\"baseURL\":\"https://llm.example.com/v1\""),
      }),
    }));
  });

  it("continues OpenCode with the native session id when one is available", async () => {
    await runner.runProvider({
      provider: "opencode",
      prompt: "retry json",
      cwd: "/repo",
      model: "anthropic/claude-sonnet-4-5",
      apiKey: "sk-open-test",
      sessionId: "planning-opencode-logical",
      continueSessionId: "ses_19151020bffeNmMNdnhmFM3fA5",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "opencode",
      args: ["run", "--session", "ses_19151020bffeNmMNdnhmFM3fA5", "--format", "json", "--dir", "/workspace", "--model", "anthropic/claude-sonnet-4-5", "retry json"],
    }));
  });

  it("continues the last OpenCode session when only the logical Code UX session id is available", async () => {
    const result = await runner.runProvider({
      provider: "opencode",
      prompt: "retry json",
      cwd: "/repo",
      model: "anthropic/claude-sonnet-4-5",
      apiKey: "sk-open-test",
      sessionId: "planning-opencode-logical",
      continueSessionId: "planning-opencode-logical",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "opencode",
      args: ["run", "--continue", "--format", "json", "--dir", "/workspace", "--model", "anthropic/claude-sonnet-4-5", "retry json"],
    }));
    expect(result.nativeSessionId).toBeNull();
  });

  it("uses the configured OpenCode custom provider model instead of a stale placeholder", async () => {
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = "1";
    try {
      await runner.runProvider({
        provider: "opencode",
        prompt: "hello",
        cwd: "/repo",
        model: "custom/model",
        apiKey: "sk-open-test",
        openCodeAuthMode: "CUSTOM_PROVIDER",
        openCodeProviderId: "ollama",
        openCodeModelId: "glm-4.7-flash",
        openCodeBaseUrl: "http://127.0.0.1:11434/v1",
        sessionId: "session-1",
        workflowSettings: { executionMode: "DOCKER" } as any,
        repoPath: "/repo",
        mcpConnection: { url: "http://127.0.0.1:4445/mcp", authToken: null },
        onActivity: vi.fn(),
      });
    } finally {
      if (originalRewrite === undefined) {
        delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
      } else {
        process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST = originalRewrite;
      }
    }

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "opencode",
      args: ["run", "--format", "json", "--dir", "/workspace", "--model", "ollama/glm-4.7-flash", "hello"],
      providerEnv: expect.objectContaining({
        OPENCODE_CONFIG_CONTENT: expect.stringContaining("\"model\":\"ollama/glm-4.7-flash\""),
      }),
    }));
    const env = dockerRunner.runProviderInDocker.mock.calls[0][0].providerEnv;
    expect(JSON.parse(env.OPENCODE_CONFIG_CONTENT)).toMatchObject({
      permission: "allow",
      provider: {
        ollama: {
          options: {
            baseURL: "http://host.docker.internal:11434/v1",
          },
        },
      },
      mcp: {
        code_ux: {
          url: "http://host.docker.internal:4445/mcp",
        },
      },
    });
  });

  it("materializes generated OpenCode config for host execution", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "provider-runner-"));
    let configPath = "";
    let configContent = "";
    vi.mocked(runStreamingCommand).mockImplementationOnce(async (_command, _args, _cwd, env) => {
      configPath = env.OPENCODE_CONFIG || "";
      configContent = await fs.readFile(configPath, "utf8");
      return {
        ok: true,
        stdout: "host stdout",
        stderr: "",
        code: 0,
        signal: null,
      };
    });

    await runner.runProvider({
      provider: "opencode",
      prompt: "hello",
      cwd: repoPath,
      model: "ollama/glm-4.7-flash",
      apiKey: "mykey",
      openCodeAuthMode: "CUSTOM_PROVIDER",
      openCodeProviderId: "ollama",
      openCodeModelId: "glm-4.7-flash",
      openCodeBaseUrl: "http://127.0.0.1:11434/v1",
      sessionId: "session/with/slash",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(runStreamingCommand).toHaveBeenCalledWith(
      "opencode",
      ["run", "--format", "json", "--dir", repoPath, "--model", "ollama/glm-4.7-flash", "hello"],
      repoPath,
      expect.objectContaining({
        OPENCODE_API_KEY: "mykey",
        OPENCODE_CONFIG: expect.stringContaining("opencode-config-session-with-slash.json"),
      }),
      expect.any(Object),
    );
    expect(configPath).toContain("opencode-config-session-with-slash.json");
    expect(JSON.parse(configContent)).toMatchObject({
      model: "ollama/glm-4.7-flash",
      permission: "allow",
      provider: {
        ollama: {
          npm: "@ai-sdk/openai-compatible",
          options: {
            baseURL: "http://127.0.0.1:11434/v1",
            apiKey: "{env:OPENCODE_API_KEY}",
          },
          models: {
            "glm-4.7-flash": {
              name: "glm-4.7-flash",
            },
          },
        },
      },
    });
    await expect(fs.access(configPath)).rejects.toThrow();
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
      "/workspace/.code-ux-home/.claude/projects/-workspace/native-123.jsonl",
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
