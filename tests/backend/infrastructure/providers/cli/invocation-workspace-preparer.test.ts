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

  it("prefers a durable recorded workspace path over the latest logical session path", async () => {
    const workspaceManager = {
      workspaceExists: vi.fn().mockResolvedValue(true),
      resolveResumeWorktreePath: vi.fn(),
      buildWorktreePath: vi.fn(),
      resolveCurrentBranch: vi.fn().mockResolvedValue("feature/task"),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(workspaceManager);

    const result = await preparer.resolveContinuationWorkspace({
      repoPath: "/repo",
      sessionId: "latest-logical-session",
      executionMode: "HOST",
      worktreePath: "/repo/.worktrees/original-workspace-session",
    });

    expect(result).toEqual({
      worktreePath: "/repo/.worktrees/original-workspace-session",
      hasPreservedWorkspace: true,
      currentBranch: "feature/task",
    });
    expect(workspaceManager.workspaceExists).toHaveBeenCalledWith(
      "/repo/.worktrees/original-workspace-session",
    );
    expect(workspaceManager.resolveResumeWorktreePath).not.toHaveBeenCalled();
  });

  it("keeps one project Git helper lease across ref refresh and snapshot creation", async () => {
    const events: string[] = [];
    let leaseActive = false;
    const workspaceManager = {
      createSnapshotWorkspace: vi.fn().mockImplementation(async () => {
        expect(leaseActive).toBe(true);
        events.push("snapshot");
        return "docker-volume://snapshot";
      }),
    } as unknown as IWorkspaceManager;
    const acquireLease = vi.fn(() => {
      leaseActive = true;
      events.push("acquire");
      return vi.fn(async () => {
        events.push("release");
        leaseActive = false;
      });
    });
    const preparer = new InvocationWorkspacePreparer(workspaceManager, acquireLease);
    vi.spyOn(preparer, "refreshSnapshotRefs").mockImplementation(async () => {
      expect(leaseActive).toBe(true);
      events.push("refresh");
    });

    await expect(preparer.createSnapshotWorkspace({
      repoPath: "/repo/project",
      sessionId: "planning-1",
    })).resolves.toBe("docker-volume://snapshot");

    expect(acquireLease).toHaveBeenCalledOnce();
    expect(acquireLease).toHaveBeenCalledWith("/repo/project");
    expect(events).toEqual(["acquire", "refresh", "snapshot", "release"]);
  });

  it("releases the project Git helper when snapshot preparation fails", async () => {
    const release = vi.fn(async () => undefined);
    const workspaceManager = {
      createSnapshotWorkspace: vi.fn().mockRejectedValue(new Error("snapshot failed")),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(workspaceManager, () => release);
    vi.spyOn(preparer, "refreshSnapshotRefs").mockResolvedValue(undefined);

    await expect(preparer.createSnapshotWorkspace({
      repoPath: "/repo/project",
      sessionId: "planning-1",
    })).rejects.toThrow("snapshot failed");

    expect(release).toHaveBeenCalledOnce();
  });

  it("skips remote refresh when a valid reusable snapshot already exists", async () => {
    const workspaceManager = {
      createOrReuseSnapshotWorkspace: vi.fn().mockResolvedValue("docker-volume://snapshot"),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(
      workspaceManager,
      () => async () => undefined,
      undefined,
      vi.fn().mockResolvedValue(null),
    );
    const refreshSnapshotRefs = vi.spyOn(preparer, "refreshSnapshotRefs").mockResolvedValue(undefined);

    await expect(preparer.createSnapshotWorkspace({
      repoPath: "/repo/project",
      sessionId: "chat-1",
      checkout: { branch: "dev", remoteOnly: true },
      gitPolicy: { githubMode: "REMOTE", defaultBranch: "dev" },
      reuseExisting: true,
    })).resolves.toBe("docker-volume://snapshot");

    expect(refreshSnapshotRefs).not.toHaveBeenCalled();
    expect(workspaceManager.createOrReuseSnapshotWorkspace).toHaveBeenCalledWith(
      "/repo/project",
      "chat-1",
      { branch: "dev", remoteOnly: true },
      expect.any(Function),
    );
  });

  it("refreshes remote refs inside reusable snapshot creation only when materialization is needed", async () => {
    const events: string[] = [];
    let leaseActive = false;
    const workspaceManager = {
      createOrReuseSnapshotWorkspace: vi.fn().mockImplementation(async (
        _repoPath: string,
        _sessionId: string,
        _checkout: unknown,
        beforeCreate: () => Promise<void>,
      ) => {
        expect(leaseActive).toBe(true);
        events.push("workspace-check");
        await beforeCreate();
        events.push("snapshot-created");
        return "docker-volume://snapshot";
      }),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(workspaceManager, () => {
      leaseActive = true;
      events.push("acquire");
      return async () => {
        events.push("release");
        leaseActive = false;
      };
    });
    vi.spyOn(preparer, "refreshSnapshotRefs").mockImplementation(async () => {
      expect(leaseActive).toBe(true);
      events.push("refresh");
    });

    await preparer.createSnapshotWorkspace({
      repoPath: "/repo/project",
      sessionId: "chat-1",
      reuseExisting: true,
    });

    expect(events).toEqual([
      "acquire",
      "workspace-check",
      "refresh",
      "snapshot-created",
      "release",
    ]);
  });

  it("leases the project helper while preparing a provider worktree", async () => {
    let leaseActive = false;
    const release = vi.fn(async () => {
      leaseActive = false;
    });
    const workspaceManager = {
      prepareWorktree: vi.fn().mockImplementation(async () => {
        expect(leaseActive).toBe(true);
        return { worktreePath: "docker-volume://worker", resumed: false };
      }),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(workspaceManager, () => {
      leaseActive = true;
      return release;
    });

    await expect(preparer.prepareWorktree({
      repoPath: "/repo/project",
      worktreePath: "docker-volume://worker",
      workerBranch: "worker/task-1",
      featureBranch: "feature/sprint-1",
    })).resolves.toEqual({ worktreePath: "docker-volume://worker", resumed: false });

    expect(release).toHaveBeenCalledOnce();
    expect(workspaceManager.prepareWorktree).toHaveBeenCalledWith(
      "/repo/project",
      "docker-volume://worker",
      "worker/task-1",
      "feature/sprint-1",
      undefined,
      undefined,
      {
        remoteOnly: false,
        refreshRemote: false,
        allowExistingWorkerBranch: false,
      },
    );
  });

  it("enables targeted remote refresh for remote worktrees", async () => {
    const workspaceManager = {
      prepareWorktree: vi.fn().mockResolvedValue({
        worktreePath: "docker-volume://worker",
        resumed: false,
      }),
    } as unknown as IWorkspaceManager;
    const preparer = new InvocationWorkspacePreparer(
      workspaceManager,
      () => async () => undefined,
      undefined,
      vi.fn().mockResolvedValue(null),
    );

    await preparer.prepareWorktree({
      repoPath: "/repo/project",
      worktreePath: "docker-volume://worker",
      workerBranch: "worker/task-1",
      featureBranch: "feature/sprint-1",
      gitPolicy: { githubMode: "REMOTE" },
    });

    expect(workspaceManager.prepareWorktree).toHaveBeenCalledWith(
      "/repo/project",
      "docker-volume://worker",
      "worker/task-1",
      "feature/sprint-1",
      undefined,
      undefined,
      {
        remoteOnly: true,
        refreshRemote: true,
        allowExistingWorkerBranch: false,
      },
    );
  });

  it("rejects a fresh remote worker branch before preparing the provider workspace", async () => {
    const workspaceManager = {
      prepareWorktree: vi.fn(),
    } as unknown as IWorkspaceManager;
    const probeRemoteWorkerBranch = vi.fn().mockResolvedValue("a".repeat(40));
    const preparer = new InvocationWorkspacePreparer(
      workspaceManager,
      () => async () => undefined,
      undefined,
      probeRemoteWorkerBranch,
    );

    await expect(preparer.prepareWorktree({
      repoPath: "/repo/project",
      worktreePath: "docker-volume://worker",
      workerBranch: "worker/task-1",
      featureBranch: "feature/sprint-1",
      gitPolicy: { githubMode: "REMOTE" },
    })).rejects.toThrow(
      "Fresh worker branch allocation collided with existing remote ref 'worker/task-1'.",
    );

    expect(probeRemoteWorkerBranch).toHaveBeenCalledWith(
      "/repo/project",
      "worker/task-1",
      {},
    );
    expect(workspaceManager.prepareWorktree).not.toHaveBeenCalled();
  });

  it("refreshes remote-only snapshots without reconciling local branches", async () => {
    const fetchSnapshotBranch = vi.fn().mockResolvedValue(true);
    const preparer = new InvocationWorkspacePreparer(
      {} as IWorkspaceManager,
      () => async () => undefined,
      fetchSnapshotBranch,
    );

    await preparer.refreshSnapshotRefs(
      "/repo/project",
      { branch: "task/one", fallbackBranch: "dev", remoteOnly: true },
      { githubMode: "REMOTE", githubToken: "token" },
    );

    expect(fetchSnapshotBranch).toHaveBeenCalledOnce();
    expect(fetchSnapshotBranch).toHaveBeenCalledWith(
      "/repo/project",
      { githubToken: "token", gitlabToken: undefined },
      ["task/one", "dev"],
    );
  });
});
