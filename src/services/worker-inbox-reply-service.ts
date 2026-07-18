import * as fs from "fs/promises";
import * as path from "path";
import { randomUUID } from "crypto";
import type { DashboardSettings, JulesActivity, ProviderId, QwenModelProviderSettings, Subtask } from "../contracts/app-types.js";
import type {
  ConversationCompactionSummary,
  ConversationMessageRecord,
  ConversationRuntimeState,
  ConversationThreadRecord,
} from "../contracts/connection-chat-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS } from "./cli-workflow-utils.js";
import type { IProviderRunner, ProviderRunResult } from "../infrastructure/providers/cli/provider-runner.js";
import { buildProviderInvocationWorkspaceOptions } from "../infrastructure/providers/cli/invocation-workspace-preparer.js";
import { buildChatReplayPrompt, normalizeProviderReply } from "./chat-reply-prompt.js";
import { sanitizeInvocationOutputText } from "./invocation-output-sanitizer.js";
import {
  MAX_MESSAGE_CONTENT_CHARS,
  truncateForStorage,
} from "./invocation-message-limits.js";

import { getRepoCodeUxPath } from "../shared/config/code-ux-paths.js";
import type { TaskService } from "./task-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import type { Logger } from "../shared/logging/logger.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import type { KnowledgeService } from "./knowledge-service.js";
import { syncRemoteBranchIfAvailable } from "./git-branch-sync-service.js";
import type { ResolvedProviderRoute } from "./provider-routing.js";
import { resolveEffectiveModel } from "./provider-execution-service.js";
import type { SkillService, PersistentSkillStorageRuntime } from "./skill-service.js";
import type { AgentPresetRepository } from "../repositories/agent-preset-repository.js";
import { resolvePersistentSkillContext } from "./persistent-skill-context.js";
import type { McpConnectionInfo } from "../contracts/mcp-connection-types.js";
import type { WorkerClarificationRecord } from "../contracts/worker-clarification-types.js";
import type { AgentMcpAccessConfig } from "../contracts/agent-preset-types.js";
import {
  automaticClarificationReplyAgentMcpAccess,
  dashboardReplyAgentMcpAccess,
  isSchedulerOnlyAgentMcpAccess,
  resolveAgentMcpRuntime,
} from "./agent-mcp-access.js";
import {
  composeGoogleDrivePrompt,
  resolveGoogleDriveMount,
  type GoogleDriveRuntimeMount,
} from "./google-drive-mount-service.js";

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

export interface GenerateWorkerClarificationReplyInput {
  projectId: string;
  sprintGoal: string;
  subtasks: Subtask[];
  task: Subtask;
  clarification: WorkerClarificationRecord;
}

export interface GenerateWorkerClarificationReplyResult {
  answerMarkdown: string;
  agentPresetId: string;
  executionInvocationId: string;
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
  providerConcurrencyService: ProviderConcurrencyService;
  knowledgeService: KnowledgeService;
  skillService?: SkillService;
  agentPresetRepository?: AgentPresetRepository;
  getMcpConnectionInfo?: () => McpConnectionInfo | null;
  /**
   * Fetches the most recent activities for a Jules session straight from the
   * Jules API. Used to read the live clarification request at reply time so we
   * never depend on a possibly-empty local activity cache.
   */
  fetchSessionActivities?: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  logger?: Logger;
}

class ClarificationReplyNoLongerActiveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClarificationReplyNoLongerActiveError";
  }
}

export class WorkerInboxReplyService {
  constructor(private readonly deps: WorkerInboxReplyServiceDependencies) {}

  private normalizeBoundedProviderReply(output: string): string {
    return truncateForStorage(
      normalizeProviderReply(sanitizeInvocationOutputText(output)),
      MAX_MESSAGE_CONTENT_CHARS,
    );
  }

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

