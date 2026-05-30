import type { CustomMcpServer, DashboardSettings } from "../contracts/app-types.js";
import type { QwenModelProviderSettings } from "../contracts/app-types.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import { resolveAgentMcpRuntime } from "./agent-mcp-access.js";
import type { ProviderInvocationPurpose } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { CliProviderId, IProviderRunner, ProviderRunResult } from "../infrastructure/providers/cli/provider-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import { classifyProviderError, ProviderQuotaError } from "../shared/providers/provider-error-classifier.js";
import { resolveProviderRetryDecision, sleepWithSignal } from "../shared/providers/provider-retry-policy.js";
import { DEFAULT_PROVIDER_SETTINGS } from "../repositories/settings-defaults.js";
import type { ProviderId } from "../contracts/app-types.js";

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
  sessionId: string;
  workspaceSessionId?: string;
  workflowSettings: DashboardSettings["cliWorkflow"];
  repoPath: string;
  githubToken?: string;

  onActivity?: (description: string, originator?: string) => void;
  signal?: AbortSignal;
  continueSessionId?: string | null;

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

export class ProviderExecutionService {
  constructor(private readonly deps: ProviderExecutionServiceDeps) {}

  async executeProvider(args: ExecutionProviderRunArgs): Promise<ProviderRunResult> {
    let execInvocationId: string | null = args.invocationId || null;

    const resolvedMcp = resolveAgentMcpRuntime({
      access: args.agentMcpAccess,
      agentId: args.mcpAgentId,
      customMcpServers: args.customMcpServers ?? [],
      mcpConnection: args.mcpConnection ?? null,
    });

    const runProviderInner = async (p: string, retrySystemMessage?: string, continueSessionId?: string | null): Promise<ProviderRunResult> => {
      const startedAt = new Date().toISOString();

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
          model: args.model,
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
      if (this.deps.providerConcurrencyService) {
        const limit = args.maxConcurrentTasks !== undefined
          ? args.maxConcurrentTasks
          : (DEFAULT_PROVIDER_SETTINGS[args.provider as ProviderId]?.maxConcurrentTasks ?? 0);

        invocation = await this.deps.providerConcurrencyService.waitForSlotAndClaim(
          args.provider as ProviderId,
          limit,
          {
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
            executionMode: args.workflowSettings.executionMode,
            startedAt,
            promptChars: p.length,
          },
          args.signal
        );
      } else {
        invocation = this.deps.executionRepository?.createProviderInvocationUsage({
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
          executionMode: args.workflowSettings.executionMode,
          startedAt,
          promptChars: p.length,
        });
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
        model: args.model,
        purpose: args.purpose,
        executionMode: args.workflowSettings.executionMode,
      });

      const runnerOpts = {
        provider: args.provider,
        prompt: p,
        cwd: args.cwd || args.repoPath,
        model: args.model,
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
        sessionId: args.sessionId,
        workspaceSessionId: args.workspaceSessionId,
        workflowSettings: args.workflowSettings,
        repoPath: args.repoPath,
        githubToken: args.githubToken ?? this.deps.getGithubToken?.(),
        signal: args.signal,
        continueSessionId,
        mcpConnection: resolvedMcp.mcpConnection,
        customMcpServers: resolvedMcp.customMcpServers,
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

      const result = await (async (): Promise<ProviderRunResult> => {
        try {
          return args.expectTextOutput
            ? await this.deps.providerRunner.runProviderForText(runnerOpts)
            : await this.deps.providerRunner.runProvider(runnerOpts);
        } catch (error) {
          this.deps.logger?.error("Provider invocation crashed", {
            logPurpose: "invocation",
            invocationId: execInvocationId,
            providerInvocationId: invocation?.id,
            projectId: args.projectId,
            sprintId: args.sprintId,
            taskId: args.taskId,
            provider: args.provider,
            model: args.model,
            purpose: args.purpose,
            durationMs: Date.now() - startedMs,
            error,
          });
          throw error;
        }
      })();

      if (invocation && this.deps.executionRepository) {
        const finishedAt = new Date().toISOString();
        const durationMs = Date.now() - startedMs;
        this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
          status: result.ok ? "completed" : "failed",
          model: args.model,
          nativeSessionId: result.nativeSessionId,
          finishedAt,
          durationMs,
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
        model: args.model,
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
        if (execInvocationId) {
          if (args.finalizeExecutionInvocation !== false) {
            this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
              status: "completed",
              provider: args.provider,
              model: args.model,
              finishedAt: new Date().toISOString(),
            });
          }
          if (args.trackAssistantInInvocation !== false) {
            this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
              role: "assistant",
              contentMarkdown: args.expectTextOutput ? (providerResult as any).text : providerResult.usageTelemetry.transcriptText,
            });
          }
        }
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
      if (execInvocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(execInvocationId, {
          status: "failed",
          provider: args.provider,
          model: args.model,
          finishedAt: new Date().toISOString(),
        });
        this.deps.executionRepository?.appendExecutionInvocationMessage(execInvocationId, {
          role: "tool",
          contentMarkdown: providerResult.stderr || providerResult.stdout || "Provider failed without output.",
        });
      }
      return providerResult;
    }
  }
}
