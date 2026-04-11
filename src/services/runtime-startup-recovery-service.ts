import type { DashboardSettings, DashboardSettingsScope, DockerContainer, ProviderId } from "../contracts/app-types.js";
import type { ProviderInvocationUsageRecord, TaskRunRecord } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { Logger } from "../shared/logging/logger.js";

const ACTIVE_SPRINT_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_DISPATCH_STATUSES = ["queued", "claimed", "running", "cancel_requested"] as const;
const TERMINAL_TASK_RUN_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);
const CLI_PROVIDERS = new Set<ProviderId>(["gemini", "codex", "claude-code"]);

export interface RuntimeStartupRecoveryResult {
  recoveredCliSessionIds: string[];
  reconciledLocalDispatchIds: string[];
  reconciledContainerInvocationIds: string[];
  resumedSprintRunIds: string[];
  supersededSprintRunIds: string[];
}

interface RuntimeStartupRecoveryServiceDeps {
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  sprintOrchestrator: SprintOrchestrator;
  dockerService?: Pick<{ listContainers: () => Promise<DockerContainer[]> }, "listContainers">;
  getDashboardSettings?: (scope?: DashboardSettingsScope) => DashboardSettings;
  logger?: Logger;
}

export class RuntimeStartupRecoveryService {
  constructor(private readonly deps: RuntimeStartupRecoveryServiceDeps) {}

  async recover(): Promise<RuntimeStartupRecoveryResult> {
    const cliRecovery = this.deps.sessionTracking.recoverInterruptedCliSessions();
    const recoveredCliSessionIds = cliRecovery.sessionIds;
    const reconciledLocalDispatchIds = this.reconcileInterruptedLocalDispatches(new Set(recoveredCliSessionIds));
    const reconciledContainerInvocationIds = await this.reconcileInterruptedCliInvocations(new Set(recoveredCliSessionIds));
    const { resumedSprintRunIds, supersededSprintRunIds } = this.resumeRecoverableSprintRuns();

    if (
      recoveredCliSessionIds.length > 0
      || reconciledLocalDispatchIds.length > 0
      || reconciledContainerInvocationIds.length > 0
      || resumedSprintRunIds.length > 0
      || supersededSprintRunIds.length > 0
    ) {
      this.deps.logger?.info("Recovered runtime state on startup", {
        recoveredCliSessions: recoveredCliSessionIds.length,
        reconciledLocalDispatches: reconciledLocalDispatchIds.length,
        reconciledContainerInvocations: reconciledContainerInvocationIds.length,
        resumedSprintRuns: resumedSprintRunIds.length,
        supersededSprintRuns: supersededSprintRunIds.length,
      });
    }

    return {
      recoveredCliSessionIds,
      reconciledLocalDispatchIds,
      reconciledContainerInvocationIds,
      resumedSprintRunIds,
      supersededSprintRunIds,
    };
  }

  private async reconcileInterruptedCliInvocations(recoveredCliSessionIds: ReadonlySet<string>): Promise<string[]> {
    if (!this.deps.dockerService?.listContainers && recoveredCliSessionIds.size === 0) {
      return [];
    }

    const runningInvocations = this.deps.executionRepository.listRunningProviderInvocationUsages(
      Array.from(CLI_PROVIDERS),
    );
    if (runningInvocations.length === 0) {
      return [];
    }

    const activeContainerSessionIds = await this.listActiveContainerSessionIds();
    const reconciledInvocationIds: string[] = [];
    const reconciledAt = new Date().toISOString();

    for (const invocation of runningInvocations) {
      const failureReason = this.resolveInterruptedInvocationReason(
        invocation,
        recoveredCliSessionIds,
        activeContainerSessionIds,
      );
      if (!failureReason) {
        continue;
      }

      this.deps.executionRepository.updateProviderInvocationUsage(invocation.id, {
        status: "failed",
        finishedAt: reconciledAt,
        durationMs: calculateInvocationDurationMs(invocation, reconciledAt),
      });

      const linkedExecutionInvocations = this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(invocation.id);
      for (const executionInvocation of linkedExecutionInvocations) {
        if (executionInvocation.status !== "running" && executionInvocation.status !== "paused") {
          continue;
        }
        this.deps.executionRepository.updateExecutionInvocation(executionInvocation.id, {
          status: "failed",
          finishedAt: reconciledAt,
          errorMessage: failureReason,
        });
        this.deps.executionRepository.appendExecutionInvocationMessage(executionInvocation.id, {
          role: "system",
          contentMarkdown: failureReason,
          metadata: {
            recovery: "startup_cli_invocation_reconcile",
            provider: invocation.provider,
            sessionId: invocation.sessionId,
          },
          createdAt: reconciledAt,
        });
      }

      reconciledInvocationIds.push(invocation.id);
    }

    return reconciledInvocationIds;
  }

  private reconcileInterruptedLocalDispatches(recoveredCliSessionIds: ReadonlySet<string>): string[] {
    const interruptedAt = new Date().toISOString();
    const reconciledDispatchIds: string[] = [];
    const activeLocalDispatches = this.deps.executionRepository.listTaskDispatchesByStatus(
      [...ACTIVE_DISPATCH_STATUSES],
      { executorType: "docker_cli" },
    );

    for (const dispatch of activeLocalDispatches) {
      const taskRun = this.deps.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (taskRun && isTerminalTaskRunState(taskRun)) {
        continue;
      }

      const sessionRecovered = taskRun?.sessionId ? recoveredCliSessionIds.has(taskRun.sessionId) : false;
      const errorMessage = sessionRecovered
        ? "Local CLI execution was interrupted by Sprint OS restart. The task was moved back to a retryable state."
        : "Local CLI execution was interrupted before Sprint OS could persist a resumable session. The task was moved back to a retryable state.";

      this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: "failed",
        finishedAt: interruptedAt,
        lastHeartbeatAt: interruptedAt,
        errorMessage,
      });

