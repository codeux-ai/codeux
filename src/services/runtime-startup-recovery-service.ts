import type { TaskRunRecord } from "../contracts/execution-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SessionTrackingRepository } from "../repositories/session-tracking-repository.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { Logger } from "../shared/logging/logger.js";

const ACTIVE_SPRINT_RUN_STATUSES = ["queued", "running"] as const;
const ACTIVE_DISPATCH_STATUSES = ["queued", "claimed", "running", "cancel_requested"] as const;
const TERMINAL_TASK_RUN_STATES = new Set(["COMPLETED", "FAILED", "BLOCKED", "QUOTA"]);

export interface RuntimeStartupRecoveryResult {
  recoveredCliSessionIds: string[];
  reconciledLocalDispatchIds: string[];
  resumedSprintRunIds: string[];
  supersededSprintRunIds: string[];
}

interface RuntimeStartupRecoveryServiceDeps {
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  sprintOrchestrator: SprintOrchestrator;
  logger?: Logger;
}

export class RuntimeStartupRecoveryService {
  constructor(private readonly deps: RuntimeStartupRecoveryServiceDeps) {}

  async recover(): Promise<RuntimeStartupRecoveryResult> {
    const cliRecovery = this.deps.sessionTracking.recoverInterruptedCliSessions();
    const recoveredCliSessionIds = cliRecovery.sessionIds;
    const reconciledLocalDispatchIds = this.reconcileInterruptedLocalDispatches(new Set(recoveredCliSessionIds));
    const { resumedSprintRunIds, supersededSprintRunIds } = this.resumeRecoverableSprintRuns();

    if (
      recoveredCliSessionIds.length > 0
      || reconciledLocalDispatchIds.length > 0
      || resumedSprintRunIds.length > 0
      || supersededSprintRunIds.length > 0
    ) {
      this.deps.logger?.info("Recovered runtime state on startup", {
        recoveredCliSessions: recoveredCliSessionIds.length,
        reconciledLocalDispatches: reconciledLocalDispatchIds.length,
        resumedSprintRuns: resumedSprintRunIds.length,
        supersededSprintRuns: supersededSprintRunIds.length,
      });
    }

    return {
      recoveredCliSessionIds,
      reconciledLocalDispatchIds,
      resumedSprintRunIds,
      supersededSprintRunIds,
    };
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
