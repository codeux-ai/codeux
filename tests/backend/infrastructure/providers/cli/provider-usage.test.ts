import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import {
  collectProviderUsageTelemetry,
  parseQwenOpenAiLogs,
  sumQwenOpenAiUsage,
} from "../../../../../src/infrastructure/providers/cli/provider-usage.js";

const tempDirs: string[] = [];
const originalHome = process.env.HOME;

afterEach(async () => {
  process.env.HOME = originalHome;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("collectProviderUsageTelemetry", () => {
  beforeEach(() => {
    process.env.HOME = originalHome;
  });

  it("parses provider-reported Gemini token usage", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "gemini-2.5-pro",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        response: "Applied the edit.",
        session_id: "gemini-session-1",
        stats: {
          tokens: {
            input: 120,
            cached: 18,
            candidates: 42,
            thoughts: 7,
          },
        },
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 18,
      outputTokens: 42,
      reasoningOutputTokens: 7,
      totalTokens: 169,
      usageSource: "reported",
      transcriptText: "Applied the edit.",
      nativeSessionId: "gemini-session-1",
    });
  });

  it("parses provider-reported Gemini token usage with explicit total field", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "gemini-2.5-pro",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        response: "Applied the edit.",
        stats: {
          tokens: {
            input: 80,
            candidates: 20,
            thoughts: 10,
            total: 140,
          },
        },
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 80,
      outputTokens: 20,
      reasoningOutputTokens: 10,
      totalTokens: 140,
      usageSource: "reported",
      transcriptText: "Applied the edit.",
    });
  });

  it("parses provider-reported Gemini usage across model stats", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "default",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        response: "ok",
        stats: {
          models: {
            router: {
              tokens: {
                input: 57,
                cached: 2859,
                candidates: 33,
                thoughts: 123,
              },
            },
            main: {
              tokens: {
                input: 12265,
                cached: 0,
                candidates: 1,
                thoughts: 79,
              },
            },
          },
        },
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 12322,
      cachedInputTokens: 2859,
      outputTokens: 34,
      reasoningOutputTokens: 202,
      totalTokens: 12558,
      usageSource: "reported",
      transcriptText: "ok",
    });
  });

  it("estimates Gemini token usage when structured stats are unavailable", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "gemini",
      model: "default",
      prompt: "Summarize the diff.",
      cwd: "/workspace/repo",
      stdout: "Applied the edit without JSON stats.",
      stderr: "",
    });

    expect(result).toMatchObject({
      cachedInputTokens: 0,
      reasoningOutputTokens: 0,
      usageSource: "estimated",
      transcriptText: "Applied the edit without JSON stats.",
    });
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.inputTokens + result.outputTokens);
  });

  it("parses provider-reported Codex token usage from JSONL output", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-5.3-codex",
      prompt: "Fix the failing test.",
      cwd: "/workspace/repo",
      stdout: [
        JSON.stringify({ type: "status", payload: { type: "status", message: "running" } }),
        JSON.stringify({
          type: "token_count",
          payload: {
            type: "token_count",
            info: {
              total_token_usage: {
                input_tokens: 210,
                cached_input_tokens: 35,
                output_tokens: 84,
                reasoning_output_tokens: 16,
                total_tokens: 345,
              },
            },
          },
        }),
      ].join("\n"),
      stderr: "",
      capturedText: "Updated the implementation and tests.",
    });

    expect(result).toMatchObject({
      inputTokens: 210,
      cachedInputTokens: 35,
      outputTokens: 84,
      reasoningOutputTokens: 16,
      totalTokens: 294,
      usageSource: "reported",
      transcriptText: "Updated the implementation and tests.",
    });
  });

  it("falls back to estimated Codex tokens when JSONL usage is unavailable", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-5.3-codex",
      prompt: "Refactor the helper.",
      cwd: "/workspace/repo",
      stdout: "plain text output",
      stderr: "",
      capturedText: "Refactor complete.",
    });

    expect(result.usageSource).toBe("estimated");
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.totalTokens).toBe(result.inputTokens + result.outputTokens);
    expect(result.transcriptText).toBe("Refactor complete.");
  }, 15000);

  it("parses OpenCode JSON event output and captures the native session id", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "opencode",
      model: "anthropic/claude-sonnet-4-5",
      prompt: "Plan the sprint.",
      cwd: "/workspace/repo",
      stdout: [
        JSON.stringify({
          type: "session.created",
          properties: {
            info: {
              id: "ses_19151020bffeNmMNdnhmFM3fA5",
            },
          },
        }),
        JSON.stringify({
          type: "text",
          part: {
            type: "text",
            text: "{\"goal\":\"ok\",\"tasks\":[]}",
          },
        }),
        JSON.stringify({
          type: "step_finish",
          part: {
            usage: {
              promptTokens: 123,
              completionTokens: 45,
            },
          },
        }),
      ].join("\n"),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 123,
      outputTokens: 45,
      totalTokens: 168,
      usageSource: "reported",
      transcriptText: "{\"goal\":\"ok\",\"tasks\":[]}",
      nativeSessionId: "ses_19151020bffeNmMNdnhmFM3fA5",
    });
  });

  it("uses Codex session file for reported usage when stdout has no token_count events", async () => {
    const sessionJson = JSON.stringify({
      id: "sess-abc123",
      model: "gpt-4o-codex",
      usage: {
        input_tokens: 500,
        cached_input_tokens: 80,
        output_tokens: 120,
        reasoning_output_tokens: 10,
      },
    });

    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Write unit tests.",
      cwd: "/workspace/repo",
      stdout: "plain text output no json",
      stderr: "",
      capturedText: "Tests written.",
      codexSessionJson: sessionJson,
    });

    expect(result).toMatchObject({
      inputTokens: 500,
      cachedInputTokens: 80,
      outputTokens: 120,
      reasoningOutputTokens: 10,
      totalTokens: 620,
      usageSource: "reported",
      transcriptText: "Tests written.",
    });
  });

  it("uses Codex session file with OpenAI completion_tokens naming convention", async () => {
    const sessionJson = JSON.stringify({
      id: "sess-xyz",
      model: "o4-mini",
      usage: {
        prompt_tokens: 800,
        completion_tokens: 200,
        prompt_tokens_details: { cached_tokens: 50 },
        completion_tokens_details: { reasoning_tokens: 30 },
      },
    });

    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "o4-mini",
      prompt: "Implement the feature.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
      codexSessionJson: sessionJson,
    });

    expect(result).toMatchObject({
      inputTokens: 800,
      cachedInputTokens: 50,
      outputTokens: 200,
      reasoningOutputTokens: 30,
      totalTokens: 1000,
      usageSource: "reported",
    });
  });

  it("aggregates Codex session usage from per-turn items when no top-level usage", async () => {
    const sessionJson = JSON.stringify({
      id: "sess-turns",
      model: "gpt-4o-codex",
      turns: [
        { role: "assistant", content: "First response", usage: { input_tokens: 100, output_tokens: 40, cached_input_tokens: 0 } },
        { role: "assistant", content: "Second response", usage: { input_tokens: 200, output_tokens: 60, cached_input_tokens: 20 } },
      ],
    });

    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Multi-turn task.",
      cwd: "/workspace/repo",
      stdout: "",
      stderr: "",
      codexSessionJson: sessionJson,
    });

    expect(result).toMatchObject({
      inputTokens: 300,
      cachedInputTokens: 20,
      outputTokens: 100,
      totalTokens: 400,
      usageSource: "reported",
    });
  });

  it("prefers stdout token_count events over Codex session file", async () => {
    const sessionJson = JSON.stringify({
      id: "sess-override",
      model: "gpt-4o-codex",
      usage: { input_tokens: 9999, output_tokens: 9999 },
    });

    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Fix the bug.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 210,
              cached_input_tokens: 35,
              output_tokens: 84,
              reasoning_output_tokens: 16,
            },
          },
        },
      }),
      stderr: "",
      capturedText: "Bug fixed.",
      codexSessionJson: sessionJson,
    });

    expect(result).toMatchObject({
      inputTokens: 210,
      cachedInputTokens: 35,
      outputTokens: 84,
      usageSource: "reported",
    });
  });

  it("parses Codex token_count usage with camelCase fields", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Fix the bug.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              inputTokens: 144,
              cached_input_tokens: 12,
              outputTokens: 56,
            },
          },
        },
      }),
      stderr: "",
      capturedText: "Bug fixed.",
    });

    expect(result).toMatchObject({
      inputTokens: 144,
      cachedInputTokens: 12,
      outputTokens: 56,
      totalTokens: 200,
      usageSource: "reported",
    });
  });

  it("parses Codex usage when only total and prompt tokens are reported", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Generate tests.",
      cwd: "/workspace/repo",
      stdout: JSON.stringify({
        type: "token_count",
        payload: {
          type: "token_count",
          info: {
            total_token_usage: {
              prompt_tokens: 300,
              total_tokens: 470,
            },
          },
        },
      }),
      stderr: "",
      capturedText: "Generated tests.",
    });

    expect(result).toMatchObject({
      inputTokens: 300,
      outputTokens: 170,
      totalTokens: 470,
      usageSource: "reported",
    });
  });

  it("falls back to estimation when both Codex stdout and session file lack usage", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "codex",
      model: "gpt-4o-codex",
      prompt: "Explain the code.",
      cwd: "/workspace/repo",
      stdout: "some output",
      stderr: "",
      capturedText: "Explanation here.",
      codexSessionJson: JSON.stringify({ id: "sess-empty", model: "gpt-4o-codex" }),
    });

    expect(result.usageSource).toBe("estimated");
    expect(result.inputTokens).toBeGreaterThan(0);
  }, 15000);

  it("parses Claude session artifacts for reported usage", async () => {
    const fakeHome = await fs.mkdtemp(path.join(os.tmpdir(), "claude-usage-home-"));
    tempDirs.push(fakeHome);
    process.env.HOME = fakeHome;

    const cwd = "/workspace/repo";
    const slug = cwd.replaceAll(path.sep, "-");
    const sessionId = "f060b6ff-b942-4d7f-a5d3-d6ad8af102f8";
    const sessionDir = path.join(fakeHome, ".claude", "projects", slug);
    await fs.mkdir(sessionDir, { recursive: true });
    await fs.writeFile(
      path.join(sessionDir, `${sessionId}.jsonl`),
      [
        JSON.stringify({
          message: {
            usage: {
              input_tokens: 91,
              cache_creation_input_tokens: 12,
              cache_read_input_tokens: 7,
              output_tokens: 33,
            },
            content: [{ type: "text", text: "Implemented the requested fix." }],
          },
        }),
      ].join("\n"),
      "utf8",
    );

    const result = await collectProviderUsageTelemetry({
      provider: "claude-code",
      model: "claude-sonnet-4-6",
      prompt: "Resolve the merge conflict.",
      cwd,
      stdout: "",
      stderr: "",
      nativeSessionId: sessionId,
    });

    expect(result).toMatchObject({
      inputTokens: 91,
      cachedInputTokens: 19,
      outputTokens: 33,
      totalTokens: 124,
      usageSource: "reported",
      transcriptText: "Implemented the requested fix.",
      nativeSessionId: sessionId,
    });
  });

  it("parses Claude container session artifacts for reported usage", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "claude-code",
      model: "claude-sonnet-4-6",
      prompt: "Resolve the merge conflict.",
      cwd: "docker-volume://workspace-1",
      stdout: "",
      stderr: "",
      nativeSessionId: "container-native-1",
      claudeSessionJsonl: [
        JSON.stringify({
          message: {
            usage: {
              input_tokens: 44,
              cache_creation_input_tokens: 5,
              cache_read_input_tokens: 6,
              output_tokens: 22,
            },
            content: [{ type: "text", text: "Container fix complete." }],
          },
        }),
      ].join("\n"),
    });

    expect(result).toMatchObject({
      inputTokens: 44,
      cachedInputTokens: 11,
      outputTokens: 22,
      totalTokens: 66,
      usageSource: "reported",
      transcriptText: "Container fix complete.",
      nativeSessionId: "container-native-1",
    });
  });

  it("estimates telemetry for qwen-code when logs are not found", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "qwen-code",
      model: "qwen3-coder-plus",
      prompt: "Implement binary search.",
      cwd: "/workspace",
      stdout: "Here is the binary search implementation.",
      stderr: "",
      nativeSessionId: "qwen-session-123",
    });

    expect(result).toMatchObject({
      inputTokens: expect.any(Number),
      outputTokens: expect.any(Number),
      totalTokens: expect.any(Number),
      usageSource: "estimated",
      nativeSessionId: "qwen-session-123",
    });
  });

  it("reports Qwen Code usage supplied from parsed OpenAI logs", async () => {
    const result = await collectProviderUsageTelemetry({
      provider: "qwen-code",
      model: "qwen3-coder-plus",
      prompt: "Implement binary search.",
      cwd: "/workspace",
      stdout: "Here is the binary search implementation.",
      stderr: "",
      nativeSessionId: "qwen-session-123",
      qwenReportedUsage: { inputTokens: 1500, cachedInputTokens: 50, outputTokens: 450 },
    });

    expect(result).toMatchObject({
      inputTokens: 1500,
      cachedInputTokens: 50,
      outputTokens: 450,
      totalTokens: 1950,
      usageSource: "reported",
      nativeSessionId: "qwen-session-123",
    });
  });
});

