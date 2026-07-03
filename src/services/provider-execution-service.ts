import type { CustomMcpServer, DashboardSettings } from "../contracts/app-types.js";
import type { QwenModelProviderSettings } from "../contracts/app-types.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import { resolveAgentMcpRuntime } from "./agent-mcp-access.js";
import type { ProviderInvocationPurpose } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { IProviderRunner, ProviderRunResult } from "../infrastructure/providers/cli/provider-runner.js";
import type { CliProviderId } from "../infrastructure/providers/cli/provider-command-specs.js";
import type { ParsedConversationTurn, ProviderUsageTelemetry } from "../infrastructure/providers/cli/provider-usage.js";
import type { AppendExecutionInvocationMessageInput } from "../contracts/invocation-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import { classifyProviderError, ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";
import { resolveProviderRetryDecision, sleepWithSignal } from "../shared/providers/provider-retry-policy.js";
import { DEFAULT_PROVIDER_SETTINGS } from "../repositories/settings-defaults.js";
import type { ProviderId } from "../contracts/app-types.js";
import type { CreateProviderInvocationUsageInput } from "../contracts/execution-types.js";
import { sanitizeInvocationOutputText } from "./invocation-output-sanitizer.js";
import { conversationTurnToMessage } from "./provider-conversation-message-mapper.js";
import { ActivityWriteCoalescer } from "./activity-write-coalescer.js";

/** Counts tool-call turns in a parsed provider conversation, for tool-call stats. */
function countConversationToolCalls(conversation: ParsedConversationTurn[] | undefined | null): number {
  if (!conversation) {
    return 0;
  }
  return conversation.reduce((count, turn) => (turn.kind === "tool_call" ? count + 1 : count), 0);
}

function buildPersistedInvocationMessages(
  provider: CliProviderId,
  model: string,
  prompt: string,
  conversation: ParsedConversationTurn[] | undefined | null,
  transcriptText: string,
  trackPromptInInvocation: boolean | undefined,
): AppendExecutionInvocationMessageInput[] {
  if (conversation && conversation.length > 0) {
    return conversation.map((turn) => conversationTurnToMessage(turn, provider, model));
  }

  const messages: AppendExecutionInvocationMessageInput[] = [];
  if (trackPromptInInvocation !== false) {
    messages.push({
      role: "user",
      contentMarkdown: prompt,
    });
  }
  if (transcriptText) {
    messages.push({
      role: "assistant",
      contentMarkdown: sanitizeInvocationOutputText(transcriptText),
    });
  }
  return messages;
}

function persistInvocationMessages(
  executionRepository: ExecutionRepository,
  execInvocationId: string,
  messages: AppendExecutionInvocationMessageInput[],
): void {
  executionRepository.clearExecutionInvocationMessages?.(execInvocationId);
  for (const message of messages) {
    executionRepository.appendExecutionInvocationMessage?.(execInvocationId, message);
  }
}

function isRestartInterruptedDockerInvocation(error: unknown, args: ExecutionProviderRunArgs): boolean {
  if (args.workflowSettings.executionMode !== "DOCKER") {
    return false;
  }

  const message = error instanceof Error ? error.message : String(error || "");
  return (
    /Command spawner host exited/i.test(message)
    && /(signal=SIGINT|signal=SIGTERM|signal=SIGHUP)/i.test(message)
  );
}

export interface ProviderExecutionServiceDeps {
  executionRepository?: ExecutionRepository;
  sessionTracking?: SessionTrackingRepository;
  providerRunner: IProviderRunner;
  providerConcurrencyService?: ProviderConcurrencyService;
  logger?: Logger;
  getGithubToken?: () => string | undefined;
}

export interface ExecutionProviderRunArgs {
  projectId: string;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  taskRunId?: string | null;
  attentionItemId?: string | null;
  invocationSource?: "internal" | "EXTERNAL_API";

  purpose: ProviderInvocationPurpose;
  type: string;

