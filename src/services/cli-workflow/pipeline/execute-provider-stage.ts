import type { PipelineContext } from "./pipeline-context.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "../../cli-workflow-text-utils.js";
import { classifyProviderError, ProviderQuotaError } from "../../../shared/providers/provider-error-classifier.js";

export async function executeProviderStage(ctx: PipelineContext, providerPrompt: string): Promise<void> {
  const providerSettings = ctx.settings.aiProvider.providers[ctx.provider];
  const model = ctx.provider === ctx.settings.workers.virtualWorkerProvider && ctx.settings.workers.model && ctx.settings.workers.model !== "default"
    ? ctx.settings.workers.model
    : providerSettings.model;
  const taskRun = ctx.taskRunId && ctx.deps.executionRepository
    ? ctx.deps.executionRepository.getTaskRun(ctx.taskRunId)
    : null;

  let execInvocation: { id: string } | undefined = undefined;

  const runProvider = async (p: string, retrySystemMessage?: string) => {
    const startedAt = new Date().toISOString();

    if (!execInvocation) {
      execInvocation = ctx.deps.executionRepository?.createExecutionInvocation({
        projectId: taskRun?.projectId || "",
        sprintId: taskRun?.sprintId,
        taskId: taskRun?.taskId,
        sprintRunId: taskRun?.sprintRunId,
        dispatchId: taskRun?.dispatchId,
        taskRunId: taskRun?.id,
        type: "cli_task_coding",
        provider: ctx.provider,
        model,
        startedAt,
      });
    }

    if (execInvocation && retrySystemMessage) {
      ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocation.id, {
        role: "system",
        contentMarkdown: retrySystemMessage,
      });
    }

    if (execInvocation) {
      ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocation.id, {
        role: "user",
        contentMarkdown: p,
      });
    }

    const invocation = taskRun && ctx.deps.executionRepository
      ? ctx.deps.executionRepository.createProviderInvocationUsage({
        projectId: taskRun.projectId,
        sprintId: taskRun.sprintId,
        taskId: taskRun.taskId,
        sprintRunId: taskRun.sprintRunId,
        dispatchId: taskRun.dispatchId,
        taskRunId: taskRun.id,
        sessionId: ctx.sessionId,
        provider: ctx.provider,
        purpose: "task_coding",
        model,
        startedAt,
        promptChars: p.length,
      })
      : null;

    if (invocation && execInvocation) {
      ctx.deps.executionRepository?.updateExecutionInvocation(execInvocation.id, {
        providerInvocationId: invocation.id,
      });
    }

    const startedMs = Date.now();
    const result = await ctx.providerRunner.runProvider({
      provider: ctx.provider,
      prompt: p,
      cwd: ctx.worktreePath,
      model,
      apiKey: providerSettings.apiKey,
      sessionId: ctx.sessionId,
      workflowSettings: ctx.workflowSettings,
      repoPath: ctx.repoPath,
      githubToken: ctx.deps.getGithubToken(),
      signal: ctx.abortSignal,
      onActivity: (desc, originator) =>
        ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
          description: desc,
          originator: originator || "system",
        }),
    });
    if (invocation && ctx.deps.executionRepository) {
      const finishedAt = new Date().toISOString();
      ctx.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
        status: result.ok ? "completed" : "failed",
        model,
        nativeSessionId: result.nativeSessionId,
        finishedAt,
        durationMs: Date.now() - startedMs,
        transcriptChars: result.usageTelemetry.transcriptText.length,
        inputTokens: result.usageTelemetry.inputTokens,
        cachedInputTokens: result.usageTelemetry.cachedInputTokens,
        outputTokens: result.usageTelemetry.outputTokens,
        reasoningOutputTokens: result.usageTelemetry.reasoningOutputTokens,
        totalTokens: result.usageTelemetry.totalTokens,
        usageSource: result.usageTelemetry.usageSource,
        rawUsageJson: result.usageTelemetry.rawUsageJson,
      });
      ctx.deps.executionRepository.appendTaskRunEvent(taskRun!.id, "cli_provider_usage_reported", "system", {
        provider: ctx.provider,
        model,
        purpose: "task_coding",
        inputTokens: result.usageTelemetry.inputTokens,
        cachedInputTokens: result.usageTelemetry.cachedInputTokens,
        outputTokens: result.usageTelemetry.outputTokens,
        reasoningOutputTokens: result.usageTelemetry.reasoningOutputTokens,
        totalTokens: result.usageTelemetry.totalTokens,
        usageSource: result.usageTelemetry.usageSource,
        durationMs: Date.now() - startedMs,
      }, {
        sourceEventKey: `cli:provider:usage:${invocation.id}`,
      });
    }

    if (execInvocation) {
      ctx.deps.executionRepository?.updateExecutionInvocation(execInvocation.id, {
        status: result.ok ? "completed" : "failed",
        finishedAt: new Date().toISOString(),
      });
      if (!result.ok) {
        ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocation.id, {
          role: "tool",
          contentMarkdown: result.stderr || result.stdout || "Provider failed without output.",
        });
      } else {
        ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocation.id, {
          role: "assistant",
          contentMarkdown: result.usageTelemetry.transcriptText,
        });
      }
    }

    return result;
  };

  let providerResult = await runProvider(providerPrompt);

  if (!providerResult.ok && ctx.workflowSettings.retryOnReadFileNotFound && isReadFileNotFoundToolError(providerResult)) {
    ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
      originator: "system",
      description: "Retrying with file-discovery guidance.",
    });
    providerResult = await runProvider(buildReadFileRetryPrompt(providerPrompt), "Retrying with file-discovery guidance.");
  }

  if (!providerResult.ok) {
    const classification = classifyProviderError(ctx.provider, providerResult);
    if (classification.category !== "UNKNOWN") {
      throw new ProviderQuotaError(classification);
    }
    throw new Error(classification.userMessage);
  }
}
