import type { CliWorkflowSettings, SettingsCredentialReference } from "../../../contracts/app-types.js";
import { syncRemoteBranchIfAvailable } from "../../../services/git-branch-sync-service.js";
import type { GitHttpAuthOptions } from "../../../services/git-http-auth.js";
import { withResolvedGitSettingsCredentials } from "../../../services/credentials/git-settings-credential-resolver.js";
import type { SettingsCredentialResolver } from "../../../services/credentials/settings-credential-resolver.js";
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
  projectId?: string | null;
  workspaceId?: string;
  githubTokenCredentialRef?: SettingsCredentialReference | null;
  gitlabTokenCredentialRef?: SettingsCredentialReference | null;
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
    projectId: args.projectId,
    workspaceId: args.workspaceId,
    githubTokenCredentialRef: args.githubTokenCredentialRef,
    gitlabTokenCredentialRef: args.gitlabTokenCredentialRef,
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
  return {
    remoteOnly: gitPolicy?.githubMode === "REMOTE",
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

export class InvocationWorkspacePreparer {
  constructor(
    private readonly workspaceManager: IWorkspaceManager = new WorkspaceManager(),
    private readonly settingsCredentialResolver?: SettingsCredentialResolver,
  ) {}

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

  async createHostSnapshotWorkspace(args: CreateSnapshotWorkspaceRequest): Promise<string> {
    await this.refreshSnapshotRefs(args.repoPath, args.checkout, args.gitPolicy);
    return await this.workspaceManager.createHostSnapshotWorkspace(args.repoPath, args.sessionId, args.checkout);
  }

  async prepareWorktree(args: PrepareInvocationWorktreeRequest): Promise<{ worktreePath: string; resumed: boolean }> {
    const prepare = async (gitAuth: GitHttpAuthOptions): Promise<{ worktreePath: string; resumed: boolean }> => (
      await this.workspaceManager.prepareWorktree(
        args.repoPath,
        args.worktreePath,
        args.workerBranch,
        args.featureBranch,
        args.resumeSessionId,
        gitAuth,
        resolvePrepareWorktreeOptions(args.gitPolicy),
      )
    );
    if (!args.gitPolicy || args.gitPolicy.githubMode !== "REMOTE") {
      return await prepare(args.gitAuth || {});
    }
    return await withResolvedGitSettingsCredentials({
      resolver: this.settingsCredentialResolver,
      projectId: args.gitPolicy.projectId,
      workspaceId: args.gitPolicy.workspaceId,
      repoPath: args.repoPath,
      consumer: "git.workspace.prepare",
      git: args.gitPolicy,
    }, prepare);
  }

  async resolveContinuationWorkspace(args: ContinuationWorkspaceRequest): Promise<ContinuationWorkspaceTarget> {
    const resumeWorkspacePath = await this.workspaceManager.resolveResumeWorktreePath(
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
    await withResolvedGitSettingsCredentials({
      resolver: this.settingsCredentialResolver,
      projectId: gitPolicy.projectId,
      workspaceId: gitPolicy.workspaceId,
      repoPath,
      consumer: "git.workspace.snapshot-refresh",
      git: gitPolicy,
    }, async (auth) => {
      for (const branch of uniqueBranches) {
        await syncRemoteBranchIfAvailable(repoPath, branch, auth);
      }
    });
  }
}

export function workflowUsesDocker(workflowSettings: Pick<CliWorkflowSettings, "executionMode">): boolean {
  return workflowSettings.executionMode === "DOCKER";
}
