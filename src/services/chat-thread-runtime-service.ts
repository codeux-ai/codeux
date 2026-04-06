import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";
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
import {
  buildChatCompactionPrompt,
  buildChatContinuationPrompt,
  buildChatReplayPrompt,
  normalizeProviderReply,
} from "./chat-reply-prompt.js";
import type { ChatManagementActionService } from "./chat-management-action-service.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { McpApprovalTracker } from "./mcp-approval-tracker.js";

interface ChatThreadRuntimeServiceDependencies {
  connectionChatRepository: ConnectionChatRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  executionRepository: ExecutionRepository;
  taskService: TaskService;
  getDashboardSettings: () => DashboardSettings;
  getGithubToken: () => string | undefined;
  agentPresetSyncService: AgentPresetSyncService;
  projectManagementRepository: ProjectManagementRepository;
  providerRunner: IProviderRunner;
  chatManagementActionService: ChatManagementActionService;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  getMcpApprovalTracker?: () => McpApprovalTracker;
  logger?: Logger;
}

export interface ThreadRouteResolution {
  mode: "CONNECTED_MCP" | "VIRTUAL";
  connectionId?: string;
  providerId?: Extract<ProviderId, "gemini" | "codex" | "claude-code">;
  model?: string;
  apiKey?: string;
  thinkingMode?: string;
}

const THREAD_COMPACTION_REQUEST = "thread_compaction_request";
const THREAD_COMPACTION_RESULT = "thread_compaction_result";
const HIDDEN_INTERNAL_VISIBILITY = "hidden";
const CONNECTED_COMPACTION_TIMEOUT_MS = 45_000;
const CONNECTED_COMPACTION_POLL_MS = 500;

export class ChatThreadRuntimeService {
  constructor(private readonly deps: ChatThreadRuntimeServiceDependencies) {}

  public resolveThreadRoute(
    thread: Pick<ConversationThreadRecord, "connectionId" | "runtimeState">,
    liveAssignments: ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>,
    settings: DashboardSettings,
    latestMessageBody: string,
  ): ThreadRouteResolution {
    const runtimeState = thread.runtimeState || null;

    if (runtimeState?.routeKind === "worker") {
      const explicitWorker = runtimeState.workerEndpointId
        ? liveAssignments.find((assignment) => (
          (assignment.workerEndpointId === runtimeState.workerEndpointId
          || assignment.connectionId === runtimeState.workerEndpointId)
          && assignment.workerStatus !== "offline"
          && assignment.workerStatus !== "stale"
          && assignment.connectionId
        ))
        : null;
      if (explicitWorker?.connectionId) {
        return { mode: "CONNECTED_MCP", connectionId: explicitWorker.connectionId };
      }
    }

    if (thread.connectionId) {
      const isLive = liveAssignments.some((a) => a.connectionId === thread.connectionId && a.workerStatus !== "offline" && a.workerStatus !== "stale");
      if (isLive) {
        return { mode: "CONNECTED_MCP", connectionId: thread.connectionId };
      }
    }

    const pseudoTask: Subtask = {
      id: "dashboard-reply",
      title: "Dashboard reply",
      prompt: latestMessageBody,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };

    const route = this.deps.taskService.resolveInvocationProvider("dashboard_reply", pseudoTask, { cliOnly: true });

    if (this.isVirtualProvider(runtimeState?.virtualProvider) && runtimeState?.routeKind === "virtual") {
      const providerId = runtimeState.virtualProvider;
      const providerSettings = route.providers[providerId];

      return {
        mode: "VIRTUAL",
        providerId,
        model: runtimeState.modelLabel || providerSettings.model,
        apiKey: providerSettings.apiKey,
        thinkingMode: providerSettings.thinkingMode,
      };
    }

    const primary = liveAssignments.find((a) => a.assignmentRole === "primary" && a.capabilities.canSuperviseProjects && a.workerStatus !== "stale" && a.workerStatus !== "offline");
    if (primary && primary.connectionId) return { mode: "CONNECTED_MCP", connectionId: primary.connectionId };

    const overflow = liveAssignments.find((a) => a.assignmentRole === "overflow" && a.capabilities.canSuperviseProjects && a.workerStatus !== "stale" && a.workerStatus !== "offline");
    if (overflow && overflow.connectionId) return { mode: "CONNECTED_MCP", connectionId: overflow.connectionId };

    const providerId = route.provider as Extract<ProviderId, "gemini" | "codex" | "claude-code">;

    return {
      mode: "VIRTUAL",
      providerId,
      model: route.providers[providerId].model,
      apiKey: route.providers[providerId].apiKey,
      thinkingMode: route.providers[providerId].thinkingMode,
    };
  }

