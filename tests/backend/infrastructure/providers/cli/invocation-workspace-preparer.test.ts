import { describe, expect, it, vi } from "vitest";
import type { IWorkspaceManager } from "../../../../../src/infrastructure/providers/cli/workspace-manager.js";
import {
  buildProviderInvocationWorkspaceOptions,
  InvocationWorkspacePreparer,
} from "../../../../../src/infrastructure/providers/cli/invocation-workspace-preparer.js";

describe("invocation workspace helpers", () => {
  it("builds fresh remote Docker invocation options from the effective default branch", () => {
    const result = buildProviderInvocationWorkspaceOptions({
      workflowSettings: { executionMode: "DOCKER" },
      gitPolicy: {
        githubMode: "REMOTE",
        defaultBranch: "dev",
        githubToken: "gh-token",
        gitlabToken: null,
      },
    });

    expect(result).toEqual({
      snapshotCheckout: {
        branch: "dev",
        fallbackBranch: undefined,
        remoteOnly: true,
      },
      gitPolicy: {
        githubMode: "REMOTE",
        defaultBranch: "dev",
        githubToken: "gh-token",
        gitlabToken: null,
      },
      workspaceLifecycle: "fresh",
      githubToken: "gh-token",
      gitlabToken: undefined,
    });
  });

  it("builds explicit continuation checkout options without falling back to the default branch", () => {
    const result = buildProviderInvocationWorkspaceOptions({
      workflowSettings: { executionMode: "DOCKER" },
      gitPolicy: {
        githubMode: "REMOTE",
        defaultBranch: "dev",
        githubToken: undefined,
        gitlabToken: "gl-token",
      },
      branch: "feature/review",
      fallbackBranch: "dev",
      useDefaultBranch: false,
      lifecycle: "continue",
    });

    expect(result.snapshotCheckout).toEqual({
      branch: "feature/review",
      fallbackBranch: "dev",
      remoteOnly: true,
    });
    expect(result.workspaceLifecycle).toBe("continue");
    expect(result.githubToken).toBeUndefined();
    expect(result.gitlabToken).toBe("gl-token");
  });

  it("omits snapshot checkout and git policy for host-mode invocations", () => {
    const result = buildProviderInvocationWorkspaceOptions({
      workflowSettings: { executionMode: "HOST" },
      gitPolicy: {
        githubMode: "REMOTE",
        defaultBranch: "dev",
      },
    });

    expect(result.snapshotCheckout).toBeUndefined();
    expect(result.gitPolicy).toBeUndefined();
    expect(result.workspaceLifecycle).toBe("fresh");
  });

  it("resolves continuation workspaces through the workspace manager", async () => {
    const workspaceManager = {
      resolveResumeWorktreePath: vi.fn().mockResolvedValue("/repo/.worktrees/session-1"),
      buildWorktreePath: vi.fn(),
      resolveCurrentBranch: vi.fn().mockResolvedValue("feature/task"),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(workspaceManager);

    const result = await preparer.resolveContinuationWorkspace({
      repoPath: "/repo",
      sessionId: "session-1",
      executionMode: "HOST",
    });

    expect(result).toEqual({
      worktreePath: "/repo/.worktrees/session-1",
      hasPreservedWorkspace: true,
      currentBranch: "feature/task",
    });
    expect(workspaceManager.resolveResumeWorktreePath).toHaveBeenCalledWith("/repo", "session-1", "HOST");
    expect(workspaceManager.resolveCurrentBranch).toHaveBeenCalledWith("/repo/.worktrees/session-1");
    expect(workspaceManager.buildWorktreePath).not.toHaveBeenCalled();
  });

  it("builds the target path when no continuation workspace exists", async () => {
    const workspaceManager = {
      resolveResumeWorktreePath: vi.fn().mockResolvedValue(undefined),
      buildWorktreePath: vi.fn().mockReturnValue("docker-volume://session-1"),
      resolveCurrentBranch: vi.fn(),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(workspaceManager);

    const result = await preparer.resolveContinuationWorkspace({
      repoPath: "/repo",
      sessionId: "session-1",
      executionMode: "DOCKER",
    });

    expect(result).toEqual({
      worktreePath: "docker-volume://session-1",
      hasPreservedWorkspace: false,
      currentBranch: null,
    });
    expect(workspaceManager.buildWorktreePath).toHaveBeenCalledWith("/repo", "session-1", "DOCKER");
    expect(workspaceManager.resolveCurrentBranch).not.toHaveBeenCalled();
  });
});
