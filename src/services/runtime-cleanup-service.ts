import { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { TaskRunState } from "../contracts/execution-types.js";
import type { Logger } from "../shared/logging/logger.js";
import { DockerRuntimePruneService } from "./docker-runtime-prune-service.js";

export interface RuntimeCleanupResult {
  staleConnectionIds: string[];
  offlineConnectionIds: string[];
  prunedConnectionIds: string[];
  prunedDockerRuntimePaths: string[];
  blockedDispatchIds: string[];
  forceCancelledDispatchIds: string[];
  reconciledDispatchIds: string[];
  failedSprintRunIds: string[];
}

const STALE_CANCEL_REQUEST_MS = 15 * 60 * 1000;
const STALE_SPRINT_RUN_MS = 15 * 60 * 1000;
const TERMINAL_TASK_RUN_STATES: TaskRunState[] = ["COMPLETED", "FAILED", "BLOCKED"];

export class RuntimeCleanupService {
  constructor(
    private readonly connectionChatRepository: ConnectionChatRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly projectAttentionService: ProjectAttentionService,
    private readonly dockerRuntimePruneService?: DockerRuntimePruneService,
    private readonly logger?: Logger,
  ) {}

  cleanup(now = new Date()): RuntimeCleanupResult {
    const connectionResult = this.connectionChatRepository.cleanupConnectionLifecycle(now);
    const dockerRuntimeResult = this.dockerRuntimePruneService?.cleanup(now) || { prunedPaths: [] };
    const blockedDispatchIds: string[] = [];
    const forceCancelledDispatchIds: string[] = [];
    const reconciledDispatchIds = this.reconcileTerminalDispatches(now);
    const failedSprintRunIds = this.failStaleSprintRuns(now);

    for (const lease of this.executionRepository.listExpiredLeases("task_dispatch", now)) {
      const dispatch = this.executionRepository.getTaskDispatch(lease.scopeId);
      this.executionRepository.releaseLease("task_dispatch", lease.scopeId, lease.leaseToken);

      if (!dispatch || !["claimed", "running", "cancel_requested"].includes(dispatch.status)) {
        continue;
      }

      const nowIso = now.toISOString();
      this.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: "blocked",
        finishedAt: nowIso,
        lastHeartbeatAt: nowIso,
        errorMessage: dispatch.errorMessage || "Worker lease expired before the dispatch completed.",
      });

      const taskRun = this.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (taskRun) {
        this.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: "BLOCKED",
          finishedAt: nowIso,
          durationMs: taskRun.startedAt
            ? Math.max(0, new Date(nowIso).getTime() - new Date(taskRun.startedAt).getTime())
            : taskRun.durationMs,
        });
        this.executionRepository.appendTaskRunEvent(taskRun.id, "worker_lease_expired", "system", {
          dispatchId: dispatch.id,
          leaseOwnerKey: lease.ownerKey,
          expiredAt: lease.expiresAt,
        }, {
          sourceEventKey: `cleanup:lease-expired:${dispatch.id}:${lease.expiresAt}`,
        });
      }

      this.projectManagementRepository.updateTask(dispatch.taskId, {
        status: "pending",
      });
      this.projectAttentionService.openItem({
        projectId: dispatch.projectId,
        sprintId: dispatch.sprintId,
        taskId: dispatch.taskId,
        sprintRunId: dispatch.sprintRunId,
        dispatchId: dispatch.id,
        attentionType: "worker_lease_expired",
        severity: "high",
        ownerType: "worker",
        title: "Worker lease expired during dispatch",
        summaryMarkdown: dispatch.errorMessage || "Worker lease expired before the dispatch completed.",
        payload: {
          dispatchId: dispatch.id,
          leaseOwnerKey: lease.ownerKey,
          expiredAt: lease.expiresAt,
        },
      });
      blockedDispatchIds.push(dispatch.id);
      if (dispatch.sprintRunId) {
        this.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
      }
    }

    const staleCancelCutoffIso = new Date(now.getTime() - STALE_CANCEL_REQUEST_MS).toISOString();
    for (const dispatch of this.executionRepository.listStaleCancelRequestedDispatches(staleCancelCutoffIso)) {
      const nowIso = now.toISOString();
      this.executionRepository.releaseLease("task_dispatch", dispatch.id);
      this.executionRepository.updateTaskDispatch(dispatch.id, {
        connectionId: null,
        status: "cancelled",
        finishedAt: nowIso,
        lastHeartbeatAt: nowIso,
        errorMessage: dispatch.errorMessage || "Dispatch force-cancelled after stale cancellation timeout.",
      });

      const taskRun = this.executionRepository.getTaskRunByDispatchId(dispatch.id);
      if (taskRun) {
        this.executionRepository.updateTaskRun(taskRun.id, {
          connectionId: null,
          state: "BLOCKED",
          finishedAt: nowIso,
          durationMs: taskRun.startedAt
            ? Math.max(0, new Date(nowIso).getTime() - new Date(taskRun.startedAt).getTime())
            : taskRun.durationMs,
        });
        this.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_cancelled", "system", {
          dispatchId: dispatch.id,
          reason: dispatch.errorMessage || "Dispatch force-cancelled after stale cancellation timeout.",
          force: true,
        }, {
          sourceEventKey: `cleanup:stale-cancel-request:${dispatch.id}:${staleCancelCutoffIso}`,
        });
      }

      this.projectManagementRepository.updateTask(dispatch.taskId, {
        status: "pending",
      });
      this.projectAttentionService.openItem({
        projectId: dispatch.projectId,
        sprintId: dispatch.sprintId,
        taskId: dispatch.taskId,
        sprintRunId: dispatch.sprintRunId,
        dispatchId: dispatch.id,
        attentionType: "dispatch_cancel_stalled",
        severity: "medium",
        ownerType: "worker",
        title: "Dispatch cancellation stalled",
        summaryMarkdown: dispatch.errorMessage || "Dispatch was force-cancelled after stale cancellation timeout.",
        payload: {
          dispatchId: dispatch.id,
          staleCancelCutoff: staleCancelCutoffIso,
        },
      });
      forceCancelledDispatchIds.push(dispatch.id);
      if (dispatch.sprintRunId) {
        this.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
      }
    }

    if (
      connectionResult.staleConnectionIds.length > 0
      || connectionResult.offlineConnectionIds.length > 0
      || connectionResult.prunedConnectionIds.length > 0
      || dockerRuntimeResult.prunedPaths.length > 0
      || blockedDispatchIds.length > 0
      || forceCancelledDispatchIds.length > 0
      || reconciledDispatchIds.length > 0
      || failedSprintRunIds.length > 0
    ) {
      this.logger?.info("Runtime cleanup sweep completed", {
        staleConnections: connectionResult.staleConnectionIds.length,
        offlineConnections: connectionResult.offlineConnectionIds.length,
        prunedConnections: connectionResult.prunedConnectionIds.length,
        prunedDockerRuntimePaths: dockerRuntimeResult.prunedPaths.length,
        blockedDispatches: blockedDispatchIds.length,
        forceCancelledDispatches: forceCancelledDispatchIds.length,
        reconciledDispatches: reconciledDispatchIds.length,
        failedSprintRuns: failedSprintRunIds.length,
      });
    }

    return {
      ...connectionResult,
      prunedDockerRuntimePaths: dockerRuntimeResult.prunedPaths,
      blockedDispatchIds,
      forceCancelledDispatchIds,
      reconciledDispatchIds,
      failedSprintRunIds,
    };
  }

  private reconcileTerminalDispatches(now: Date): string[] {
    const reconciledDispatchIds: string[] = [];

    for (const project of this.projectManagementRepository.listProjects().projects) {
      for (const dispatch of this.executionRepository.listTaskDispatches({ projectId: project.id })) {
        if (!["queued", "claimed", "running", "cancel_requested"].includes(dispatch.status)) {
          continue;
        }

        const taskRun = this.executionRepository.getTaskRunByDispatchId(dispatch.id);
        if (!taskRun || !isTerminalTaskRunState(taskRun.state)) {
          continue;
        }

        const terminalAt = taskRun.finishedAt || now.toISOString();
        this.executionRepository.updateTaskDispatch(dispatch.id, {
          status: this.mapTaskRunStateToDispatchStatus(taskRun.state),
          finishedAt: terminalAt,
          lastHeartbeatAt: terminalAt,
          errorMessage: taskRun.state === "FAILED"
            ? dispatch.errorMessage || "Provider session failed before dispatch reconciliation."
            : taskRun.state === "BLOCKED"
              ? dispatch.errorMessage || "Provider session requires attention before dispatch reconciliation."
              : null,
        });
        if (dispatch.sprintRunId) {
          this.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
        }
        reconciledDispatchIds.push(dispatch.id);
      }
    }

    return reconciledDispatchIds;
  }

  private failStaleSprintRuns(now: Date): string[] {
    const failedSprintRunIds: string[] = [];
    const staleCutoffMs = now.getTime() - STALE_SPRINT_RUN_MS;
    const nowIso = now.toISOString();

    for (const project of this.projectManagementRepository.listProjects().projects) {
      for (const sprintRun of this.executionRepository.listSprintRuns(project.id)) {
        if (sprintRun.status !== "running") {
          continue;
        }
        const sprintLease = this.executionRepository.getLease("sprint", sprintRun.sprintId);
        if (sprintLease && sprintLease.expiresAt > nowIso) {
          continue;
        }
        if (this.executionRepository.hasActiveTaskDispatches(sprintRun.id)) {
          continue;
        }

        const lastHeartbeatAt = sprintRun.lastHeartbeatAt || sprintRun.updatedAt || sprintRun.startedAt || sprintRun.createdAt;
        if (!lastHeartbeatAt || new Date(lastHeartbeatAt).getTime() > staleCutoffMs) {
          continue;
        }

        if (sprintLease) {
          this.executionRepository.releaseLease("sprint", sprintRun.sprintId, sprintLease.leaseToken);
        }
        this.executionRepository.updateSprintRun(sprintRun.id, {
          status: "failed",
          finishedAt: nowIso,
          lastHeartbeatAt: nowIso,
        });
        this.executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_failed", "system", {
          reason: "orchestration_heartbeat_stalled",
          previousLastHeartbeatAt: sprintRun.lastHeartbeatAt,
          failedAt: nowIso,
        }, {
          sourceEventKey: `cleanup:stale-sprint-run:${sprintRun.id}:${lastHeartbeatAt}`,
        });
        failedSprintRunIds.push(sprintRun.id);
      }
    }

    return failedSprintRunIds;
  }

  private mapTaskRunStateToDispatchStatus(state: "COMPLETED" | "FAILED" | "BLOCKED"): "completed" | "failed" | "blocked" {
    switch (state) {
      case "FAILED":
        return "failed";
      case "BLOCKED":
        return "blocked";
      case "COMPLETED":
      default:
        return "completed";
    }
  }
}

function isTerminalTaskRunState(state: TaskRunState): state is "COMPLETED" | "FAILED" | "BLOCKED" {
  return TERMINAL_TASK_RUN_STATES.includes(state);
}
