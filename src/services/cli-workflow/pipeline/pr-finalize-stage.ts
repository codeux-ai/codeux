import type { PipelineContext } from "./pipeline-context.js";

export async function executePrFinalizeStage(ctx: PipelineContext): Promise<void> {
  let prUrl: string | undefined;

  if (ctx.settings.git.autoCreatePr) {
    prUrl = await ctx.prService.resolveOrCreateFeaturePr(
      {
        taskId: ctx.task.id,
        provider: ctx.provider,
        title: ctx.title,
        featureBranch: ctx.featureBranch,
        workerBranch: ctx.workerBranch,
      },
      ctx.worktreePath,
      ctx.deps.getGithubToken()
    );
  }

  ctx.deps.sessionTracking.updateSession(ctx.sessionId, { state: "COMPLETED", prUrl });
  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: prUrl ? `Workflow completed. PR: ${prUrl}` : "Workflow completed.",
  });

  ctx.workflowSucceeded = true;
}