  provider: CliProviderId;
  maxConcurrentTasks?: number;
  prompt: string;
  cwd?: string;
  model: string;
  apiKey: string;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
  providerMountAuth?: boolean;
  providerAuthPath?: string;
  customBaseUrl?: string;
  customModel?: string;
  sessionId: string;
  workspaceSessionId?: string;
  workflowSettings: DashboardSettings["cliWorkflow"];
  repoPath: string;
  githubToken?: string;
  gitlabToken?: string;

  onActivity?: (description: string, originator?: string) => void;
  signal?: AbortSignal;
  continueSessionId?: string | null;
  /** The previous invocation's raw opencode export snapshot for this session,
   *  when `continueSessionId` resumes it. Ignored for other providers. See
   *  {@link https://opencode.ai} `export` semantics: totals are cumulative for
   *  the whole session, so this baseline is subtracted from each follow-up's
   *  freshly exported usage. */
  openCodeBaselineRawUsageJson?: Record<string, unknown> | null;

  // Option to return ProviderResult with string `text` rather than standard ProviderResult
  expectTextOutput?: boolean;

  invocationId?: string; // Use existing execution invocation if passed
  trackPromptInInvocation?: boolean;
  trackAssistantInInvocation?: boolean;
  finalizeExecutionInvocation?: boolean;

  /** MCP server connection info for injecting management tools into the CLI provider. */
  mcpConnection?: McpConnectionInfo | null;
  /** User-defined custom MCP servers injected into the CLI provider alongside code_ux. */
  customMcpServers?: CustomMcpServer[];
  /**
   * Per-agent MCP access config. When provided (agent-scoped run), custom servers are
   * narrowed to the agent's linked ids and code_ux is gated by codeUxEnabled. When
   * undefined the run is not agent-scoped and MCP inputs pass through unchanged.
   */
  agentMcpAccess?: AgentMcpAccessConfig | null;
  /** Agent preset id for the run; used to scope code_ux tool enforcement at the gateway. */
  mcpAgentId?: string | null;
}

/** Resolves the effective model name to use for telemetry and recording. */
export function resolveEffectiveModel(args: Pick<ExecutionProviderRunArgs, "provider" | "model" | "providerMountAuth" | "customModel" | "qwenAuthMode" | "qwenModelId" | "openCodeAuthMode" | "openCodeProviderId" | "openCodeModelId">): string {
  const { provider, model, providerMountAuth, customModel } = args;
  if (!providerMountAuth && (provider === "claude-code" || provider === "codex") && customModel && customModel.trim().length > 0) {
    return customModel.trim();
  }
  if (provider === "qwen-code" && args.qwenAuthMode === "MODEL_PROVIDER") {
    if (model === "custom/model" || model === "local-model") {
      return (args.qwenModelId || "glm-4.7-flash").trim();
    }
    return (args.qwenModelId || model || "glm-4.7-flash").trim();
  }
  if (provider === "opencode" && args.openCodeAuthMode === "CUSTOM_PROVIDER") {
    const providerId = (args.openCodeProviderId || model.split("/")[0] || "custom").trim();
    const modelId = (args.openCodeModelId || model.split("/").slice(1).join("/") || "model").trim();
    return `${providerId}/${modelId}`;
  }
  return model;
}

export class ProviderExecutionService {
  constructor(private readonly deps: ProviderExecutionServiceDeps) {}

