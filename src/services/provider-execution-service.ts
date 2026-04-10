import type { DashboardSettings } from "../contracts/app-types.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { ProviderInvocationPurpose } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { IProviderRunner, ProviderRunResult } from "../infrastructure/providers/cli/provider-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import { classifyProviderError, ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";
import { resolveProviderRetryDecision, sleepWithSignal } from "../shared/providers/provider-retry-policy.js";

export interface ProviderExecutionServiceDeps {
  executionRepository?: ExecutionRepository;
  sessionTracking?: SessionTrackingRepository;
  providerRunner: IProviderRunner;
  logger?: Logger;
  getGithubToken?: () => string | undefined;
}

type CliProviderId = "gemini" | "codex" | "claude-code";

export interface ExecutionProviderRunArgs {
  projectId: string;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  taskRunId?: string | null;
  attentionItemId?: string | null;

  purpose: ProviderInvocationPurpose;
  type: string;

  provider: CliProviderId;
  prompt: string;
  cwd?: string;
  model: string;
  apiKey: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  sessionId: string;
  workflowSettings: DashboardSettings["cliWorkflow"];
  repoPath: string;
  githubToken?: string;

  onActivity?: (description: string, originator?: string) => void;
  signal?: AbortSignal;
  continueSessionId?: string | null;

  // Option to return ProviderResult with string `text` rather than standard ProviderResult
  expectTextOutput?: boolean;

  invocationId?: string; // Use existing execution invocation if passed

  /** MCP server connection info for injecting management tools into the CLI provider. */
  mcpConnection?: McpConnectionInfo | null;
}

export class ProviderExecutionService {
  constructor(private readonly deps: ProviderExecutionServiceDeps) {}

  async executeProvider(args: ExecutionProviderRunArgs): Promise<ProviderRunResult> {
    let execInvocationId: string | null = args.invocationId || null;

    const runProviderInner = async (p: string, retrySystemMessage?: string, continueSessionId?: string | null): Promise<ProviderRunResult> => {
      const startedAt = new Date().toISOString();

      if (!execInvocationId) {
        execInvocationId = this.deps.executionRepository?.createExecutionInvocation({
          projectId: args.projectId,
          sprintId: args.sprintId,
          taskId: args.taskId,
          sprintRunId: args.sprintRunId,
          dispatchId: args.dispatchId,
          taskRunId: args.taskRunId,
          attentionItemId: args.attentionItemId,
          type: args.type,
          provider: args.provider,
          model: args.model,
          startedAt,
        })?.id || null;
      }

      if (execInvocationId && retrySystemMessage) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "system",
          contentMarkdown: retrySystemMessage,
        });
      }

      if (execInvocationId) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "user",
          contentMarkdown: p,
        });
      }

      const invocation = this.deps.executionRepository?.createProviderInvocationUsage({
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId: args.taskId,
        sprintRunId: args.sprintRunId,
        dispatchId: args.dispatchId,
        taskRunId: args.taskRunId,
        attentionItemId: args.attentionItemId,
        sessionId: args.sessionId,
        provider: args.provider,
        purpose: args.purpose,
        model: args.model,
        startedAt,
        promptChars: p.length,
      });

      if (invocation && execInvocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
          providerInvocationId: invocation.id,
        });
      }

      const startedMs = Date.now();

      const runnerOpts = {
        provider: args.provider,
        prompt: p,
        cwd: args.cwd || args.repoPath,
        model: args.model,
        apiKey: args.apiKey,
        providerMountAuth: args.providerMountAuth,
        providerAuthPath: args.providerAuthPath,
        sessionId: args.sessionId,
        workflowSettings: args.workflowSettings,
        repoPath: args.repoPath,
        githubToken: args.githubToken ?? this.deps.getGithubToken?.(),
        signal: args.signal,
        continueSessionId,
        mcpConnection: args.mcpConnection,
        onActivity: (desc: string, originator?: string) => {
          if (args.onActivity) {
            args.onActivity(desc, originator);
          } else if (this.deps.sessionTracking) {
            this.deps.sessionTracking.appendActivity(args.sessionId, {
              description: desc,
              originator: originator || "system",
            });
          }
        },
      };

      const result = args.expectTextOutput
        ? await this.deps.providerRunner.runProviderForText(runnerOpts)
        : await this.deps.providerRunner.runProvider(runnerOpts);

      if (invocation && this.deps.executionRepository) {
        const finishedAt = new Date().toISOString();
        this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
          status: result.ok ? "completed" : "failed",
          model: args.model,
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

        if (args.taskRunId) {
            this.deps.executionRepository.appendTaskRunEvent(args.taskRunId, "cli_provider_usage_reported", "system", {
            provider: args.provider,
            model: args.model,
            purpose: args.purpose,
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
      }

      if (execInvocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
          status: result.ok ? "completed" : "failed",
          provider: args.provider,
          model: args.model,
          finishedAt: new Date().toISOString(),
        });
        if (!result.ok) {
          this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
            role: "tool",
            contentMarkdown: result.stderr || result.stdout || "Provider failed without output.",
          });
        } else {
          this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
            role: "assistant",
            contentMarkdown: args.expectTextOutput ? (result as any).text : result.usageTelemetry.transcriptText,
          });
        }
      }

      return result;
    };

    let currentPrompt = args.prompt;
    let providerResult: ProviderRunResult;
    let usedReadFileRetry = false;
    let continueSessionId: string | null = args.continueSessionId || null;
    let rateLimitRetryCount = 0;

    while (true) {
      providerResult = await runProviderInner(
        currentPrompt,
        usedReadFileRetry ? "Retrying with file-discovery guidance." : undefined,
        continueSessionId,
      );

      if (!providerResult.ok && args.workflowSettings.retryOnReadFileNotFound && !usedReadFileRetry && isReadFileNotFoundToolError(providerResult)) {
        if (args.onActivity) {
          args.onActivity("Retrying with file-discovery guidance.", "system");
        } else if (this.deps.sessionTracking) {
          this.deps.sessionTracking.appendActivity(args.sessionId, {
            originator: "system",
            description: "Retrying with file-discovery guidance.",
          });
        }
        currentPrompt = buildReadFileRetryPrompt(args.prompt);
        usedReadFileRetry = true;
        continue;
      }

      if (providerResult.ok) {
        return providerResult;
      }

      const classification = classifyProviderError(args.provider, providerResult);
      if (execInvocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
          lastErrorCategory: classification.category,
          lastErrorMessage: classification.userMessage,
          lastRetryAfterIso: classification.resetAtIso,
        });
        this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "system",
          contentMarkdown: `Provider error (${classification.category}): ${classification.userMessage}`,
          metadata: {
            provider: args.provider,
            model: args.model,
            errorCategory: classification.category,
            retryAfterIso: classification.resetAtIso,
          },
        });
      }

      const retryDecision = resolveProviderRetryDecision(classification, args.workflowSettings);
      if (retryDecision) {
        if (retryDecision.kind === "rate_limit" && rateLimitRetryCount >= args.workflowSettings.maxRateLimitRetries) {
          // fall through to terminal classified error handling below
        } else {
          if (retryDecision.kind === "rate_limit") {
            rateLimitRetryCount += 1;
          }
          const retryMessage = retryDecision.kind === "quota_reset"
            ? `Waiting for provider quota reset. Retrying at ${retryDecision.retryAtIso}.`
            : `Provider rate-limited. Retrying at ${retryDecision.retryAtIso}.`;

          if (args.onActivity) {
            args.onActivity(retryMessage, "system");
          } else if (this.deps.sessionTracking) {
            this.deps.sessionTracking.appendActivity(args.sessionId, {
              originator: "system",
              description: retryMessage,
            });
          }

          if (execInvocationId) {
            this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
              role: "system",
              contentMarkdown: retryMessage,
              metadata: {
                provider: args.provider,
                model: args.model,
                errorCategory: classification.category,
                retryAfterIso: retryDecision.retryAtIso,
              },
            });
          }
          continueSessionId = providerResult.nativeSessionId || (args.provider === "claude-code" ? null : args.sessionId);
          await sleepWithSignal(retryDecision.delayMs, args.signal);
          continue;
        }
      }

      if (classification.category !== "UNKNOWN") {
        throw new ProviderQuotaError(classification);
      }

      // If no retry policy handles the failure, propagate it to the caller if not OK
      return providerResult;
    }
  }
}