  public updateThreadRoute(threadId: string, input: UpdateConversationThreadRouteInput): ConversationThreadRecord {
    const thread = this.deps.connectionChatRepository.getThread(threadId);
    let connectionId: string | null = null;

    if (input.routeKind === "worker") {
      if (!input.workerEndpointId) {
        throw new Error("workerEndpointId is required for worker route.");
      }
      const assignments = this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(thread.projectId, { activeOnly: true });
      const worker = assignments.find((a) => (
        a.workerEndpointId === input.workerEndpointId
        || a.connectionId === input.workerEndpointId
      ));
      if (!worker) {
        throw new Error(`Worker not found or not active: ${input.workerEndpointId}`);
      }
      if (worker.workerStatus === "offline" || worker.workerStatus === "stale") {
        throw new Error(`Worker is unavailable: ${input.workerEndpointId}`);
      }
      connectionId = worker.connectionId;
    } else if (input.routeKind === "virtual") {
      if (!input.virtualProvider) {
        throw new Error("virtualProvider is required for virtual route.");
      }
      const validProviders = ["gemini", "codex", "claude-code"];
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
      workerEndpointId: input.routeKind === "worker"
        ? connectionId || input.workerEndpointId
        : undefined,
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
    const settings = this.deps.getDashboardSettings();
    const route = this.resolveThreadRoute(thread, assignments, settings, messages[messages.length - 1]?.bodyMarkdown || thread.title);
    if (route.mode === "CONNECTED_MCP" && route.connectionId) {
      return await this.runConnectedWorkerCompaction(project.id, project.baseDir, project.name, thread, messages, route.connectionId);
    }

    if (route.mode !== "VIRTUAL" || !route.providerId || !route.model || typeof route.apiKey !== "string") {
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

    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) throw new Error(`Project not found: ${projectId}`);

    const assignments = this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true });
    const settings = this.deps.getDashboardSettings();

    const route = this.resolveThreadRoute(thread, assignments, settings, userMessage.bodyMarkdown);

    if (route.mode === "CONNECTED_MCP") {
      if (thread.connectionId !== route.connectionId) {
        this.deps.connectionChatRepository.updateThread(thread.id, { connectionId: route.connectionId });
      }
      return userMessage;
    }

