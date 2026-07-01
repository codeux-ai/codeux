import type { DashboardSettings, DashboardSettingsScope, ProviderId, QwenModelProviderSettings, Subtask } from "../contracts/app-types.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import type { ProjectWorkerAssignmentRepository } from "../repositories/project-worker-assignment-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { IProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ConversationCompactionSummary, CreateDashboardConversationMessageInput, ConversationThreadRecord, ConversationMessageRecord, ConversationRuntimeState, UpdateConversationThreadRouteInput } from "../contracts/connection-chat-types.js";
import { buildProviderPrompt } from "./cli-workflow-utils.js";
import { resolveEffectiveModel } from "./provider-execution-service.js";
import {
  buildChatCompactionPrompt,
  buildChatContinuationPrompt,
  buildChatReplayPrompt,
  normalizeProviderReply,
} from "./chat-reply-prompt.js";
import type { ChatManagementActionService } from "./chat-management-action-service.js";
import type { KnowledgeService } from "./knowledge-service.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { McpApprovalTracker } from "./mcp-approval-tracker.js";
import { getCorrelationId } from "../shared/logging/correlation-id.js";

interface ChatThreadRuntimeServiceDependencies {
  connectionChatRepository: ConnectionChatRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  executionRepository: ExecutionRepository;
  taskService: TaskService;
  getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings;
  getGithubToken: () => string | undefined;
  agentPresetSyncService: AgentPresetSyncService;
  projectManagementRepository: ProjectManagementRepository;
  providerRunner: IProviderRunner;
  chatManagementActionService: ChatManagementActionService;
  knowledgeService: KnowledgeService;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  getMcpApprovalTracker?: () => McpApprovalTracker;
  logger?: Logger;
}

export interface ThreadRouteResolution {
  mode: "VIRTUAL";
  providerId?: Exclude<ProviderId, "jules">;
  model?: string;
  apiKey?: string;
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
  thinkingMode?: string;
}

interface InFlightChatTurn {
  abortController: AbortController;
  latestMessage: ConversationMessageRecord;
}

export class ChatThreadRuntimeService {
  private readonly inFlightTurns = new Map<string, InFlightChatTurn>();

  constructor(private readonly deps: ChatThreadRuntimeServiceDependencies) {}

  public async resolveThreadRoute(
    thread: Pick<ConversationThreadRecord, "connectionId" | "projectId" | "runtimeState">,
    liveAssignments: ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>,
    settings: DashboardSettings,
    latestMessageBody: string,
  ): Promise<ThreadRouteResolution> {
    const runtimeState = thread.runtimeState || null;
    void liveAssignments;

    const pseudoTask: Subtask = {
      id: "dashboard-reply",
      title: "Dashboard reply",
      prompt: latestMessageBody,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };

    const dashboardReplyAgent = typeof this.deps.agentPresetSyncService.resolveDashboardReplyAgent === "function"
      ? await this.deps.agentPresetSyncService.resolveDashboardReplyAgent(
        thread.projectId,
        settings.agents?.routing?.dashboardReply?.agentPresetId ?? null,
      ).catch((err) => {
        this.deps.logger?.warn("Failed to resolve dashboard reply agent template", { projectId: thread.projectId, error: err instanceof Error ? err.message : String(err) });
        return null;
      })
      : await this.deps.agentPresetSyncService.getWorkerAgent(thread.projectId).catch((err) => {
        this.deps.logger?.warn("Failed to resolve fallback worker agent template", { projectId: thread.projectId, error: err instanceof Error ? err.message : String(err) });
        return null;
      });
    const route = this.deps.taskService.resolveInvocationProvider("dashboard_reply", pseudoTask, {
      scope: { projectId: thread.projectId },
      cliOnly: true,
      agentProvider: dashboardReplyAgent
        ? {
          providerConfigId: dashboardReplyAgent.providerConfigId,
          model: dashboardReplyAgent.model,
        }
        : null,
    });

    const providerId = route.provider as Exclude<ProviderId, "jules"> | undefined;
    if (!providerId) {
      throw new Error("Dashboard replies require an enabled CLI provider, but no eligible provider was resolved.");
    }
    const providerConfigId = route.providerConfigId || providerId;
    const providerSettings = route.providers[providerConfigId];
    if (!providerSettings) {
      throw new Error(`Dashboard reply routing resolved provider ${providerConfigId}, but no provider settings were available.`);
    }

    return {
      mode: "VIRTUAL",
      providerId,
      model: providerSettings.model,
      apiKey: providerSettings.apiKey,
      qwenAuthMode: providerSettings.qwenAuthMode,
      qwenRegion: providerSettings.qwenRegion,
      qwenBaseUrl: providerSettings.qwenBaseUrl,
      qwenEnvKey: providerSettings.qwenEnvKey,
      qwenModelId: providerSettings.qwenModelId,
      qwenProtocol: providerSettings.qwenProtocol,
      qwenAdditionalModelProviders: providerSettings.qwenAdditionalModelProviders,
        openCodeAuthMode: providerSettings.openCodeAuthMode,
        openCodeProviderId: providerSettings.openCodeProviderId,
        openCodeModelId: providerSettings.openCodeModelId,
        openCodeBaseUrl: providerSettings.openCodeBaseUrl,
        openCodeEnvKey: providerSettings.openCodeEnvKey,
        openCodePackage: providerSettings.openCodePackage,
      providerMountAuth: providerSettings.mountAuth,
      providerAuthPath: providerSettings.authPath,
      customBaseUrl: providerSettings.customBaseUrl,
      customModel: providerSettings.customModel,
      thinkingMode: providerSettings.thinkingMode,
    };
  }