    const thread = this.deps.connectionChatRepository.getThread(input.threadId);
    const messages = this.deps.connectionChatRepository.listMessages(input.threadId);
    const settings = this.deps.getDashboardSettings({ projectId: input.projectId });
    let rawPrompt = input.bodyMarkdown.trim();
    let agentProvider: { providerConfigId?: string | null; model?: string | null } | null = null;
    let agentMcpAccess: AgentMcpAccessConfig | null | undefined;
    let mcpAgentId: string | null | undefined;

    if (input.mode !== "compact_thread") {
      const dashboardReplyAgentPresetId = settings.agents?.routing?.dashboardReply?.agentPresetId ?? null;
      const dashboardReplyAgent = typeof this.deps.agentPresetSyncService.resolveDashboardReplyAgent === "function"
        ? await this.deps.agentPresetSyncService.resolveDashboardReplyAgent(input.projectId, dashboardReplyAgentPresetId)
        : await this.deps.agentPresetSyncService.getWorkerAgent(input.projectId);
      agentProvider = {
        providerConfigId: dashboardReplyAgent.providerConfigId,
        model: dashboardReplyAgent.model,
      };
      agentMcpAccess = this.resolveDashboardReplyMcpAccess(
        dashboardReplyAgent.mcpAccess,
        dashboardReplyAgentPresetId,
      );
      mcpAgentId = dashboardReplyAgent.id;
      const workerInstructions = dashboardReplyAgent.instructionMarkdown.trim();
      const knowledgeManifest = this.deps.knowledgeService?.buildManifestMarkdownForAgent(dashboardReplyAgent.id) ?? null;
      const mcpAvailable = Boolean(agentMcpAccess.codeUxEnabled && this.deps.getMcpConnectionInfo?.());
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
        mcpAvailable,
        mcpAccessMode: isSchedulerOnlyAgentMcpAccess(agentMcpAccess) ? "scheduler_only" : "management",
        knowledgeManifest,
      });
    }
    const route = this.resolveProviderRoute("dashboard_reply", input.bodyMarkdown, agentProvider);
    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const persistentSkillContext = await resolvePersistentSkillContext({
      projectId: input.projectId,
      agentPresetId: mcpAgentId,
      prompt: rawPrompt,
    }, this.deps);
    const workflowSettings = { ...DEFAULT_CLI_WORKFLOW_SETTINGS, ...settings.cliWorkflow };
    const googleDriveMount = settings.googleDrive
      ? await resolveGoogleDriveMount(settings.googleDrive, project.baseDir, workflowSettings.executionMode, {
        logger: this.deps.logger,
      })
      : null;
    const invocationPrompt = googleDriveMount
      ? composeGoogleDrivePrompt(persistentSkillContext.prompt, settings.googleDrive.accessMode)
      : persistentSkillContext.prompt;
    const prompt = buildProviderPrompt(invocationPrompt, providerSettings.thinkingMode, route.provider);
    const startedAt = new Date().toISOString();
    const sessionId = `dashboard-reply-${randomUUID().slice(0, 8)}`;

    const usageRecord = await this.deps.providerConcurrencyService.waitForSlotAndClaim(
      route.provider,
      providerSettings.maxConcurrentTasks,
      {
        projectId: input.projectId,
        sessionId,
        provider: route.provider,
        purpose: "dashboard_reply",
        status: "running",
        model: providerSettings.model,
        startedAt,
        promptChars: invocationPrompt.length,
      }
    );

    const execInvocation = this.deps.executionRepository.createExecutionInvocation({
      projectId: input.projectId,
      skipValidation: true,
      type: input.mode === "compact_thread" ? "chat_compaction" : "worker_reply",
      provider: route.provider,
      model: providerSettings.model,
      startedAt,
      attentionItemId: null,
      dispatchId: null,
      providerInvocationId: usageRecord.id,
      sprintId: null,
      sprintRunId: null,
      taskId: null,
      taskRunId: null,
    });

    this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
      role: "user",
      contentMarkdown: invocationPrompt,
    });

    let output: string;
    try {
      const result = await this.runProvider({
        provider: route.provider,
        prompt,
        repoPath: project.baseDir,
        model: providerSettings.model,
        thinkingMode: providerSettings.thinkingMode,
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
        providerConfigMode: providerSettings.providerConfigMode,
        providerConfigPath: providerSettings.providerConfigPath,
        customBaseUrl: providerSettings.customBaseUrl,
        customModel: providerSettings.customModel,
        githubToken: this.deps.getGithubToken(),
        projectId: input.projectId,
        agentMcpAccess,
        mcpAgentId,
        persistentSkillRuntime: persistentSkillContext.runtime,
        googleDriveMount,
      });
      output = result.text;
    } catch (err) {
      this.deps.executionRepository.updateExecutionInvocation(execInvocation.id, {
        status: "failed",
        finishedAt: new Date().toISOString(),
      });
      throw err;
    }

    const bodyMarkdown = this.normalizeBoundedProviderReply(output);

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
    return (await this.generateClarificationReplyResult(args)).answerMarkdown;
  }

  async generateWorkerClarificationReply(
    args: GenerateWorkerClarificationReplyInput,
  ): Promise<GenerateWorkerClarificationReplyResult> {
    return await this.generateClarificationReplyResult(args);
  }

  private async generateClarificationReplyResult(args: {
    projectId: string;
    sprintGoal: string;
    subtasks: Subtask[];
    task: Subtask;
    clarification?: WorkerClarificationRecord;
  }): Promise<GenerateWorkerClarificationReplyResult> {
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

    const matchingSubtask = this.findMatchingSubtask(args.task, args.subtasks);
    const invocationTaskId = this.firstNonEmptyString(args.task.record_id, matchingSubtask?.record_id);
    const invocationSprintId = this.firstNonEmptyString(args.task.sprint_id, matchingSubtask?.sprint_id);

    const settings = this.deps.getDashboardSettings({
      projectId: args.projectId,
      sprintId: invocationSprintId ?? undefined,
    });
    const clarificationAgentPresetId = settings.agents?.routing?.clarificationReply?.agentPresetId ?? null;
    const clarificationAgent = clarificationAgentPresetId
      ? await this.deps.agentPresetSyncService.resolveTargetedCodingAgent(
        args.projectId,
        clarificationAgentPresetId,
      )
      : await this.deps.agentPresetSyncService.getProjectManagerAgent(args.projectId);
    const route = this.resolveProviderRoute("clarification_reply", args.task.prompt || args.task.title, {
      providerConfigId: clarificationAgent.providerConfigId,
      model: clarificationAgent.model,
    });
    const projectManagerInstructions = clarificationAgent
      .instructionMarkdown
      .trim();
    const knowledgeManifest = this.deps.knowledgeService?.buildManifestMarkdownForAgent(clarificationAgent.id) ?? null;

    const clarificationRequest = args.clarification?.questionMarkdown
      ?? this.getLatestClarificationRequest(
        await this.resolveClarificationActivities(args.task, args.subtasks),
      );
    const requesterLabel = args.clarification ? "coding agent" : "Jules";

    const fullContextPrompt = [
      projectManagerInstructions ? `## PROJECT MANAGER INSTRUCTIONS\n\n${projectManagerInstructions}` : "",
      knowledgeManifest ? `## KNOWLEDGE BASE\n\n${knowledgeManifest}` : "",
      "## CLARIFICATION TASK",
      `Answer the ${requesterLabel}'s clarification request for the current task using the sprint context below.`,
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
      `## ${args.clarification ? "CODING AGENT" : "JULES"} CLARIFICATION REQUEST`,
      clarificationRequest,
      "",
      "## REQUIRED OUTPUT",
      "Return only the answer body in markdown. No JSON. No code fences unless the reply truly needs them.",
      args.clarification
        ? "Do not call reply_to_clarification from this automated turn; the runtime will validate and deliver your returned answer."
        : "",
      "Answer the agent so they can continue implementation immediately.",
    ].filter(Boolean).join("\n");

    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const persistentSkillContext = await resolvePersistentSkillContext({
      projectId: args.projectId,
      agentPresetId: clarificationAgent.id,
      prompt: fullContextPrompt,
    }, this.deps);
    const workflowSettings = { ...DEFAULT_CLI_WORKFLOW_SETTINGS, ...settings.cliWorkflow };
    const googleDriveMount = settings.googleDrive
      ? await resolveGoogleDriveMount(settings.googleDrive, project.baseDir, workflowSettings.executionMode, {
        logger: this.deps.logger,
      })
      : null;
    const invocationPrompt = googleDriveMount
      ? composeGoogleDrivePrompt(persistentSkillContext.prompt, settings.googleDrive.accessMode)
      : persistentSkillContext.prompt;
    const prompt = buildProviderPrompt(invocationPrompt, providerSettings.thinkingMode, route.provider);

    const startedAt = new Date().toISOString();

    const providerInvocationId = randomUUID();
    const sessionId = `${args.clarification ? "clarification-reply" : "worker-reply"}-${providerInvocationId}`;
    const timeoutSeconds = Math.max(30, Math.floor(settings.workers?.timeoutSeconds || 300));
    const timeoutMs = timeoutSeconds * 1000;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      controller.abort(new Error(
        `Clarification reply generation timed out after ${timeoutSeconds}s`,
      ));
    }, timeoutMs);
    timeout.unref?.();

    try {
      const usageRecord = await this.deps.providerConcurrencyService.waitForSlotAndClaim(
        route.provider,
        providerSettings.maxConcurrentTasks,
        {
          projectId: args.projectId,
          taskId: invocationTaskId,
          sprintId: invocationSprintId,
          sprintRunId: args.clarification?.sprintRunId ?? null,
          dispatchId: args.clarification?.dispatchId ?? null,
          taskRunId: args.clarification?.taskRunId ?? null,
          attentionItemId: args.clarification?.id ?? null,
          sessionId,
          provider: route.provider,
          purpose: "clarification_reply",
          status: "running",
          model: providerSettings.model,
          startedAt,
          promptChars: invocationPrompt.length,
        },
        controller.signal,
        timeoutMs,
      );

      let executionInvocationId: string | null = null;
      try {
        const execInvocation = this.deps.executionRepository.createExecutionInvocation({
          projectId: args.projectId,
          skipValidation: true,
          type: "worker_reply",
          provider: route.provider,
          model: providerSettings.model,
          startedAt,
          attentionItemId: args.clarification?.id ?? null,
          dispatchId: args.clarification?.dispatchId ?? null,
          providerInvocationId: usageRecord.id,
          sprintId: invocationSprintId,
          sprintRunId: args.clarification?.sprintRunId ?? null,
          taskId: invocationTaskId,
          taskRunId: args.clarification?.taskRunId ?? null,
          agentPresetId: clarificationAgent.id,
        });
        executionInvocationId = execInvocation.id;
        this.deps.executionRepository.appendExecutionInvocationMessage(execInvocation.id, {
          role: "user",
          contentMarkdown: invocationPrompt,
        });

        const providerResult: ProviderRunResult & { text: string } = await this.runProvider({
          provider: route.provider,
          prompt,
          repoPath: project.baseDir,
          model: providerSettings.model,
          thinkingMode: providerSettings.thinkingMode,
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
          providerConfigMode: providerSettings.providerConfigMode,
          providerConfigPath: providerSettings.providerConfigPath,
          customBaseUrl: providerSettings.customBaseUrl,
          customModel: providerSettings.customModel,
          githubToken: this.deps.getGithubToken(),
          projectId: args.projectId,
          sprintId: invocationSprintId,
          agentMcpAccess: automaticClarificationReplyAgentMcpAccess(),
          mcpAgentId: clarificationAgent.id,
          executionInvocationId: execInvocation.id,
          persistentSkillRuntime: persistentSkillContext.runtime,
          googleDriveMount,
          signal: controller.signal,
        });
        const reply = this.normalizeBoundedProviderReply(providerResult.text);
        if (!reply) {
          throw new Error(`Provider ${route.provider} returned an empty clarification reply.`);
        }

        const finishedAt = new Date().toISOString();
        this.assertClarificationReplyRuntimeActive({
          sprintRunId: args.clarification?.sprintRunId ?? null,
          executionInvocationId: execInvocation.id,
          providerInvocationId: usageRecord.id,
        });
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
        return {
          answerMarkdown: reply,
          agentPresetId: clarificationAgent.id,
          executionInvocationId: execInvocation.id,
        };
      } catch (error) {
        const finishedAt = new Date().toISOString();
        const canInspectExecutionInvocation =
          typeof this.deps.executionRepository.getExecutionInvocation === "function";
        const canInspectProviderInvocation =
          typeof this.deps.executionRepository.getProviderInvocationUsage === "function";
        const currentExecutionInvocation = executionInvocationId && canInspectExecutionInvocation
          ? this.deps.executionRepository.getExecutionInvocation(executionInvocationId)
          : null;
        const currentUsage = canInspectProviderInvocation
          ? this.deps.executionRepository.getProviderInvocationUsage(usageRecord.id)
          : null;
        const runtimeWasSettledExternally = (
          currentExecutionInvocation !== null
          && currentExecutionInvocation.status !== "running"
        ) || (
          currentUsage !== null
          && currentUsage.status !== "running"
        );
        const cancelledByLifecycle = error instanceof ClarificationReplyNoLongerActiveError;
        if (executionInvocationId && !runtimeWasSettledExternally) {
          this.deps.executionRepository.updateExecutionInvocation(executionInvocationId, {
            status: cancelledByLifecycle ? "cancelled" : "failed",
            finishedAt,
            errorMessage: cancelledByLifecycle
              ? null
              : error instanceof Error
                ? error.message
                : String(error),
          });
        }
        if (!runtimeWasSettledExternally) {
          this.deps.executionRepository.updateProviderInvocationUsage(usageRecord.id, {
            status: cancelledByLifecycle ? "cancelled" : "failed",
            finishedAt,
            durationMs: new Date(finishedAt).getTime() - new Date(startedAt).getTime(),
          });
        }
        throw error;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  private assertClarificationReplyRuntimeActive(args: {
    sprintRunId: string | null;
    executionInvocationId: string;
    providerInvocationId: string;
  }): void {
    const repository = this.deps.executionRepository;
    if (
      typeof repository.getExecutionInvocation !== "function"
      || typeof repository.getProviderInvocationUsage !== "function"
    ) {
      return;
    }

    if (args.sprintRunId && typeof repository.getSprintRun === "function") {
      const sprintRun = repository.getSprintRun(args.sprintRunId);
      if (!sprintRun || (sprintRun.status !== "queued" && sprintRun.status !== "running")) {
        throw new ClarificationReplyNoLongerActiveError(
          `Clarification reply delivery stopped because sprint run ${args.sprintRunId} is no longer active.`,
        );
      }
    }

    const executionInvocation = repository.getExecutionInvocation(
      args.executionInvocationId,
    );
    const providerInvocation = repository.getProviderInvocationUsage(
      args.providerInvocationId,
    );
    if (
      !executionInvocation
      || executionInvocation.status !== "running"
      || !providerInvocation
      || providerInvocation.status !== "running"
    ) {
      throw new ClarificationReplyNoLongerActiveError(
        "Clarification reply delivery stopped because its invocation was cancelled or settled.",
      );
    }
  }

  private firstNonEmptyString(...values: Array<string | null | undefined>): string | null {
    for (const value of values) {
      if (typeof value === "string" && value.trim().length > 0) {
        return value.trim();
      }
    }
    return null;
  }

  private findMatchingSubtask(task: Subtask, subtasks: Subtask[]): Subtask | undefined {
    // The task may arrive in two shapes: a hydrated Subtask (`id` = task key,
    // `record_id` = db id) or a bare task record cast to Subtask (`id` = db id).
    // Cross-match both identifier fields so either shape resolves its subtask.
    const recordId = this.firstNonEmptyString(task.record_id);
    const taskKeyOrId = this.firstNonEmptyString(task.id);
    return subtasks.find((candidate) =>
      (recordId && (candidate.record_id === recordId || candidate.id === recordId)) ||
      (taskKeyOrId && (candidate.id === taskKeyOrId || candidate.record_id === taskKeyOrId))
    );
  }

  private resolveSessionNameForTask(task: Subtask, subtasks: Subtask[]): string | null {
    const match = this.findMatchingSubtask(task, subtasks);
    return this.firstNonEmptyString(
      task.session_name,
      task.session_id,
      match?.session_name,
      match?.session_id,
    );
  }

  /**
   * Resolves the session activities to mine for the latest Jules clarification.
   *
   * The local activity cache can be empty or stale (e.g. when the clarification
   * is handled outside the regular session-sync loop), so we read the live
   * activities straight from the Jules API first. We only fall back to the
   * task's (or its hydrated subtask's) cached activities when the live fetch is
   * unavailable, fails, or returns nothing — guaranteeing the real Jules
   * message is never silently dropped.
   */
  private async resolveClarificationActivities(task: Subtask, subtasks: Subtask[]): Promise<JulesActivity[]> {
    const sessionName = this.resolveSessionNameForTask(task, subtasks);
    const isCliSession = !!sessionName && sessionName.replace(/^sessions\//, "").startsWith("cli-");
    if (sessionName && !isCliSession && this.deps.fetchSessionActivities) {
      try {
        const liveActivities = await this.deps.fetchSessionActivities(sessionName, 15);
        if (Array.isArray(liveActivities) && liveActivities.length > 0) {
          return liveActivities;
        }
      } catch (error) {
        this.deps.logger?.warn(
          "Failed to fetch live Jules activities for clarification reply; falling back to cached activities",
          {
            sessionName,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    }

    const taskActivities = Array.isArray(task.activities) ? task.activities : [];
    if (taskActivities.length > 0) {
      return taskActivities;
    }
    const match = this.findMatchingSubtask(task, subtasks);
    return Array.isArray(match?.activities) ? match.activities : [];
  }

  private isUserOriginatedActivity(entry: JulesActivity): boolean {
    return typeof entry.originator === "string" && entry.originator.toLowerCase() === "user";
  }

  private getLatestClarificationRequest(activities: JulesActivity[]): string {
    // Prefer the most recent agent message across all activities so that a
    // newer progress/description entry never masks the actual question Jules
    // asked. User-originated activities (e.g. our own prior reply) are skipped.
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const entry = activities[index];
      if (this.isUserOriginatedActivity(entry)) {
        continue;
      }
      const agentMessage = typeof entry.agentMessaged?.agentMessage === "string"
        ? entry.agentMessaged.agentMessage.trim()
        : "";
      if (agentMessage.length > 0) {
        return agentMessage;
      }
    }
    for (let index = activities.length - 1; index >= 0; index -= 1) {
      const entry = activities[index];
      if (this.isUserOriginatedActivity(entry)) {
        continue;
      }
      const summary = (typeof entry.progressUpdated?.title === "string" ? entry.progressUpdated.title.trim() : "")
        || (typeof entry.progressUpdated?.description === "string" ? entry.progressUpdated.description.trim() : "")
        || (typeof entry.description === "string" ? entry.description.trim() : "");
      if (summary.length > 0) {
        return `No explicit Jules clarification message was captured. Latest related activity summary: ${summary}`;
      }
    }
    return "No explicit Jules clarification message was captured in recent session activities.";
  }

  private resolveProviderRoute(
    invocation: "dashboard_reply" | "clarification_reply",
    bodyMarkdown: string,
    agentProvider?: { providerConfigId?: string | null; model?: string | null } | null,
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
      agentProvider,
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
    thinkingMode?: import("../contracts/app-types.js").ThinkingMode;
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
    providerConfigMode?: import("../contracts/app-types.js").ProviderConfigMode;
    providerConfigPath?: string;
    customBaseUrl?: string;
    customModel?: string;
    githubToken?: string;
    projectId?: string;
    sprintId?: string | null;
    agentMcpAccess?: AgentMcpAccessConfig | null;
    mcpAgentId?: string | null;
    executionInvocationId?: string | null;
    persistentSkillRuntime?: PersistentSkillStorageRuntime | null;
    googleDriveMount?: GoogleDriveRuntimeMount | null;
    signal?: AbortSignal;
  }): Promise<ProviderRunResult & { text: string }> {
    const dashboardSettings = this.deps.getDashboardSettings(input.projectId
      ? { projectId: input.projectId, sprintId: input.sprintId ?? undefined }
      : undefined);
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...dashboardSettings.cliWorkflow,
    };
    const gitSettings = dashboardSettings.git ?? { githubMode: "REMOTE" as const, defaultBranch: "main", githubToken: "", gitlabToken: "" };
    const defaultBranch = gitSettings.defaultBranch?.trim() || "main";
    const persistentSkillRuntime = input.persistentSkillRuntime ?? null;
    const mcpConnection = persistentSkillRuntime || input.agentMcpAccess?.codeUxEnabled
      ? this.deps.getMcpConnectionInfo?.() ?? null
      : null;
    const resolvedMcp = resolveAgentMcpRuntime({
      access: input.agentMcpAccess,
      agentId: input.mcpAgentId,
      executionInvocationId: input.executionInvocationId,
      customMcpServers: dashboardSettings.customMcpServers ?? [],
      mcpConnection,
      persistentSkillRetrievalEnabled: Boolean(persistentSkillRuntime),
    });

    const effectiveModel = resolveEffectiveModel({
      provider: input.provider,
      model: input.model,
      providerMountAuth: input.providerMountAuth,
      customModel: input.customModel,
      qwenAuthMode: input.qwenAuthMode,
      qwenModelId: input.qwenModelId,
      openCodeAuthMode: input.openCodeAuthMode,
      openCodeProviderId: input.openCodeProviderId,
      openCodeModelId: input.openCodeModelId,
    });

    return await this.deps.providerRunner.runProviderForText({
      provider: input.provider,
      prompt: input.prompt,
      cwd: input.repoPath,
      model: effectiveModel,
      thinkingMode: input.thinkingMode,
      apiKey: input.apiKey,
      qwenAuthMode: input.qwenAuthMode,
      qwenRegion: input.qwenRegion,
      qwenBaseUrl: input.qwenBaseUrl,
      qwenEnvKey: input.qwenEnvKey,
      qwenModelId: input.qwenModelId,
      qwenProtocol: input.qwenProtocol,
      qwenAdditionalModelProviders: input.qwenAdditionalModelProviders,
        openCodeAuthMode: input.openCodeAuthMode,
        openCodeProviderId: input.openCodeProviderId,
        openCodeModelId: input.openCodeModelId,
        openCodeBaseUrl: input.openCodeBaseUrl,
        openCodeEnvKey: input.openCodeEnvKey,
        openCodePackage: input.openCodePackage,
      providerMountAuth: input.providerMountAuth,
      providerAuthPath: input.providerAuthPath,
      providerConfigMode: input.providerConfigMode,
      providerConfigPath: input.providerConfigPath,
      customBaseUrl: input.customBaseUrl,
      customModel: input.customModel,
      sessionId: "worker-reply-" + randomUUID(),
      workflowSettings,
      repoPath: input.repoPath,
      ...buildProviderInvocationWorkspaceOptions({
        workflowSettings,
        gitPolicy: {
          githubMode: gitSettings.githubMode,
          defaultBranch,
          githubToken: input.githubToken || gitSettings.githubToken,
          gitlabToken: gitSettings.gitlabToken,
        },
      }),
      mcpConnection: resolvedMcp.mcpConnection,
      customMcpServers: resolvedMcp.customMcpServers,
      persistentSkillStorageMounts: persistentSkillRuntime?.mounts,
      googleDriveMount: input.googleDriveMount ?? undefined,
      signal: input.signal,
      onActivity: () => {},
    });
  }

  private resolveDashboardReplyMcpAccess(
    access: AgentMcpAccessConfig | undefined,
    _dashboardReplyAgentPresetId: string | null,
  ): AgentMcpAccessConfig {
    return dashboardReplyAgentMcpAccess(access);
  }

}
