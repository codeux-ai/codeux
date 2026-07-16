import type { CliWorkflowSettings } from "../../../contracts/app-types.js";
import {
  fetchOriginIfAvailable,
  type GitBranchSyncOptions,
} from "../../../services/git-branch-sync-service.js";
import {
  buildGitHttpAuthEnvForRepoWithFallbacks,
  type GitHttpAuthOptions,
} from "../../../services/git-http-auth.js";
import { runCommandStrict } from "../../../services/cli-process-runner.js";
import { acquireProjectGitHelper } from "../../../shared/subprocess/command-runner.js";
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
  allowExistingWorkerBranch?: boolean;
  gitAuth?: GitHttpAuthOptions;
  gitPolicy?: InvocationWorkspaceGitPolicy;
}

export interface ProviderInvocationWorkspaceOptions {
  snapshotCheckout?: SnapshotCheckout;
  gitPolicy?: InvocationWorkspaceGitPolicy;
  workspaceLifecycle: "fresh" | "continue";
  githubToken?: string;
  gitlabToken?: string;
}

export interface BuildProviderInvocationWorkspaceOptionsRequest {
  workflowSettings: Pick<CliWorkflowSettings, "executionMode">;
  gitPolicy: InvocationWorkspaceGitPolicy;
  branch?: string | null;
  fallbackBranch?: string | null;
  useDefaultBranch?: boolean;
  lifecycle?: "fresh" | "continue";
}

export interface ContinuationWorkspaceRequest {
  repoPath: string;
  sessionId: string;
  executionMode: CliWorkflowSettings["executionMode"];
  /** Durable workspace path recorded by the execution log, when it differs from the latest session. */
  worktreePath?: string | null;
}

export interface ContinuationWorkspaceTarget {
  worktreePath: string;
  hasPreservedWorkspace: boolean;
  currentBranch: string | null;
}

const cleanBranch = (branch: string | null | undefined): string | undefined => {
  const trimmed = branch?.trim();
  return trimmed || undefined;
};

export function buildInvocationGitPolicy(args: InvocationWorkspaceGitPolicy): InvocationWorkspaceGitPolicy {
  return {
    githubMode: args.githubMode,
    defaultBranch: cleanBranch(args.defaultBranch) || args.defaultBranch,
    githubToken: args.githubToken,
    gitlabToken: args.gitlabToken,
  };
}

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

export function resolvePrepareWorktreeOptions(
  gitPolicy: Pick<InvocationWorkspaceGitPolicy, "githubMode"> | undefined,
): PrepareWorktreeOptions {
  const usesRemoteGit = gitPolicy?.githubMode === "REMOTE";
  return {
    remoteOnly: usesRemoteGit,
    refreshRemote: usesRemoteGit,
  };
}

export function buildProviderInvocationWorkspaceOptions(
  request: BuildProviderInvocationWorkspaceOptionsRequest,
): ProviderInvocationWorkspaceOptions {
  const gitPolicy = buildInvocationGitPolicy(request.gitPolicy);

  return {
    snapshotCheckout: workflowUsesDocker(request.workflowSettings)
      ? buildInvocationSnapshotCheckout(gitPolicy, {
        branch: request.branch,
        fallbackBranch: request.fallbackBranch,
        useDefaultBranch: request.useDefaultBranch,
      })
      : undefined,
    gitPolicy: workflowUsesDocker(request.workflowSettings) ? gitPolicy : undefined,
    workspaceLifecycle: request.lifecycle ?? "fresh",
    githubToken: gitPolicy.githubToken || undefined,
    gitlabToken: gitPolicy.gitlabToken || undefined,
  };
}

type ProjectGitHelperLeaseFactory = (repoPath: string) => () => Promise<void>;
type SnapshotBranchFetcher = (
  repoPath: string,
  options: GitBranchSyncOptions,
  branch?: string | readonly string[],
) => Promise<boolean>;
type FreshRemoteWorkerBranchProbe = (
  repoPath: string,
  workerBranch: string,
  gitAuth: GitHttpAuthOptions,
) => Promise<string | null>;

const probeFreshRemoteWorkerBranch: FreshRemoteWorkerBranchProbe = async (
  repoPath,
  workerBranch,
  gitAuth,
) => {
  const env = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth);
  const workerRef = `refs/heads/${workerBranch}`;
  const result = await runCommandStrict(
    "git",
    ["ls-remote", "--heads", "origin", workerRef],
    repoPath,
    env ?? process.env,
  );
  for (const line of result.stdout.split(/\r?\n/)) {
    const [sha, ref] = line.trim().split(/\s+/, 2);
    if (sha && ref === workerRef) {
      return sha;
    }
  }
  return null;
};

