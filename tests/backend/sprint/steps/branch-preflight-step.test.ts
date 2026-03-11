import * as fs from "fs/promises";
import { commandRunner } from "../../../../src/shared/subprocess/command-runner.js";
import { ensureSprintBranchReady, runBranchPreflightStep } from "../../../../src/sprint/steps/branch-preflight-step.js";
import { describe, it, expect, vi, afterEach } from "vitest";
import { SprintOrchestrator } from "../../../../src/sprint/sprint-orchestrator.js";
import { buildMockSettings } from "../../../builders/settings-builder.js";

const buildDeps = () => {
  const deps = {
    settings: { maxFailures: 5 },
    getDashboardSettings: () => buildMockSettings(),
    renderInstruction: vi.fn().mockResolvedValue(""),
    isJulesApiConfigured: () => true,
    loadSubtasks: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    updateLastStatus: vi.fn(),
    completedSprints: new Set<string>(),
    projectManagementRepository: { updateTask: vi.fn() },
    executionRepository: { updateSprintRun: vi.fn() },
    sprintExecutionStateService: {
      resolveContext: vi.fn((args: any) => ({
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: args.sprint_number ?? 1,
        repoPath: args.repo_path,
        featureBranch: args.feature_branch || "feature/sprint1-implementation",
        defaultBranch: "main",
        sourceId: args.source_id,
      })),
      hasPlannedTasks: vi.fn().mockReturnValue(true),
      loadSubtasks: vi.fn().mockResolvedValue([]),
    },
  };
  return deps;
};

describe("SprintOrchestrator - Preflight Logic", () => {
  it("returns setup guidance when all providers are disabled", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({
      aiProvider: {
        provider: "jules",
        strategy: "MANUAL",
        providers: {
          jules: { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
          gemini: { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
          codex: { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
          "claude-code": { enabled: false, model: "", weight: 0, thinkingMode: "SMALL", apiKey: "" },
        },
        julesApiKey: "",
      },
    });
    
    deps.renderInstruction = vi.fn(async (templateId: string) => {
        if (templateId === "providerSetupRequired") return "Provider Setup Required\nNo AI providers are enabled";
        return "";
    });

    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/tmp/repo",
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    expect(result.content[0].text).toContain("Provider Setup Required");
    expect(result.content[0].text).toContain("No AI providers are enabled");
  });

  it("returns branch configuration blocker for plan when feature branch is missing", async () => {
    const deps = buildDeps();
    deps.renderInstruction = vi.fn(async (templateId: string, vars: any) => {
        if (templateId === "branchMissing") return `Branch Configuration Missing: ${vars.feature_branch}`;
        return "";
    });
    
    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/definitely/missing-repo",
      source_id: "sources/123",
      action: "plan",
      wait: false,
    });

    expect(result.content[0].text).toContain("Branch Configuration Missing");
    expect(result.content[0].text).toContain("feature/sprint1-implementation");
  });
});

vi.mock("fs/promises");
vi.mock("../../../../src/shared/subprocess/command-runner.js", () => {
  return {
    commandRunner: {
      run: vi.fn(),
      runStrict: vi.fn(),
    }
  };
});

