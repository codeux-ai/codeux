import type { PipelineContext } from "./pipeline-context.js";

export async function executeCleanupStage(ctx: PipelineContext): Promise<void> {
  const shouldCleanup = ctx.workflowSucceeded
    ? ctx.workflowSettings.cleanupWorktreeOnSuccess
    : ctx.workflowSettings.cleanupWorktreeOnFailure;

  if (shouldCleanup) {
    await ctx.workspaceManager.removeWorktree(ctx.repoPath, ctx.worktreePath);
  } else {
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
      originator: "system",
      description: `Preserving worktree: ${ctx.worktreePath}`,
    });
  }
}