describe("parseQwenOpenAiLogs", () => {
  it("aggregates usage from response.usage across multiple log files", async () => {
    const logDir = path.join(os.tmpdir(), `code-ux-qwen-logs-${Date.now().toString(36)}`);
    tempDirs.push(logDir);
    await fs.mkdir(logDir, { recursive: true });

    await fs.writeFile(
      path.join(logDir, "openai-1.json"),
      JSON.stringify({
        timestamp: new Date().toISOString(),
        request: { model: "qwen3-coder-plus" },
        response: {
          usage: {
            prompt_tokens: 1500,
            completion_tokens: 450,
            prompt_tokens_details: { cached_tokens: 50 },
          },
        },
      }),
      "utf8",
    );
    await fs.writeFile(
      path.join(logDir, "openai-2.json"),
      JSON.stringify({
        response: { usage: { prompt_tokens: 200, completion_tokens: 80 } },
      }),
      "utf8",
    );

    const usage = await parseQwenOpenAiLogs(logDir, Date.now() - 500);

    expect(usage).toEqual({ inputTokens: 1700, cachedInputTokens: 50, outputTokens: 530 });
  });

  it("returns null when no log file reports usage", async () => {
    const logDir = path.join(os.tmpdir(), `code-ux-qwen-empty-${Date.now().toString(36)}`);
    tempDirs.push(logDir);
    await fs.mkdir(logDir, { recursive: true });
    await fs.writeFile(path.join(logDir, "openai-err.json"), JSON.stringify({ error: { message: "boom" } }), "utf8");

    expect(await parseQwenOpenAiLogs(logDir, Date.now() - 500)).toBeNull();
  });

  it("falls back to a top-level usage object (legacy logs)", () => {
    expect(sumQwenOpenAiUsage([{ usage: { input_tokens: 10, output_tokens: 4 } }]))
      .toEqual({ inputTokens: 10, cachedInputTokens: 0, outputTokens: 4 });
  });
});
