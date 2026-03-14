import { buildProviderPrompt } from "../../cli-workflow-utils.js";
import type { PipelineContext } from "./pipeline-context.js";

export async function executePrepareStage(
  ctx: PipelineContext,
  resumeFromFailedSessionId?: string
): Promise<{ worktreePath: string; initialHead: string; providerPrompt: string }> {
  const providerSettings = ctx.settings.aiProvider.providers[ctx.provider];

  const workerGuide = await ctx.deps.getWorkerInstruction(ctx.repoPath);

  const promptBody = workerGuide
    ? `## SYSTEM INSTRUCTIONS & ENGINEERING STANDARDS\n\n${workerGuide}\n\n---\n\n## SUBTASK TO EXECUTE\n\n${ctx.task.prompt}`
    : ctx.task.prompt;

  const { worktreePath: finalPath, resumed } = await ctx.workspaceManager.prepareWorktree(
    ctx.repoPath,
    ctx.worktreePath,
    ctx.workerBranch,
    ctx.featureBranch,
    resumeFromFailedSessionId
  );

  ctx.worktreePath = finalPath;

  const workspaceGuidance = await ctx.workspaceManager.buildWorkspaceGuidance(ctx.task.prompt, ctx.worktreePath);
  const providerPrompt = buildProviderPrompt(`${promptBody}\n\n${workspaceGuidance}`, providerSettings.thinkingMode);

  const initialHead = (await ctx.runCommand("git", ["rev-parse", "HEAD"], ctx.worktreePath)).stdout.trim();
  ctx.initialHead = initialHead;

  if (resumed) {
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
      originator: "system",
      description: `Resumed failed workspace from ${resumeFromFailedSessionId}.`,
    });
    try {
      await ctx.runCommand("git", ["merge", "--ff-only", `origin/${ctx.featureBranch}`], ctx.worktreePath);
      ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
        originator: "system",
        description: `Synced resumed workspace with latest origin/${ctx.featureBranch}.`,
      });
    } catch {
      ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
        originator: "system",
        description: `Resumed workspace could not fast-forward; continuing on existing state.`,
      });
    }
  }

  ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
    originator: "system",
    description: `Running ${ctx.provider} prompt on ${ctx.workerBranch}.`,
  });

  return { worktreePath: ctx.worktreePath, initialHead, providerPrompt };
}
