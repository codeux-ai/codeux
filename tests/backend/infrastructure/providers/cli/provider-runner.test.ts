import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { runStreamingCommand } from "../../../../../src/services/cli-process-runner.js";
import { ProviderRunner } from "../../../../../src/infrastructure/providers/cli/provider-runner.js";
import { resolveEffectiveModel } from "../../../../../src/services/provider-execution-service.js";

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

  it("prewarms an isolated Docker workspace without launching a provider", async () => {
    await runner.prewarmWorkspace({
      cwd: "/repo",
      repoPath: "/repo",
      sessionId: "thread-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      snapshotCheckout: { branch: "main", remoteOnly: true },
      gitPolicy: { githubMode: "REMOTE", defaultBranch: "main" },
    });

    expect(dockerRunner.ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/repo",
      repoPath: "/repo",
      sessionId: "thread-1",
      snapshotCheckout: { branch: "main", remoteOnly: true },
      gitPolicy: { githubMode: "REMOTE", defaultBranch: "main" },
      preserve: true,
      reuseExisting: true,
    });
    expect(dockerRunner.runProviderInDocker).not.toHaveBeenCalled();
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
      googleDriveMount: {
        source: "/linked/google-drive",
        destination: "/mnt/code-ux/google-drive",
        readonly: true,
      },
      onActivity: vi.fn(),
    });

    expect(dockerRunner.ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/repo",
      repoPath: "/repo",
      sessionId: "workspace-1",
      snapshotCheckout: undefined,
      gitPolicy: undefined,
      preserve: true,
      reuseExisting: false,
    });
    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "docker-volume://workspace-1",
      command: "gemini",
      args: ["--yolo", "--output-format", "json", "--p", "hello"],
      providerEnv: expect.objectContaining({
        GEMINI_CLI_TRUST_WORKSPACE: "true",
      }),
      googleDriveMount: {
        source: "/linked/google-drive",
        destination: "/mnt/code-ux/google-drive",
        readonly: true,
      },
    }));
  });

  it("keeps structured Docker provider events out of the activity stream", async () => {
    const onActivity = vi.fn();
    dockerRunner.runProviderInDocker.mockImplementation(async (options: any) => {
      options.onActivity(JSON.stringify({ type: "message", text: "machine event" }), "agent");
      options.onActivity("Readable progress", "agent");
      return { ok: true, stdout: "", stderr: "", code: 0, signal: null };
    });

    await runner.runProvider({
      provider: "gemini",
      prompt: "hello",
      cwd: "/repo",
      model: "gemini-2.5-pro",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity,
    });

    expect(onActivity).toHaveBeenCalledWith("Readable progress", "agent");
    expect(onActivity).not.toHaveBeenCalledWith(expect.stringContaining("machine event"), "agent");
  });

  it("executes mockup-cli in host mode without credentials and mutates only the workspace", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-host-"));
    const outsidePath = path.join(os.tmpdir(), "mockup-cli-outside.txt");

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: [
        "mockup-cli:write src/generated.txt :: hello from mockup",
        "mockup-cli:append src/generated.txt :: second line",
        `mockup-cli:run node -e "require('fs').accessSync('src/generated.txt')"`,
      ].join("\n"),
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-1",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      googleDriveMount: {
        source: "/linked/google-drive",
        destination: "/mnt/code-ux/google-drive",
        readonly: false,
      },
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(result.nativeSessionId).toMatch(/^mockup-cli-[0-9a-f]{16}$/);
    expect(result.text).toBe("Mockup CLI completed deterministic workspace task.");
    expect(result.usageTelemetry).toMatchObject({
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      usageSource: "unsupported",
      transcriptText: "Mockup CLI completed deterministic workspace task.",
      nativeSessionId: result.nativeSessionId,
    });
    await expect(fs.readFile(path.join(repoPath, "src/generated.txt"), "utf8")).resolves.toBe("hello from mockup\nsecond line\n");
    await expect(fs.access(outsidePath)).rejects.toThrow();
    expect(runStreamingCommand).not.toHaveBeenCalled();
    expect(dockerRunner.runProviderInDocker).not.toHaveBeenCalled();

    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("ignores generic validation language outside explicit mockup directives", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-explicit-only-"));

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: [
        "## SYSTEM INSTRUCTIONS",
        "2. **Unit & Integration**: `npm run test` and `npm run test:coverage` must pass.",
        "",
        "## SUBTASK TO EXECUTE",
        "Use only the deterministic mockup-cli directives below.",
        "mockup-cli:write src/generated.txt :: explicit directives only",
        "",
        "## MEMORY CONTEXT",
        "- [patterns] Run validation commands: npm run missing-script",
      ].join("\n"),
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-explicit-only",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Mockup CLI completed deterministic workspace task.");
    await expect(fs.readFile(path.join(repoPath, "src/generated.txt"), "utf8")).resolves.toBe("explicit directives only\n");

    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("returns a nonzero mockup-cli failure for explicit failure directives", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-fail-"));

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: "mockup-cli:fail",
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-fail",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(false);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("mockup-cli intentional failure directive triggered");
    expect(result.text).toBe("Mockup CLI intentional failure directive triggered.");
    expect(result.nativeSessionId).toMatch(/^mockup-cli-[0-9a-f]{16}$/);

    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("supports the full deterministic mockup directive surface in one sprint step", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-full-"));

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: [
        "mockup-cli:write src/base.txt :: base",
        "mockup-cli:append src/base.txt :: appended",
        "mockup-cli:replace src/base.txt :: appended => replaced",
        "mockup-cli:write src/delete-me.txt :: remove me",
        "mockup-cli:delete src/delete-me.txt",
        "mockup-cli:conflict src/conflict.txt :: incoming deterministic edit",
        `mockup-cli:run node -e "const fs=require('fs'); const text=fs.readFileSync('src/base.txt','utf8'); if (!text.includes('replaced')) process.exit(1)"`,
      ].join("\n"),
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-full",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(result.text).toBe("Mockup CLI completed deterministic workspace task.");
    await expect(fs.readFile(path.join(repoPath, "src/base.txt"), "utf8")).resolves.toContain("replaced");
    await expect(fs.access(path.join(repoPath, "src", "delete-me.txt"))).rejects.toThrow();
    await expect(fs.readFile(path.join(repoPath, "src", "conflict.txt"), "utf8")).resolves.toContain("<<<<<<< mockup-cli-current");

    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("resolves active merge conflict markers for mockup virtual conflict workers", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-conflict-resolve-"));
    await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "README.md"), [
      "# Fixture",
      "<<<<<<< HEAD",
      "Left sibling edited the conflict target.",
      "=======",
      "Right sibling edited the conflict target.",
      ">>>>>>> task/right",
      "",
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(repoPath, "src", "conflict-target.js"), [
      "export function conflictValue() {",
      "<<<<<<< HEAD",
      "  return 'left';",
      "=======",
      "  return 'right';",
      ">>>>>>> task/right",
      "}",
      "",
    ].join("\n"), "utf8");
    await fs.mkdir(path.join(repoPath, ".code-ux"), { recursive: true });
    await fs.writeFile(path.join(repoPath, ".code-ux", "mockup-pentest.log"), [
      "<<<<<<< HEAD",
      "left task completed",
      "||||||| merged common ancestors",
      "root task completed",
      "=======",
      "right task completed",
      ">>>>>>> task/right",
      "",
    ].join("\n"), "utf8");

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: "Resolve the active Git merge conflict already present in this worktree.",
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-conflict-resolve",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    const readme = await fs.readFile(path.join(repoPath, "README.md"), "utf8");
    expect(readme).toContain("Left sibling edited the conflict target.");
    expect(readme).toContain("Right sibling edited the conflict target.");
    expect(readme).not.toContain("<<<<<<<");
    expect(readme).not.toContain(">>>>>>>");
    await expect(fs.readFile(path.join(repoPath, "src", "conflict-target.js"), "utf8")).resolves.toContain("return 'left+right';");
    const pentestLog = await fs.readFile(path.join(repoPath, ".code-ux", "mockup-pentest.log"), "utf8");
    expect(pentestLog).toContain("left task completed");
    expect(pentestLog).toContain("right task completed");
    expect(pentestLog).not.toContain("|||||||");
    expect(pentestLog).not.toContain("<<<<<<<");

    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("resolves final local merge conflict markers for mockup virtual conflict workers", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-final-conflict-resolve-"));
    await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "src", "final-merge-conflict.js"), [
      "export function finalMergeValue() {",
      "<<<<<<< HEAD",
      "  return 'feature';",
      "=======",
      "  return 'default';",
      ">>>>>>> main",
      "}",
      "",
    ].join("\n"), "utf8");

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: "Resolve the active Git merge conflict already present in this worktree.",
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-final-conflict-resolve",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    const resolved = await fs.readFile(path.join(repoPath, "src", "final-merge-conflict.js"), "utf8");
    expect(resolved).toContain("return 'feature+default';");
    expect(resolved).not.toContain("<<<<<<<");
    expect(resolved).not.toContain(">>>>>>>");

    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("prioritizes active merge conflict repair over embedded mockup directives", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-conflict-directives-"));
    await fs.mkdir(path.join(repoPath, "src"), { recursive: true });
    await fs.writeFile(path.join(repoPath, "README.md"), [
      "# Fixture",
      "<<<<<<< HEAD",
      "Left sibling edited the conflict target.",
      "=======",
      "Right sibling edited the conflict target.",
      ">>>>>>> task/right",
      "",
    ].join("\n"), "utf8");
    await fs.writeFile(path.join(repoPath, "src", "conflict-target.js"), [
      "export function conflictValue() {",
      "<<<<<<< HEAD",
      "  return 'left';",
      "=======",
      "  return 'right';",
      ">>>>>>> task/right",
      "}",
      "",
    ].join("\n"), "utf8");

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: [
        "Resolve the active Git merge conflict already present in this worktree.",
        "",
        "Original task prompt included for context:",
        "mockup-cli:write src/conflict-target.js :: export function conflictValue() {\\n  return 'left+right';\\n}",
      ].join("\n"),
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-conflict-directives",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    const readme = await fs.readFile(path.join(repoPath, "README.md"), "utf8");
    expect(readme).toContain("Left sibling edited the conflict target.");
    expect(readme).toContain("Right sibling edited the conflict target.");
    expect(readme).not.toContain("<<<<<<<");
    expect(readme).not.toContain(">>>>>>>");
    await expect(fs.readFile(path.join(repoPath, "src", "conflict-target.js"), "utf8")).resolves.toContain("left+right");

    await fs.rm(repoPath, { recursive: true, force: true });
  });

  it("forwards mockup-cli through Docker command construction with no API key requirement", async () => {
    await runner.runProvider({
      provider: "mockup-cli",
      prompt: "mockup-cli:write fixture.txt :: hello",
      cwd: "/repo",
      model: "default",
      apiKey: "",
      sessionId: "mock-docker-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "node",
      args: expect.arrayContaining(["-e", "mockup-cli:write fixture.txt :: hello"]),
      providerLabel: "mockup-cli",
      providerEnv: expect.objectContaining({
        CODE_UX_MOCKUP_MODEL: "default",
        CODE_UX_MOCKUP_SESSION_ID: "mock-docker-1",
      }),
    }));
    const env = dockerRunner.runProviderInDocker.mock.calls[0][0].providerEnv;
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("sanitizes mockup-cli transcript output", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "mockup-cli-sanitize-"));
    const rawSecret = "sk-or-v1-mockupSecret1234567890";

    const result = await runner.runProviderForText({
      provider: "mockup-cli",
      prompt: `mockup-cli:write secret.txt :: ${rawSecret}`,
      cwd: repoPath,
      model: "default",
      apiKey: "",
      sessionId: "mock-session-sanitize",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      onActivity: vi.fn(),
    });

    expect(result.stdout).not.toContain(rawSecret);
    expect(result.text).not.toContain(rawSecret);
    expect(result.usageTelemetry.transcriptText).not.toContain(rawSecret);
    expect(await fs.readFile(path.join(repoPath, "secret.txt"), "utf8")).toContain(rawSecret);

    await fs.rm(repoPath, { recursive: true, force: true });
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

  it("sanitizes host provider activity callbacks and returned command output", async () => {
    const rawSecret = "sk-or-v1-providerRunnerHostSecret1234567890";
    const onActivity = vi.fn();
    vi.mocked(runStreamingCommand).mockImplementationOnce(async (_command, _args, _cwd, _env, options: any) => {
      options.onStdoutLine?.(`stdout OPENROUTER_API_KEY=${rawSecret}`);
      options.onStderrLine?.(`stderr Authorization: Bearer ${rawSecret}`);
      return {
        ok: true,
        stdout: `stdout OPENROUTER_API_KEY=${rawSecret}`,
        stderr: `stderr Authorization: Bearer ${rawSecret}`,
        code: 0,
        signal: null,
      };
    });

    const result = await runner.runProvider({
      provider: "codex",
      prompt: "hello",
      cwd: "/repo",
      model: "default",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath: "/repo",
      onActivity,
    });

    const activityText = JSON.stringify(onActivity.mock.calls);
    expect(activityText).not.toContain(rawSecret);
    expect(activityText).toContain("[REDACTED]");
    expect(result.stdout).not.toContain(rawSecret);
    expect(result.stderr).not.toContain(rawSecret);
    expect(result.stdout).toContain("OPENROUTER_API_KEY=[REDACTED]");
    expect(result.stderr).toContain("Authorization: Bearer [REDACTED]");
  });

  it("sanitizes Docker provider activity callbacks and returned command output", async () => {
    const rawSecret = "github_pat_1234567890abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_1234567890";
    const onActivity = vi.fn();
    dockerRunner.runProviderInDocker.mockImplementationOnce(async ({ onActivity: emit }: any) => {
      emit(`cloned with ${rawSecret}`, "agent");
      emit(`provider Authorization: Bearer ${rawSecret}`, "provider");
      return {
        ok: true,
        stdout: `stdout ${rawSecret}`,
        stderr: `stderr Authorization: Bearer ${rawSecret}`,
        code: 0,
        signal: null,
      };
    });

    const result = await runner.runProvider({
      provider: "gemini",
      prompt: "hello",
      cwd: "/repo",
      model: "gemini-2.5-pro",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity,
    });

    const activityText = JSON.stringify(onActivity.mock.calls);
    expect(activityText).not.toContain(rawSecret);
    expect(activityText).toContain("[REDACTED]");
    expect(result.stdout).not.toContain(rawSecret);
    expect(result.stderr).not.toContain(rawSecret);
  });

  it("persists the fresh Claude session id after missing-conversation fallback", async () => {
    const oldNativeSessionId = "66e95743-e82e-445d-891a-ac01b27ddcb9";
    dockerRunner.readWorkspaceFile.mockResolvedValue("");
    dockerRunner.runProviderInDocker
      .mockResolvedValueOnce({
        ok: false,
        stdout: "",
        stderr: `[claude-code] No conversation found with session ID: ${oldNativeSessionId}`,
        code: 1,
        signal: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        stdout: "fresh response",
        stderr: "",
        code: 0,
        signal: null,
      });

    const result = await runner.runProviderForText({
      provider: "claude-code",
      prompt: "continue planning",
      cwd: "/repo",
      model: "default",
      apiKey: "key",
      sessionId: "planning-claude-code-old",
      continueSessionId: oldNativeSessionId,
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const firstArgs = dockerRunner.runProviderInDocker.mock.calls[0]?.[0]?.args;
    const secondArgs = dockerRunner.runProviderInDocker.mock.calls[1]?.[0]?.args;
    const freshSessionFlagIndex = secondArgs?.indexOf("--session-id") ?? -1;
    const freshSessionId = freshSessionFlagIndex >= 0 ? secondArgs?.[freshSessionFlagIndex + 1] : undefined;

    expect(firstArgs).toEqual(expect.arrayContaining(["--resume", oldNativeSessionId]));
    expect(secondArgs).not.toEqual(expect.arrayContaining(["--resume", oldNativeSessionId]));
    expect(freshSessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(freshSessionId).not.toBe(oldNativeSessionId);
    expect(result.nativeSessionId).toBe(freshSessionId);
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
      args: expect.arrayContaining(["--resume", "native-123"]),
    }));
  });

  it("resumes the explicit Codex native session instead of the latest workspace session", async () => {
    const nativeSessionId = "11111111-2222-7333-8444-555555555555";

    await runner.runProvider({
      provider: "codex",
      prompt: "continue the selected conversation",
      cwd: "/repo",
      model: "gpt-5.3-codex",
      apiKey: "key",
      sessionId: "session-1",
      continueSessionId: nativeSessionId,
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const args: string[] = dockerRunner.runProviderInDocker.mock.calls[0][0].args;
    expect(args.slice(0, 2)).toEqual(["exec", "resume"]);
    expect(args).not.toContain("--last");
    expect(args.at(-2)).toBe(nativeSessionId);
    expect(args.at(-1)).toBe("continue the selected conversation");
  });

  it("falls back to the latest Codex session without passing a logical id as the native resume target", async () => {
    await runner.runProvider({
      provider: "codex",
      prompt: "continue after telemetry was interrupted",
      cwd: "/repo",
      model: "gpt-5.3-codex",
      apiKey: "key",
      sessionId: "planning-codex-logical-session",
      workspaceSessionId: "planning-workspace-logical-session",
      continueSessionWithoutNativeId: true,
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const args: string[] = dockerRunner.runProviderInDocker.mock.calls[0][0].args;
    expect(args.slice(0, 3)).toEqual(["exec", "resume", "--last"]);
    expect(args).not.toContain("planning-codex-logical-session");
    expect(args).not.toContain("planning-workspace-logical-session");
    expect(args.at(-1)).toBe("continue after telemetry was interrupted");
  });

  it.each([
    {
      provider: "codex" as const,
      continueSessionId: "codex-native-1",
      expectedNativePrompt: "/compact",
      expectedResumeArgs: ["exec", "resume", "codex-native-1"],
    },
    {
      provider: "claude-code" as const,
      continueSessionId: "66e95743-e82e-445d-891a-ac01b27ddcb9",
      expectedNativePrompt: "/compact",
      expectedResumeArgs: ["--resume", "66e95743-e82e-445d-891a-ac01b27ddcb9"],
    },
    {
      provider: "gemini" as const,
      continueSessionId: "gemini-native-1",
      expectedNativePrompt: "/compress",
      expectedResumeArgs: ["--resume"],
    },
    {
      provider: "qwen-code" as const,
      continueSessionId: "thread-qwen-code",
      expectedNativePrompt: "/compress",
      expectedResumeArgs: ["--continue"],
    },
    {
      provider: "opencode" as const,
      continueSessionId: "ses_19151020bffeNmMNdnhmFM3fA5",
      expectedNativePrompt: "/compact",
      expectedResumeArgs: ["--session", "ses_19151020bffeNmMNdnhmFM3fA5"],
    },
    {
      provider: "antigravity" as const,
      continueSessionId: "antigravity-native-1",
      expectedNativePrompt: "/compact",
      expectedResumeArgs: ["--conversation=antigravity-native-1"],
    },
  ])("runs native compaction for $provider by resuming the existing CLI session", async ({ provider, continueSessionId, expectedNativePrompt, expectedResumeArgs }) => {
    const sessionId = `thread-${provider}`;

    await runner.runProviderForText({
      provider,
      prompt: "this transcript must not be replayed for compaction",
      cwd: "/repo",
      model: "default",
      apiKey: "key",
      sessionId,
      workspaceSessionId: sessionId,
      continueSessionId,
      nativeSessionOperation: "compact",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    const providerRun = dockerRunner.runProviderInDocker.mock.calls
      .map((call: any[]) => call[0])
      .find((call: any) => call.providerLabel === provider && call.sessionId === sessionId);

    expect(providerRun).toBeTruthy();
    expect(providerRun.args).toEqual(expect.arrayContaining(expectedResumeArgs));
    expect(providerRun.args).toContain(expectedNativePrompt);
    expect(providerRun.args).not.toContain("this transcript must not be replayed for compaction");
    expect(JSON.stringify(dockerRunner.runProviderInDocker.mock.calls)).not.toContain(":compaction");
    expect(dockerRunner.ensureWorkspace).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      preserve: true,
      reuseExisting: true,
    }));
  });

  it("rejects native compaction when no continuation session is available", async () => {
    await expect(runner.runProvider({
      provider: "claude-code",
      prompt: "compact",
      cwd: "/repo",
      model: "sonnet",
      apiKey: "key",
      sessionId: "thread-1",
      nativeSessionOperation: "compact",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    })).rejects.toThrow("requires continueSessionId");

    expect(dockerRunner.runProviderInDocker).not.toHaveBeenCalled();
  });

  it("preserves provider result and logs errors when cleanup operations fail", async () => {
    vi.mocked(runStreamingCommand).mockResolvedValueOnce({
      ok: true,
      stdout: "provider output",
      stderr: "",
      code: 0,
      signal: null,
    });

    // Instead of asserting on the logger directly, which can be brittle due to global pino configuration in testing,
    // we assert that the error is gracefully swallowed and the provider's valid result is successfully returned,
    // and that the intended cleanup logic was indeed triggered to fail.
    const mockRm = vi.spyOn(fs, "rm").mockRejectedValueOnce(new Error("Simulated cleanup error"));

    const result = await runner.runProvider({
      provider: "antigravity",
      prompt: "hello",
      cwd: "/repo",
      model: "antigravity",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(mockRm).toHaveBeenCalled();
    mockRm.mockRestore();
  });

  it("logs runtime cleanup failures as sanitized metadata without raw command payloads", async () => {
    vi.mocked(runStreamingCommand).mockResolvedValueOnce({
      ok: true,
      stdout: "provider output",
      stderr: "",
      code: 0,
      signal: null,
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn(),
    };
    const runnerWithLogger = new ProviderRunner(dockerRunner, logger as any);
    const repoDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-runner-cleanup-"));
    const rawPrompt = "raw prompt transcript that must not be logged";
    const rawSecret = "sk-cleanup-secret";
    const mockRm = vi.spyOn(fs, "rm").mockRejectedValueOnce(
      new Error(`rm failed after antigravity ${rawPrompt} ANTHROPIC_API_KEY=${rawSecret}`),
    );

    const result = await runnerWithLogger.runProvider({
      provider: "opencode",
      prompt: rawPrompt,
      cwd: repoDir,
      model: "anthropic/claude-sonnet-4-5",
      apiKey: rawSecret,
      openCodeAuthMode: "ENV_KEY",
      sessionId: "session-1",
      invocationId: "exec-inv-1",
      providerInvocationId: "provider-inv-1",
      purpose: "task_coding",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath: repoDir,
      mcpConnection: { url: "http://127.0.0.1:4444/mcp", authToken: "mcp-secret" },
      onActivity: vi.fn(),
    });

    expect(result.ok).toBe(true);
    expect(logger.error).toHaveBeenCalledWith(
      "Provider cleanup task failed: runtime cleanup",
      expect.objectContaining({
        logPurpose: "runtime",
        errorName: "Error",
      }),
    );
    const loggedMetadata = JSON.stringify(logger.error.mock.calls);
    expect(loggedMetadata).not.toContain(rawPrompt);
    expect(loggedMetadata).not.toContain(rawSecret);
    expect(loggedMetadata).not.toContain("ANTHROPIC_API_KEY");
    mockRm.mockRestore();
    await fs.rm(repoDir, { recursive: true, force: true });
  });

  it("cleans up workspace and codex output path if internal execution throws in runProvider", async () => {
    dockerRunner.runProviderInDocker.mockRejectedValueOnce(new Error("Execution failed"));

    const mockCleanup = vi.fn();
    dockerRunner.ensureWorkspace.mockResolvedValueOnce({ cwd: "docker-volume://workspace-error", cleanup: mockCleanup });

    await expect(runner.runProvider({
      provider: "claude-code",
      prompt: "throw",
      cwd: "/repo",
      model: "sonnet",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    })).rejects.toThrow("Execution failed");

    expect(dockerRunner.ensureWorkspace).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
  });

  it("cleans up workspace and codex output path if internal execution throws in runProviderForText", async () => {
    dockerRunner.runProviderInDocker.mockRejectedValueOnce(new Error("Text execution failed"));

    const mockCleanup = vi.fn();
    dockerRunner.ensureWorkspace.mockResolvedValueOnce({ cwd: "docker-volume://workspace-error-text", cleanup: mockCleanup });

    await expect(runner.runProviderForText({
      provider: "codex",
      prompt: "throw text",
      cwd: "/repo",
      model: "default",
      apiKey: "key",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    })).rejects.toThrow("Text execution failed");

    expect(dockerRunner.ensureWorkspace).toHaveBeenCalled();
    expect(mockCleanup).toHaveBeenCalled();
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
        QWEN_CODE_SUPPRESS_YOLO_WARNING: "1",
      }),
    }));
  });

  it("uses the configured Qwen custom model and rewrites local Docker endpoints", async () => {
    const originalPlatform = process.platform;
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    try {
      const runArgs = {
        provider: "qwen-code" as const,
        prompt: "hello",
        cwd: "/repo",
        model: "custom/model",
        apiKey: "sk-qwen-test",
        qwenAuthMode: "MODEL_PROVIDER" as const,
        qwenModelId: "glm-4.7-flash",
        qwenBaseUrl: "http://127.0.0.1:11434/v1",
        qwenEnvKey: "OLLAMA_API_KEY",
        qwenProtocol: "openai" as const,
        sessionId: "session-1",
        workflowSettings: { executionMode: "DOCKER" } as any,
        repoPath: "/repo",
        mcpConnection: { url: "http://127.0.0.1:4445/mcp", authToken: null },
        onActivity: vi.fn(),
      };
      const model = resolveEffectiveModel(runArgs);
      await runner.runProvider({ ...runArgs, model });
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
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
        CODE_UX_PROVIDER_ENV_KEYS: "OLLAMA_API_KEY,QWEN_CODE_SUPPRESS_YOLO_WARNING",
        QWEN_CODE_SUPPRESS_YOLO_WARNING: "1",
      }),
    }));
    const env = dockerRunner.runProviderInDocker.mock.calls[0][0].providerEnv;
    const qwenSettings = JSON.parse(env.QWEN_SETTINGS_CONTENT);
    expect(qwenSettings.enableOpenAILogging).toBeUndefined();
    expect(qwenSettings).toMatchObject({
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
      memory: {
        enableManagedAutoMemory: false,
        enableManagedAutoDream: false,
      },
      mcpServers: {
        code_ux: {
          httpUrl: "http://host.docker.internal:4445/mcp",
        },
      },
    });
  });

  it("continues Qwen Code with project-scoped --continue instead of a Code UX session id", async () => {
    const result = await runner.runProvider({
      provider: "qwen-code",
      prompt: "fix the JSON",
      cwd: "/repo",
      model: "qwen3-coder-plus",
      apiKey: "sk-qwen-test",
      qwenAuthMode: "ALIBABA_CODING_PLAN",
      qwenRegion: "international",
      qwenProtocol: "openai",
      sessionId: "planning-qwen-code-logical",
      continueSessionId: "planning-qwen-code-logical",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "qwen",
      args: ["--auth-type", "openai", "--yolo", "--continue", "--model", "qwen3-coder-plus", "-p", "fix the JSON"],
    }));
    expect(result.nativeSessionId).toBeNull();
  });

  it("preserves and reuses Docker-created Qwen workspaces so saved sessions survive short-lived containers", async () => {
    await runner.runProvider({
      provider: "qwen-code",
      prompt: "hello",
      cwd: "/repo",
      model: "qwen3-coder-plus",
      apiKey: "sk-qwen-test",
      qwenAuthMode: "ALIBABA_CODING_PLAN",
      qwenRegion: "international",
      qwenProtocol: "openai",
      sessionId: "chat-thread-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/repo",
      repoPath: "/repo",
      sessionId: "chat-thread-1",
      snapshotCheckout: undefined,
      gitPolicy: undefined,
      preserve: true,
      reuseExisting: false,
    });
  });

  it("preserves and reuses Docker-created Claude workspaces so saved sessions survive short-lived containers", async () => {
    await runner.runProvider({
      provider: "claude-code",
      prompt: "hello",
      cwd: "/repo",
      model: "sonnet",
      apiKey: "sk-anthropic",
      sessionId: "chat-thread-2",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    });

    expect(dockerRunner.ensureWorkspace).toHaveBeenCalledWith({
      cwd: "/repo",
      repoPath: "/repo",
      sessionId: "chat-thread-2",
      snapshotCheckout: undefined,
      gitPolicy: undefined,
      preserve: true,
      reuseExisting: false,
    });
  });

  it("routes Claude Code through a custom base URL and model when configured", async () => {
    const runArgs = {
      provider: "claude-code" as const,
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
    };
    const model = resolveEffectiveModel(runArgs);
    await runner.runProvider({ ...runArgs, model });

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
    const runArgs = {
      provider: "codex" as const,
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
    };
    const model = resolveEffectiveModel(runArgs);
    await runner.runProvider({ ...runArgs, model });

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

  it("does not pass custom model provider overrides or API key for Codex when mount auth is selected", async () => {
    const runArgs = {
      provider: "codex" as const,
      prompt: "ship it",
      cwd: "/repo",
      model: "gpt-5-codex",
      apiKey: "sk-openai",
      customBaseUrl: "https://openrouter.ai/api/v1",
      customModel: "openai/gpt-5-codex",
      providerMountAuth: true,
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity: vi.fn(),
    };
    const model = resolveEffectiveModel(runArgs);
    expect(model).toBe("gpt-5-codex");
    await runner.runProvider({ ...runArgs, model });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      command: "codex",
      providerEnv: expect.not.objectContaining({
        OPENAI_API_KEY: expect.anything(),
        OPENAI_BASE_URL: expect.anything(),
      }),
    }));

    const env = dockerRunner.runProviderInDocker.mock.calls[0][0].providerEnv;
    expect(env.CODEX_MODEL).toBe("gpt-5-codex");
    const args: string[] = dockerRunner.runProviderInDocker.mock.calls[0][0].args;
    expect(args).toContain("gpt-5-codex");
    expect(args).not.toContain("openai/gpt-5-codex");
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

  it("retries OpenCode with a fresh session when the saved native session is missing", async () => {
    const onActivity = vi.fn();
    dockerRunner.runProviderInDocker
      .mockResolvedValueOnce({
        ok: false,
        stdout: "",
        stderr: "OpenCode failed: Error: Session not found",
        code: 1,
        signal: null,
      })
      .mockResolvedValueOnce({
        ok: true,
        stdout: "provider stdout",
        stderr: "",
        code: 0,
        signal: null,
      });

    const result = await runner.runProvider({
      provider: "opencode",
      prompt: "retry json",
      cwd: "/repo",
      model: "anthropic/claude-sonnet-4-5",
      apiKey: "sk-open-test",
      sessionId: "planning-opencode-logical",
      continueSessionId: "ses_19151020bffeNmMNdnhmFM3fA5",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      onActivity,
    });

    expect(result.ok).toBe(true);
    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledTimes(2);
    expect(dockerRunner.runProviderInDocker).toHaveBeenNthCalledWith(1, expect.objectContaining({
      command: "opencode",
      args: ["run", "--session", "ses_19151020bffeNmMNdnhmFM3fA5", "--format", "json", "--dir", "/workspace", "--model", "anthropic/claude-sonnet-4-5", "retry json"],
    }));
    expect(dockerRunner.runProviderInDocker).toHaveBeenNthCalledWith(2, expect.objectContaining({
      command: "opencode",
      args: ["run", "--format", "json", "--dir", "/workspace", "--model", "anthropic/claude-sonnet-4-5", "retry json"],
    }));
    expect(onActivity).toHaveBeenCalledWith(
      "OpenCode could not resume the previous session (session not found). Retrying once with a fresh session...",
      "provider",
    );
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
    const originalPlatform = process.platform;
    const originalRewrite = process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    Object.defineProperty(process, "platform", {
      value: "linux",
      configurable: true,
    });
    delete process.env.CODE_UX_DOCKER_REWRITE_LOCALHOST;
    try {
      const runArgs = {
        provider: "opencode" as const,
        prompt: "hello",
        cwd: "/repo",
        model: "custom/model",
        apiKey: "sk-open-test",
        openCodeAuthMode: "CUSTOM_PROVIDER" as const,
        openCodeProviderId: "ollama",
        openCodeModelId: "glm-4.7-flash",
        openCodeBaseUrl: "http://127.0.0.1:11434/v1",
        sessionId: "session-1",
        workflowSettings: { executionMode: "DOCKER" } as any,
        repoPath: "/repo",
        mcpConnection: { url: "http://127.0.0.1:4445/mcp", authToken: null },
        onActivity: vi.fn(),
      };
      const model = resolveEffectiveModel(runArgs);
      await runner.runProvider({ ...runArgs, model });
    } finally {
      Object.defineProperty(process, "platform", {
        value: originalPlatform,
        configurable: true,
      });
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
      inputTokens: 260,
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
      "/code-ux-runtime-home/.claude/projects/-workspace/native-123.jsonl",
    );
    expect(result.usageTelemetry).toMatchObject({
      inputTokens: 12,
      cachedInputTokens: 7,
      outputTokens: 8,
      totalTokens: 27,
      usageSource: "reported",
      transcriptText: "Finished in container.",
    });
  });

  it("injects MCP configuration for Antigravity in DOCKER mode", async () => {
    dockerRunner.runProviderInDocker = vi.fn(async () => ({
      ok: true,
      stdout: "docker stdout",
      stderr: "",
      code: 0,
      signal: null,
    }));

    await runner.runProvider({
      provider: "antigravity",
      prompt: "hello",
      cwd: "/repo",
      model: "default",
      apiKey: "mykey",
      sessionId: "session-1",
      workflowSettings: { executionMode: "DOCKER" } as any,
      repoPath: "/repo",
      mcpConnection: { url: "http://127.0.0.1:4445/mcp", authToken: null },
      onActivity: vi.fn(),
    });

    expect(dockerRunner.runProviderInDocker).toHaveBeenCalledWith(expect.objectContaining({
      providerLabel: "antigravity",
      mcpConnection: expect.objectContaining({ url: "http://127.0.0.1:4445/mcp" }),
    }));
  });

  it("materializes generated Antigravity config for host execution", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "provider-runner-"));
    let mcpConfigPath = "";
    let mcpConfigContent = "";
    vi.mocked(runStreamingCommand).mockImplementationOnce(async (_command, _args, cwd, env) => {
      mcpConfigPath = path.join(cwd, ".agents", "mcp_config.json");
      mcpConfigContent = await fs.readFile(mcpConfigPath, "utf8");
      return {
        ok: true,
        stdout: "host stdout",
        stderr: "",
        code: 0,
        signal: null,
      };
    });

    await runner.runProvider({
      provider: "antigravity",
      prompt: "hello",
      cwd: repoPath,
      model: "default",
      apiKey: "mykey",
      sessionId: "session-1",
      workflowSettings: { executionMode: "HOST" } as any,
      repoPath,
      mcpConnection: { url: "http://127.0.0.1:4445/mcp", authToken: "token123" },
      onActivity: vi.fn(),
    });

    expect(runStreamingCommand).toHaveBeenCalledWith(
      "agy",
      ["--dangerously-skip-permissions", "--log-file", expect.any(String), "-p", "hello"],
      repoPath,
      expect.any(Object),
      expect.any(Object),
    );
    expect(JSON.parse(mcpConfigContent)).toMatchObject({
      mcpServers: {
        code_ux: {
          serverUrl: "http://127.0.0.1:4445/mcp",
          headers: {
            Authorization: "Bearer token123",
          },
        },
      },
    });
    // Check clean up
    await expect(fs.access(mcpConfigPath)).rejects.toThrow();
  });
});


