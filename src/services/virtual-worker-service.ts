import { randomUUID } from "crypto";
import type { DashboardSettings, JulesSession, WorkerExecutionMode, Subtask } from "../contracts/app-types.js";
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
import { ProviderRunner } from "../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../infrastructure/providers/cli/docker-runner.js";
import { ProviderExecutionService } from "./provider-execution-service.js";
import { runCommandStrict } from "./cli-process-runner.js";
import { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { WorkerTaskDispatchService } from "./worker-task-dispatch-service.js";
import { CliWorkflowService } from "./cli-workflow-service.js";
import { resolveProviderForInvocation } from "./provider-routing.js";
import type { WorkerInboxReplyService } from "./worker-inbox-reply-service.js";
import type { InstructionService } from "../instructions/instruction-template-service.js";
import type { SprintExecutionStateService } from "./sprint-execution-state-service.js";

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
  workerTaskDispatchService: WorkerTaskDispatchService;
  cliWorkflowService: CliWorkflowService;
  sprintExecutionStateService: SprintExecutionStateService;
  workerInboxReplyService: WorkerInboxReplyService;
  instructionService: InstructionService;
  approveSessionPlan: (sessionId: string) => Promise<unknown>;
  sendSessionMessage: (sessionId: string, prompt: string) => Promise<unknown>;
  logger?: Logger;
}

export class VirtualWorkerService {
  private readonly workspaceManager = new WorkspaceManager();

  private readonly providerRunner = new ProviderRunner(new DockerRunner());

  private readonly activeCycles = new Map<string, Promise<void>>();

  private readonly scheduledProjects = new Set<string>();

  private reconcileTimer: ReturnType<typeof setInterval> | null = null;

  private readonly ciAutofixRetryCounts = new Map<string, number>();
  private readonly clarificationRetryCounts = new Map<string, number>();

  private readonly providerExecutionService: ProviderExecutionService;

