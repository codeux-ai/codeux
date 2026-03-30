import type { PipelineContext } from "./pipeline-context.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "../../cli-workflow-text-utils.js";
import { classifyProviderError, ProviderQuotaError } from "../../../shared/providers/provider-error-classifier.js";
import { resolveProviderRetryDecision, sleepWithSignal } from "../../../shared/providers/provider-retry-policy.js";
import { resolveProviderForInvocation } from "../../provider-routing.js";

export async function executeProviderStage(ctx: PipelineContext, providerPrompt: string): Promise<void> {
  const providerSettings = ctx.providerSettingsOverride || resolveProviderForInvocation(ctx.settings, {
    invocation: "task_coding",
    task: ctx.task,
  }).providers[ctx.provider];
  const model = providerSettings.model;
  const taskRun = ctx.taskRunId && ctx.deps.executionRepository
    ? ctx.deps.executionRepository.getTaskRun(ctx.taskRunId)
    : null;

  let execInvocationId: string | null = null;

  const runProvider = async (p: string, retrySystemMessage?: string, continueSessionId?: string | null) => {
    const startedAt = new Date().toISOString();

    if (!execInvocationId) {
      execInvocationId = ctx.deps.executionRepository?.createExecutionInvocation({
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
      })?.id || null;
    }

    if (execInvocationId && retrySystemMessage) {
      ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: retrySystemMessage,
      });
    }

    if (execInvocationId) {
      ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
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

    if (invocation && execInvocationId) {
      ctx.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
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
      continueSessionId,
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

    if (execInvocationId) {
      ctx.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
        status: result.ok ? "completed" : "failed",
        provider: ctx.provider,
        model,
        finishedAt: new Date().toISOString(),
      });
      if (!result.ok) {
        ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "tool",
          contentMarkdown: result.stderr || result.stdout || "Provider failed without output.",
        });
      } else {
        ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "assistant",
          contentMarkdown: result.usageTelemetry.transcriptText,
        });
      }
    }

    return result;
  };

  let currentPrompt = providerPrompt;
  let providerResult: Awaited<ReturnType<typeof runProvider>>;
  let usedReadFileRetry = false;
  let continueSessionId: string | null = null;
  let rateLimitRetryCount = 0;

  while (true) {
    providerResult = await runProvider(
      currentPrompt,
      usedReadFileRetry ? "Retrying with file-discovery guidance." : undefined,
      continueSessionId,
    );

    if (!providerResult.ok && ctx.workflowSettings.retryOnReadFileNotFound && !usedReadFileRetry && isReadFileNotFoundToolError(providerResult)) {
      ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
        originator: "system",
        description: "Retrying with file-discovery guidance.",
      });
      currentPrompt = buildReadFileRetryPrompt(providerPrompt);
      usedReadFileRetry = true;
      continue;
    }

    if (providerResult.ok) {
      return;
    }

    const classification = classifyProviderError(ctx.provider, providerResult);
    if (execInvocationId) {
      ctx.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
        lastErrorCategory: classification.category,
        lastErrorMessage: classification.userMessage,
        lastRetryAfterIso: classification.resetAtIso,
      });
      ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
        role: "system",
        contentMarkdown: `Provider error (${classification.category}): ${classification.userMessage}`,
        metadata: {
          provider: ctx.provider,
          model,
          errorCategory: classification.category,
          retryAfterIso: classification.resetAtIso,
        },
      });
    }

    const retryDecision = resolveProviderRetryDecision(classification, ctx.workflowSettings);
    if (retryDecision) {
      if (retryDecision.kind === "rate_limit" && rateLimitRetryCount >= ctx.workflowSettings.maxRateLimitRetries) {
        // fall through to terminal classified error handling below
      } else {
        if (retryDecision.kind === "rate_limit") {
          rateLimitRetryCount += 1;
        }
        const retryMessage = retryDecision.kind === "quota_reset"
          ? `Waiting for provider quota reset. Retrying at ${retryDecision.retryAtIso}.`
          : `Provider rate-limited. Retrying at ${retryDecision.retryAtIso}.`;
        ctx.deps.sessionTracking.appendActivity(ctx.sessionId, {
          originator: "system",
          description: retryMessage,
        });
        if (execInvocationId) {
          ctx.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
            role: "system",
            contentMarkdown: retryMessage,
            metadata: {
              provider: ctx.provider,
              model,
              errorCategory: classification.category,
              retryAfterIso: retryDecision.retryAtIso,
            },
          });
        }
        continueSessionId = providerResult.nativeSessionId || (ctx.provider === "claude-code" ? null : ctx.sessionId);
        await sleepWithSignal(retryDecision.delayMs, ctx.abortSignal);
        continue;
      }
    }

    if (classification.category !== "UNKNOWN") {
      throw new ProviderQuotaError(classification);
    }
    throw new Error(classification.userMessage);
  }
}
