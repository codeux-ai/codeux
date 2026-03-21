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
          },
        },
      }),
      stderr: "",
    });

    expect(result).toMatchObject({
      inputTokens: 120,
      cachedInputTokens: 18,
      outputTokens: 42,
      totalTokens: 180,
      usageSource: "reported",
      transcriptText: "Applied the edit.",
      nativeSessionId: "gemini-session-1",
    });
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
      totalTokens: 345,
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
  });

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
      totalTokens: 143,
      usageSource: "reported",
      transcriptText: "Implemented the requested fix.",
      nativeSessionId: sessionId,
    });
  });
});