  async executeProvider(args: ExecutionProviderRunArgs): Promise<ProviderRunResult> {
    let execInvocationId: string | null = args.invocationId || null;
    const effectiveModel = resolveEffectiveModel(args);

    const resolvedMcp = resolveAgentMcpRuntime({
      access: args.agentMcpAccess,
      agentId: args.mcpAgentId,
      customMcpServers: args.customMcpServers ?? [],
      mcpConnection: args.mcpConnection ?? null,
    });

    const runProviderInner = async (p: string, retrySystemMessage?: string, continueSessionId?: string | null, openCodeBaselineRawUsageJson?: Record<string, unknown> | null): Promise<ProviderRunResult> => {
      const startedAt = new Date().toISOString();

      // Coalesce the per-line streaming activity firehose into batched transactions so concurrent
      // sprints don't saturate the single thread with one INSERT per output line. Only used when
      // the caller didn't supply its own onActivity (i.e. when we'd otherwise write per line).
      const activityCoalescer = (!args.onActivity && this.deps.sessionTracking)
        ? new ActivityWriteCoalescer(this.deps.sessionTracking, args.sessionId, {
            logger: this.deps.logger,
          })
        : null;

      // The telemetry watcher fires every ~1.5s while a run is live, and the handler below mirrors
      // the full parsed conversation into the invocation by clearing and re-inserting every message.
      // That is O(turns) synchronous writes per tick — and the conversation only grows — so without
      // a guard a single long run rewrites the same rows dozens of times, and concurrent sprints
      // multiply it. Track a cheap signature of what we last persisted and skip the rewrite when the
      // conversation hasn't changed since the previous tick.
      let lastPersistedMessagesSignature: string | null = null;

      if (!execInvocationId) {
        execInvocationId = this.deps.executionRepository?.createExecutionInvocation({
          projectId: args.projectId,
          sprintId: args.sprintId,
          taskId: args.taskId,
          skipValidation: true,
          sprintRunId: args.sprintRunId,
          dispatchId: args.dispatchId,
          taskRunId: args.taskRunId,
          attentionItemId: args.attentionItemId,
          type: args.type,
          provider: args.provider,
          model: effectiveModel,
          startedAt,
          invocationSource: args.invocationSource,
        })?.id || null;
      }

      if (execInvocationId && retrySystemMessage) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "system",
          contentMarkdown: retrySystemMessage,
        });
      }

      if (execInvocationId && args.trackPromptInInvocation !== false) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "user",
          contentMarkdown: p,
        });
      }

      let invocation;
      const limit = args.maxConcurrentTasks !== undefined
        ? args.maxConcurrentTasks
        : (DEFAULT_PROVIDER_SETTINGS[args.provider as ProviderId]?.maxConcurrentTasks ?? 0);

      const usageInput: CreateProviderInvocationUsageInput = {
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
        model: effectiveModel,
        executionMode: args.workflowSettings.executionMode,
        startedAt,
        promptChars: p.length,
      };

      if (this.deps.providerConcurrencyService) {
        invocation = await this.deps.providerConcurrencyService.waitForSlotAndClaim(
          args.provider as ProviderId,
          limit,
          usageInput,
          args.signal
        );
      } else {
        // Fallback for cases where ProviderConcurrencyService is not provided, 
        // e.g. in some specialized service tests, though in production it should be present
        // when an execution repository is present.
        invocation = this.deps.executionRepository?.createProviderInvocationUsage(usageInput);
      }

      if (invocation && execInvocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
          providerInvocationId: invocation.id,
        });
      }

      const startedMs = Date.now();
      this.deps.logger?.info("Provider invocation started", {
        logPurpose: "invocation",
        invocationId: execInvocationId,
        providerInvocationId: invocation?.id,
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId: args.taskId,
        provider: args.provider,
        model: effectiveModel,
        purpose: args.purpose,
        executionMode: args.workflowSettings.executionMode,
      });

      const runnerOpts = {
        provider: args.provider,
        prompt: p,
        cwd: args.cwd || args.repoPath,
        model: effectiveModel,
        apiKey: args.apiKey,
        qwenAuthMode: args.qwenAuthMode,
        qwenRegion: args.qwenRegion,
        qwenBaseUrl: args.qwenBaseUrl,
        qwenEnvKey: args.qwenEnvKey,
        qwenModelId: args.qwenModelId,
        qwenProtocol: args.qwenProtocol,
        qwenAdditionalModelProviders: args.qwenAdditionalModelProviders,
        openCodeAuthMode: args.openCodeAuthMode,
        openCodeProviderId: args.openCodeProviderId,
        openCodeModelId: args.openCodeModelId,
        openCodeBaseUrl: args.openCodeBaseUrl,
        openCodeEnvKey: args.openCodeEnvKey,
        openCodePackage: args.openCodePackage,
        providerMountAuth: args.providerMountAuth,
        providerAuthPath: args.providerAuthPath,
        customBaseUrl: args.customBaseUrl,
        customModel: args.customModel,
        sessionId: args.sessionId,
        workspaceSessionId: args.workspaceSessionId,
        workflowSettings: args.workflowSettings,
        repoPath: args.repoPath,
        githubToken: args.githubToken ?? this.deps.getGithubToken?.(),
        gitlabToken: args.gitlabToken,
        signal: args.signal,
        continueSessionId,
        openCodeBaselineUsage: openCodeBaselineRawUsageJson,
        mcpConnection: resolvedMcp.mcpConnection,
        customMcpServers: resolvedMcp.customMcpServers,
        onActivity: (desc: string, originator?: string) => {
          if (args.onActivity) {
            args.onActivity(desc, originator);
          } else if (activityCoalescer) {
            activityCoalescer.push(desc, originator || "system");
          }
        },
        onTelemetry: (telemetry: ProviderUsageTelemetry) => {
          if (invocation && this.deps.executionRepository && this.isProviderInvocationStillRunning(invocation.id)) {
            const durationMs = Date.now() - startedMs;
            this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
              status: "running",
              model: effectiveModel,
              nativeSessionId: telemetry.nativeSessionId || undefined,
              durationMs,
              transcriptChars: telemetry.transcriptText.length,
              inputTokens: telemetry.inputTokens,
              cachedInputTokens: telemetry.cachedInputTokens,
              outputTokens: telemetry.outputTokens,
              reasoningOutputTokens: telemetry.reasoningOutputTokens,
              totalTokens: telemetry.totalTokens,
              toolCallCount: countConversationToolCalls(telemetry.conversation),
              usageSource: telemetry.usageSource,
              rawUsageJson: telemetry.rawUsageJson || undefined,
            });
          }

          if (
            execInvocationId
            && this.deps.executionRepository
            && this.isExecutionInvocationStillRunning(execInvocationId)
          ) {
            if (args.trackAssistantInInvocation !== false) {
              // Record the full parsed agent session for every invocation type —
              // including text-output (QA / planning / setup) runs, which are
              // just as agentic but were previously collapsed to prompt + final
              // answer. The structured callers parse their result from the
              // returned text, not from these messages, so this is display-only.
              const messages = buildPersistedInvocationMessages(
                args.provider,
                effectiveModel,
                p,
                telemetry.conversation,
                telemetry.transcriptText,
                args.trackPromptInInvocation,
              );
              const signature = JSON.stringify(messages);

              if (signature !== lastPersistedMessagesSignature) {
                persistInvocationMessages(this.deps.executionRepository, execInvocationId, messages);
                lastPersistedMessagesSignature = signature;
              }
            }
          }
        },
      };

      const result = await (async (): Promise<ProviderRunResult> => {
        try {
          return args.expectTextOutput
            ? await this.deps.providerRunner.runProviderForText(runnerOpts)
            : await this.deps.providerRunner.runProvider(runnerOpts);
        } catch (error) {
          const wasCancelled = Boolean(args.signal?.aborted);
          const preserveForStartupRecovery = isRestartInterruptedDockerInvocation(error, args);
          if (invocation && this.deps.executionRepository && !preserveForStartupRecovery) {
            const finishedAt = new Date().toISOString();
            const durationMs = Date.now() - startedMs;
            this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
              status: wasCancelled ? "cancelled" : "failed",
              finishedAt,
              durationMs,
            });
          }
          const logFields = {
            logPurpose: "invocation" as const,
            invocationId: execInvocationId,
            providerInvocationId: invocation?.id,
            projectId: args.projectId,
            sprintId: args.sprintId,
            taskId: args.taskId,
            provider: args.provider,
            model: effectiveModel,
            purpose: args.purpose,
            durationMs: Date.now() - startedMs,
            error,
          };
          if (wasCancelled) {
            this.deps.logger?.info("Provider invocation cancelled", logFields);
          } else {
            this.deps.logger?.error("Provider invocation crashed", logFields);
          }
          // Persist buffered streaming activity before the failure unwinds.
          activityCoalescer?.stop();
          throw error;
        }
      })();
      // Persist any buffered streaming activity from the completed run before recording usage.
      activityCoalescer?.stop();

      if (invocation && this.deps.executionRepository) {
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startedMs;
        if (this.isProviderInvocationStillRunning(invocation.id)) {
          this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
            status: args.signal?.aborted ? "cancelled" : (result.ok ? "completed" : "failed"),
            model: effectiveModel,
            nativeSessionId: result.nativeSessionId,
            finishedAt,
            durationMs,
            transcriptChars: result.usageTelemetry.transcriptText.length,
            inputTokens: result.usageTelemetry.inputTokens,
            cachedInputTokens: result.usageTelemetry.cachedInputTokens,
            outputTokens: result.usageTelemetry.outputTokens,
            reasoningOutputTokens: result.usageTelemetry.reasoningOutputTokens,
            totalTokens: result.usageTelemetry.totalTokens,
            toolCallCount: countConversationToolCalls(result.usageTelemetry.conversation),
            usageSource: result.usageTelemetry.usageSource,
            rawUsageJson: result.usageTelemetry.rawUsageJson,
          });
        }

        if (args.taskRunId) {
            this.deps.executionRepository.appendTaskRunEvent(args.taskRunId, "cli_provider_usage_reported", "system", {
            provider: args.provider,
            model: effectiveModel,
            purpose: args.purpose,
            inputTokens: result.usageTelemetry.inputTokens,
            cachedInputTokens: result.usageTelemetry.cachedInputTokens,
            outputTokens: result.usageTelemetry.outputTokens,
            reasoningOutputTokens: result.usageTelemetry.reasoningOutputTokens,
            totalTokens: result.usageTelemetry.totalTokens,
            usageSource: result.usageTelemetry.usageSource,
            durationMs,
          }, {
            sourceEventKey: `cli:provider:usage:${invocation.id}`,
          });
        }
      }

      this.deps.logger?.info("Provider invocation finished", {
        logPurpose: "invocation",
        invocationId: execInvocationId,
        providerInvocationId: invocation?.id,
        projectId: args.projectId,
        sprintId: args.sprintId,
        taskId: args.taskId,
        provider: args.provider,
        model: effectiveModel,
        purpose: args.purpose,
        ok: result.ok,
        durationMs: Date.now() - startedMs,
        totalTokens: result.usageTelemetry.totalTokens,
        usageSource: result.usageTelemetry.usageSource,
      });

      return result;
    };

    let currentPrompt = args.prompt;
    let providerResult: ProviderRunResult;
    let usedReadFileRetry = false;
    let continueSessionId: string | null = args.continueSessionId || null;
    let rateLimitRetryCount = 0;
    let openCodeBaselineRawUsageJson: Record<string, unknown> | null = args.openCodeBaselineRawUsageJson || null;

    while (true) {
      providerResult = await runProviderInner(
        currentPrompt,
        usedReadFileRetry ? "Retrying with file-discovery guidance." : undefined,
        continueSessionId,
        openCodeBaselineRawUsageJson,
      );
      // Each attempt's raw export snapshot becomes the baseline for the next
      // retry, since a retry that resumes the same opencode session would
      // otherwise re-report this attempt's tokens too (export is cumulative).
      if (args.provider === "opencode" && providerResult.usageTelemetry?.rawUsageJson) {
        openCodeBaselineRawUsageJson = providerResult.usageTelemetry.rawUsageJson;
      }

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
        if (execInvocationId && this.isExecutionInvocationStillRunning(execInvocationId)) {
          if (args.finalizeExecutionInvocation !== false) {
            this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
              status: "completed",
              provider: args.provider,
              model: effectiveModel,
              finishedAt: new Date().toISOString(),
            });
          }
          if (args.trackAssistantInInvocation !== false) {
            const conversation = providerResult.usageTelemetry.conversation;
            if (conversation && conversation.length > 0) {
              const messages = buildPersistedInvocationMessages(
                args.provider,
                effectiveModel,
                currentPrompt,
                conversation,
                providerResult.usageTelemetry.transcriptText,
                args.trackPromptInInvocation,
              );
              if (this.deps.executionRepository) {
                persistInvocationMessages(this.deps.executionRepository, execInvocationId, messages);
              }
            } else {
              const fallbackText = args.expectTextOutput
                ? ((providerResult as { text?: string }).text ?? providerResult.usageTelemetry.transcriptText)
                : providerResult.usageTelemetry.transcriptText;
              if (fallbackText) {
                this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
                  role: "assistant",
                  contentMarkdown: sanitizeInvocationOutputText(fallbackText),
                });
              }
            }
          }
        }
        return providerResult;
      }

      const classification = classifyProviderError(args.provider, providerResult);
      const retryDecision = resolveProviderRetryDecision(classification, args.workflowSettings);
      const retryAfterIso = retryDecision
        && !(retryDecision.kind === "rate_limit" && rateLimitRetryCount >= args.workflowSettings.maxRateLimitRetries)
        ? retryDecision.retryAtIso
        : null;
      if (execInvocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
          lastErrorCategory: classification.category,
          lastErrorMessage: classification.userMessage,
          lastRetryAfterIso: retryAfterIso,
        });
        this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "system",
          contentMarkdown: `Provider error (${classification.category}): ${classification.userMessage}`,
          metadata: {
            provider: args.provider,
            model: args.model,
            errorCategory: classification.category,
            retryAfterIso,
          },
        });
      }

      if (retryDecision) {
        if (retryDecision.kind === "rate_limit" && rateLimitRetryCount >= args.workflowSettings.maxRateLimitRetries) {
          // fall through to terminal classified error handling below
        } else {
          if (retryDecision.kind === "rate_limit") {
            rateLimitRetryCount += 1;
          }
          const retryMessage = retryDecision.kind === "quota_reset"
            ? `Waiting for provider quota reset. Retrying at ${retryAfterIso}.`
            : `Provider rate-limited. Retrying at ${retryAfterIso}.`;

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
                retryAfterIso,
              },
            });
          }
          // Surface the in-process wait as a task-run event so the live dashboard can show
          // QUOTA + a countdown while we sleep here (the dispatch deliberately stays
          // "running" during the wait, so this is the only signal the UI can key off).
          if (args.taskRunId) {
            this.deps.executionRepository?.appendTaskRunEvent(args.taskRunId, "cli_provider_quota_wait", "system", {
              provider: args.provider,
              model: args.model,
              purpose: args.purpose,
              kind: retryDecision.kind,
              errorCategory: classification.category,
              retryAfterIso,
            }, {
              sourceEventKey: `cli:provider:quota-wait:${execInvocationId ?? args.sessionId}:${retryAfterIso}`,
            });
          }
          continueSessionId = providerResult.nativeSessionId || (args.provider === "claude-code" ? null : args.sessionId);
          await sleepWithSignal(retryDecision.delayMs, args.signal);
          continue;
        }
      }

      if (classification.category !== "UNKNOWN") {
        throw new ProviderQuotaError({
          ...classification,
          resetAtIso: retryAfterIso,
        });
      }

      // If no retry policy handles the failure, propagate it to the caller if not OK
      if (execInvocationId) {
        if (this.isExecutionInvocationStillRunning(execInvocationId)) {
          this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
            status: args.signal?.aborted ? "cancelled" : "failed",
            provider: args.provider,
            model: args.model,
            finishedAt: new Date().toISOString(),
          });
          // Include both streams so the real failure detail is never hidden: some
          // providers (notably codex) print only a benign "Reading additional input
          // from stdin..." to stderr while the actionable error events go to stdout.
          const rawOutput = [providerResult.stderr, providerResult.stdout]
            .map((stream) => (stream ?? "").trim())
            .filter((stream) => stream.length > 0)
            .join("\n\n");
          this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
            role: "tool",
            contentMarkdown: sanitizeInvocationOutputText(rawOutput || "Provider failed without output."),
          });
        }
      }
      return providerResult;
    }
  }

  private isProviderInvocationStillRunning(providerInvocationId: string): boolean {
    const current = this.deps.executionRepository?.getProviderInvocationUsage?.(providerInvocationId);
    return !current || current.status === "running";
  }

  private isExecutionInvocationStillRunning(executionInvocationId: string): boolean {
    const current = this.deps.executionRepository?.getExecutionInvocation?.(executionInvocationId);
    return !current || current.status === "running" || current.status === "paused";
  }
}
