import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { collectProviderUsageTelemetry } from "../../../../../src/infrastructure/providers/cli/provider-usage.js";

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
});
