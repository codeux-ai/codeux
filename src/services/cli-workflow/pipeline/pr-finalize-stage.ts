import type { PipelineContext } from "./pipeline-context.js";

export async function executePrFinalizeStage(ctx: PipelineContext): Promise<{ prUrl?: string }> {
  let prUrl: string | undefined;

  if (ctx.settings.git.githubMode === "LOCAL") {
    await ctx.runCommand("git", ["checkout", ctx.featureBranch], ctx.repoPath);
    await ctx.runCommand("git", ["merge", "--no-ff", "-m", `Merge worker branch ${ctx.workerBranch}`, ctx.workerBranch], ctx.repoPath);
    await ctx.runCommand("git", ["checkout", ctx.workerBranch], ctx.repoPath);

    ctx.deps.sessionTracking.updateSession(ctx.sessionId, { state: "COMPLETED" });
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
      originator: "system",
      description: `Workflow completed. Merged locally to ${ctx.featureBranch}.`,
    });
    ctx.workflowSucceeded = true;
    return {};
  }

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
      ctx.deps.getGithubToken()
    );
  }

  ctx.deps.sessionTracking.updateSession(ctx.sessionId, { state: "COMPLETED", prUrl });
  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: prUrl ? `Workflow completed. PR: ${prUrl}` : "Workflow completed.",
  });

  ctx.workflowSucceeded = true;
  return { prUrl };
}
