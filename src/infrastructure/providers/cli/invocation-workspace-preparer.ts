import type { CliWorkflowSettings } from "../../../contracts/app-types.js";
import { syncRemoteBranchIfAvailable } from "../../../services/git-branch-sync-service.js";
import type { GitHttpAuthOptions } from "../../../services/git-http-auth.js";
import {
  WorkspaceManager,
  type IWorkspaceManager,
  type PrepareWorktreeOptions,
  type SnapshotCheckout,
  type SnapshotWorkspaceOptions,
} from "./workspace-manager.js";

export interface InvocationWorkspaceGitPolicy extends GitHttpAuthOptions {
  githubMode: "REMOTE" | "LOCAL";
  defaultBranch?: string | null;
}

export interface SnapshotBranchRequest {
  branch?: string | null;
  fallbackBranch?: string | null;
  useDefaultBranch?: boolean;
}

export interface CreateSnapshotWorkspaceRequest {
  repoPath: string;
  sessionId: string;
  checkout?: SnapshotCheckout;
  workspaceOptions?: SnapshotWorkspaceOptions;
  reuseExisting?: boolean;
  gitPolicy?: InvocationWorkspaceGitPolicy;
}

export interface PrepareInvocationWorktreeRequest {
  repoPath: string;
  worktreePath: string;
  workerBranch: string;
  featureBranch: string;
  resumeSessionId?: string;
  gitAuth?: GitHttpAuthOptions;
  gitPolicy?: InvocationWorkspaceGitPolicy;
}

const cleanBranch = (branch: string | null | undefined): string | undefined => {
  const trimmed = branch?.trim();
  return trimmed || undefined;
};

export function resolveDefaultBranch(
  gitPolicy: Pick<InvocationWorkspaceGitPolicy, "defaultBranch"> | undefined,
  fallbackBranch?: string | null,
): string | undefined {
  return cleanBranch(gitPolicy?.defaultBranch) || cleanBranch(fallbackBranch);
}

export function buildInvocationSnapshotCheckout(
  gitPolicy: InvocationWorkspaceGitPolicy,
  request: SnapshotBranchRequest,
): SnapshotCheckout | undefined {
  const defaultBranch = request.useDefaultBranch === false
    ? undefined
    : resolveDefaultBranch(gitPolicy, request.fallbackBranch);
  const branch = cleanBranch(request.branch) || defaultBranch;
  const fallbackBranch = cleanBranch(request.fallbackBranch);

  if (gitPolicy.githubMode !== "REMOTE") {
    return branch || fallbackBranch ? { branch, fallbackBranch } : undefined;
  }

  return {
    branch,
    fallbackBranch: fallbackBranch && fallbackBranch !== branch ? fallbackBranch : undefined,
    remoteOnly: true,
  };
}

export function buildDefaultBranchSnapshotCheckout(
  gitPolicy: InvocationWorkspaceGitPolicy,
  fallbackBranch?: string | null,
): SnapshotCheckout | undefined {
  return buildInvocationSnapshotCheckout(gitPolicy, {
    fallbackBranch,
  });
}

export function buildExplicitBranchSnapshotCheckout(
  gitPolicy: InvocationWorkspaceGitPolicy,
  branch?: string | null,
  fallbackBranch?: string | null,
): SnapshotCheckout | undefined {
  return buildInvocationSnapshotCheckout(gitPolicy, {
    branch,
    fallbackBranch,
    useDefaultBranch: false,
  });
}

export function resolvePrepareWorktreeOptions(
  gitPolicy: Pick<InvocationWorkspaceGitPolicy, "githubMode"> | undefined,
): PrepareWorktreeOptions {
  return {
    remoteOnly: gitPolicy?.githubMode === "REMOTE",
  };
}

export class InvocationWorkspacePreparer {
  constructor(private readonly workspaceManager: IWorkspaceManager = new WorkspaceManager()) {}

  get manager(): IWorkspaceManager {
    return this.workspaceManager;
  }

  async createSnapshotWorkspace(args: CreateSnapshotWorkspaceRequest): Promise<string> {
    await this.refreshSnapshotRefs(args.repoPath, args.checkout, args.gitPolicy);
    if (args.reuseExisting) {
      return await this.workspaceManager.createOrReuseSnapshotWorkspace(args.repoPath, args.sessionId, args.checkout);
    }
    return await this.workspaceManager.createSnapshotWorkspace(
      args.repoPath,
      args.sessionId,
      args.checkout,
      args.workspaceOptions,
    );
  }

  async prepareWorktree(args: PrepareInvocationWorktreeRequest): Promise<{ worktreePath: string; resumed: boolean }> {
    return await this.workspaceManager.prepareWorktree(
      args.repoPath,
      args.worktreePath,
      args.workerBranch,
      args.featureBranch,
      args.resumeSessionId,
      args.gitAuth,
      resolvePrepareWorktreeOptions(args.gitPolicy),
    );
  }

  async refreshSnapshotRefs(
    repoPath: string,
    checkout: SnapshotCheckout | undefined,
    gitPolicy: InvocationWorkspaceGitPolicy | undefined,
  ): Promise<void> {
    if (gitPolicy?.githubMode !== "REMOTE" || !checkout?.remoteOnly) {
      return;
    }

    const branches = [checkout.branch, checkout.fallbackBranch]
      .map(cleanBranch)
      .filter((branch): branch is string => Boolean(branch));
    const uniqueBranches = Array.from(new Set(branches));
    for (const branch of uniqueBranches) {
      await syncRemoteBranchIfAvailable(repoPath, branch, {
        githubToken: gitPolicy.githubToken,
        gitlabToken: gitPolicy.gitlabToken,
      });
    }
  }
}

export function workflowUsesDocker(workflowSettings: Pick<CliWorkflowSettings, "executionMode">): boolean {
  return workflowSettings.executionMode === "DOCKER";
}
