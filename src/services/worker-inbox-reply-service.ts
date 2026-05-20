import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type { DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";
import type {
  ConversationCompactionSummary,
  ConversationMessageRecord,
  ConversationRuntimeState,
  ConversationThreadRecord,
} from "../contracts/connection-chat-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { buildProviderPrompt } from "./cli-workflow-utils.js";
import type { IProviderRunner, ProviderRunResult } from "../infrastructure/providers/cli/provider-runner.js";
import {
  buildChatReplayPrompt,
  normalizeProviderReply,
} from "./chat-reply-prompt.js";

import { getRepoCodeUxPath } from "../shared/config/code-ux-paths.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import { syncRemoteBranchIfAvailable } from "./git-branch-sync-service.js";
import type { ResolvedProviderRoute } from "./provider-routing.js";

export interface GenerateDashboardReplyInput {
  projectId: string;
  threadId: string;
  threadTitle?: string;
  bodyMarkdown: string;
  mode?: "reply" | "compact_thread";
}

export interface GenerateDashboardReplyResult {
  bodyMarkdown: string;
  provider: Exclude<ProviderId, "jules">;
  model: string;
}

interface WorkerInboxReplyServiceDependencies {
  projectManagementRepository: ProjectManagementRepository;
  connectionChatRepository: ConnectionChatRepository;
  taskService: TaskService;
  agentPresetSyncService: AgentPresetSyncService;
  executionRepository: ExecutionRepository;
  getDashboardSettings: (scope?: { projectId?: string; sprintId?: string }) => DashboardSettings;
  getGithubToken: () => string | undefined;
  providerRunner: IProviderRunner;
  logger?: Logger;
}

export class WorkerInboxReplyService {
  constructor(private readonly deps: WorkerInboxReplyServiceDependencies) {}

  private async syncRemoteBranchesIfNeeded(
    repoPath: string,
    branch: string | undefined,
    scope?: { projectId?: string; sprintId?: string },
  ): Promise<void> {
    const settings = this.deps.getDashboardSettings(scope);
    if (settings.git.githubMode !== "REMOTE") {
      return;
    }

    const branchToSync = branch?.trim() || settings.git.defaultBranch?.trim() || undefined;

    try {
      await syncRemoteBranchIfAvailable(repoPath, branchToSync, {
        githubToken: settings.git.githubToken,
        gitlabToken: settings.git.gitlabToken,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const branchLabel = branchToSync || "the requested branch";
      throw new Error(`Failed to refresh origin before generating clarification reply from ${branchLabel}: ${message}`);
    }
  }

  async generateReply(input: GenerateDashboardReplyInput): Promise<GenerateDashboardReplyResult> {
    const project = this.deps.projectManagementRepository.getProject(input.projectId);
    if (!project) {
      throw new Error(`Project not found: ${input.projectId}`);
    }

    const route = this.resolveProviderRoute("dashboard_reply", input.bodyMarkdown);
    const thread = this.deps.connectionChatRepository.getThread(input.threadId);
    const messages = this.deps.connectionChatRepository.listMessages(input.threadId);
    let rawPrompt = input.bodyMarkdown.trim();

    if (input.mode !== "compact_thread") {
      const settings = this.deps.getDashboardSettings({ projectId: input.projectId });
      const dashboardReplyAgentPresetId = settings.agents?.routing?.dashboardReply?.agentPresetId ?? null;
      const dashboardReplyAgent = typeof this.deps.agentPresetSyncService.resolveTargetedCodingAgent === "function"
        ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(input.projectId, dashboardReplyAgentPresetId)
        : await this.deps.agentPresetSyncService.getWorkerAgent(input.projectId);
      const workerInstructions = dashboardReplyAgent.instructionMarkdown.trim();
      rawPrompt = buildChatReplayPrompt({
        projectId: input.projectId,
        repoPath: project.baseDir,
        projectName: project.name,
        thread,
        threadTitle: input.threadTitle || thread.title,
        messages,
        bodyMarkdown: input.bodyMarkdown,
        workerInstructions,
        isDashboardReply: true,
      });
    }
    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const prompt = buildProviderPrompt(rawPrompt, providerSettings.thinkingMode);

    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: input.projectId,
      skipValidation: true,
      type: input.mode === "compact_thread" ? "chat_compaction" : "worker_reply",
      provider: route.provider,
      model: providerSettings.model,
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
      contentMarkdown: rawPrompt,
    });

    let output: string;
    try {
      const result = await this.runProvider({
        provider: route.provider,
        prompt,
        repoPath: project.baseDir,
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        qwenAuthMode: providerSettings.qwenAuthMode,
        qwenRegion: providerSettings.qwenRegion,
        qwenBaseUrl: providerSettings.qwenBaseUrl,
        qwenEnvKey: providerSettings.qwenEnvKey,
        qwenProtocol: providerSettings.qwenProtocol,
        openCodeAuthMode: providerSettings.openCodeAuthMode,
        openCodeProviderId: providerSettings.openCodeProviderId,
        openCodeModelId: providerSettings.openCodeModelId,
        openCodeBaseUrl: providerSettings.openCodeBaseUrl,
        openCodeEnvKey: providerSettings.openCodeEnvKey,
        openCodePackage: providerSettings.openCodePackage,
        providerMountAuth: providerSettings.mountAuth,
        providerAuthPath: providerSettings.authPath,
        githubToken: this.deps.getGithubToken(),
      });
      output = result.text;
    } catch (err) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }

    const bodyMarkdown = normalizeProviderReply(output);

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "assistant",
      contentMarkdown: bodyMarkdown,
    });
    this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });

    if (!bodyMarkdown) {
      throw new Error(
        input.mode === "compact_thread"
          ? `Provider ${route.provider} returned an empty thread compaction summary.`
          : `Provider ${route.provider} returned an empty dashboard reply.`
      );
    }

    this.deps.logger?.info("Generated dashboard reply", {
      provider: route.provider,
      projectId: input.projectId,
      threadId: input.threadId,
    });

    return {
      bodyMarkdown,
      provider: route.provider,
      model: providerSettings.model,
    };
  }

  async generateClarificationReply(args: {
    projectId: string;
    sprintGoal: string;
    subtasks: Subtask[];
    task: Subtask;
  }): Promise<string> {
    const project = this.deps.projectManagementRepository.getProject(args.projectId);
    if (!project) {
      throw new Error(`Project not found: ${args.projectId}`);
    }

    await this.syncRemoteBranchesIfNeeded(
      project.baseDir,
      typeof args.task.worker_branch === "string" ? args.task.worker_branch : undefined,
      {
        projectId: args.projectId,
        sprintId: typeof args.task.sprint_id === "string" ? args.task.sprint_id : undefined,
      },
    );

    const route = this.resolveProviderRoute("clarification_reply", args.task.prompt || args.task.title);
    const invocationTaskId = typeof args.task.record_id === "string" && args.task.record_id.trim().length > 0
      ? args.task.record_id.trim()
      : null;

    const settings = this.deps.getDashboardSettings({
      projectId: args.projectId,
      sprintId: typeof args.task.sprint_id === "string" ? args.task.sprint_id : undefined,
    });
    const clarificationAgentPresetId = settings.agents?.routing?.clarificationReply?.agentPresetId ?? null;
    const clarificationAgent = clarificationAgentPresetId
      ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(
        args.projectId,
        clarificationAgentPresetId,
      )
      : await this.deps.agentPresetSyncService.getProjectManagerAgent(args.projectId);
    const projectManagerInstructions = clarificationAgent
      .instructionMarkdown
      .trim();

    const clarificationRequest = this.getLatestClarificationRequest(args.task);

    const fullContextPrompt = [
      projectManagerInstructions ? `## PROJECT MANAGER INSTRUCTIONS\n\n${projectManagerInstructions}` : "",
      "## CLARIFICATION TASK",
      "Answer Jules' clarification request for the current task using the sprint context below.",
      "",
      "## SPRINT CONTEXT",
      `Project: ${project.name}`,
      `Sprint Goal: ${args.sprintGoal}`,
      "",
      "## SUBTASKS",
      args.subtasks.map((t) => `- [${t.status}] ${t.id}: ${t.title}${t.id === args.task.id ? " (CURRENT TASK)" : ""}`).join("\n"),
      "",
      "## CURRENT TASK DETAIL",
      `Task ID: ${args.task.id}`,
      `Title: ${args.task.title}`,
      `Original Prompt: ${args.task.prompt}`,
      "",
      "## JULES CLARIFICATION REQUEST",
      clarificationRequest,
      "",
      "## REQUIRED OUTPUT",
      "Return only the answer body in markdown. No JSON. No code fences unless the reply truly needs them.",
      "Answer the agent so they can continue implementation immediately.",
    ].filter(Boolean).join("\n");

    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const prompt = buildProviderPrompt(fullContextPrompt, providerSettings.thinkingMode);

    const startedAt = new Date().toISOString();

    const providerInvocationId = randomUUID();
    const sessionId = "worker-reply-" + providerInvocationId;

    const usageRecord = this.deps.executionRepository.createProviderInvocationUsage({
      projectId: args.projectId,
      taskId: invocationTaskId,
      sessionId,
      provider: route.provider,
      purpose: "clarification_reply",
      status: "running",
      model: providerSettings.model,
      startedAt,
      promptChars: fullContextPrompt.length,
    });

    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: args.projectId,
      skipValidation: true,
      type: "worker_reply",
      provider: route.provider,
      model: providerSettings.model,
      startedAt,
      attentionItemId: null,
      dispatchId: null,
      providerInvocationId: usageRecord.id,
      sprintId: null,
      sprintRunId: null,
      taskId: invocationTaskId,
      taskRunId: null,
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "user",
      contentMarkdown: fullContextPrompt,
    });

    let output: string;
    let providerResult: ProviderRunResult & { text: string };
    try {
      providerResult = await this.runProvider({
        provider: route.provider,
        prompt,
        repoPath: project.baseDir,
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        qwenAuthMode: providerSettings.qwenAuthMode,
        qwenRegion: providerSettings.qwenRegion,
        qwenBaseUrl: providerSettings.qwenBaseUrl,
        qwenEnvKey: providerSettings.qwenEnvKey,
        qwenProtocol: providerSettings.qwenProtocol,
        openCodeAuthMode: providerSettings.openCodeAuthMode,
        openCodeProviderId: providerSettings.openCodeProviderId,
        openCodeModelId: providerSettings.openCodeModelId,
        openCodeBaseUrl: providerSettings.openCodeBaseUrl,
        openCodeEnvKey: providerSettings.openCodeEnvKey,
        openCodePackage: providerSettings.openCodePackage,
        providerMountAuth: providerSettings.mountAuth,
        providerAuthPath: providerSettings.authPath,
        githubToken: this.deps.getGithubToken(),
      });
      output = providerResult.text;
    } catch (err) {
      const finishedAt = new Date().toISOString();
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt,
      });
      this.deps.executionRepository.updateProviderInvocationUsage(usageRecord.id, {
        status: "failed",
        finishedAt,
        durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      });
      throw err;
    }

    const reply = normalizeProviderReply(output);

    const finishedAt = new Date().toISOString();
    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "assistant",
      contentMarkdown: reply,
    });
    this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
      status: "completed",
      finishedAt,
    });
    this.deps.executionRepository.updateProviderInvocationUsage(usageRecord.id, {
      status: "completed",
      finishedAt,
      durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
      ...providerResult.usageTelemetry,
    });

    if (!reply) {
      throw new Error(`Provider ${route.provider} returned an empty clarification reply.`);
    }

    return reply;
  }

  private getLatestClarificationRequest(task: Subtask): string {
    const activities = Array.isArray(task.activities) ? task.activities : [];
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const entry = activities[index] as Record<string, unknown>;
      const agentMessaged = entry.agentMessaged as Record<string, unknown> | undefined;
      const agentMessage = typeof agentMessaged?.agentMessage === "string" ? agentMessaged.agentMessage.trim() : "";
      if (agentMessage.length > 0) {
        return agentMessage;
      }
      const description = typeof entry.description === "string" ? entry.description.trim() : "";
      if (description.length > 0) {
        return `No explicit Jules clarification message was captured. Latest related activity summary: ${description}`;
      }
    }
    return "No explicit Jules clarification message was captured in recent session activities.";
  }

  private resolveProviderRoute(
    invocation: "dashboard_reply" | "clarification_reply",
    bodyMarkdown: string,
  ): ResolvedProviderRoute & { provider: Exclude<ProviderId, "jules"> } {
    const pseudoTask: Subtask = {
      id: "dashboard-reply",
      title: "Dashboard reply",
      prompt: bodyMarkdown,
      depends_on: [],
      is_independent: true,
      status: "PENDING",
    };

    const route = this.deps.taskService.resolveInvocationProvider(invocation, pseudoTask, {
      cliOnly: true,
    });
    if (!route.provider) {
      throw new Error(`Invocation ${invocation} requires an enabled CLI provider, but none was resolved.`);
    }
    const providerConfigId = route.providerConfigId || route.provider;
    if (!route.providers[providerConfigId]) {
      throw new Error(`Invocation ${invocation} resolved provider ${providerConfigId}, but no provider settings were available.`);
    }
    return {
      ...route,
      providerConfigId,
      provider: route.provider as Exclude<ProviderId, "jules">,
    };
  }

  private async runProvider(input: {
    provider: Exclude<ProviderId, "jules">;
    prompt: string;
    repoPath: string;
    model: string;
    apiKey: string;
    qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
    qwenRegion?: "china" | "international";
    qwenBaseUrl?: string;
    qwenEnvKey?: string;
    qwenProtocol?: "openai" | "anthropic" | "gemini";
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
    providerMountAuth?: boolean;
    providerAuthPath?: string;
    githubToken?: string;
  }): Promise<ProviderRunResult & { text: string }> {
    const workflowSettings = this.deps.getDashboardSettings().cliWorkflow;

    return await this.deps.providerRunner.runProviderForText({
      provider: input.provider,
      prompt: input.prompt,
      cwd: input.repoPath,
      model: input.model,
      apiKey: input.apiKey,
      qwenAuthMode: input.qwenAuthMode,
      qwenRegion: input.qwenRegion,
      qwenBaseUrl: input.qwenBaseUrl,
      qwenEnvKey: input.qwenEnvKey,
      qwenProtocol: input.qwenProtocol,
        openCodeAuthMode: input.openCodeAuthMode,
        openCodeProviderId: input.openCodeProviderId,
        openCodeModelId: input.openCodeModelId,
        openCodeBaseUrl: input.openCodeBaseUrl,
        openCodeEnvKey: input.openCodeEnvKey,
        openCodePackage: input.openCodePackage,
      providerMountAuth: input.providerMountAuth,
      providerAuthPath: input.providerAuthPath,
      sessionId: "worker-reply-" + randomUUID(),
      workflowSettings,
      repoPath: input.repoPath,
      githubToken: input.githubToken,
      onActivity: () => {},
    });
  }

}
