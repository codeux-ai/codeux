import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId, VirtualWorkerProvider } from "../contracts/app-types.js";
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
  providerPrompt: string;
  repoPath: string;
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
  captureMemory?: (sessionId: string, invocationId: string) => Promise<void>;
}

export interface StructuredAgentRequestResult<T> extends StructuredProviderResult<T> {
  sessionId: string;
  invocationId: string;
}

export interface StructuredAgentWorkflowServiceDeps {
  executionRepository?: ExecutionRepository;
  structuredProviderResponseService: StructuredProviderResponseService;
  logger?: Logger;
}

export class StructuredAgentWorkflowService {
  constructor(private readonly deps: StructuredAgentWorkflowServiceDeps) {}

  async executeRequest<T>(args: StructuredRequestArgs<T>): Promise<StructuredAgentRequestResult<T>> {
    const sessionId = `${args.sessionIdPrefix}-${args.provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;

    let invocationId = args.invocationId;
    if (!invocationId) {
      const invocation = this.deps.executionRepository?.createExecutionInvocation({
        projectId: args.projectId,
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

      if (invocationId && args.systemRoutingMessage) {
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
    } else {
      this.deps.executionRepository?.updateExecutionInvocation(invocationId, {
        provider: args.provider,
        model: args.model,
      });

      if (args.systemRoutingMessage) {
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

    try {
      const result = await this.deps.structuredProviderResponseService.executeAndParse<T>({
        projectId: args.projectId,
        sprintId: args.sprintId || null,
        taskId: args.taskId || null,
        sprintRunId: args.sprintRunId || null,
        taskRunId: args.taskRunId || null,
        purpose: args.purpose,
        type: args.type,
        provider: args.provider as VirtualWorkerProvider,
        prompt: args.providerPrompt,
        model: args.model,
        apiKey: args.apiKey,
        sessionId,
        workflowSettings: args.settings.cliWorkflow,
        repoPath: args.repoPath,
        githubToken: args.githubToken,
        signal: args.signal,
        invocationId,
        onActivity: args.onActivity,
        settings: args.settings,
        maxRetries: args.maxRetries ?? args.settings.cliWorkflow?.maxPlanningJsonRetries ?? 3,
        providerLabel: args.providerLabel,
        parseFn: args.parseFn,
        buildRetryPrompt: args.buildRetryPrompt,
      });

      if (invocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(invocationId, {
          status: "completed",
          finishedAt: new Date().toISOString(),
        });
      }

      if (args.captureMemory) {
        await args.captureMemory(sessionId, invocationId || "");
      }

      return {
        ...result,
        sessionId,
        invocationId: invocationId || "",
      };
    } catch (error) {
      if (invocationId) {
        this.deps.executionRepository?.updateExecutionInvocation(invocationId, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          finishedAt: new Date().toISOString(),
        });
      }
      throw error;
    }
  }
}
