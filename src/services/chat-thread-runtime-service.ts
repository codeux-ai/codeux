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
import type { CreateDashboardConversationMessageInput, ConversationThreadRecord, ConversationMessageRecord, ConversationRuntimeState } from "../contracts/connection-chat-types.js";
import { buildProviderPrompt } from "./cli-workflow-utils.js";

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

export class ChatThreadRuntimeService {
  constructor(private readonly deps: ChatThreadRuntimeServiceDependencies) {}

  public resolveThreadRoute(
    thread: Pick<ConversationThreadRecord, 'connectionId'>,
    liveAssignments: ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>,
    settings: DashboardSettings,
    latestMessageBody: string,
  ): ThreadRouteResolution {
    if (thread.connectionId) {
      const isLive = liveAssignments.some((a) => a.connectionId === thread.connectionId && a.workerStatus !== "offline" && a.workerStatus !== "stale");
      if (isLive) {
        return { mode: "CONNECTED_MCP", connectionId: thread.connectionId };
      }
    }

    const primary = liveAssignments.find((a) => a.assignmentRole === "primary" && a.capabilities.canSuperviseProjects && a.workerStatus !== "stale" && a.workerStatus !== "offline");
    if (primary && primary.connectionId) return { mode: "CONNECTED_MCP", connectionId: primary.connectionId };

    const overflow = liveAssignments.find((a) => a.assignmentRole === "overflow" && a.capabilities.canSuperviseProjects && a.workerStatus !== "stale" && a.workerStatus !== "offline");
    if (overflow && overflow.connectionId) return { mode: "CONNECTED_MCP", connectionId: overflow.connectionId };

    const pseudoTask: Subtask = {
      id: "dashboard-reply",
      title: "Dashboard reply",
      prompt: latestMessageBody,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };

    const route = this.deps.taskService.resolveInvocationProvider("dashboard_reply", pseudoTask, { cliOnly: true });
    const providerId = route.provider as Extract<ProviderId, "gemini" | "codex" | "claude-code">;

    return {
      mode: "VIRTUAL",
      providerId,
      model: route.providers[providerId].model,
      apiKey: route.providers[providerId].apiKey,
      thinkingMode: route.providers[providerId].thinkingMode,
    };
  }

  async postMessage(projectId: string, input: CreateDashboardConversationMessageInput): Promise<ConversationMessageRecord> {
    const userMessage = this.deps.connectionChatRepository.postDashboardMessage(projectId, input);
    const thread = this.deps.connectionChatRepository.listThreads(projectId).find(t => t.id === userMessage.threadId);
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
    const workflowSettings = this.deps.getDashboardSettings().cliWorkflow;
    const githubToken = this.deps.getGithubToken();

    const runtimeState = thread.runtimeState || {};
    const lastProvider = runtimeState.virtualProvider;
    const replayRequired = runtimeState.replayRequired === true || lastProvider !== provider || !runtimeState.sessionIds?.length;

    let promptContent = "";
    let continueSessionId: string | null = null;

    const allMessages = this.deps.connectionChatRepository.listMessages(thread.id);

    if (replayRequired) {
      promptContent = await this.buildReplayPrompt(projectId, project.baseDir, project.name, thread, allMessages);
    } else {
      promptContent = await this.buildContinuationPrompt(latestMessage);
      continueSessionId = runtimeState.sessionIds![0];
    }

    const finalPrompt = buildProviderPrompt(promptContent, thinkingMode as any);

    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId,
      type: "worker_reply",
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
        cwd: project.baseDir,
        model,
        apiKey,
        sessionId: thread.id,
        workflowSettings,
        repoPath: project.baseDir,
        githubToken,
        continueSessionId,
        onActivity: (desc, originator) => {
          this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
            role: originator === "user" ? "user" : "assistant",
            contentMarkdown: `[Status] ${desc}`,
          });
        },
      });

      this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
        role: "assistant",
        contentMarkdown: result.text,
      });
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "completed",
        finishedAt: new Date().toISOString(),
      });

      const replyMarkdown = this.normalizeProviderReply(result.text);

      this.deps.connectionChatRepository.postSystemMessage(projectId, {
        threadId: thread.id,
        bodyMarkdown: replyMarkdown,
      });

      const newRuntimeState: ConversationRuntimeState = {
        ...runtimeState,
        routeKind: "VIRTUAL",
        virtualProvider: provider,
        modelLabel: model,
        sessionIds: result.nativeSessionId ? [result.nativeSessionId] : [],
        replayRequired: false,
      };

      this.deps.connectionChatRepository.updateThread(thread.id, {
        connectionId: null,
        runtimeState: newRuntimeState,
      });

    } catch (err: any) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });

      this.deps.connectionChatRepository.postSystemMessage(projectId, {
        threadId: thread.id,
        bodyMarkdown: `Worker execution failed: ${err.message}`,
      });
      throw err;
    }
  }

  private async buildReplayPrompt(projectId: string, repoPath: string, projectName: string, thread: ConversationThreadRecord, messages: ConversationMessageRecord[]): Promise<string> {
    const workerInstructions = (await this.deps.agentPresetSyncService.getWorkerAgent(projectId)).instructionMarkdown.trim();

    const instructions = [
      "You are a Sprint OS connected worker replying to a dashboard chat message.",
      "Reply in concise markdown.",
      "Do not claim code changes, PRs, or completed execution unless they actually happened.",
      "If the message asks for status you do not know, say so plainly and ask for the next action.",
      "Do not start implementation from this message. This is a reply-only interaction.",
    ].join("\\n");

    const history = messages.map(m => {
      const role = m.authorType === "dashboard_user" ? "User" : "Worker";
      return `### ${role}\\n${m.bodyMarkdown.trim()}`;
    }).join("\\n\\n");

    return [
      workerInstructions ? `## WORKER INSTRUCTIONS\\n\\n${workerInstructions}` : "",
      "## ROLE",
      instructions,
      "",
      "## CONTEXT",
      `Project: ${projectName}`,
      `Repo Path: ${repoPath}`,
      `Thread ID: ${thread.id}`,
      thread.title ? `Thread Title: ${thread.title}` : "",
      "",
      "## CONVERSATION HISTORY",
      history,
      "",
      "## REQUIRED OUTPUT",
      "Return only the reply body in markdown. No JSON. No code fences unless the reply truly needs them.",
    ].filter((part) => part.trim().length > 0).join("\\n");
  }

  private async buildContinuationPrompt(message: ConversationMessageRecord): Promise<string> {
    return `### User\\n${message.bodyMarkdown.trim()}`;
  }

  private normalizeProviderReply(output: string): string {
    const trimmed = output.trim();
    if (!trimmed) {
      return "";
    }

    try {
      const parsed = JSON.parse(trimmed) as { response?: unknown };
      if (typeof parsed?.response === "string") {
        return parsed.response.trim();
      }
    } catch {
      // Provider returned plain text; keep it as-is.
    }

    return trimmed;
  }
}