      if (taskRun) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: "FAILED",
          finishedAt: interruptedAt,
          durationMs: calculateDurationMs(taskRun, interruptedAt),
        });
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "cli_workflow_failed", "system", {
          dispatchId: dispatch.id,
          reason: "runtime_restart_interrupted",
          recoveredSessionId: sessionRecovered ? taskRun.sessionId : null,
          errorMessage,
        }, {
          sourceEventKey: `startup-recovery:cli-interrupted:${dispatch.id}:${taskRun.id}`,
        });
      }

      this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
        status: "pending",
      });

      if (dispatch.sprintRunId) {
        this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
      }
      reconciledDispatchIds.push(dispatch.id);
    }

    return reconciledDispatchIds;
  }

  private resumeRecoverableSprintRuns(): { resumedSprintRunIds: string[]; supersededSprintRunIds: string[] } {
    const resumedSprintRunIds: string[] = [];
    const supersededSprintRunIds: string[] = [];
    const activeRuns = this.deps.executionRepository.listSprintRunsByStatus([...ACTIVE_SPRINT_RUN_STATUSES]);
    activeRuns.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    const recoveredSprintIds = new Set<string>();
    const recoveredAt = new Date().toISOString();

    for (const sprintRun of activeRuns) {
      if (recoveredSprintIds.has(sprintRun.sprintId)) {
        this.deps.executionRepository.updateSprintRun(sprintRun.id, {
          status: "failed",
          finishedAt: recoveredAt,
          lastHeartbeatAt: recoveredAt,
        });
        this.deps.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_failed", "system", {
          reason: "superseded_by_newer_active_run_on_startup",
        }, {
          sourceEventKey: `startup-recovery:superseded:${sprintRun.id}`,
        });
        supersededSprintRunIds.push(sprintRun.id);
        continue;
      }

      // Gate the recovery loop against the active in-memory orchestrator registry
      if (this.deps.sprintOrchestrator.isOrchestratingSprint && this.deps.sprintOrchestrator.isOrchestratingSprint(sprintRun.projectId, sprintRun.sprintId)) {
        continue;
      }


      recoveredSprintIds.add(sprintRun.sprintId);
      this.deps.executionRepository.releaseLease("sprint", sprintRun.sprintId);
      resumedSprintRunIds.push(sprintRun.id);

      void this.deps.sprintOrchestrator.recoverSprintRun(sprintRun.id).catch((error) => {
        this.deps.logger?.error("Failed to recover sprint run on startup", {
          sprintRunId: sprintRun.id,
          sprintId: sprintRun.sprintId,
          projectId: sprintRun.projectId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }

    return { resumedSprintRunIds, supersededSprintRunIds };
  }

  private async listActiveContainerSessionIds(): Promise<Set<string>> {
    if (!this.deps.dockerService?.listContainers) {
      return new Set();
    }

    const containers = await this.deps.dockerService.listContainers().catch(() => []);
    return new Set(
      containers
        .map((container) => container.labels?.["sprint-os.session-id"]?.trim())
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    );
  }

  private resolveInterruptedInvocationReason(
    invocation: ProviderInvocationUsageRecord,
    recoveredCliSessionIds: ReadonlySet<string>,
    activeContainerSessionIds: ReadonlySet<string>,
  ): string | null {
    if (!CLI_PROVIDERS.has(invocation.provider as ProviderId)) {
      return null;
    }

    if (recoveredCliSessionIds.has(invocation.sessionId)) {
      return `Recovered stale ${invocation.purpose} invocation after Sprint OS restart. The backing CLI session (${invocation.sessionId}) was interrupted before completion.`;
    }

    const executionMode = this.resolveInvocationExecutionMode(invocation);
    if (executionMode === "DOCKER" && !activeContainerSessionIds.has(invocation.sessionId)) {
      return `Recovered stale ${invocation.purpose} invocation after Sprint OS restart. No active Docker container remained for session ${invocation.sessionId}.`;
    }

    return null;
  }

  private resolveInvocationExecutionMode(invocation: ProviderInvocationUsageRecord): ProviderInvocationUsageRecord["executionMode"] {
    if (invocation.executionMode) {
      return invocation.executionMode;
    }
    if (!this.deps.getDashboardSettings) {
      return null;
    }
    return this.deps.getDashboardSettings({
      projectId: invocation.projectId,
      sprintId: invocation.sprintId,
    }).cliWorkflow.executionMode;
  }
}

function isTerminalTaskRunState(taskRun: TaskRunRecord): boolean {
  return TERMINAL_TASK_RUN_STATES.has(taskRun.state);
}

function calculateDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
  if (!taskRun.startedAt) {
    return taskRun.durationMs;
  }
  return Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime());
}

function calculateInvocationDurationMs(invocation: ProviderInvocationUsageRecord, finishedAt: string): number | null {
  const startedAtMs = Date.parse(invocation.startedAt);
  const finishedAtMs = Date.parse(finishedAt);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(finishedAtMs)) {
    return invocation.durationMs;
  }
  return Math.max(0, finishedAtMs - startedAtMs);
}
