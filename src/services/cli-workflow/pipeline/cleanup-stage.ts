import type { PipelineContext } from "./pipeline-context.js";

export async function executeCleanupStage(ctx: PipelineContext): Promise<{ cleanedUp: boolean }> {
  const shouldCleanup = ctx.workflowSucceeded
    ? (ctx.preserveSuccessfulWorktree ? false : ctx.workflowSettings.cleanupWorktreeOnSuccess)
    : ctx.workflowSettings.cleanupWorktreeOnFailure;

  if (shouldCleanup) {
    await ctx.workspaceManager.removeWorktree(ctx.repoPath, ctx.worktreePath);
    return { cleanedUp: true };
  }

  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: `Preserving worktree: ${ctx.worktreePath}`,
  });
  return { cleanedUp: false };
}
