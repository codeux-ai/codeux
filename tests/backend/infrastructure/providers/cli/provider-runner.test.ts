import { describe, it, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import * as fs from "fs/promises";
import { ProviderRunner } from "../../../../../src/infrastructure/providers/cli/provider-runner.js";
import { IDockerRunner } from "../../../../../src/infrastructure/providers/cli/docker-runner.js";
import { runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";
import { isDockerWorkspaceMountError } from "../../../../../src/services/cli-docker-utils.js";
import { CliWorkflowSettings } from "../../../../../src/contracts/app-types.js";

vi.mock("fs/promises");
vi.mock("../../../../../src/services/cli-process-runner.js", () => ({
  runStreamingCommand: vi.fn(),
}));
vi.mock("../../../../../src/services/cli-docker-utils.js", () => ({
  isDockerWorkspaceMountError: vi.fn(),
}));

describe("ProviderRunner", () => {
  let runner: ProviderRunner;
  let mockDockerRunner: IDockerRunner;
  let defaultWorkflowSettings: CliWorkflowSettings;

  beforeEach(() => {
    vi.resetAllMocks();

    mockDockerRunner = {
      runProviderInDocker: vi.fn(),
    };
    runner = new ProviderRunner(mockDockerRunner);

    vi.mocked(runStreamingCommand).mockResolvedValue({
      ok: true,
      stdout: "mock stdout",
      stderr: "mock stderr",
      code: 0,
      signal: null,
    });

    vi.mocked(mockDockerRunner.runProviderInDocker).mockResolvedValue({
      ok: true,
      stdout: "mock docker stdout",
      stderr: "mock docker stderr",
      code: 0,
      signal: null,
    });

    vi.mocked(fs.access).mockResolvedValue(undefined);
    vi.mocked(isDockerWorkspaceMountError).mockReturnValue(false);

    defaultWorkflowSettings = {
      executionMode: "HOST",
    } as CliWorkflowSettings;

    process.env = {}; // Clear environment variables for testing
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should run gemini locally correctly", async () => {
    const onActivity = vi.fn();

    await runner.runProvider({
      provider: "gemini",
      prompt: "test prompt",
      cwd: "/repo",
      model: "test-model",
      apiKey: "test-api-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      onActivity,
    });

    expect(runStreamingCommand).toHaveBeenCalled();
    const [cmd, args, cwd, env] = vi.mocked(runStreamingCommand).mock.calls[0];

    expect(cmd).toBe("gemini");
    expect(args).toEqual(["--yolo", "--p", "test prompt"]);
    expect(env.GEMINI_MODEL).toBe("test-model");
    expect(env.GEMINI_API_KEY).toBe("test-api-key");
  });

  it("should run claude-code locally correctly", async () => {
    const onActivity = vi.fn();

    await runner.runProvider({
      provider: "claude-code",
      prompt: "test prompt",
      cwd: "/repo",
      model: "test-model",
      apiKey: "test-api-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      onActivity,
    });

    expect(runStreamingCommand).toHaveBeenCalled();
    const [cmd, args, cwd, env] = vi.mocked(runStreamingCommand).mock.calls[0];

    expect(cmd).toBe("claude");
    expect(args).toEqual(["--dangerously-skip-permissions", "--model", "test-model", "-p", "test prompt"]);
    expect(env.ANTHROPIC_API_KEY).toBe("test-api-key");
  });

  it("should run codex locally correctly", async () => {
    const onActivity = vi.fn();

    await runner.runProvider({
      provider: "codex",
      prompt: "test prompt",
      cwd: "/repo",
      model: "test-model",
      apiKey: "test-api-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      onActivity,
    });

    expect(runStreamingCommand).toHaveBeenCalled();
    const [cmd, args, cwd, env] = vi.mocked(runStreamingCommand).mock.calls[0];

    expect(cmd).toBe("codex");
    expect(args).toEqual(["exec", "--yolo", "--output-last-message", "/tmp/codex-last-message.txt", "--model", "test-model", "test prompt"]);
    expect(env.CODEX_MODEL).toBe("test-model");
    expect(env.OPENAI_API_KEY).toBe("test-api-key");
  });

  it("should execute via DockerRunner when executionMode is DOCKER", async () => {
    const onActivity = vi.fn();
    defaultWorkflowSettings.executionMode = "DOCKER";

    await runner.runProvider({
      provider: "gemini",
      prompt: "test prompt",
      cwd: "/repo",
      model: "test-model",
      apiKey: "test-api-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      onActivity,
    });

    expect(runStreamingCommand).not.toHaveBeenCalled();
    expect(mockDockerRunner.runProviderInDocker).toHaveBeenCalled();
  });

  it("should not pass mounted Gemini auth or GitHub token env vars into Docker", async () => {
    const onActivity = vi.fn();
    defaultWorkflowSettings = {
      executionMode: "DOCKER",
      containerMountGithubAuth: true,
      containerMountGeminiAuth: true,
    } as CliWorkflowSettings;

    await runner.runProvider({
      provider: "gemini",
      prompt: "test prompt",
      cwd: "/repo",
      model: "test-model",
      apiKey: "test-api-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      githubToken: "gh-token-123",
      onActivity,
    });

    const [input] = vi.mocked(mockDockerRunner.runProviderInDocker).mock.calls[0];
    expect(input.providerEnv.GEMINI_MODEL).toBe("test-model");
    expect(input.providerEnv.GEMINI_API_KEY).toBeUndefined();
    expect(input.providerEnv.GH_TOKEN).toBeUndefined();
    expect(input.providerEnv.GITHUB_TOKEN).toBeUndefined();
  });

  it("should handle Docker workspace mount error", async () => {
    const onActivity = vi.fn();
    defaultWorkflowSettings.executionMode = "DOCKER";

    vi.mocked(mockDockerRunner.runProviderInDocker).mockResolvedValue({
      ok: false,
      stdout: "",
      stderr: "mount error",
      code: 1,
      signal: null,
    });

    vi.mocked(isDockerWorkspaceMountError).mockReturnValue(true);

    await runner.runProvider({
      provider: "gemini",
      prompt: "test prompt",
      cwd: "/repo",
      model: "default",
      apiKey: "test-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      onActivity,
    });

    expect(fs.access).toHaveBeenCalledWith("/repo");
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Docker could not mount workspace path"));
  });

  it("should retry codex transient transport errors", async () => {
    const onActivity = vi.fn();

    vi.mocked(runStreamingCommand).mockResolvedValueOnce({
      ok: false,
      stdout: "error",
      stderr: "stream disconnected before completion",
      code: 1,
      signal: null,
    }).mockResolvedValueOnce({
      ok: true,
      stdout: "success",
      stderr: "",
      code: 0,
      signal: null,
    });

    await runner.runProvider({
      provider: "codex",
      prompt: "test prompt",
      cwd: "/repo",
      model: "default",
      apiKey: "test-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      onActivity,
    });

    expect(runStreamingCommand).toHaveBeenCalledTimes(2);
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Codex transport disconnected. Retrying once automatically..."));
  });

  it("should map GH_TOKEN correctly if githubToken is provided", async () => {
    const onActivity = vi.fn();

    await runner.runProvider({
      provider: "gemini",
      prompt: "test prompt",
      cwd: "/repo",
      model: "default",
      apiKey: "test-key",
      sessionId: "session-1",
      workflowSettings: defaultWorkflowSettings,
      repoPath: "/repo",
      githubToken: "gh-token-123",
      onActivity,
    });

    const [, , , env] = vi.mocked(runStreamingCommand).mock.calls[0];
    expect(env.GH_TOKEN).toBe("gh-token-123");
    expect(env.GITHUB_TOKEN).toBe("gh-token-123");
  });
});
