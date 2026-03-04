import type { PipelineContext } from "./pipeline-context.js";

export async function executeGitFinalizeStage(ctx: PipelineContext): Promise<{ hasChanges: boolean }> {
  // Ensure we are on the right branch
  const currentBranch = (await ctx.runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], ctx.worktreePath)).stdout.trim();
  if (currentBranch !== ctx.workerBranch) {
    await ctx.runCommand("git", ["checkout", ctx.workerBranch], ctx.worktreePath);
  }

  const finalHead = (await ctx.runCommand("git", ["rev-parse", "HEAD"], ctx.worktreePath)).stdout.trim();
  const hasWorkingTreeChanges = (await ctx.runCommand("git", ["status", "--porcelain"], ctx.worktreePath)).stdout.trim().length > 0;
  const hasCommittedChanges = finalHead !== ctx.initialHead;
  const hasUnpushed = await ctx.prService.hasUnpushedCommits(ctx.worktreePath, ctx.workerBranch, ctx.featureBranch);
  const hasAhead = await ctx.prService.hasWorkerBranchCommitsAgainstFeature(ctx.worktreePath, ctx.featureBranch);

  if (!hasWorkingTreeChanges && !hasCommittedChanges && !hasUnpushed && !hasAhead) {
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, { originator: "system", description: `No file changes produced.` });
    ctx.deps.sessionTracking.updateSession(ctx.sessionId, { state: "COMPLETED" });
    ctx.workflowSucceeded = true;
    return { hasChanges: false };
  }

  if (hasWorkingTreeChanges) {
    await ctx.runCommand("git", ["add", "-A"], ctx.worktreePath);
    await ctx.runCommand("git", ["commit", "-m", `feat(task ${ctx.task.id}): implement via ${ctx.provider}`], ctx.worktreePath);
  }

  await ctx.runCommand("git", ["push", "-u", "origin", ctx.workerBranch], ctx.worktreePath);

  return { hasChanges: true };
}