  public updateThreadRoute(threadId: string, input: UpdateConversationThreadRouteInput): ConversationThreadRecord {
    const thread = this.deps.connectionChatRepository.getThread(threadId);
    let connectionId: string | null = null;

    if (input.routeKind === "worker") {
      throw new Error("Connected MCP worker routes are no longer supported.");
    } else if (input.routeKind === "virtual") {
      if (!input.virtualProvider) {
        throw new Error("virtualProvider is required for virtual route.");
      }
      const validProviders = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"];
      if (!validProviders.includes(input.virtualProvider)) {
        throw new Error(`Virtual provider is not configured or unavailable: ${input.virtualProvider}`);
      }
    } else {
      throw new Error(`Invalid route kind: ${input.routeKind}`);
    }

    const newRuntimeState: ConversationRuntimeState = {
      ...thread.runtimeState,
      routeKind: input.routeKind,
      virtualProvider: input.virtualProvider,
      modelLabel: input.virtualModel,
      workerEndpointId: undefined,
      replayRequired: true,
    };

    return this.deps.connectionChatRepository.updateThread(thread.id, {
      connectionId,
      runtimeState: newRuntimeState,
    });
  }

  public async compactThreadSession(threadId: string): Promise<ConversationThreadRecord> {
    const thread = this.deps.connectionChatRepository.getThread(threadId);
    const project = this.deps.projectManagementRepository.getProject(thread.projectId);
    if (!project) {
      throw new Error(`Project not found: ${thread.projectId}`);
    }
    const messages = this.deps.connectionChatRepository.listMessages(thread.id);
    if (messages.length === 0) {
      return this.deps.connectionChatRepository.updateThread(thread.id, {
        runtimeState: {
          ...thread.runtimeState,
          replayRequired: true,
          sessionIds: [],
        },
      });
    }

    const assignments = this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(thread.projectId, { activeOnly: true });
    const settings = this.deps.getDashboardSettings({ projectId: thread.projectId });
    const route = await this.resolveThreadRoute(thread, assignments, settings, messages[messages.length - 1]?.bodyMarkdown || thread.title);
    if (!route.providerId || !route.model || typeof route.apiKey !== "string") {
      throw new Error("Failed to resolve a chat worker for thread compaction.");
    }

    const compacted = await this.generateThreadCompaction(project.id, project.baseDir, project.name, thread, messages, route);

    const newRuntimeState: ConversationRuntimeState = {
      ...thread.runtimeState,
      replayRequired: true,
      sessionIds: [],
      compactionSummary: compacted,
    };

    return this.deps.connectionChatRepository.updateThread(thread.id, {
      runtimeState: newRuntimeState,
    });
  }

