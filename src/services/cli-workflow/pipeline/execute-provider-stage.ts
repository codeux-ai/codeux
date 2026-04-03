import type { PipelineContext } from "./pipeline-context.js";
import { resolveProviderForInvocation } from "../../provider-routing.js";
import { ProviderExecutionService } from "../../provider-execution-service.js";

export async function executeProviderStage(ctx: PipelineContext, providerPrompt: string): Promise<void> {
  const providerSettings = ctx.providerSettingsOverride || resolveProviderForInvocation(ctx.settings, {
    invocation: "task_coding",
    task: ctx.task,
  }).providers[ctx.provider];

  const taskRun = ctx.taskRunId && ctx.deps.executionRepository
    ? ctx.deps.executionRepository.getTaskRun(ctx.taskRunId)
    : null;

  const providerExecutionService = new ProviderExecutionService({
    executionRepository: ctx.deps.executionRepository,
    sessionTracking: ctx.deps.sessionTracking,
    providerRunner: ctx.providerRunner,
    getGithubToken: ctx.deps.getGithubToken,
  });

  const result = await providerExecutionService.executeProvider({
    projectId: taskRun?.projectId || "",
    sprintId: taskRun?.sprintId,
    taskId: taskRun?.taskId,
    sprintRunId: taskRun?.sprintRunId,
    dispatchId: taskRun?.dispatchId,
    taskRunId: taskRun?.id,
    purpose: "task_coding",
    type: "cli_task_coding",
    provider: ctx.provider,
    prompt: providerPrompt,
    cwd: ctx.worktreePath,
    model: providerSettings.model,
    apiKey: providerSettings.apiKey,
    sessionId: ctx.sessionId,
    workflowSettings: ctx.workflowSettings,
    repoPath: ctx.repoPath,
    githubToken: ctx.deps.getGithubToken(),
    signal: ctx.abortSignal,
  });

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || "Provider failed without output.");
  }
}
