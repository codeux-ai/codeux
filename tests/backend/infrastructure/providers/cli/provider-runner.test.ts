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

  it("captures antigravity diagnostics via a --log-file and demotes an exit-0 quota run", async () => {
    // agy exits 0 with empty stdout/stderr; the real quota error lives only in its log file.
    dockerRunner.runProviderInDocker.mockResolvedValueOnce({
      ok: true,
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
    });
    dockerRunner.readWorkspaceFile.mockImplementation(async (_cwd: string, filePath: string) =>
      filePath.includes("antigravity-logs")
        ? "E0601 09:45:02.823154 813902 log.go:398] agent executor error: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact your administrator to enable overages. Resets in 3h4m52s.: RESOURCE_EXHAUSTED (code 429): Individual quota reached. Contact your administrator to enable overages. Resets in 3h4m52s."
        : "captured text");

    const result = await runner.runProvider({
      provider: "antigravity",
      prompt: "implement the feature",
      cwd: "/repo",
      model: "default",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    // The run is demoted to a failure and the quota line (with reset time) is surfaced in stderr.
    expect(result.ok).toBe(false);
    expect(result.stderr).toContain("Individual quota reached");
    expect(result.stderr).toContain("Resets in 3h4m52s");
    // The CLI must be told where to write its log so we can read it back.
    const call = dockerRunner.runProviderInDocker.mock.calls[0][0];
    const logFileIdx = call.args.indexOf("--log-file");
    expect(logFileIdx).toBeGreaterThanOrEqual(0);
    expect(call.args[logFileIdx + 1]).toContain("antigravity-logs");
  });

  it("sanitizes bootstrap-branch fatal fallback text in runProviderForText", async () => {
    dockerRunner.readWorkspaceFile.mockResolvedValue("");
    dockerRunner.runProviderInDocker.mockResolvedValueOnce({
      ok: true,
      stdout: "fatal: your current branch 'code-ux-bootstrap-1' does not have any commits yet\nkeep this line",
      stderr: "",
      code: 0,
      signal: null,
    });

    const result = await runner.runProviderForText({
      provider: "codex",
      prompt: "hello",
      cwd: "/repo",
      model: "default",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(result.text).toBe("keep this line");
  });

  it("leaves a normal antigravity completion successful when the log has no errors", async () => {
    dockerRunner.runProviderInDocker.mockResolvedValueOnce({
      ok: true,
      stdout: "",
      stderr: "",
      code: 0,
      signal: null,
    });
    dockerRunner.readWorkspaceFile.mockImplementation(async (_cwd: string, filePath: string) =>
      filePath.includes("antigravity-logs")
        ? "I0601 09:45:02.397366 813902 conversation_manager.go:284] Starting new conversation (agent=false)\nI0601 09:45:03.001858 813902 printmode_manager.go:90] Response complete"
        : "captured text");

    const result = await runner.runProvider({
      provider: "antigravity",
      prompt: "implement the feature",
      cwd: "/repo",
      model: "default",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
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
      args: ["--auth-type", "openai", "--yolo", "--session-id", expect.any(String), "--model", "qwen3-coder-plus", "-p", "ship it"],
      providerEnv: expect.objectContaining({
        BAILIAN_CODING_PLAN_API_KEY: "sk-sp-test",
        OPENAI_BASE_URL: "https://coding-intl.dashscope.aliyuncs.com/v1",
        QWEN_CODE_SUPPRESS_YOLO_WARNING: "1",
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
      args: ["--auth-type", "openai", "--yolo", "--session-id", expect.any(String), "--model", "glm-4.7-flash", "-p", "hello"],
      providerEnv: expect.objectContaining({
        OLLAMA_API_KEY: "sk-qwen-test",
        OPENAI_BASE_URL: "http://host.docker.internal:11434/v1",
        CODE_UX_PROVIDER_ENV_KEYS: "OLLAMA_API_KEY,QWEN_CODE_SUPPRESS_YOLO_WARNING",
        QWEN_CODE_SUPPRESS_YOLO_WARNING: "1",
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

  it("routes Claude Code through a custom base URL and model when configured", async () => {
    await runner.runProvider({
      provider: "claude-code",
      prompt: "build it",
      cwd: "/repo",
      model: "sonnet",
      apiKey: "sk-anthropic",
      customBaseUrl: "https://openrouter.ai/api/v1",
      customModel: "anthropic/claude-sonnet-4.5",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "claude",
      args: expect.arrayContaining(["--model", "anthropic/claude-sonnet-4.5", "-p", "build it"]),
      providerEnv: expect.objectContaining({
        // Gateway auth uses a Bearer token; ANTHROPIC_API_KEY is cleared to avoid conflicts.
        ANTHROPIC_AUTH_TOKEN: "sk-anthropic",
        ANTHROPIC_API_KEY: "",
        // Trailing /v1 is normalized off so Claude Code's appended /v1/messages resolves.
        ANTHROPIC_BASE_URL: "https://openrouter.ai/api",
        ANTHROPIC_MODEL: "anthropic/claude-sonnet-4.5",
        ANTHROPIC_SMALL_FAST_MODEL: "anthropic/claude-sonnet-4.5",
      }),
    }));
  });

  it("strips a trailing /v1 from the Claude Code base URL so Messages API paths resolve", async () => {
    await runner.runProvider({
      provider: "claude-code",
      prompt: "build it",
      cwd: "/repo",
      model: "sonnet",
      apiKey: "sk-anthropic",
      customBaseUrl: "https://openrouter.ai/api/v1",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const env = dockerRunner.runProviderInDocker.mock.calls[0][0].providerEnv;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://openrouter.ai/api");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("sk-anthropic");
  });

  it("uses the standard Anthropic API key header when no custom base URL is set", async () => {
    await runner.runProvider({
      provider: "claude-code",
      prompt: "build it",
      cwd: "/repo",
      model: "sonnet",
      apiKey: "sk-anthropic",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const env = dockerRunner.runProviderInDocker.mock.calls[0][0].providerEnv;
    expect(env.ANTHROPIC_API_KEY).toBe("sk-anthropic");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined();
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined();
  });

  it("routes Codex through a custom base URL and model via a dedicated model provider", async () => {
    await runner.runProvider({
      provider: "codex",
      prompt: "ship it",
      cwd: "/repo",
      model: "gpt-5-codex",
      apiKey: "sk-openai",
      customBaseUrl: "https://openrouter.ai/api/v1",
      customModel: "openai/gpt-5-codex",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "codex",
      args: expect.arrayContaining([
        "-c", `model_provider="custom_gateway"`,
        "-c", `model_providers.custom_gateway.base_url="https://openrouter.ai/api/v1"`,
        "-c", `model_providers.custom_gateway.env_key="OPENAI_API_KEY"`,
        "-c", `model_providers.custom_gateway.requires_openai_auth=false`,
        "--model", "openai/gpt-5-codex", "ship it",
      ]),
      providerEnv: expect.objectContaining({
        OPENAI_API_KEY: "sk-openai",
        OPENAI_BASE_URL: "https://openrouter.ai/api/v1",
        CODEX_MODEL: "openai/gpt-5-codex",
      }),
    }));
  });

  it("does not set a Codex wire_api override (Codex only supports the responses default)", async () => {
    await runner.runProvider({
      provider: "codex",
      prompt: "ship it",
      cwd: "/repo",
      model: "gpt-5-codex",
      apiKey: "sk-openai",
      customBaseUrl: "https://openrouter.ai/api/v1",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const args: string[] = dockerRunner.runProviderInDocker.mock.calls[0][0].args;
    expect(args.some((a) => a.includes("wire_api"))).toBe(false);
  });

  it("does not inject Codex custom provider flags without a custom base URL", async () => {
    await runner.runProvider({
      provider: "codex",
      prompt: "ship it",
      cwd: "/repo",
      model: "gpt-5-codex",
      apiKey: "sk-openai",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const args: string[] = dockerRunner.runProviderInDocker.mock.calls[0][0].args;
    expect(args).not.toContain("-c");
    expect(args).not.toContain(`model_provider="custom_gateway"`);
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

  it("reads Codex reported usage and conversation from the latest rollout .jsonl", async () => {
    // Timestamps must fall inside runProvider's run-isolation window
    // (turns older than the run start are dropped), so derive them from "now"
    // rather than hardcoding a wall-clock time that goes stale during the day.
    const base = Date.now();
    const ts = (offsetMs: number) => new Date(base + offsetMs).toISOString();
    const rollout = [
      { timestamp: ts(0), type: "session_meta", payload: { id: "codex-sess-1", cwd: "/workspace" } },
      { timestamp: ts(2000), type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "hello" }] } },
      { timestamp: ts(4000), type: "response_item", payload: { type: "function_call", name: "exec_command", arguments: "{\"cmd\":\"ls\"}", call_id: "call_1" } },
      { timestamp: ts(4500), type: "response_item", payload: { type: "function_call_output", call_id: "call_1", output: "file.txt" } },
      { timestamp: ts(5000), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: { input_tokens: 300, cached_input_tokens: 40, output_tokens: 90, reasoning_output_tokens: 5, total_tokens: 390 } } } },
      { timestamp: ts(6000), type: "response_item", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Listed files." }] } },
    ].map((line) => JSON.stringify(line)).join("\n");
    dockerRunner.readLatestWorkspaceFile = vi.fn(async () => rollout);

    const result = await runner.runProvider({
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

    // The rollout lookup must target the date-partitioned sessions dir with the *.jsonl glob.
    const [, dirArg, globArg] = dockerRunner.readLatestWorkspaceFile.mock.calls[0];
    expect(dirArg).toContain("/.codex/sessions/");
    expect(globArg).toBe("*.jsonl");

    expect(result.usageTelemetry).toMatchObject({
      inputTokens: 300,
      cachedInputTokens: 40,
      outputTokens: 90,
      reasoningOutputTokens: 5,
      totalTokens: 390,
      usageSource: "reported",
    });
    expect(result.usageTelemetry.conversation.map((t) => t.kind)).toEqual([
      "user",
      "tool_call",
      "tool_result",
      "assistant",
    ]);
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
