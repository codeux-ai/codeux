import type { DashboardSettings, JulesSession, ProviderId } from "../../contracts/app-types.js";
import type { WorkerTaskDispatchClaim } from "../../contracts/execution-types.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { WorkerEndpointRepository } from "../../repositories/worker-endpoint-repository.js";
import type { SessionTrackingRepository } from "../../repositories/session-tracking-repository.js";
import type { CliWorkflowService } from "../cli-workflow-service.js";
import type { WorkerTaskDispatchService } from "../worker-task-dispatch-service.js";
import { resolveWorkerModelForProvider } from "../provider-routing.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ProjectWorkerAssignmentService } from "../../domain/workers/project-worker-assignment-service.js";
import type { Logger } from "../../shared/logging/logger.js";
import { sanitizeToken } from "../cli-workflow-utils.js";
import { randomUUID } from "crypto";

const VIRTUAL_WORKER_SESSION_POLL_MS = 2_000;

export function sleep(ms: number): Promise<void> {
  if (ms <= 0) {
    return Promise.resolve();
  }
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isTerminalSessionState(state: string | undefined): boolean {
  return state === "COMPLETED" || state === "FAILED" || state === "CANCELLED" || state === "QUOTA" || state === "RATE_LIMITED";
}

export function extractPullRequest(session: JulesSession): { url?: string; workerBranch?: string } | null {
  const output = (session.outputs || [])
    .map((entry) => entry.pullRequest)
    .find((entry): entry is { url?: string; workerBranch?: string } => Boolean(entry));
  return output || null;
}

export function resolveTerminalDispatchState(session: JulesSession): "COMPLETED" | "FAILED" | "QUOTA" | null {
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

export interface TaskReconciliationServiceDependencies {
  projectManagementRepository: ProjectManagementRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  logger?: Logger;
  executionRepository: ExecutionRepository;
  cliWorkflowService: CliWorkflowService;
  workerEndpointRepository: WorkerEndpointRepository;
  workerTaskDispatchService: WorkerTaskDispatchService;
  sessionTracking: SessionTrackingRepository;
  resolveDashboardSettings: (projectId: string, sprintId?: string | null) => DashboardSettings;
}

export class TaskReconciliationService {
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private readonly activeCycles = new Map<string, Promise<void>>();
  private readonly scheduledProjects = new Set<string>();
  constructor(private readonly deps: TaskReconciliationServiceDependencies) {}

  start(): void {
    if (this.reconcileTimer) {
      return;
    }

    void this.reconcile();
    this.reconcileTimer = setInterval(() => {
      void this.reconcile().catch((error) => {
        this.deps.logger?.error("Task reconciliation failed", { error });
      });
    }, 3_000); // VIRTUAL_WORKER_RECONCILE_MS
    this.reconcileTimer.unref?.();
  }

  stop(): void {
    if (this.reconcileTimer) {
      clearInterval(this.reconcileTimer);
      this.reconcileTimer = null;
    }
  }

  async reconcile(): Promise<void> {
    for (const project of this.deps.projectManagementRepository.listProjects().projects) {
      const settings = this.deps.resolveDashboardSettings(project.id);
      if (settings.workers.executionMode === "VIRTUAL") {
        this.scheduleProjectTaskReconciliation(project.id);
      }
    }
  }

  private scheduleProjectTaskReconciliation(projectId: string): void {
    if (this.activeCycles.has(projectId) || this.scheduledProjects.has(projectId)) {
      return;
    }

    this.scheduledProjects.add(projectId);
    queueMicrotask(() => {
      this.scheduledProjects.delete(projectId);
      if (this.activeCycles.has(projectId)) {
        return;
      }

      const cycle = this.runProjectTaskCycle(projectId)
        .catch((error) => {
          this.deps.logger?.error("Task reconciliation cycle failed", { projectId, error });
        })
        .finally(() => {
          this.activeCycles.delete(projectId);
        });

      this.activeCycles.set(projectId, cycle);
    });
  }

  private async runProjectTaskCycle(projectId: string): Promise<void> {
    const settings = this.deps.resolveDashboardSettings(projectId);
    const providerConfigId = settings.workers.virtualWorkerProvider;
    const providerSettings = settings.aiProvider.providers[providerConfigId];
    const cycleProviderType = providerSettings?.provider || "codex";

    const endpoint = this.deps.workerEndpointRepository.createVirtualEndpoint({
      endpointKey: `virtual:${projectId}:${Date.now().toString(36)}:${sanitizeToken(randomUUID().slice(0, 8))}`,
      displayName: `Virtual ${this.getProviderLabel(cycleProviderType)} Worker`,
      status: "connected",
      transport: "internal",
      capabilities: {
        canExecuteTasks: true,
      },
    });

    this.deps.projectWorkerAssignmentService.ensureWorkerAssignment(projectId, endpoint.id);

    try {
      const claim = this.deps.workerTaskDispatchService.claimNextDispatchForWorker({
        projectId,
        workerEndpointId: endpoint.id,
        executionMode: "VIRTUAL",
      });

      if (claim) {
        await this.handleTaskDispatch(endpoint.id, claim);
        // Reschedule to see if there are more
        this.scheduleProjectTaskReconciliation(projectId);
      }
    } finally {
      this.deps.projectWorkerAssignmentService.releaseWorkerAssignment(projectId, endpoint.id, "virtual_worker_task_cycle_complete");
      this.deps.workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);
    }
  }

  private getProviderLabel(provider: string): string {
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


  async handleTaskDispatch(workerEndpointId: string, claim: WorkerTaskDispatchClaim): Promise<void> {
    const settings = this.deps.resolveDashboardSettings(claim.project.id, claim.sprint.id);
    const providerConfigId = settings.workers.virtualWorkerProvider;
    const providerSettings = settings.aiProvider.providers[providerConfigId];
    const provider = providerSettings.provider as Exclude<ProviderId, "jules">;
    const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(claim.dispatch.id);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${claim.dispatch.id}`);
    }

    const session = await this.deps.cliWorkflowService.startTask({
      provider,
      providerSettingsOverride: {
        model: resolveWorkerModelForProvider(
          provider,
          settings.workers.model,
          providerSettings.model,
        ),
        thinkingMode: providerSettings.thinkingMode,
        apiKey: providerSettings.apiKey,
        providerMountAuth: providerSettings.mountAuth,
        providerAuthPath: providerSettings.authPath,
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
}
