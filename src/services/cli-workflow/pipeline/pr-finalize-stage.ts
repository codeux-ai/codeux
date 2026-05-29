import type { PipelineContext } from "./pipeline-context.js";

export async function executePrFinalizeStage(ctx: PipelineContext): Promise<{ prUrl?: string }> {
  let prUrl: string | undefined;

  if (ctx.settings.git.autoCreatePr) {
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
      throw new Error(`Feature PR creation completed without a PR URL for ${ctx.workerBranch}. Check Git host CLI availability and authentication.`);
    }
  }

  ctx.deps.sessionTracking.updateSession(ctx.sessionId, { state: "COMPLETED", prUrl });
  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: prUrl
      ? `Workflow completed. PR: ${prUrl}`
      : "Workflow completed without PR because auto-create PRs are disabled.",
  });

  ctx.workflowSucceeded = true;
  return { prUrl };
}
