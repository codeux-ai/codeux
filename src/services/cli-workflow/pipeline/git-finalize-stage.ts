import { withResolvedPipelineGitCredentials, type PipelineContext } from "./pipeline-context.js";
import { buildGitHttpAuthEnvForRepoWithFallbacks, type GitHttpAuthOptions } from "../../git-http-auth.js";
import { isRuntimeShutdownInProgress } from "../../shutdown-state.js";

export async function executeGitFinalizeStage(ctx: PipelineContext): Promise<{
  hasChanges: boolean;
  committedChanges: boolean;
  pushedBranch?: string;
  commitSha?: string;
  stats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}> {
  if (ctx.deps.settingsCredentialResolver && (ctx.settings.git.githubTokenCredentialRef || ctx.settings.git.gitlabTokenCredentialRef)) {
    return await withResolvedPipelineGitCredentials(ctx, executeGitFinalizeStage);
  }
  const gitAuth: GitHttpAuthOptions = {
    githubToken: ctx.settings.git.githubToken,
    gitlabToken: ctx.settings.git.gitlabToken,
  };
  const gitIdentity = ctx.workflowSettings.containerMountGitConfig
    || !ctx.workflowSettings.containerGitUserName?.trim()
    || !ctx.workflowSettings.containerGitUserEmail?.trim()
    ? undefined
    : {
      name: ctx.workflowSettings.containerGitUserName,
      email: ctx.workflowSettings.containerGitUserEmail,
    };
  const patchText = await ctx.workspaceArtifactService.exportBinaryPatch(ctx.worktreePath, ctx.initialHead);
  const applied = await ctx.workspaceArtifactService.applyPatchToBranch({
    repoPath: ctx.repoPath,
    baseRef: ctx.initialHead,
    workerBranch: ctx.workerBranch,
    patchText,
    commitMessage: `feat(task ${ctx.task.id}): implement via ${ctx.provider}`,
    gitAuth,
    gitIdentity,
    githubMode: ctx.settings.git.githubMode,
  });

  if (applied.hasChanges) {
    return {
      hasChanges: true,
      committedChanges: true,
      pushedBranch: ctx.workerBranch,
      commitSha: applied.commitSha,
      stats: applied.stats,
    };
  }

  const hasUnpushed = await ctx.prService.hasUnpushedCommits(ctx.repoPath, ctx.workerBranch, ctx.featureBranch);
  const hasAhead = await ctx.prService.hasWorkerBranchCommitsAgainstFeature(ctx.repoPath, ctx.workerBranch, ctx.featureBranch);

  if (!applied.hasChanges && !hasUnpushed && !hasAhead) {
    if (isRuntimeShutdownInProgress()) {
      throw new Error("Runtime shutdown interrupted git finalization before no-change output could be trusted.");
    }
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, { originator: "system", description: `No file changes produced.` });
    ctx.deps.sessionTracking.updateSession(ctx.sessionId, { state: "COMPLETED" });
    ctx.workflowSucceeded = true;
    return { hasChanges: false, committedChanges: false };
  }

  if (hasUnpushed && ctx.settings.git.githubMode !== "LOCAL") {
    const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(ctx.repoPath, gitAuth);
    await ctx.runCommand(
      "git",
      ["push", "-u", "origin", `refs/heads/${ctx.workerBranch}:refs/heads/${ctx.workerBranch}`],
      ctx.repoPath,
      pushEnv ?? process.env,
    );
  }

  const headResult = await ctx.runCommand(
    "git",
    ["rev-parse", `refs/heads/${ctx.workerBranch}`],
    ctx.repoPath,
  );
  const branchHeadSha = headResult.stdout.trim() || undefined;

  return {
    hasChanges: hasAhead || hasUnpushed,
    committedChanges: hasAhead || hasUnpushed,
    pushedBranch: ctx.workerBranch,
    commitSha: branchHeadSha,
  };
}