export class InvocationWorkspacePreparer {
  constructor(
    private readonly workspaceManager: IWorkspaceManager = new WorkspaceManager(),
    private readonly acquireGitHelperLease: ProjectGitHelperLeaseFactory = acquireProjectGitHelper,
    private readonly fetchSnapshotBranch: SnapshotBranchFetcher = fetchOriginIfAvailable,
    private readonly probeRemoteWorkerBranch: FreshRemoteWorkerBranchProbe = probeFreshRemoteWorkerBranch,
  ) {}

  get manager(): IWorkspaceManager {
    return this.workspaceManager;
  }

  async createSnapshotWorkspace(args: CreateSnapshotWorkspaceRequest): Promise<string> {
    return await this.withProjectGitHelper(args.repoPath, async () => {
      if (args.reuseExisting) {
        return await this.workspaceManager.createOrReuseSnapshotWorkspace(
          args.repoPath,
          args.sessionId,
          args.checkout,
          async () => this.refreshSnapshotRefs(args.repoPath, args.checkout, args.gitPolicy),
        );
      }
      await this.refreshSnapshotRefs(args.repoPath, args.checkout, args.gitPolicy);
      return await this.workspaceManager.createSnapshotWorkspace(
        args.repoPath,
        args.sessionId,
        args.checkout,
        args.workspaceOptions,
      );
    });
  }

  async createHostSnapshotWorkspace(args: CreateSnapshotWorkspaceRequest): Promise<string> {
    return await this.withProjectGitHelper(args.repoPath, async () => {
      await this.refreshSnapshotRefs(args.repoPath, args.checkout, args.gitPolicy);
      return await this.workspaceManager.createHostSnapshotWorkspace(args.repoPath, args.sessionId, args.checkout);
    });
  }

  async prepareWorktree(args: PrepareInvocationWorktreeRequest): Promise<{
    worktreePath: string;
    resumed: boolean;
    createdFreshWorkerBranch?: boolean;
  }> {
    return await this.withProjectGitHelper(args.repoPath, async () => {
      const allowExistingWorkerBranch = args.allowExistingWorkerBranch
        ?? Boolean(args.resumeSessionId);
      if (!allowExistingWorkerBranch && args.gitPolicy?.githubMode === "REMOTE") {
        const remoteTip = await this.probeRemoteWorkerBranch(
          args.repoPath,
          args.workerBranch,
          args.gitAuth ?? {},
        );
        if (remoteTip) {
          throw new Error(
            `Fresh worker branch allocation collided with existing remote ref '${args.workerBranch}'.`,
          );
        }
      }
      return await this.workspaceManager.prepareWorktree(
        args.repoPath,
        args.worktreePath,
        args.workerBranch,
        args.featureBranch,
        args.resumeSessionId,
        args.gitAuth,
        {
          ...resolvePrepareWorktreeOptions(args.gitPolicy),
          allowExistingWorkerBranch,
        },
      );
    });
  }

  async resolveContinuationWorkspace(args: ContinuationWorkspaceRequest): Promise<ContinuationWorkspaceTarget> {
    return await this.withProjectGitHelper(args.repoPath, async () => {
      const durableWorktreePath = args.worktreePath?.trim();
      const resumeWorkspacePath = durableWorktreePath
        && await this.workspaceManager.workspaceExists(durableWorktreePath)
        ? durableWorktreePath
        : await this.workspaceManager.resolveResumeWorktreePath(
          args.repoPath,
          args.sessionId,
          args.executionMode,
        );
      const hasPreservedWorkspace = Boolean(resumeWorkspacePath);
      const worktreePath = resumeWorkspacePath
        || this.workspaceManager.buildWorktreePath(args.repoPath, args.sessionId, args.executionMode);
      const currentBranch = hasPreservedWorkspace
        ? await this.workspaceManager.resolveCurrentBranch(worktreePath)
        : null;

      return {
        worktreePath,
        hasPreservedWorkspace,
        currentBranch,
      };
    });
  }

  private async withProjectGitHelper<T>(repoPath: string, operation: () => Promise<T>): Promise<T> {
    const release = this.acquireGitHelperLease(repoPath);
    try {
      return await operation();
    } finally {
      await release();
    }
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
    if (uniqueBranches.length > 0) {
      // Snapshot consumers read refs/remotes/origin/* directly. Fetching the requested ref is
      // sufficient; the full branch-sync path additionally probes and mutates the local branch,
      // adding several serial Git processes without changing the snapshot that will be seeded.
      await this.fetchSnapshotBranch(repoPath, {
        githubToken: gitPolicy.githubToken,
        gitlabToken: gitPolicy.gitlabToken,
      }, uniqueBranches);
    }
  }
}

export function workflowUsesDocker(workflowSettings: Pick<CliWorkflowSettings, "executionMode">): boolean {
  return workflowSettings.executionMode === "DOCKER";
}
