import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId, QwenModelProviderSettings, VirtualWorkerProvider } from "../contracts/app-types.js";
import type { ProviderInvocationPurpose } from "../contracts/execution-types.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import { StructuredProviderResponseService, type StructuredProviderResult } from "./structured-provider-response-service.js";

export interface StructuredRequestArgs<T> {
  projectId: string;
  sprintId?: string | null;
  taskId?: string | null;
  sprintRunId?: string | null;
  taskRunId?: string | null;
  purpose: ProviderInvocationPurpose;
  type: string;
  provider: ProviderId;
  model: string;
  apiKey: string;
  maxConcurrentTasks?: number;
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
  providerPrompt: string;
  repoPath: string;
  cwd?: string;
  workspaceSessionId?: string;
  settings: DashboardSettings;
  parseFn: (text: string) => T;
  buildRetryPrompt: (error: Error) => string;
  providerLabel: string;
  sessionIdPrefix: string;
  invocationId?: string;
  systemRoutingMessage?: string;
  maxRetries?: number;
  githubToken?: string;
  signal?: AbortSignal;
  onActivity?: (description: string, originator?: string) => void;
}

export interface StructuredAgentRequestResult<T> extends StructuredProviderResult<T> {
  sessionId: string;
  invocationId: string;
}

export interface StructuredAgentRequestServiceDeps {
  executionRepository?: ExecutionRepository;
  structuredProviderResponseService: StructuredProviderResponseService;
  logger?: Logger;
}

export class StructuredAgentRequestService {
  constructor(private readonly deps: StructuredAgentRequestServiceDeps) {}

  async executeRequest<T>(args: StructuredRequestArgs<T>): Promise<StructuredAgentRequestResult<T>> {
    const sessionId = `${args.sessionIdPrefix}-${args.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

    let invocationId = args.invocationId;
    if (!invocationId) {
      const invocation = this.deps.executionRepository?.createExecutionInvocation({
        projectId: args.projectId,
        skipValidation: true,
        sprintId: args.sprintId || null,
        taskId: args.taskId || null,
        sprintRunId: args.sprintRunId || null,
        taskRunId: args.taskRunId || null,
        type: args.type,
        provider: args.provider,
        model: args.model,
        startedAt: new Date().toISOString(),
      });
      invocationId = invocation?.id;
    } else {
      this.deps.executionRepository?.updateExecutionInvocation(invocationId, {
        provider: args.provider,
        model: args.model,
      });
    }

    if (invocationId && args.systemRoutingMessage) {
      const existingMessages = this.deps.executionRepository?.listExecutionInvocationMessages(invocationId) || [];
      const hasRouteMessage = existingMessages.some(
        msg => msg.role === "system" &&
               msg.contentMarkdown === args.systemRoutingMessage &&
               msg.metadata?.routeKind === "virtual"
      );

      if (!hasRouteMessage) {
        this.deps.executionRepository?.appendExecutionInvocationMessage(invocationId, {
          role: "system",
          contentMarkdown: args.systemRoutingMessage,
          metadata: {
            provider: args.provider,
            model: args.model,
            routeKind: "virtual",
          },
        });
      }
    }

    const result = await this.deps.structuredProviderResponseService.executeAndParse<T>({
      projectId: args.projectId,
      sprintId: args.sprintId || null,
      taskId: args.taskId || null,
      sprintRunId: args.sprintRunId || null,
      taskRunId: args.taskRunId || null,
      purpose: args.purpose,
      type: args.type,
      provider: args.provider as VirtualWorkerProvider,
      maxConcurrentTasks: args.maxConcurrentTasks,
      prompt: args.providerPrompt,
      cwd: args.cwd,
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
      customModel: args.customModel,
      sessionId,
      workspaceSessionId: args.workspaceSessionId,
      workflowSettings: args.settings.cliWorkflow,
      repoPath: args.repoPath,
      githubToken: args.githubToken,
      signal: args.signal,
      invocationId,
      onActivity: args.onActivity,
      settings: args.settings,
      maxRetries: args.maxRetries ?? args.settings.cliWorkflow?.maxParsingRetries ?? 3,
      providerLabel: args.providerLabel,
      parseFn: args.parseFn,
      buildRetryPrompt: args.buildRetryPrompt,
    });

    return {
      ...result,
      sessionId,
      invocationId: invocationId || "",
    };
  }
}
