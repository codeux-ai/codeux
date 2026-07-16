import type { PipelineContext } from "./pipeline-context.js";

export async function executeCleanupStage(ctx: PipelineContext): Promise<{ cleanedUp: boolean }> {
  const shouldCleanup = ctx.workflowSucceeded
    ? (ctx.preserveSuccessfulWorktree || ctx.preserveSuccessfulWorktreeForActiveSprint
      ? false
      : ctx.workflowSettings.cleanupWorktreeOnSuccess)
    : ctx.workflowSettings.cleanupWorktreeOnFailure;

  if (shouldCleanup) {
    await ctx.workspaceManager.removeWorktree(ctx.repoPath, ctx.worktreePath);
    return { cleanedUp: true };
  }

  // A successful task workspace may remain available for QA/restart recovery,
  // but its helper container is only a command sidecar. Release that sidecar
  // immediately so preserved volumes do not retain one container per task.
  await ctx.workspaceManager.releaseWorkspaceHelper(ctx.worktreePath);

  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: `Preserving worktree: ${ctx.worktreePath}`,
  });
  return { cleanedUp: false };
}
