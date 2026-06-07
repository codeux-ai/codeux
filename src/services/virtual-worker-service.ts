import { randomUUID } from "crypto";
import type { CliWorkflowSettings, DashboardSettings, JulesSession, ProviderId, QwenModelProviderSettings, WorkerExecutionMode, Subtask } from "../contracts/app-types.js";
import type { WorkerTaskDispatchClaim } from "../contracts/execution-types.js";
import type { ProjectAttentionItemRecord } from "../contracts/project-attention-types.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { WorkerEndpointRepository } from "../repositories/worker-endpoint-repository.js";
import type { ProjectWorkerAssignmentRepository } from "../repositories/project-worker-assignment-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { buildTaskRunKey } from "./task-run-key.js";
import { buildProviderPrompt, DEFAULT_CLI_WORKFLOW_SETTINGS, sanitizeToken } from "./cli-workflow-utils.js";
import { isReadFileNotFoundToolError, buildReadFileRetryPrompt } from "./cli-workflow-text-utils.js";
import { WorkspaceManager } from "../infrastructure/providers/cli/workspace-manager.js";
import { WorkspaceArtifactService } from "../infrastructure/providers/cli/workspace-artifact-service.js";
import { ProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { PrService } from "../infrastructure/providers/cli/pr-service.js";
import { ProviderExecutionService } from "./provider-execution-service.js";
import type { GuardrailService } from "./guardrail-service.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { buildGitHttpAuthEnvForRepoWithFallbacks, type GitHttpAuthOptions } from "./git-http-auth.js";
import { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { WorkerTaskDispatchService } from "./worker-task-dispatch-service.js";
import { CliWorkflowService } from "./cli-workflow-service.js";
import { resolveProviderForInvocation, resolveWorkerModelForProvider } from "./provider-routing.js";
import { ProviderConcurrencyService } from "./provider-concurrency-service.js";
import { resolveEffectiveDashboardSettings } from "./settings-resolution-service.js";
import type { WorkerInboxReplyService } from "./worker-inbox-reply-service.js";
import type { InstructionService } from "../instructions/instruction-template-service.js";
import type { SprintExecutionStateService } from "./sprint-execution-state-service.js";
import type { MemoryService } from "./memory-service.js";
import type { AgentPresetSyncService } from "./agent-preset-sync-service.js";
import { resolveAgentMemoryInstructions } from "./agent-memory-instructions.js";
import { LEARNINGS_FILENAME } from "../contracts/memory-types.js";
import { DockerService } from "./docker-service.js";

const VIRTUAL_WORKER_RECONCILE_MS = 3_000;
const VIRTUAL_WORKER_SESSION_POLL_MS = 2_000;

function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTerminalSessionState(state: string | undefined): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "QUOTA" || state === "RATE_LIMITED";
}

function extractPullRequest(session: JulesSession): { url?: string; workerBranch?: string } | null {
  const output = (session.outputs || [])
    .map((entry) => entry.pullRequest)
    .find((entry): entry is { url?: string; workerBranch?: string } => Boolean(entry));
  return output || null;
}

function resolveTerminalDispatchState(session: JulesSession): "COMPLETED" | "FAILED" | "QUOTA" | null {
  if (session.state === "QUOTA") {
    return "QUOTA";
  }
  if (session.state === "RATE_LIMITED") {
    return "QUOTA";
  }
  if (session.state === "FAILED" || session.state === "CANCELLED") {
    return "FAILED";
  }
  if (extractPullRequest(session) || session.state === "COMPLETED") {
    return "COMPLETED";
  }
  return null;
}

export interface VirtualWorkerServiceDependencies {
  settingsRepository: SettingsRepository;
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  workerEndpointRepository: WorkerEndpointRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  projectAttentionService: ProjectAttentionService;
  guardrailService?: GuardrailService;
  workerTaskDispatchService: WorkerTaskDispatchService;
  cliWorkflowService: CliWorkflowService;
  sprintExecutionStateService: SprintExecutionStateService;
  workerInboxReplyService: WorkerInboxReplyService;
  instructionService: InstructionService;
  approveSessionPlan: (sessionId: string) => Promise<unknown>;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  providerConcurrencyService: ProviderConcurrencyService;
  memoryService?: MemoryService;
  agentPresetSyncService?: Pick<AgentPresetSyncService, "getOptionalWorkerAgentForRepoPath" | "resolveTargetedCodingAgent">;
  logger?: Logger;
}

export class VirtualWorkerService {
  private readonly workspaceManager = new WorkspaceManager();
  private readonly workspaceArtifactService = new WorkspaceArtifactService(this.workspaceManager);
  private readonly dockerService = new DockerService();
  private readonly prService = new PrService();

  private readonly providerRunner = new ProviderRunner(new DockerRunner());

  private readonly activeCycles = new Map<string, Promise<void>>();

  private readonly scheduledProjects = new Set<string>();

  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  private readonly providerExecutionService: ProviderExecutionService;

  constructor(private readonly deps: VirtualWorkerServiceDependencies) {
    this.providerExecutionService = new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: this.providerRunner,
      providerConcurrencyService: deps.providerConcurrencyService,
      logger: deps.logger,
      sessionTracking: deps.sessionTracking,
    });
  }

  private isOrchestratorHandledClarificationItem(item: ProjectAttentionItemRecord): boolean {
    return item.summaryMarkdown.includes("Clarification cooldown active")
      || item.summaryMarkdown.includes("already answered automatically")
      || item.summaryMarkdown.includes("Resume instruction already sent");
  }

  start(): void {
    if (this.reconcileTimer) {
      return;
    }

    this.cleanupOrphanedVirtualWorkers();
    void this.reconcile();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch((error) => {
        this.deps.logger?.error("Virtual worker reconcile failed", { error });
      });
    }, VIRTUAL_WORKER_RECONCILE_MS);
    this.reconcileTimer.unref?.();
  }

  stop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  scheduleProject(projectId: string, reason: string): void {
    if (this.activeCycles.has(projectId) || this.scheduledProjects.has(projectId)) {
      return;
    }
    if (!this.projectNeedsVirtualWorker(projectId)) {
      return;
    }

    this.scheduledProjects.add(projectId);
    queueMicrotask(() => {
      this.scheduledProjects.delete(projectId);
      if (this.activeCycles.has(projectId) || !this.projectNeedsVirtualWorker(projectId)) {
        return;
      }

      const cycle = this.runProjectCycle(projectId, reason)
        .catch((error) => {
          this.deps.logger?.error("Virtual worker cycle failed", { projectId, reason, error });
        })
        .finally(() => {
          this.activeCycles.delete(projectId);
          if (this.projectNeedsVirtualWorker(projectId)) {
            this.scheduleProject(projectId, "remaining_worker_work");
          }
        });

      this.activeCycles.set(projectId, cycle);
    });
  }

  async reconcile(): Promise<void> {
    for (const project of this.deps.projectManagementRepository.listProjects().projects) {
      if (this.projectNeedsVirtualWorker(project.id)) {
        this.scheduleProject(project.id, "reconcile");
      }
    }
  }

  private projectUsesVirtualWorkers(projectId: string, sprintId?: string | null): boolean {
    return this.resolveWorkerExecutionMode(projectId, sprintId) === "VIRTUAL";
  }

  private resolveWorkerExecutionMode(projectId: string, sprintId?: string | null): WorkerExecutionMode {
    return resolveEffectiveDashboardSettings(this.deps.settingsRepository, projectId, sprintId).settings.workers.executionMode;
  }

  private resolveDashboardSettings(projectId: string, sprintId?: string | null): DashboardSettings {
    return resolveEffectiveDashboardSettings(this.deps.settingsRepository, projectId, sprintId).settings;
  }

  private projectNeedsVirtualWorker(projectId: string): boolean {
    if (!this.projectUsesVirtualWorkers(projectId)) {
      return false;
    }
    if (this.activeCycles.has(projectId)) {
      return false;
    }

    return this.pickNextWorkerAttention(projectId) !== null;
  }

  private async runProjectCycle(projectId: string, reason: string): Promise<void> {
    const cycleSettings = this.resolveCycleSettings(projectId);
    const cycleProviderType = cycleSettings.aiProvider.providers[cycleSettings.workers.virtualWorkerProvider]?.provider || "codex";
    const endpoint = this.deps.workerEndpointRepository.createVirtualEndpoint({
      endpointKey: `virtual:${projectId}:${Date.now().toString(36)}:${sanitizeToken(randomUUID().slice(0, 8))}`,
      displayName: `Virtual ${this.getProviderLabel(cycleProviderType)} Worker`,
      status: "connected",
      transport: "internal",
      capabilities: {
        canSuperviseProjects: true,
        canExecuteTasks: true,
      },
    });

    this.deps.projectWorkerAssignmentService.ensureWorkerAssignment(projectId, endpoint.id);

    try {
      const attentionItem = this.pickNextWorkerAttention(projectId);
      if (attentionItem) {
        await this.handleAttentionItem(endpoint.id, attentionItem, reason);
      }
    } finally {
      this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(projectId, endpoint.id, "virtual_worker_cycle_complete");
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private pickNextWorkerAttention(projectId: string): ProjectAttentionItemRecord | null {
    const nextItem = this.deps.projectAttentionService.listActiveProjectItems(projectId)
      .find((item) => {
        if (item.ownerType !== "worker") {
          return false;
        }
        if (item.status !== "open" && !(item.status === "claimed" && !item.assignedWorkerEndpointId)) {
          return false;
        }

        // Avoid clarification/recovery items already being held in orchestrator-managed automated recovery.
        if (this.isOrchestratorHandledClarificationItem(item)) {
          return false;
        }

        const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);

        if (item.attentionType === "merge_required") {
          return false;
        }

        if (item.attentionType === "merge_conflict") {
          return settings.ciIntelligence.resolveMergeConflicts;
        }

        if (item.attentionType === "ci_fix_required") {
          return settings.ciIntelligence.waitForJulesCiAutofix;
        }

        if (item.attentionType === "action_required") {
          return settings.automationInterventions.autoAnswerClarification || settings.automationInterventions.autoApprovePlan;
        }

        // Default: worker-owned items are handleable unless explicitly excluded above
        return true;
      }) || null;

    if (nextItem && nextItem.status === "open") {
      // Explicitly set the item's status to claimed so subsequent HI queries filter it out
      this.deps.projectAttentionService.resolveItem(nextItem.id, { status: "claimed" } as any);
      nextItem.status = "claimed";
    }

    return nextItem;
  }

  private async handleTaskDispatch(workerEndpointId: string, claim: WorkerTaskDispatchClaim): Promise<void> {
    const settings = this.resolveDashboardSettings(claim.project.id, claim.sprint.id);
    const providerConfigId = settings.workers.virtualWorkerProvider;
    const providerSettings = settings.aiProvider.providers[providerConfigId];
    const provider = providerSettings.provider as Exclude<ProviderId, "jules">;
    const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${claim.dispatch.id}`);
    }

    const task = this.deps.projectManagementRepository.getTask(claim.dispatch.taskId);

    const session = await this.deps.cliWorkflowService.startTask({
      provider,
      providerSettingsOverride: {
        model: resolveWorkerModelForProvider(
          provider,
          task?.model || settings.workers.model,
          providerSettings.model,
        ),
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
        customBaseUrl: providerSettings.customBaseUrl,
        customModel: providerSettings.customModel,
      },
      task: {
        record_id: claim.task.id,
        project_id: claim.project.id,
        sprint_id: claim.sprint.id,
        id: claim.task.taskKey,
        title: claim.task.title,
        prompt: claim.task.promptMarkdown,
        depends_on: [...claim.task.dependsOnTaskIds],
        is_independent: true,
        status: "PENDING",
      },
      repoPath: claim.executionContext.repoPath,
      featureBranch: claim.executionContext.featureBranch,
      sprintNumber: claim.sprint.number ?? 0,
      dispatchId: claim.dispatch.id,
      taskRunId: taskRun.id,
    });
    const pullRequest = extractPullRequest(session);

    this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");
    this.deps.workerTaskDispatchService.updateDispatchForWorker({
      workerEndpointId,
      dispatchId: claim.dispatch.id,
      leaseToken: claim.leaseToken,
      state: "RUNNING",
      provider,
      sessionId: session.id,
      sessionName: session.name,
      workerBranch: pullRequest?.workerBranch || claim.executionContext.featureBranch,
      prUrl: pullRequest?.url,
    });

    while (true) {
      await sleep(VIRTUAL_WORKER_SESSION_POLL_MS);
      this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");

      const currentSession = this.deps.sessionTracking.getSession(session.id) || session;
      const persistedTaskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
      const terminalState = persistedTaskRun?.state === "COMPLETED"
        ? "COMPLETED"
        : persistedTaskRun?.state === "FAILED"
          ? "FAILED"
          : persistedTaskRun?.state === "QUOTA"
            ? "QUOTA"
            : persistedTaskRun?.state === "BLOCKED"
              ? "BLOCKED"
              : resolveTerminalDispatchState(currentSession);
      const currentPullRequest = extractPullRequest(currentSession);
      const update = this.deps.workerTaskDispatchService.updateDispatchForWorker({
        workerEndpointId,
        dispatchId: claim.dispatch.id,
        leaseToken: claim.leaseToken,
        state: terminalState || "RUNNING",
        provider,
        sessionId: currentSession.id,
        sessionName: currentSession.name,
        workerBranch: currentPullRequest?.workerBranch || claim.executionContext.featureBranch,
        prUrl: currentPullRequest?.url,
        summaryMarkdown: terminalState ? this.buildDispatchSummary(claim, currentSession) : undefined,
        errorMessage: terminalState === "FAILED"
          ? `Virtual worker session ended in state ${currentSession.state || "FAILED"}`
          : undefined,
      });

      if (terminalState || update.controlAction === "cancel" || isTerminalSessionState(currentSession.state)) {
        return;
      }
    }
  }

  private buildDispatchSummary(claim: WorkerTaskDispatchClaim, session: JulesSession): string {
    const pullRequest = extractPullRequest(session);
    return [
      `Project: ${claim.project.name}`,
      `Sprint: ${claim.sprint.name}`,
      `Task: ${claim.task.taskKey} ${claim.task.title}`,
      `Worker mode: virtual`,
      `Provider: ${session.provider || "unknown"}`,
      `State: ${session.state || "UNKNOWN"}`,
      pullRequest?.workerBranch ? `Worker branch: ${pullRequest.workerBranch}` : null,
      pullRequest?.url ? `Pull request: ${pullRequest.url}` : null,
    ].filter(Boolean).join("\n");
  }

  private resolveCycleSettings(projectId: string): DashboardSettings {
    const attentionItem = this.deps.projectAttentionService.listActiveProjectItems(projectId)
      .find((item) => item.ownerType === "worker" && this.projectUsesVirtualWorkers(item.projectId, item.sprintId));
    if (attentionItem) {
      return this.resolveDashboardSettings(projectId, attentionItem.sprintId);
    }

    return this.resolveDashboardSettings(projectId);
  }

  private async handleAttentionItem(workerEndpointId: string, item: ProjectAttentionItemRecord, reason: string): Promise<void> {
    // Check if it's an orchestrator-managed clarification recovery item we somehow claimed anyway.
    if (this.isOrchestratorHandledClarificationItem(item)) {
      // Just release it, don't escalate. The orchestrator will handle it.
      return;
    }

    const claimed = item.status === "claimed"
      ? this.deps.projectAttentionService.claimItem(item.id, workerEndpointId, `virtual_worker_reclaimed:${reason}`)
      : this.deps.projectAttentionService.claimItem(item.id, workerEndpointId, `virtual_worker_claimed:${reason}`);
    this.deps.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpointId, "connected");

    if (claimed.attentionType === "merge_conflict" || claimed.attentionType === "merge_required") {
      await this.resolveMergeConflictAttention(workerEndpointId, claimed);
      return;
    }

    if (claimed.attentionType === "ci_fix_required") {
      await this.resolveCiFixAttention(workerEndpointId, claimed);
      return;
    }

    if (claimed.attentionType === "action_required") {
      await this.resolveActionRequiredAttention(workerEndpointId, claimed);
      return;
    }

    this.escalateAttentionToHuman(workerEndpointId, claimed, [
      "Virtual worker cannot handle this worker-owned attention item automatically.",
      "",
      claimed.summaryMarkdown.trim(),
    ].join("\n"));
  }

  private async resolveActionRequiredAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);
    const payload = item.payload || {};
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    const sessionState = typeof payload.sessionState === "string" ? payload.sessionState : null;

    if (!sessionId) {
      this.escalateAttentionToHuman(workerEndpointId, item, "No session ID available for action-required attention.");
      return;
    }

    try {
      if (sessionState === "AWAITING_PLAN_APPROVAL" && settings.automationInterventions.autoApprovePlan) {
        await this.deps.approveSessionPlan(sessionId);
        this.deps.projectAttentionService.resolveItem(item.id, {
          status: "resolved",
          reason: "virtual_worker_auto_approved_plan",
          resolutionSummaryMarkdown: "Virtual worker automatically approved the session plan.",
          workerEndpointId,
        });
        return;
      }

      if (sessionState === "AWAITING_USER_FEEDBACK" && settings.automationInterventions.autoAnswerClarification) {
        const guardrailScope = { projectId: item.projectId, sprintId: item.sprintId };
        const clarificationEval = item.taskId
          ? this.deps.guardrailService?.evaluate(guardrailScope, item.taskId, "clarification_reply") ?? null
          : null;
        if (clarificationEval && !clarificationEval.allowed && clarificationEval.action !== "WARN_ONLY") {
          this.escalateAttentionToHuman(
            workerEndpointId,
            item,
            `Virtual worker reached the clarification auto-answer guardrail (${clarificationEval.count}/${clarificationEval.cap}). Escalating to human.`,
          );
          return;
        }

        const task = this.deps.projectManagementRepository.getTask(item.taskId || "");
        const sprint = this.deps.projectManagementRepository.getSprint(item.sprintId || "");
        if (!task || !sprint) {
          throw new Error("Missing task or sprint context for clarification reply.");
        }

        const subtasks = await this.deps.sprintExecutionStateService.loadSubtasks(item.projectId, item.sprintId || "");

        const reply = await this.deps.workerInboxReplyService.generateClarificationReply({
          projectId: item.projectId,
          sprintGoal: sprint.goal || "",
          subtasks,
          task: task as unknown as Subtask,
        });

        await this.deps.sendSessionMessage(sessionId, reply);
        if (item.taskId) {
          this.deps.guardrailService?.record(guardrailScope, item.taskId, "clarification_reply");
        }

        this.deps.projectAttentionService.resolveItem(item.id, {
          status: "resolved",
          reason: "virtual_worker_auto_answered_clarification",
          resolutionSummaryMarkdown: [
            "Virtual worker automatically answered clarification request.",
            "",
            "Reply:",
            reply,
          ].join("\n"),
          workerEndpointId,
        });
        return;
      }

      this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker cannot handle action-required state: ${sessionState || "unknown"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker failed to handle action-required attention: ${message}`);
    }
  }

  private async resolveMergeConflictAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);
    const guardrailScope = { projectId: item.projectId, sprintId: item.sprintId };
    const mergeConflictEval = item.taskId
      ? this.deps.guardrailService?.evaluate(guardrailScope, item.taskId, "merge_conflict") ?? null
      : null;
    if (mergeConflictEval && !mergeConflictEval.allowed && mergeConflictEval.action !== "WARN_ONLY") {
      this.escalateAttentionToHuman(
        workerEndpointId,
        item,
        `Virtual worker reached the merge-conflict resolution guardrail (${mergeConflictEval.count}/${mergeConflictEval.cap > 0 ? mergeConflictEval.cap : "∞"}). Escalating to human.`,
      );
      return;
    }
    const workerAgent = await this.deps.agentPresetSyncService?.resolveTargetedCodingAgent(
      item.projectId,
      settings.agents?.routing?.mergeConflict?.agentPresetId ?? null,
    ).catch(() => null);
    const route = resolveProviderForInvocation(settings, {
      invocation: "merge_conflict",
      task: {
        id: item.taskId || item.id,
        title: item.title,
        prompt: item.summaryMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"],
      agentProvider: workerAgent
        ? {
          providerConfigId: workerAgent.providerConfigId,
          model: workerAgent.model,
        }
        : null,
    });
    const provider = route.provider as Exclude<ProviderId, "jules">;
    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const payload = item.payload || {};
    const repoPath = this.readRequiredString(payload.repoPath, "repoPath");
    const conflictingBranches = this.asRecord(payload.conflictingBranches);
    const sourceBranchRaw = conflictingBranches?.source ?? payload.workerBranch;
    if (typeof sourceBranchRaw !== "string" || !sourceBranchRaw.trim()) {
      this.escalateAttentionToHuman(
        workerEndpointId,
        item,
        [
          "Virtual worker cannot resolve merge conflict: source branch is not recorded in the attention payload.",
          "This can happen when the Jules session did not return a workerBranch and gitStatus was unavailable when the conflict was detected.",
          "Please resolve the conflict manually or re-trigger the sprint cycle once the GitHub API is reachable.",
          "",
          item.summaryMarkdown.trim(),
        ].join("\n"),
      );
      return;
    }
    const sourceBranch = sourceBranchRaw.trim();
    const targetBranch = this.readRequiredString(conflictingBranches?.target ?? payload.featureBranch, "targetBranch");
    const sessionId = `virtual-merge-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    let worktreePath = this.workspaceManager.buildWorktreePath(repoPath, sessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;
    let initialHead = "";
    const memoryContext = workerAgent?.id
      ? this.buildMemoryContext(item.projectId, item.sprintId || null, workerAgent.id)
      : undefined;
    const memoryInstructions = settings.memory?.enabled && settings.memory.autoCaptureSprint
      ? resolveAgentMemoryInstructions(workerAgent || {}, settings.memory?.workerLearningsInstruction)
      : "";

    this.deps.sessionTracking.createSession({
      id: sessionId,
      provider,
      taskId: buildTaskRunKey(repoPath, 0, `attention-${item.id}`),
      title,
      prompt: item.summaryMarkdown,
      state: "RUNNING",
      featureBranch: sourceBranch,
      workerBranch: sourceBranch,
      repoPath,
    });
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Virtual worker claimed merge conflict between ${sourceBranch} and ${targetBranch}.`,
    });

    let cleanedUp = false;
    const gitAuth: GitHttpAuthOptions = {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    };
    try {
      const effectiveWorkflowSettings = await this.resolveVirtualWorkerWorkflowSettings({
        workflowSettings,
        sessionId,
        repoPath,
        purpose: "merge_conflict",
      });
      const prepared = await this.workspaceManager.prepareWorktree(
        repoPath,
        this.workspaceManager.buildWorktreePath(repoPath, sessionId, effectiveWorkflowSettings.executionMode),
        sourceBranch,
        sourceBranch,
        undefined,
        gitAuth,
      );
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;
      initialHead = (await this.runWorkspaceCommand(finalWorktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();
      const hasConflicts = await this.runMergeIntoSource(finalWorktreePath, targetBranch, sessionId);
      if (hasConflicts) {
        const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
        const providerPrompt = buildProviderPrompt(
          this.buildMergeConflictPrompt(
            item,
            sourceBranch,
            targetBranch,
            workspaceGuidance,
            workerAgent?.instructionMarkdown,
            memoryContext,
            memoryInstructions,
          ),
          providerSettings.thinkingMode,
        );
        await this.runProviderWithRetry({
          provider,
          providerPrompt,
          workflowSettings: effectiveWorkflowSettings,
          repoPath,
          worktreePath: finalWorktreePath,
          sessionId,
          attentionItem: item,
          purpose: "merge_conflict",
          model: providerSettings.model,
          apiKey: providerSettings.apiKey,
          maxConcurrentTasks: providerSettings.maxConcurrentTasks,
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
          githubToken: settings.git.githubToken,
        });
      }
      await this.ensureMergeConflictResolved(finalWorktreePath);
      await this.finalizeMergeCommit(finalWorktreePath, sourceBranch, targetBranch);
      await this.ensureTargetMergedIntoSource(finalWorktreePath, targetBranch);
      if (settings.memory?.enabled && settings.memory.autoCaptureSprint) {
        await this.captureMemoriesFromWorkspace(
          item.projectId,
          item.sprintId || undefined,
          workerAgent?.id || null,
          finalWorktreePath,
          item.id,
        );
      }
      const patchText = await this.workspaceArtifactService.exportBinaryPatch(finalWorktreePath, initialHead);
      const applyResult = await this.workspaceArtifactService.applyPatchToBranch({
        repoPath,
        baseRef: initialHead,
        workerBranch: sourceBranch,
        patchText,
        commitMessage: `fix(merge): resolve ${targetBranch} into ${sourceBranch}`,
        parentRefs: settings.git.githubMode === "LOCAL" ? [targetBranch] : [`origin/${targetBranch}`],
        gitAuth,
        gitIdentity: effectiveWorkflowSettings.containerMountGitConfig
          ? undefined
          : {
            name: effectiveWorkflowSettings.containerGitUserName,
            email: effectiveWorkflowSettings.containerGitUserEmail,
          },
        githubMode: settings.git.githubMode,
      });
      let hasUnpushed = applyResult.hasChanges;
      let hasAhead = applyResult.hasChanges;
      if (!applyResult.hasChanges) {
        hasUnpushed = await this.prService.hasUnpushedCommits(repoPath, sourceBranch, targetBranch);
        hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(repoPath, sourceBranch, targetBranch);
        if (hasUnpushed && settings.git.githubMode !== "LOCAL") {
          const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth);
          await runCommandStrict(
            "git",
            ["push", "-u", "origin", `refs/heads/${sourceBranch}:refs/heads/${sourceBranch}`],
            repoPath,
            pushEnv ?? process.env,
          );
        }
      }
      const headSha = applyResult.commitSha
        || ((hasUnpushed || hasAhead)
          ? (await runCommandStrict("git", ["rev-parse", `refs/heads/${sourceBranch}`], repoPath)).stdout.trim()
          : initialHead);
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: hasUnpushed || applyResult.hasChanges
          ? `Pushed resolved merge conflict to ${sourceBranch} at ${headSha}.`
          : `Resolved merge-conflict run completed on ${sourceBranch} at ${headSha}.`,
      });
      if (item.taskId) {
        this.deps.guardrailService?.record(guardrailScope, item.taskId, "merge_conflict");
      }
      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_merge_conflict_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `Virtual ${this.getProviderLabel(provider)} worker resolved the merge conflict and pushed the updated source branch.`,
          `Source branch: ${sourceBranch}`,
          `Target branch: ${targetBranch}`,
          `Head SHA: ${headSha}`,
        ].join("\n"),
        workerEndpointId,
        payloadPatch: {
          handledBy: "virtual_worker",
          provider,
          sourceBranch,
          targetBranch,
          headSha,
        },
      });
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sessionTracking.updateSession(sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Virtual worker failed to resolve merge conflict: ${message}`,
      });
      this.escalateAttentionToHuman(workerEndpointId, item, [
        `Virtual ${this.getProviderLabel(provider)} worker failed to resolve the merge conflict automatically.`,
        "",
        `Error: ${message}`,
        "",
        item.summaryMarkdown.trim(),
      ].join("\n"));
    } finally {
      // Virtual merge worktrees are ephemeral — always clean up to prevent
      // stale worktree references from poisoning subsequent git fetch operations.
      const shouldCleanup = succeeded
        ? workflowSettings.cleanupWorktreeOnSuccess
        : true;
      if (shouldCleanup) {
        await this.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
        cleanedUp = true;
      }
      if (!cleanedUp) {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Preserved merge-resolution worktree at ${worktreePath}.`,
        });
      }
    }
  }

  private async resolveCiFixAttention(workerEndpointId: string, item: ProjectAttentionItemRecord): Promise<void> {
    const settings = this.resolveDashboardSettings(item.projectId, item.sprintId);
    const workerAgent = await this.deps.agentPresetSyncService?.resolveTargetedCodingAgent(
      item.projectId,
      settings.agents?.routing?.ciFix?.agentPresetId ?? null,
    ).catch(() => null);
    const route = resolveProviderForInvocation(settings, {
      invocation: "ci_fix",
      task: {
        id: item.taskId || item.id,
        title: item.title,
        prompt: item.summaryMarkdown,
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
      providerPool: ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"],
      agentProvider: workerAgent
        ? {
          providerConfigId: workerAgent.providerConfigId,
          model: workerAgent.model,
        }
        : null,
    });
    const provider = route.provider as Exclude<ProviderId, "jules">;
    const providerConfigId = route.providerConfigId || route.provider;
    const providerSettings = route.providers[providerConfigId];
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const payload = item.payload || {};
    const repoPath = this.readRequiredString(payload.repoPath, "repoPath");
    const branchName = this.readRequiredString(
      payload.workerBranch ?? payload.branchName,
      "branchName",
    );
    const compareBaseBranch = typeof payload.featureBranch === "string" && payload.featureBranch.trim().length > 0
      ? payload.featureBranch.trim()
      : (settings.git.defaultBranch || "main");

    const guardrailScope = { projectId: item.projectId, sprintId: item.sprintId };
    const ciFixEval = item.taskId
      ? this.deps.guardrailService?.evaluate(guardrailScope, item.taskId, "ci_fix") ?? null
      : null;
    const retryCount = ciFixEval?.count ?? 0;
    const maxRetries = ciFixEval?.cap ?? 0;
    const capLabel = maxRetries > 0 ? String(maxRetries) : "∞";

    if (ciFixEval && !ciFixEval.allowed && ciFixEval.action !== "WARN_ONLY") {
      this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker reached the CI autofix guardrail (${retryCount}/${capLabel}). Escalating to human.`);
      return;
    }

    const sessionId = `virtual-cifix-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    const resumeTarget = this.deps.sessionTracking.findLatestCliSessionForBranch({
      repoPath,
      workerBranch: branchName,
      providers: [provider],
    });
    const workspaceOwnerSessionId = resumeTarget?.sessionId || sessionId;
    let worktreePath = this.workspaceManager.buildWorkspaceRef(repoPath, workspaceOwnerSessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;
    let initialHead = "";
    const memoryContext = workerAgent?.id
      ? this.buildMemoryContext(item.projectId, item.sprintId || null, workerAgent.id)
      : undefined;
    const memoryInstructions = settings.memory?.enabled && settings.memory.autoCaptureSprint
      ? resolveAgentMemoryInstructions(workerAgent || {}, settings.memory?.workerLearningsInstruction)
      : "";

    this.deps.sessionTracking.createSession({
      id: sessionId,
      provider,
      taskId: buildTaskRunKey(repoPath, 0, `attention-${item.id}`),
      title,
      prompt: item.summaryMarkdown,
      state: "RUNNING",
      featureBranch: branchName,
      workerBranch: branchName,
      repoPath,
    });
    this.deps.sessionTracking.appendActivity(sessionId, {
      originator: "system",
      description: `Virtual worker claimed CI fix for branch ${branchName} (Attempt ${retryCount + 1}/${maxRetries}).`,
    });

    let cleanedUp = false;
    const gitAuth: GitHttpAuthOptions = {
      githubToken: settings.git.githubToken,
      gitlabToken: settings.git.gitlabToken,
    };
    try {
      const effectiveWorkflowSettings = await this.resolveVirtualWorkerWorkflowSettings({
        workflowSettings,
        sessionId,
        repoPath,
        purpose: "ci_fix",
      });
      const prepared = await this.workspaceManager.prepareWorktree(
        repoPath,
        this.workspaceManager.buildWorkspaceRef(repoPath, workspaceOwnerSessionId, effectiveWorkflowSettings.executionMode),
        branchName,
        branchName,
        resumeTarget?.sessionId,
        gitAuth,
      );
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;
      initialHead = (await this.runWorkspaceCommand(finalWorktreePath, "git", ["rev-parse", "HEAD"])).stdout.trim();

      const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
      const providerPrompt = buildProviderPrompt(
        this.buildCiFixPrompt(
          item,
          branchName,
          workspaceGuidance,
          workerAgent?.instructionMarkdown,
          memoryContext,
          memoryInstructions,
        ),
        providerSettings.thinkingMode,
      );
      await this.runProviderWithRetry({
        provider,
        providerPrompt,
        workflowSettings: effectiveWorkflowSettings,
        repoPath,
        worktreePath: finalWorktreePath,
        sessionId,
        attentionItem: item,
        purpose: "ci_fix",
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        maxConcurrentTasks: providerSettings.maxConcurrentTasks,
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
        githubToken: settings.git.githubToken,
      });

      if (settings.memory?.enabled && settings.memory.autoCaptureSprint) {
        await this.captureMemoriesFromWorkspace(
          item.projectId,
          item.sprintId || undefined,
          workerAgent?.id || null,
          finalWorktreePath,
          item.id,
        );
      }

      const patchText = await this.workspaceArtifactService.exportBinaryPatch(finalWorktreePath, initialHead);
      const applyResult = await this.workspaceArtifactService.applyPatchToBranch({
        repoPath,
        baseRef: initialHead,
        workerBranch: branchName,
        patchText,
        commitMessage: `fix(ci): resolve failing checks on ${branchName}`,
        gitAuth,
        gitIdentity: effectiveWorkflowSettings.containerMountGitConfig
          ? undefined
          : {
            name: effectiveWorkflowSettings.containerGitUserName,
            email: effectiveWorkflowSettings.containerGitUserEmail,
          },
        githubMode: settings.git.githubMode,
      });
      let hasUnpushed = applyResult.hasChanges;
      let hasAhead = applyResult.hasChanges;
      if (!applyResult.hasChanges) {
        hasUnpushed = await this.prService.hasUnpushedCommits(repoPath, branchName, compareBaseBranch);
        hasAhead = await this.prService.hasWorkerBranchCommitsAgainstFeature(repoPath, branchName, compareBaseBranch);
        if (hasUnpushed && settings.git.githubMode !== "LOCAL") {
          const pushEnv = await buildGitHttpAuthEnvForRepoWithFallbacks(repoPath, gitAuth);
          await runCommandStrict(
            "git",
            ["push", "-u", "origin", `refs/heads/${branchName}:refs/heads/${branchName}`],
            repoPath,
            pushEnv ?? process.env,
          );
        }
      }
      const headSha = applyResult.commitSha
        || ((hasUnpushed || hasAhead)
          ? (await runCommandStrict("git", ["rev-parse", `refs/heads/${branchName}`], repoPath)).stdout.trim()
          : initialHead);
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: hasUnpushed || applyResult.hasChanges
          ? `Pushed CI fix to ${branchName} at ${headSha}.`
          : `CI fix run completed on ${branchName} at ${headSha}.`,
      });

      if (item.taskId) {
        this.deps.guardrailService?.record(guardrailScope, item.taskId, "ci_fix");
      }

      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_ci_fix_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `Virtual ${this.getProviderLabel(provider)} worker fixed CI issues and pushed the updated branch.`,
          `Branch: ${branchName}`,
          `Head SHA: ${headSha}`,
          `Attempt: ${retryCount + 1}/${capLabel}`,
        ].join("\n"),
        workerEndpointId,
        payloadPatch: {
          handledBy: "virtual_worker",
          provider,
          branchName,
          headSha,
          attempt: retryCount + 1,
        },
      });
      succeeded = true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.sessionTracking.updateSession(sessionId, { state: "FAILED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Virtual worker failed to fix CI issues: ${message}`,
      });
      this.escalateAttentionToHuman(workerEndpointId, item, [
        `Virtual ${this.getProviderLabel(provider)} worker failed to fix CI issues automatically.`,
        "",
        `Error: ${message}`,
        "",
        item.summaryMarkdown.trim(),
      ].join("\n"));
    } finally {
      const shouldCleanup = succeeded
        ? workflowSettings.cleanupWorktreeOnSuccess
        : true;
      if (shouldCleanup) {
        await this.workspaceManager.removeWorktree(repoPath, worktreePath).catch(() => undefined);
        cleanedUp = true;
      }
      if (!cleanedUp) {
        this.deps.sessionTracking.appendActivity(sessionId, {
          originator: "system",
          description: `Preserved CI-fix worktree at ${worktreePath}.`,
        });
      }
    }
  }

  private async resolveVirtualWorkerWorkflowSettings(args: {
    workflowSettings: CliWorkflowSettings;
    sessionId: string;
    repoPath: string;
    purpose: "ci_fix" | "merge_conflict";
  }): Promise<CliWorkflowSettings> {
    if (args.workflowSettings.executionMode !== "DOCKER") {
      return args.workflowSettings;
    }

    const dockerAvailable = await this.dockerService.isAvailable();
    if (dockerAvailable) {
      return args.workflowSettings;
    }

    if (args.purpose === "merge_conflict") {
      throw new Error(
        "Docker is unavailable, and merge-conflict resolution requires isolated container execution. Fix Docker availability and retry.",
      );
    }

    this.deps.sessionTracking.appendActivity(args.sessionId, {
      originator: "system",
      description: "Docker is unavailable. Falling back to HOST execution mode for virtual worker CI autofix.",
    });
    return {
      ...args.workflowSettings,
      executionMode: "HOST",
    };
  }

  private buildCiFixPrompt(
    item: ProjectAttentionItemRecord,
    branchName: string,
    workspaceGuidance: string,
    workerInstruction?: string,
    memoryContext?: string,
    memoryInstructions?: string,
  ): string {
    const payload = item.payload || {};
    const failedChecks = Array.isArray(payload.failedChecks) ? payload.failedChecks as string[] : [];
    const failedJobLabels = Array.isArray(payload.failedJobLabels) ? payload.failedJobLabels as string[] : [];
    const failedLogSnippets = Array.isArray(payload.failedLogSnippets) ? payload.failedLogSnippets as string[] : [];
    const prUrl = typeof payload.prUrl === "string" ? payload.prUrl : "";
    const prNumber = typeof payload.prNumber === "number" ? payload.prNumber : 0;
    const taskPrompt = typeof payload.taskPrompt === "string" ? payload.taskPrompt.trim() : "";

    return [
      `CI checks have failed for PR #${prNumber} on branch \`${branchName}\`.`,
      workerInstruction?.trim() ? `## Agent Instructions\n\n${workerInstruction.trim()}` : null,
      prUrl ? `PR URL: ${prUrl}` : null,
      "",
      memoryContext?.trim() || null,
      "",
      "Failed checks: " + (failedChecks.length > 0 ? failedChecks.join(", ") : "unknown"),
      failedJobLabels.length > 0 ? "Failed jobs: " + failedJobLabels.join(", ") : null,
      "",
      "Requirements:",
      "- Investigate the CI failures and fix the root cause.",
      "- Commit the necessary changes and leave the branch in a pushable state.",
      "- Do not open a new pull request or rewrite history.",
      "- Continue until the issues causing CI failures are resolved.",
      "",
      failedLogSnippets.length > 0
        ? "Failed job logs (excerpt):\n" + failedLogSnippets.join("\n\n")
        : "Failed job logs were not available from CI metadata. Use `gh run view <run-id> --log-failed` to fetch logs.",
      "",
      taskPrompt ? "Original task prompt:\n" + taskPrompt : null,
      "",
      "## LEARNINGS CAPTURE (Required)",
      memoryInstructions?.trim()
        || `Before you finish, write key durable learnings and pitfalls from this CI fix to \`${LEARNINGS_FILENAME}\`.`,
      "",
      "Original attention summary:",
      item.summaryMarkdown.trim(),
      "",
      workspaceGuidance,
    ].filter(Boolean).join("\n");
  }

  private async runMergeIntoSource(worktreePath: string, targetBranch: string, sessionId: string): Promise<boolean> {
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["merge", "--no-ff", "--no-commit", `origin/${targetBranch}`]);
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Prepared merge of origin/${targetBranch} into the source branch without conflicts.`,
      });
      return false;
    } catch (error) {
      const unresolved = await this.listUnresolvedFiles(worktreePath);
      if (unresolved.length === 0) {
        throw error;
      }
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Merge produced conflicts in: ${unresolved.join(", ")}`,
      });
      return true;
    }
  }

  private async runProviderWithRetry(args: {
    provider: Exclude<ProviderId, "jules">;
    providerPrompt: string;
    workflowSettings: DashboardSettings["cliWorkflow"];
    repoPath: string;
    worktreePath: string;
    sessionId: string;
    attentionItem: ProjectAttentionItemRecord;
    purpose: "ci_fix" | "merge_conflict";
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
    githubToken: string;
  }): Promise<void> {
    const result = await this.providerExecutionService.executeProvider({
      projectId: args.attentionItem.projectId,
      sprintId: args.attentionItem.sprintId,
      taskId: args.attentionItem.taskId,
      sprintRunId: args.attentionItem.sprintRunId,
      dispatchId: args.attentionItem.dispatchId,
      attentionItemId: args.attentionItem.id,
      purpose: args.purpose,
      type: args.purpose,
      provider: args.provider,
      prompt: args.providerPrompt,
      cwd: args.worktreePath,
      model: args.model,
      apiKey: args.apiKey,
      maxConcurrentTasks: args.maxConcurrentTasks,
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
      workflowSettings: args.workflowSettings,
      repoPath: args.repoPath,
      githubToken: args.githubToken,
    });

    if (!result.ok) {
      throw new Error(result.stderr || result.stdout || "Provider failed without output.");
    }
  }

  private async ensureMergeConflictResolved(worktreePath: string): Promise<void> {
    const unresolved = await this.listUnresolvedFiles(worktreePath);
    if (unresolved.length > 0) {
      throw new Error(`Unresolved merge conflicts remain: ${unresolved.join(", ")}`);
    }
  }

  private async listUnresolvedFiles(worktreePath: string): Promise<string[]> {
    const result = await this.runWorkspaceCommand(worktreePath, "git", ["diff", "--name-only", "--diff-filter=U"]);
    return result.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
  }

  private async finalizeMergeCommit(worktreePath: string, sourceBranch: string, targetBranch: string): Promise<void> {
    const mergeHead = await this.hasMergeHead(worktreePath);
    const status = (await this.runWorkspaceCommand(worktreePath, "git", ["status", "--porcelain"])).stdout.trim();
    if (!mergeHead && status.length === 0) {
      return;
    }

    await this.runWorkspaceCommand(worktreePath, "git", ["add", "-A"]);
    try {
      await this.runWorkspaceCommand(
        worktreePath,
        "git",
        ["commit", "-m", `Resolve merge conflict: ${targetBranch} into ${sourceBranch}`],
      );
    } catch (error) {
      const nextStatus = (await this.runWorkspaceCommand(worktreePath, "git", ["status", "--porcelain"])).stdout.trim();
      if (nextStatus.length > 0 || await this.hasMergeHead(worktreePath)) {
        throw error;
      }
    }
  }

  private async ensureTargetMergedIntoSource(worktreePath: string, targetBranch: string): Promise<void> {
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["merge-base", "--is-ancestor", `origin/${targetBranch}`, "HEAD"]);
    } catch {
      throw new Error(`Merge verification failed: origin/${targetBranch} is not contained in the resolved source branch.`);
    }
  }

  private async hasMergeHead(worktreePath: string): Promise<boolean> {
    try {
      await this.runWorkspaceCommand(worktreePath, "git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"]);
      return true;
    } catch {
      return false;
    }
  }

  private buildMergeConflictPrompt(
    item: ProjectAttentionItemRecord,
    sourceBranch: string,
    targetBranch: string,
    workspaceGuidance: string,
    workerInstruction?: string,
    memoryContext?: string,
    memoryInstructions?: string,
  ): string {
    const payload = item.payload || {};
    const mergedTaskPrompts = this.extractMergeConflictTaskPrompts(
      Array.isArray(payload.mergedTaskPrompts)
        ? payload.mergedTaskPrompts
        : Array.isArray(payload.featureBranchTaskContexts)
          ? payload.featureBranchTaskContexts
          : [],
    );
    const currentTaskPrompt = this.extractCurrentTaskPrompt(payload);

    return [
      "Resolve the active Git merge conflict already present in this worktree.",
      workerInstruction?.trim() ? `## Agent Instructions\n\n${workerInstruction.trim()}` : null,
      `Source branch: ${sourceBranch}`,
      `Target branch: ${targetBranch}`,
      "",
      memoryContext?.trim() || null,
      "",
      "Requirements:",
      "- Preserve the intended work from both branches.",
      "- Resolve only the conflict and any directly related fallout.",
      "- Leave the branch in a clean, committed, pushable state.",
      "- Do not open a new pull request or rewrite history.",
      "",
      currentTaskPrompt ? "Current task prompt:" : null,
      currentTaskPrompt || null,
      mergedTaskPrompts.length > 0 ? "\nMerged task prompts already present on the target branch:" : null,
      mergedTaskPrompts.length > 0 ? mergedTaskPrompts.join("\n\n") : null,
      "",
      "## LEARNINGS CAPTURE (Required)",
      memoryInstructions?.trim()
        || `Before you finish, write key durable learnings and pitfalls from this merge-conflict resolution to \`${LEARNINGS_FILENAME}\`.`,
      "",
      "Original attention summary:",
      item.summaryMarkdown.trim(),
      "",
      workspaceGuidance,
    ].filter(Boolean).join("\n");
  }

  private extractCurrentTaskPrompt(payload: Record<string, unknown>): string {
    if (typeof payload.currentTaskPrompt === "string" && payload.currentTaskPrompt.trim()) {
      return payload.currentTaskPrompt.trim();
    }

    const currentTask = this.asRecord(payload.currentTask);
    if (typeof currentTask?.taskPrompt === "string" && currentTask.taskPrompt.trim()) {
      return currentTask.taskPrompt.trim();
    }

    if (typeof payload.taskPrompt === "string" && payload.taskPrompt.trim()) {
      return payload.taskPrompt.trim();
    }

    return "";
  }

  private extractMergeConflictTaskPrompts(entries: unknown[]): string[] {
    return entries
      .map((entry) => this.asRecord(entry))
      .filter((entry): entry is Record<string, unknown> => Boolean(entry))
      .map((entry) => {
        const taskKey = typeof entry.taskKey === "string" ? entry.taskKey : "task";
        const title = typeof entry.taskTitle === "string"
          ? entry.taskTitle
          : typeof entry.title === "string"
            ? entry.title
            : taskKey;
        const prompt = typeof entry.taskPrompt === "string"
          ? entry.taskPrompt
          : typeof entry.prompt === "string"
            ? entry.prompt
            : "";
        return `${taskKey} ${title}\n\n${prompt}`.trim();
      })
      .filter(Boolean);
  }

  private escalateAttentionToHuman(workerEndpointId: string, item: ProjectAttentionItemRecord, summaryMarkdown: string): void {
    this.deps.projectAttentionService.openItem({
      projectId: item.projectId,
      sprintId: item.sprintId,
      taskId: item.taskId,
      sprintRunId: item.sprintRunId,
      dispatchId: item.dispatchId,
      attentionType: "human_escalation_required",
      severity: item.severity,
      ownerType: "human",
      title: `Virtual worker escalation: ${item.title}`,
      summaryMarkdown,
      payload: {
        ...(item.payload || {}),
        sourceAttentionItemId: item.id,
        sourceAttentionType: item.attentionType,
        escalatedBy: "virtual_worker",
      },
    });
    this.deps.projectAttentionService.resolveItem(item.id, {
      status: "resolved",
      reason: "virtual_worker_escalated",
      resolutionSummaryMarkdown: summaryMarkdown,
      workerEndpointId,
      payloadPatch: {
        workerOutcome: "needs_human_escalation",
      },
    });
  }

  private cleanupOrphanedVirtualWorkers(): void {
    const orphaned = this.deps.workerEndpointRepository.listWorkerEndpoints()
      .filter((endpoint) => endpoint.endpointType === "virtual_cli");

    for (const endpoint of orphaned) {
      for (const assignment of this.deps.projectWorkerAssignmentRepository.listActiveAssignmentsForWorker(endpoint.id)) {
        this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(assignment.projectId, endpoint.id, "virtual_worker_startup_prune");
      }
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private getProviderLabel(provider: ProviderId): string {
    switch (provider) {
      case "claude-code":
        return "Claude Code";
      case "qwen-code":
        return "Qwen Code";
      case "opencode":
        return "OpenCode";
      case "gemini":
        return "Gemini";
      case "codex":
      default:
        return "Codex";
    }
  }

  private readRequiredString(value: unknown, label: string): string {
    const normalized = typeof value === "string" ? value.trim() : "";
    if (!normalized) {
      throw new Error(`Missing ${label} in virtual worker attention payload.`);
    }
    return normalized;
  }

  private asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  }

  private buildMemoryContext(projectId: string, sprintId: string | null, agentPresetId: string): string | undefined {
    const memoryService = this.deps.memoryService;
    if (!memoryService) {
      return undefined;
    }

    try {
      const longTerm = memoryService.listLongTermByAgent(projectId, agentPresetId, 10);
      const shortTerm = sprintId
        ? memoryService.listBySprintAndAgent(projectId, sprintId, agentPresetId, 10)
        : [];

      if (longTerm.length === 0 && shortTerm.length === 0) {
        return undefined;
      }

      const sections: string[] = ["## PROJECT CONTEXT FROM MEMORY"];
      if (longTerm.length > 0) {
        sections.push("### Long-Term Knowledge");
        for (const memory of longTerm) {
          sections.push(`- [${memory.category}] ${memory.content.slice(0, 300)}`);
        }
      }
      if (shortTerm.length > 0) {
        sections.push("### Recent Sprint Learnings");
        for (const memory of shortTerm) {
          sections.push(`- [${memory.category}] ${memory.content.slice(0, 300)}`);
        }
      }
      return sections.join("\n");
    } catch {
      return undefined;
    }
  }

  private async captureMemoriesFromWorkspace(
    projectId: string,
    sprintId: string | undefined,
    agentPresetId: string | null,
    worktreePath: string,
    originId: string,
  ): Promise<number> {
    if (!this.deps.memoryService) {
      return 0;
    }
    if (worktreePath.startsWith("docker-volume://")) {
      const raw = await this.workspaceManager.readWorkspaceFile(worktreePath, LEARNINGS_FILENAME);
      if (!raw) {
        return 0;
      }
      return await this.deps.memoryService.captureMemoriesFromContent(
        projectId,
        sprintId,
        agentPresetId,
        raw,
        originId,
      );
    }
    return await this.deps.memoryService.captureMemoriesFromWorktree(
      projectId,
      sprintId,
      agentPresetId,
      worktreePath,
      originId,
    );
  }

  private async runWorkspaceCommand(worktreePath: string, command: string, args: string[]) {
    if (worktreePath.startsWith("docker-volume://")) {
      return this.workspaceManager.runWorkspaceCommand(worktreePath, command, args);
    }
    return runCommandStrict(command, args, worktreePath);
  }
}
