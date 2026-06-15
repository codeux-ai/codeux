import type { PipelineContext } from "./pipeline-context.js";

export async function executePrFinalizeStage(ctx: PipelineContext): Promise<{ prUrl?: string }> {
  let prUrl: string | undefined;

  // In LOCAL git mode there is no remote host to open a PR against — the worker
  // branch stays local and the feature-PR gate merges it into the feature branch
  // with a local `git merge --no-ff`. Attempting a remote PR here hits the no-op
  // LocalHostCli and fails the whole workflow ("Host CLI unavailable for local
  // provider"), so skip PR creation entirely and let the task settle as
  // CODING_COMPLETED awaiting the local merge.
  if (ctx.settings.git.autoCreatePr && ctx.settings.git.githubMode !== "LOCAL") {
    const sprint = ctx.task.sprint_id ? ctx.deps.projectManagementRepository?.getSprint(ctx.task.sprint_id) : null;
    prUrl = await ctx.prService.resolveOrCreateFeaturePr(
      {
        taskId: ctx.task.id,
        provider: ctx.provider,
        title: ctx.title,
        featureBranch: ctx.featureBranch,
        workerBranch: ctx.workerBranch,
        taskDescription: ctx.task.prompt,
        sprintDescription: sprint?.goal,
      },
      ctx.repoPath,
      {
        githubToken: ctx.deps.getGithubToken() || ctx.settings.git.githubToken,
        gitlabToken: ctx.settings.git.gitlabToken,
      }
    );
    if (!prUrl) {
      throw new Error(`Feature PR creation completed without a PR URL for ${ctx.workerBranch}. Check Git host token availability and authentication.`);
    }
  }

  ctx.deps.sessionTracking.updateSession(ctx.sessionId, { state: "COMPLETED", prUrl });
  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: prUrl
      ? `Workflow completed. PR: ${prUrl}`
      : ctx.settings.git.githubMode === "LOCAL"
        ? `Workflow completed. Worker branch ${ctx.workerBranch} is ready to merge locally into ${ctx.featureBranch}.`
        : "Workflow completed without PR because auto-create PRs are disabled.",
  });

  ctx.workflowSucceeded = true;
  return { prUrl };
}