describe("runBranchPreflightStep (Async)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns existsLocal false and existsRemote false if repoPath does not exist", async () => {
    vi.mocked(fs.stat).mockRejectedValueOnce(new Error("ENOENT"));

    const result = await runBranchPreflightStep("/missing-repo", "feature/sprint1");
    expect(result).toEqual({ existsLocal: false, existsRemote: false });
  });

  it("returns existsLocal false and existsRemote false if repoPath is not a directory", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => false } as any);

    const result = await runBranchPreflightStep("/file-repo", "feature/sprint1");
    expect(result).toEqual({ existsLocal: false, existsRemote: false });
  });

  it("returns existsLocal false and existsRemote false if not a git repository", async () => {
    vi.mocked(fs.stat).mockResolvedValueOnce({ isDirectory: () => true } as any);
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "" });

    const result = await runBranchPreflightStep("/valid-repo", "feature/sprint1");
    expect(result).toEqual({ existsLocal: false, existsRemote: false });
    expect(commandRunner.run).toHaveBeenCalledWith("git", ["rev-parse", "--is-inside-work-tree"], { cwd: "/valid-repo" });
  });

  it("returns branch existence based on git commands", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);

    // 1st call: isGitRepository
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" });
    // 2nd call: hasLocalBranch (true)
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" });
    // 3rd call: hasRemoteBranch (true, needs stdout > 0)
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: true, code: 0, stdout: "commit-hash refs/heads/feature/sprint1\n", stderr: "" });

    const result = await runBranchPreflightStep("/valid-repo", "feature/sprint1");
    expect(result).toEqual({ existsLocal: true, existsRemote: true });

    expect(commandRunner.run).toHaveBeenNthCalledWith(2, "git", ["show-ref", "--verify", "refs/heads/feature/sprint1"], { cwd: "/valid-repo" });
    expect(commandRunner.run).toHaveBeenNthCalledWith(3, "git", ["ls-remote", "--heads", "origin", "feature/sprint1"], { cwd: "/valid-repo" });
  });

  it("returns existsLocal false if git show-ref throws", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    // 1st call: isGitRepository (true)
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" });
    // 2nd call: hasLocalBranch (throws)
    vi.mocked(commandRunner.run).mockRejectedValueOnce(new Error("git show-ref failed"));
    // 3rd call: hasRemoteBranch (true)
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: true, code: 0, stdout: "commit-hash refs/heads/feature/sprint1\n", stderr: "" });

    const result = await runBranchPreflightStep("/valid-repo", "feature/sprint1");
    expect(result.existsLocal).toBe(false);
    expect(result.existsRemote).toBe(true);
  });

  it("returns existsRemote false if git ls-remote throws", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    // 1st call: isGitRepository (true)
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" });
    // 2nd call: hasLocalBranch (true)
    vi.mocked(commandRunner.run).mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" });
    // 3rd call: hasRemoteBranch (throws)
    vi.mocked(commandRunner.run).mockRejectedValueOnce(new Error("git ls-remote failed"));

    const result = await runBranchPreflightStep("/valid-repo", "feature/sprint1");
    expect(result.existsLocal).toBe(true);
    expect(result.existsRemote).toBe(false);
  });

  it("returns existsLocal false and existsRemote false if isGitRepository throws", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    // 1st call: isGitRepository (throws)
    vi.mocked(commandRunner.run).mockRejectedValueOnce(new Error("git rev-parse failed"));

    const result = await runBranchPreflightStep("/valid-repo", "feature/sprint1");
    expect(result).toEqual({ existsLocal: false, existsRemote: false });
  });

  it("automatically creates and pushes a missing sprint branch from the default branch", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(commandRunner.run)
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: false, code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: false, code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" });

    const result = await ensureSprintBranchReady("/valid-repo", "feature/sprint1", "main");

    expect(result.action).toBe("created_and_pushed");
    expect(vi.mocked(commandRunner.runStrict)).toHaveBeenNthCalledWith(1, "git", ["checkout", "main"], { cwd: "/valid-repo" });
    expect(vi.mocked(commandRunner.runStrict)).toHaveBeenNthCalledWith(2, "git", ["checkout", "-b", "feature/sprint1"], { cwd: "/valid-repo" });
    expect(vi.mocked(commandRunner.runStrict)).toHaveBeenNthCalledWith(3, "git", ["push", "-u", "origin", "feature/sprint1"], { cwd: "/valid-repo" });
  });

  it("checks out a remote sprint branch locally when origin already has it", async () => {
    vi.mocked(fs.stat).mockResolvedValue({ isDirectory: () => true } as any);
    vi.mocked(commandRunner.run)
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: false, code: 1, stdout: "", stderr: "" })
      .mockResolvedValueOnce({ ok: true, code: 0, stdout: "hash refs/heads/feature/sprint1\n", stderr: "" });

    const result = await ensureSprintBranchReady("/valid-repo", "feature/sprint1", "main");

    expect(result.action).toBe("checked_out_remote_tracking");
    expect(vi.mocked(commandRunner.runStrict)).toHaveBeenNthCalledWith(1, "git", ["fetch", "origin", "feature/sprint1"], { cwd: "/valid-repo" });
    expect(vi.mocked(commandRunner.runStrict)).toHaveBeenNthCalledWith(2, "git", ["checkout", "-b", "feature/sprint1", "--track", "origin/feature/sprint1"], { cwd: "/valid-repo" });
  });
});