  async postMessage(projectId: string, input: CreateDashboardConversationMessageInput): Promise<ConversationMessageRecord> {
    const userMessage = this.deps.connectionChatRepository.postDashboardMessage(projectId, input);
    const thread = this.deps.connectionChatRepository.getThread(userMessage.threadId);
    if (!thread) throw new Error("Thread not found");

    const existingTurn = this.inFlightTurns.get(thread.id);
    if (existingTurn) {
      // A turn for this thread is already in flight — either still waiting on a provider
      // concurrency slot or already running inside its docker container. Abort it; the
      // owning call below will notice the abort, fold this (and any other still-pending)
      // message into a single follow-up turn instead of racing two invocations against
      // the same provider session.
      existingTurn.abortController.abort(new Error("Superseded by a newer chat message"));
      return userMessage;
    }

    const turnHandle: InFlightChatTurn = {
      abortController: new AbortController(),
      latestMessage: userMessage,
    };
    this.inFlightTurns.set(thread.id, turnHandle);

    try {
      const assignments = this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
      const settings = this.deps.getDashboardSettings({ projectId });

      for (;;) {
        const currentThread = this.deps.connectionChatRepository.getThread(thread.id) || thread;
        try {
          const route = await this.resolveThreadRoute(currentThread, assignments, settings, turnHandle.latestMessage.bodyMarkdown);
          await this.runVirtualProvider(projectId, currentThread, turnHandle.latestMessage, route, turnHandle.abortController.signal);
          break;
        } catch (err) {
          if (!turnHandle.abortController.signal.aborted) {
            throw err;
          }

          // Superseded mid-flight: gather every dashboard message still awaiting a reply
          // (the one that triggered this abort, plus any others sent while it ran) and
          // retry as a single combined follow-up against the same (resumed) session.
          const pendingMessages = this.deps.connectionChatRepository
            .listMessages(thread.id)
            .filter((candidate) => candidate.direction === "dashboard_to_connection" && candidate.deliveryStatus === "pending");
          if (pendingMessages.length === 0) {
            break;
          }

          const combinedBody = pendingMessages.map((candidate) => candidate.bodyMarkdown).join("\n\n");
          turnHandle.latestMessage = { ...pendingMessages[pendingMessages.length - 1], bodyMarkdown: combinedBody };
          turnHandle.abortController = new AbortController();
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.deps.logger?.error("Dashboard chat turn failed", {
        projectId,
        threadId: thread.id,
        messageId: turnHandle.latestMessage.id,
        error: message,
      });
      this.deps.connectionChatRepository.markDashboardMessagesFailed(thread.id, {
        upToMessageId: turnHandle.latestMessage.id,
      });
      this.deps.connectionChatRepository.postSystemMessage(projectId, {
        threadId: thread.id,
        bodyMarkdown: `Worker execution failed: ${message}`,
      });
      return {
        ...userMessage,
        deliveryStatus: "failed",
      };
    } finally {
      this.inFlightTurns.delete(thread.id);
    }
    return userMessage;
  }

  private async runVirtualProvider(
    projectId: string,
    thread: ConversationThreadRecord,
    latestMessage: ConversationMessageRecord,
    route: ThreadRouteResolution,
    signal: AbortSignal,
  ): Promise<void> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) return;

    const provider = route.providerId!;
    // Fold the instance's customModel into the model exactly like the coding path
    // (ProviderExecutionService.executeProvider). The low-level runner keys off `model`
    // alone and ignores `customModel`, so without this a "Claude Local"-style instance
    // (customModel/customBaseUrl pointing at a local LM server) would run as `model=default`
    // and hit the real Anthropic subscription instead of the configured local endpoint.
    const model = resolveEffectiveModel({
      provider,
      model: route.model!,
      customModel: route.customModel,
      qwenAuthMode: route.qwenAuthMode,
      qwenModelId: route.qwenModelId,
      openCodeAuthMode: route.openCodeAuthMode,
      openCodeProviderId: route.openCodeProviderId,
      openCodeModelId: route.openCodeModelId,
    });
    const apiKey = route.apiKey!;
    const thinkingMode = route.thinkingMode;
    const dashboardSettings = this.deps.getDashboardSettings({ projectId });

    const runtimeState = thread.runtimeState || {};
    const pendingAction = runtimeState.pendingManagementAction;

    if (pendingAction) {
      const lowerBody = latestMessage.bodyMarkdown.trim().toLowerCase();
      const isApproval = lowerBody === "yes" || lowerBody === "approve" || lowerBody === "confirm" || lowerBody === "y";
      const isRejection = lowerBody === "no" || lowerBody === "reject" || lowerBody === "cancel" || lowerBody === "n";

      if (isApproval || isRejection) {
        this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
          upToMessageId: latestMessage.id,
        });

        if (isRejection) {
          this.deps.connectionChatRepository.postSystemMessage(projectId, {
            threadId: thread.id,
            bodyMarkdown: "_Management action canceled by user._",
          });
          const newRuntimeState: ConversationRuntimeState = { ...runtimeState };
          delete newRuntimeState.pendingManagementAction;
          this.deps.connectionChatRepository.updateThread(thread.id, { runtimeState: newRuntimeState });
          return;
        }

        try {
          const result = await this.deps.chatManagementActionService.executeApprovedAction(
            projectId,
            provider,
            model,
            pendingAction.action
          );

          let systemReply = result.replyMarkdown;
          if (result.result) {
            const stringifiedResult = typeof result.result === "object" ? JSON.stringify(result.result, null, 2) : String(result.result);
            systemReply += `\n\n_Action completed successfully._\n\`\`\`json\n${stringifiedResult}\n\`\`\``;
          }

          this.deps.connectionChatRepository.postSystemMessage(projectId, {
            threadId: thread.id,
            bodyMarkdown: systemReply.trim(),
          });

          const newRuntimeState: ConversationRuntimeState = { ...runtimeState };
          delete newRuntimeState.pendingManagementAction;
          this.deps.connectionChatRepository.updateThread(thread.id, { runtimeState: newRuntimeState });
          return;

        } catch (err: any) {
          this.deps.connectionChatRepository.postSystemMessage(projectId, {
            threadId: thread.id,
            bodyMarkdown: `Execution failed: ${err.message}`,
          });
          const newRuntimeState: ConversationRuntimeState = { ...runtimeState };
          delete newRuntimeState.pendingManagementAction;
          this.deps.connectionChatRepository.updateThread(thread.id, { runtimeState: newRuntimeState });
          return;
        }
      }
    }

    const lastProvider = runtimeState.virtualProvider;
    const replayRequired = runtimeState.replayRequired === true || lastProvider !== provider || !runtimeState.sessionIds?.length;

    let promptContent = "";
    let continueSessionId: string | null = null;
    const mcpConnection = this.deps.getMcpConnectionInfo?.() ?? null;
    const mcpAvailable = mcpConnection !== null;

    const allMessages = this.deps.connectionChatRepository.listMessages(thread.id);

    const respondingAgent = typeof this.deps.agentPresetSyncService.resolveDashboardReplyAgent === "function"
      ? await this.deps.agentPresetSyncService.resolveDashboardReplyAgent(
        projectId,
        dashboardSettings.agents?.routing?.dashboardReply?.agentPresetId ?? null,
      )
      : await this.deps.agentPresetSyncService.getWorkerAgent(projectId);

    if (replayRequired) {
      const workerInstructions = respondingAgent.instructionMarkdown.trim();
      const knowledgeManifest = this.deps.knowledgeService?.buildManifestMarkdownForAgent(respondingAgent.id) ?? null;
      promptContent = buildChatReplayPrompt({
        projectId,
        repoPath: project.baseDir,
        projectName: project.name,
        thread,
        messages: allMessages,
        workerInstructions,
        isDashboardReply: false,
        mcpAvailable,
        knowledgeManifest,
      });
    } else {
      promptContent = buildChatContinuationPrompt(latestMessage, pendingAction, mcpAvailable);
      continueSessionId = runtimeState.sessionIds![0];
    }

    const finalPrompt = buildProviderPrompt(promptContent, thinkingMode as any);

    const result = await this.deps.chatManagementActionService.processManagementAction({
      projectId,
      provider,
      model,
      apiKey,
      qwenAuthMode: route.qwenAuthMode,
      qwenRegion: route.qwenRegion,
      qwenBaseUrl: route.qwenBaseUrl,
      qwenEnvKey: route.qwenEnvKey,
      qwenModelId: route.qwenModelId,
      qwenProtocol: route.qwenProtocol,
      qwenAdditionalModelProviders: route.qwenAdditionalModelProviders,
      openCodeAuthMode: route.openCodeAuthMode,
      openCodeProviderId: route.openCodeProviderId,
      openCodeModelId: route.openCodeModelId,
      openCodeBaseUrl: route.openCodeBaseUrl,
      openCodeEnvKey: route.openCodeEnvKey,
      openCodePackage: route.openCodePackage,
      providerMountAuth: route.providerMountAuth,
      providerAuthPath: route.providerAuthPath,
      customBaseUrl: route.customBaseUrl,
      customModel: route.customModel,
      sessionId: thread.id,
      continueSessionId,
      settings: dashboardSettings,
      prompt: finalPrompt,
      repoPath: project.baseDir,
      mcpConnection,
      agentMcpAccess: respondingAgent.mcpAccess ?? null,
      mcpAgentId: respondingAgent.id,
      signal,
    });

    this.deps.connectionChatRepository.markDashboardMessagesProcessed(thread.id, {
      upToMessageId: latestMessage.id,
    });

    let systemReply = result.replyMarkdown;
    let newPendingAction = null;

    if (result.action) {
      if (result.approvalRequired) {
        systemReply += `\n\n_Action requires approval: ${result.approvalMessage}_\n_Please reply with "yes" to confirm or "no" to cancel._`;
        newPendingAction = {
          action: result.action,
          approvalMessage: result.approvalMessage || "Action requires approval.",
          proposedAt: new Date().toISOString(),
        };
      } else if (result.result) {
        const stringifiedResult = typeof result.result === "object" ? JSON.stringify(result.result, null, 2) : String(result.result);
        systemReply += `\n\n_Action completed successfully._\n\`\`\`json\n${stringifiedResult}\n\`\`\``;
      }
    }

    // In MCP-native mode, check if the worker triggered an approval-gated action
    if (mcpAvailable && !newPendingAction) {
      const tracker = this.deps.getMcpApprovalTracker?.();
      const correlationId = getCorrelationId() ?? thread.id;
      const pendingApproval = tracker?.takePending(correlationId) ?? null;
      if (pendingApproval) {
        newPendingAction = {
          action: pendingApproval.action,
          approvalMessage: pendingApproval.approvalMessage,
          proposedAt: pendingApproval.proposedAt,
        };
      }
    }

    this.deps.connectionChatRepository.postSystemMessage(projectId, {
      threadId: thread.id,
      bodyMarkdown: systemReply.trim(),
    });

    const newRuntimeState: ConversationRuntimeState = {
      ...runtimeState,
      routeKind: "virtual",
      virtualProvider: provider,
      modelLabel: model,
      sessionIds: [result.nativeSessionId || continueSessionId || thread.id],
      replayRequired: false,
    };

    if (newPendingAction) {
      newRuntimeState.pendingManagementAction = newPendingAction;
    } else {
      delete newRuntimeState.pendingManagementAction;
    }

    this.deps.connectionChatRepository.updateThread(thread.id, {
      connectionId: null,
      runtimeState: newRuntimeState,
    });
  }

  private async generateThreadCompaction(
    projectId: string,
    repoPath: string,
    projectName: string,
    thread: ConversationThreadRecord,
    messages: ConversationMessageRecord[],
    route: ThreadRouteResolution,
  ): Promise<ConversationCompactionSummary> {
    const provider = route.providerId!;
    // Fold customModel into the model so a local-redirect instance (customModel/customBaseUrl)
    // compacts against its configured endpoint rather than the real subscription. The runner
    // keys off `model` and ignores the separate `customModel` field.
    const model = resolveEffectiveModel({
      provider,
      model: route.model!,
      customModel: route.customModel,
      qwenAuthMode: route.qwenAuthMode,
      qwenModelId: route.qwenModelId,
      openCodeAuthMode: route.openCodeAuthMode,
      openCodeProviderId: route.openCodeProviderId,
      openCodeModelId: route.openCodeModelId,
    });
    const apiKey = route.apiKey!;
    const thinkingMode = route.thinkingMode;
    const dashboardSettings = this.deps.getDashboardSettings({ projectId });
    const workflowSettings = dashboardSettings.cliWorkflow;
    const githubToken = this.deps.getGithubToken();
    const workerAgent = typeof this.deps.agentPresetSyncService.resolveTargetedCodingAgent === "function"
      ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(
        projectId,
        dashboardSettings.agents?.routing?.dashboardReply?.agentPresetId ?? null,
      )
      : await this.deps.agentPresetSyncService.getWorkerAgent(projectId);
    const workerInstructions = workerAgent.instructionMarkdown.trim();
    const promptContent = buildChatCompactionPrompt({ projectId, repoPath, projectName, thread, messages, workerInstructions });
    const finalPrompt = buildProviderPrompt(promptContent, thinkingMode as any);
    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId,
      skipValidation: true,
      type: "chat_compaction",
      provider,
      model,
      startedAt: new Date().toISOString(),
      attentionItemId: null,
      dispatchId: null,
      providerInvocationId: null,
      sprintId: null,
      sprintRunId: null,
      taskId: null,
      taskRunId: null,
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "user",
      contentMarkdown: finalPrompt,
    });

    try {
      const result = await this.deps.providerRunner.runProviderForText({
        provider,
        prompt: finalPrompt,
        cwd: repoPath,
        model,
        apiKey,
      qwenAuthMode: route.qwenAuthMode,
      qwenRegion: route.qwenRegion,
      qwenBaseUrl: route.qwenBaseUrl,
      qwenEnvKey: route.qwenEnvKey,
      qwenModelId: route.qwenModelId,
      qwenProtocol: route.qwenProtocol,
      qwenAdditionalModelProviders: route.qwenAdditionalModelProviders,
        openCodeAuthMode: route.openCodeAuthMode,
        openCodeProviderId: route.openCodeProviderId,
        openCodeModelId: route.openCodeModelId,
        openCodeBaseUrl: route.openCodeBaseUrl,
        openCodeEnvKey: route.openCodeEnvKey,
        openCodePackage: route.openCodePackage,
        providerMountAuth: route.providerMountAuth,
        providerAuthPath: route.providerAuthPath,
        customBaseUrl: route.customBaseUrl,
        customModel: route.customModel,
        sessionId: `${thread.id}:compaction`,
        workflowSettings,
        repoPath,
        githubToken,
        continueSessionId: null,
        onActivity: (desc, originator) => {
          this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: originator === "user" ? "user" : "assistant",
            contentMarkdown: `[Status] ${desc}`,
          });
        },
      });

      const markdown = normalizeProviderReply(result.text);
      if (!markdown) {
        throw new Error(`Provider ${provider} returned an empty compaction summary.`);
      }

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
        role: "assistant",
        contentMarkdown: markdown,
      });
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });

      return {
        markdown,
        generatedAt: new Date().toISOString(),
        provider,
        model,
        sourceMessageId: messages[messages.length - 1]?.id || null,
        sourceMessageCount: messages.length,
      };
    } catch (err: any) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }
  }
}