  constructor(private readonly deps: VirtualWorkerServiceDependencies) {
    this.providerExecutionService = new ProviderExecutionService({
      executionRepository: deps.executionRepository,
      providerRunner: this.providerRunner,
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
    if (sprintId) {
      return this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode;
    }
    return this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings.workers.executionMode;
  }

  private resolveDashboardSettings(projectId: string, sprintId?: string | null): DashboardSettings {
    if (sprintId) {
      return this.deps.settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings;
    }
    return this.deps.settingsRepository.resolveProjectDashboardSettings(projectId).settings;
  }

  private projectNeedsVirtualWorker(projectId: string): boolean {
    if (!this.projectUsesVirtualWorkers(projectId)) {
      return false;
    }
    if (this.activeCycles.has(projectId)) {
      return false;
    }

    const pickableAttention = this.pickNextWorkerAttention(projectId);
    if (pickableAttention) {
      return true;
    }

    const pickableDispatch = this.deps.executionRepository.listTaskDispatches({ projectId })
      .some((dispatch) => (
        dispatch.executorType === "mcp_worker"
        && dispatch.status === "queued"
        && this.projectUsesVirtualWorkers(dispatch.projectId, dispatch.sprintId)
      ));

    return pickableDispatch;
  }

  private async runProjectCycle(projectId: string, reason: string): Promise<void> {
    const cycleSettings = this.resolveCycleSettings(projectId);
    const endpoint = this.deps.workerEndpointRepository.createVirtualEndpoint({
      endpointKey: `virtual:${projectId}:${Date.now().toString(36)}:${sanitizeToken(randomUUID().slice(0, 8))}`,
      displayName: `Virtual ${this.getProviderLabel(cycleSettings.workers.virtualWorkerProvider)} Worker`,
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
        return;
      }

      const dispatchClaim = this.deps.workerTaskDispatchService.claimNextDispatchForWorker({
        projectId,
        workerEndpointId: endpoint.id,
        executionMode: "VIRTUAL",
        ownerKey: endpoint.endpointKey,
      });
      if (dispatchClaim) {
        await this.handleTaskDispatch(endpoint.id, dispatchClaim);
      }
    } finally {
      this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(projectId, endpoint.id, "virtual_worker_cycle_complete");
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private pickNextWorkerAttention(projectId: string): ProjectAttentionItemRecord | null {
    return this.deps.projectAttentionService.listActiveProjectItems(projectId)
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
  }

  private async handleTaskDispatch(workerEndpointId: string, claim: WorkerTaskDispatchClaim): Promise<void> {
    const settings = this.resolveDashboardSettings(claim.project.id, claim.sprint.id);
    const provider = settings.workers.virtualWorkerProvider;
    const providerSettings = settings.aiProvider.providers[provider];
    const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${claim.dispatch.id}`);
    }

    const session = await this.deps.cliWorkflowService.startTask({
      provider,
      providerSettingsOverride: {
        model: settings.workers.model && settings.workers.model !== "default"
          ? settings.workers.model
          : providerSettings.model,
        thinkingMode: providerSettings.thinkingMode,
        apiKey: providerSettings.apiKey,
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

    const queuedDispatch = this.deps.executionRepository.listTaskDispatches({ projectId })
      .find((dispatch) => dispatch.executorType === "mcp_worker" && dispatch.status === "queued" && this.projectUsesVirtualWorkers(dispatch.projectId, dispatch.sprintId));
    if (queuedDispatch) {
      return this.resolveDashboardSettings(projectId, queuedDispatch.sprintId);
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
        const retryKey = item.taskId || item.id;
        const retryCount = this.clarificationRetryCounts.get(retryKey) || 0;
        const maxRetries = 3; // Policy: 3 auto-answers before escalation

        if (retryCount >= maxRetries) {
          this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker reached maximum clarification auto-answers (${maxRetries}). Escalating to human.`);
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
        this.clarificationRetryCounts.set(retryKey, retryCount + 1);

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
      providerPool: ["gemini", "codex", "claude-code"],
    });
    const provider = route.provider as DashboardSettings["workers"]["virtualWorkerProvider"];
    const providerSettings = route.providers[provider];
    const workflowSettings = {
      ...DEFAULT_CLI_WORKFLOW_SETTINGS,
      ...settings.cliWorkflow,
    };
    const payload = item.payload || {};
    const repoPath = this.readRequiredString(payload.repoPath, "repoPath");
    const conflictingBranches = this.asRecord(payload.conflictingBranches);
    const sourceBranch = this.readRequiredString(conflictingBranches?.source ?? payload.workerBranch, "sourceBranch");
    const targetBranch = this.readRequiredString(conflictingBranches?.target ?? payload.featureBranch, "targetBranch");
    const sessionId = `virtual-merge-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    let worktreePath = this.workspaceManager.buildWorktreePath(repoPath, sessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;

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
    try {
      const prepared = await this.workspaceManager.prepareWorktree(repoPath, worktreePath, sourceBranch, sourceBranch);
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;
      const hasConflicts = await this.runMergeIntoSource(finalWorktreePath, targetBranch, sessionId);
      if (hasConflicts) {
        const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
        const providerPrompt = buildProviderPrompt(this.buildMergeConflictPrompt(item, sourceBranch, targetBranch, workspaceGuidance), providerSettings.thinkingMode);
        await this.runProviderWithRetry({
          provider,
          providerPrompt,
          workflowSettings,
          repoPath,
          worktreePath: finalWorktreePath,
        sessionId,
        attentionItem: item,
        purpose: "merge_conflict",
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        githubToken: settings.git.githubToken,
      });
      }
      await this.ensureMergeConflictResolved(finalWorktreePath);
      await this.finalizeMergeCommit(finalWorktreePath, sourceBranch, targetBranch);
      await runCommandStrict("git", ["push", "origin", `HEAD:${sourceBranch}`], finalWorktreePath);

      const headSha = (await runCommandStrict("git", ["rev-parse", "HEAD"], finalWorktreePath)).stdout.trim();
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Pushed resolved merge conflict to ${sourceBranch} at ${headSha}.`,
      });
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
      providerPool: ["gemini", "codex", "claude-code"],
    });
    const provider = route.provider as DashboardSettings["workers"]["virtualWorkerProvider"];
    const providerSettings = route.providers[provider];
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

    const retryKey = item.taskId || item.id;
    const retryCount = this.ciAutofixRetryCounts.get(retryKey) || 0;
    const maxRetries = settings.ciIntelligence.julesCiAutofixMaxRetries || 3;

    if (retryCount >= maxRetries) {
      this.escalateAttentionToHuman(workerEndpointId, item, `Virtual worker reached maximum CI autofix retries (${maxRetries}). Escalating to human.`);
      return;
    }

    const sessionId = `virtual-cifix-${provider}-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
    let worktreePath = this.workspaceManager.buildWorktreePath(repoPath, sessionId, workflowSettings.executionMode);
    const title = item.title;
    let succeeded = false;

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
    try {
      const prepared = await this.workspaceManager.prepareWorktree(repoPath, worktreePath, branchName, branchName);
      const finalWorktreePath = prepared.worktreePath;
      worktreePath = finalWorktreePath;

      const workspaceGuidance = await this.workspaceManager.buildWorkspaceGuidance(item.summaryMarkdown, finalWorktreePath);
      const providerPrompt = buildProviderPrompt(this.buildCiFixPrompt(item, branchName, workspaceGuidance), providerSettings.thinkingMode);
      await this.runProviderWithRetry({
        provider,
        providerPrompt,
        workflowSettings,
        repoPath,
        worktreePath: finalWorktreePath,
        sessionId,
        attentionItem: item,
        purpose: "ci_fix",
        model: providerSettings.model,
        apiKey: providerSettings.apiKey,
        githubToken: settings.git.githubToken,
      });

      await runCommandStrict("git", ["push", "origin", `HEAD:${branchName}`], finalWorktreePath);

      const headSha = (await runCommandStrict("git", ["rev-parse", "HEAD"], finalWorktreePath)).stdout.trim();
      this.deps.sessionTracking.updateSession(sessionId, { state: "COMPLETED" });
      this.deps.sessionTracking.appendActivity(sessionId, {
        originator: "system",
        description: `Pushed CI fix to ${branchName} at ${headSha}.`,
      });

      this.ciAutofixRetryCounts.set(retryKey, retryCount + 1);

      this.deps.projectAttentionService.resolveItem(item.id, {
        status: "resolved",
        reason: "virtual_worker_ci_fix_resolved",
        resolutionSummaryMarkdown: [
          item.summaryMarkdown.trim(),
          "",
          `Virtual ${this.getProviderLabel(provider)} worker fixed CI issues and pushed the updated branch.`,
          `Branch: ${branchName}`,
          `Head SHA: ${headSha}`,
          `Attempt: ${retryCount + 1}/${maxRetries}`,
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

  private buildCiFixPrompt(
    item: ProjectAttentionItemRecord,
    branchName: string,
    workspaceGuidance: string,
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
      prUrl ? `PR URL: ${prUrl}` : null,
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
      "Original attention summary:",
      item.summaryMarkdown.trim(),
      "",
      workspaceGuidance,
    ].filter(Boolean).join("\n");
  }

  private async runMergeIntoSource(worktreePath: string, targetBranch: string, sessionId: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["merge", "--no-ff", "--no-commit", `origin/${targetBranch}`], worktreePath);
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
    provider: DashboardSettings["workers"]["virtualWorkerProvider"];
    providerPrompt: string;
    workflowSettings: DashboardSettings["cliWorkflow"];
    repoPath: string;
    worktreePath: string;
    sessionId: string;
    attentionItem: ProjectAttentionItemRecord;
    purpose: "ci_fix" | "merge_conflict";
    model: string;
    apiKey: string;
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
    const result = await runCommandStrict("git", ["diff", "--name-only", "--diff-filter=U"], worktreePath);
    return result.stdout.split("\n").map((entry) => entry.trim()).filter(Boolean);
  }

  private async finalizeMergeCommit(worktreePath: string, sourceBranch: string, targetBranch: string): Promise<void> {
    const mergeHead = await this.hasMergeHead(worktreePath);
    const status = (await runCommandStrict("git", ["status", "--porcelain"], worktreePath)).stdout.trim();
    if (!mergeHead && status.length === 0) {
      return;
    }

    await runCommandStrict("git", ["add", "-A"], worktreePath);
    try {
      await runCommandStrict(
        "git",
        ["commit", "-m", `Resolve merge conflict: ${targetBranch} into ${sourceBranch}`],
        worktreePath,
      );
    } catch (error) {
      const nextStatus = (await runCommandStrict("git", ["status", "--porcelain"], worktreePath)).stdout.trim();
      if (nextStatus.length > 0 || await this.hasMergeHead(worktreePath)) {
        throw error;
      }
    }
  }

  private async hasMergeHead(worktreePath: string): Promise<boolean> {
    try {
      await runCommandStrict("git", ["rev-parse", "-q", "--verify", "MERGE_HEAD"], worktreePath);
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
      `Source branch: ${sourceBranch}`,
      `Target branch: ${targetBranch}`,
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

  private getProviderLabel(provider: DashboardSettings["workers"]["virtualWorkerProvider"]): string {
    switch (provider) {
      case "claude-code":
        return "Claude Code";
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
}
