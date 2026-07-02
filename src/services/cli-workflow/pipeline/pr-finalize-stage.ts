import type { PipelineContext } from "./pipeline-context.js";
import { buildTaskPrComposerInput } from "../../../domain/sprint/composer/task-pr-input-builder.js";
import { composeTaskPrBody, composeTaskPrTitle } from "../../../domain/sprint/composer/pr-description-composer.js";

export async function executePrFinalizeStage(ctx: PipelineContext): Promise<{ prUrl?: string }> {
  let prUrl: string | undefined;

  // In LOCAL git mode there is no remote host to open a PR against — the worker
  // branch stays local and the feature-PR gate merges it into the feature branch
  // with a local `git merge --no-ff`. Attempting a remote PR here hits the no-op
  // LocalHostCli and fails the whole workflow ("Host CLI unavailable for local
  // provider"), so skip PR creation entirely and let the task settle as
  // CODING_COMPLETED awaiting the local merge.
  if (ctx.settings.git.autoCreatePr && ctx.settings.git.githubMode !== "LOCAL") {
    const sprint = ctx.task.sprint_id ? ctx.deps.projectManagementRepository?.getSprint(ctx.task.sprint_id) ?? null : null;
    const taskRun = ctx.taskRunId ? ctx.deps.executionRepository?.getTaskRun(ctx.taskRunId) ?? null : null;
    const composerInput = buildTaskPrComposerInput({
      projectId: ctx.task.project_id || "",
      task: ctx.task,
      sprint,
      provider: ctx.provider,
      featureBranch: ctx.featureBranch,
      workerBranch: ctx.workerBranch,
      taskRun,
      aiProviderSettings: ctx.settings.aiProvider,
      sections: ctx.settings.git.prDescription.task,
      executionRepository: ctx.deps.executionRepository,
    });
    prUrl = await ctx.prService.resolveOrCreateFeaturePr(
      {
        taskId: ctx.task.id,
        provider: ctx.provider,
        title: composeTaskPrTitle(composerInput),
        body: composeTaskPrBody(composerInput),
        featureBranch: ctx.featureBranch,
        workerBranch: ctx.workerBranch,
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