describe("ProviderRunner MCP config generation", () => {
  let runner: any;

  beforeEach(() => {
    vi.clearAllMocks();
    runner = new ProviderRunner();
    const mockMkdir = vi.spyOn(fs, 'mkdir');
    mockMkdir.mockResolvedValue(undefined);
    const mockReadFile = vi.spyOn(fs, 'readFile');
    mockReadFile.mockResolvedValue(null as any);
    const mockWriteFile = vi.spyOn(fs, 'writeFile');
    mockWriteFile.mockResolvedValue(undefined);
    const mockChmod = vi.spyOn(fs, 'chmod');
    mockChmod.mockResolvedValue(undefined);
  });

  const writeConfig = (conn: any, cwd: string, provider: any, qwenSettings?: string, customServers: any[] = []) =>
    runner.writeLocalMcpConfig(conn, cwd, provider, qwenSettings, customServers);

  const getWrittenContent = (filename: string): string | undefined => {
    const call = vi.mocked(fs.writeFile).mock.calls.filter(([target]) => String(target).endsWith(filename)).at(-1);
    return call ? String(call[1]) : undefined;
  };

  it("writes local claude config with merged servers", async () => {
    await writeConfig({ url: "http://127.0.0.1/mcp", authToken: "sec" }, "/tmp/cwd", "claude-code", undefined, [
      { id: "1", name: "tool", url: "http://tool/mcp", enabled: true, headers: { auth: "bearer 123" } }
    ]);
    const json = JSON.parse(getWrittenContent(".claude/settings.local.json")!);
    expect(json.mcpServers.code_ux).toEqual({ type: "http", url: "http://127.0.0.1/mcp", headers: { Authorization: "Bearer sec" } });
    expect(json.mcpServers.tool).toEqual({ type: "http", url: "http://tool/mcp", headers: { auth: "bearer 123" } });
  });

  it("writes local gemini config with merged servers", async () => {
    await writeConfig(null, "/tmp/cwd", "gemini", undefined, [
      { id: "1", name: "tool", transport: "stdio", command: "ls", args: ["-la"], enabled: true }
    ]);
    const json = JSON.parse(getWrittenContent(".gemini/settings.json")!);
    expect(json.mcpServers.tool).toEqual({ command: "ls", args: ["-la"] });
  });

  it("writes local qwen config with merged existing settings", async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify({
      memory: {
        enableAutoSkill: true,
      },
    }) as any);
    await writeConfig(null, "/tmp/cwd", "qwen-code", JSON.stringify({
      enableOpenAILogging: true,
      customOpt: "abc",
      memory: {
        enableManagedAutoMemory: false,
        enableManagedAutoDream: false,
      },
    }), [
      { id: "1", name: "tool", transport: "stdio", command: "echo", enabled: true }
    ]);
    const json = JSON.parse(getWrittenContent(".qwen/settings.json")!);
    expect(json.enableOpenAILogging).toBeUndefined();
    expect(json.customOpt).toBe("abc");
    expect(json.memory).toEqual({
      enableAutoSkill: true,
      enableManagedAutoMemory: false,
      enableManagedAutoDream: false,
    });
    expect(json.mcpServers.tool).toEqual({ command: "echo" });
  });

  it("writes local codex config", async () => {
    await writeConfig({ url: "http://127.0.0.1/mcp" }, "/tmp/cwd", "codex", undefined, [
      { id: "1", name: "tool", transport: "stdio", command: "cat", enabled: true }
    ]);
    const toml = getWrittenContent(".codex/config.toml")!;
    expect(toml).toContain('[mcp_servers.code-ux]');
    expect(toml).toContain('url = "http://127.0.0.1/mcp"');
    expect(toml).toContain('[mcp_servers.tool]');
    expect(toml).toContain('command = "cat"');
  });

  it("does not duplicate existing local codex mcp tables", async () => {
    vi.mocked(fs.readFile).mockResolvedValueOnce([
      'model = "gpt-5-codex"',
      "[mcp_servers.playwright]",
      'command = "npx"',
      'args = ["@playwright/mcp@latest"]',
      "",
    ].join("\n") as any);

    await writeConfig({ url: "http://127.0.0.1/mcp" }, "/tmp/cwd", "codex", undefined, [
      { id: "playwright", name: "playwright", transport: "stdio", command: "npx", args: ["@playwright/mcp@latest"], enabled: true },
      { id: "tool", name: "tool", transport: "stdio", command: "cat", enabled: true },
    ]);

    const toml = getWrittenContent(".codex/config.toml")!;
    expect(toml.match(/\[mcp_servers\.playwright\]/g)).toHaveLength(1);
    expect(toml).toContain('model = "gpt-5-codex"');
    expect(toml).toContain("[mcp_servers.code-ux]");
    expect(toml).toContain("[mcp_servers.tool]");
  });

  it("writes local antigravity config", async () => {
    await writeConfig({ url: "http://127.0.0.1/mcp" }, "/tmp/cwd", "antigravity", undefined, [
      { id: "1", name: "tool", transport: "stdio", command: "bash", args: ["-c", "echo hello"], enabled: true }
    ]);
    const json = JSON.parse(getWrittenContent(".agents/mcp_config.json")!);
    expect(json.mcpServers.code_ux).toEqual({ serverUrl: "http://127.0.0.1/mcp" });
    expect(json.mcpServers.tool).toEqual({ command: "bash", args: ["-c", "echo hello"] });
  });
});