    await this.runVirtualProvider(projectId, thread, userMessage, route);
    return userMessage;
  }

  private async runVirtualProvider(
    projectId: string,
    thread: ConversationThreadRecord,
    latestMessage: ConversationMessageRecord,
    route: ThreadRouteResolution
  ): Promise<void> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) return;

    const provider = route.providerId!;
    const model = route.model!;
    const apiKey = route.apiKey!;
    const thinkingMode = route.thinkingMode;
    const dashboardSettings = this.deps.getDashboardSettings();

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

    if (replayRequired) {
      const workerInstructions = (await this.deps.agentPresetSyncService.getWorkerAgent(projectId)).instructionMarkdown.trim();
      promptContent = buildChatReplayPrompt({
        projectId,
        repoPath: project.baseDir,
        projectName: project.name,
        thread,
        messages: allMessages,
        workerInstructions,
        isDashboardReply: false,
        mcpAvailable,
      });
    } else {
      promptContent = buildChatContinuationPrompt(latestMessage, pendingAction, mcpAvailable);
      continueSessionId = runtimeState.sessionIds![0];
    }

    const finalPrompt = buildProviderPrompt(promptContent, thinkingMode as any);

    try {
      const result = await this.deps.chatManagementActionService.processManagementAction({
        projectId,
        provider,
        model,
        apiKey,
        sessionId: continueSessionId || thread.id,
        settings: dashboardSettings,
        prompt: finalPrompt,
        repoPath: project.baseDir,
        mcpConnection,
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
        const pendingApproval = tracker?.takePending() ?? null;
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
        sessionIds: [continueSessionId || thread.id], // processManagementAction doesn't currently return nativeSessionId from StructuredProviderResponseService!
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

    } catch (err: any) {
      this.deps.connectionChatRepository.postSystemMessage(projectId, {
        threadId: thread.id,
        bodyMarkdown: `Worker execution failed: ${err.message}`,
      });
      throw err;
    }
  }

  private isVirtualProvider(value: string | undefined | null): value is Extract<ProviderId, "gemini" | "codex" | "claude-code"> {
    return value === "gemini" || value === "codex" || value === "claude-code";
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
    const model = route.model!;
    const apiKey = route.apiKey!;
    const thinkingMode = route.thinkingMode;
    const workflowSettings = this.deps.getDashboardSettings().cliWorkflow;
    const githubToken = this.deps.getGithubToken();
    const workerInstructions = (await this.deps.agentPresetSyncService.getWorkerAgent(projectId)).instructionMarkdown.trim();
    const promptContent = buildChatCompactionPrompt({ projectId, repoPath, projectName, thread, messages, workerInstructions });
    const finalPrompt = buildProviderPrompt(promptContent, thinkingMode as any);
    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId,
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

  private async runConnectedWorkerCompaction(
    projectId: string,
    repoPath: string,
    projectName: string,
    thread: ConversationThreadRecord,
    messages: ConversationMessageRecord[],
    connectionId: string,
  ): Promise<ConversationThreadRecord> {
    const requestId = randomUUID();
    const workerInstructions = (await this.deps.agentPresetSyncService.getWorkerAgent(projectId)).instructionMarkdown.trim();
    const compactionPrompt = buildChatCompactionPrompt({ projectId, repoPath, projectName, thread, messages, workerInstructions });
    const boundThread = thread.connectionId === connectionId
      ? thread
      : this.deps.connectionChatRepository.updateThread(thread.id, { connectionId });

    this.deps.connectionChatRepository.postDashboardMessage(projectId, {
      threadId: boundThread.id,
      connectionId,
      bodyMarkdown: compactionPrompt,
      metadata: {
        internalVisibility: HIDDEN_INTERNAL_VISIBILITY,
        internalOperation: THREAD_COMPACTION_REQUEST,
        requestId,
      },
    });

    const reply = await this.waitForConnectedCompactionReply(boundThread.id, requestId);
    const provider = typeof reply.metadata?.provider === "string" ? reply.metadata.provider : "connected-worker";
    const model = typeof reply.metadata?.model === "string" ? reply.metadata.model : "unknown";
    const generatedAt = typeof reply.metadata?.generatedAt === "string"
      ? reply.metadata.generatedAt
      : new Date().toISOString();

    return this.deps.connectionChatRepository.updateThread(boundThread.id, {
      runtimeState: {
        ...boundThread.runtimeState,
        routeKind: "worker",
        workerEndpointId: connectionId,
        replayRequired: true,
        sessionIds: [],
        compactionSummary: {
          markdown: reply.bodyMarkdown,
          generatedAt,
          provider,
          model,
          sourceMessageId: messages[messages.length - 1]?.id || null,
          sourceMessageCount: messages.length,
        },
      },
    });
  }

  private async waitForConnectedCompactionReply(
    threadId: string,
    requestId: string,
  ): Promise<ConversationMessageRecord> {
    const deadline = Date.now() + CONNECTED_COMPACTION_TIMEOUT_MS;

    while (Date.now() < deadline) {
      const messages = this.deps.connectionChatRepository.listMessages(threadId, { includeHidden: true });
      const reply = messages.find((message) => (
        message.authorType === "connection"
        && message.metadata?.internalOperation === THREAD_COMPACTION_RESULT
        && message.metadata?.requestId === requestId
      ));
      if (reply) {
        return reply;
      }
      await this.sleep(CONNECTED_COMPACTION_POLL_MS);
    }

    throw new Error("Timed out waiting for the selected chat worker to return a compaction summary.");
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
