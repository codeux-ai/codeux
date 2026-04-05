import type { PipelineContext } from "./pipeline-context.js";

export async function executeGitFinalizeStage(ctx: PipelineContext): Promise<{
  hasChanges: boolean;
  committedChanges: boolean;
  pushedBranch?: string;
  stats?: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
}> {
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
    return { hasChanges: false, committedChanges: false };
  }

  if (hasWorkingTreeChanges) {
    await ctx.runCommand("git", ["add", "-A"], ctx.worktreePath);
    await ctx.runCommand("git", ["commit", "-m", `feat(task ${ctx.task.id}): implement via ${ctx.provider}`], ctx.worktreePath);
  }

  await ctx.runCommand("git", ["push", "-u", "origin", ctx.workerBranch], ctx.worktreePath);

  // Calculate git metrics against the initial head
  const diffOutput = (await ctx.runCommand("git", ["diff", "--numstat", ctx.initialHead, "HEAD"], ctx.worktreePath)).stdout;

  let filesChanged = 0;
  let insertions = 0;
  let deletions = 0;

  const lines = diffOutput.trim().split("\n");
  for (const line of lines) {
    if (!line) continue;
    const parts = line.split("\t");
    if (parts.length >= 2) {
      filesChanged++;
      // Handle binary files which output '-' instead of a number
      if (parts[0] !== '-' && parts[1] !== '-') {
        const ins = parseInt(parts[0], 10);
        const del = parseInt(parts[1], 10);
        if (!isNaN(ins)) insertions += ins;
        if (!isNaN(del)) deletions += del;
      }
    }
  }

  return {
    hasChanges: true,
    committedChanges: hasWorkingTreeChanges || hasCommittedChanges,
    pushedBranch: ctx.workerBranch,
    stats: {
      filesChanged,
      insertions,
      deletions,
    },
  };
}
