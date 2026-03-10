import { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { Logger } from "../shared/logging/logger.js";

export interface RuntimeCleanupResult {
  staleConnectionIds: string[];
  offlineConnectionIds: string[];
  prunedConnectionIds: string[];
  blockedDispatchIds: string[];
  forceCancelledDispatchIds: string[];
}

const STALE_CANCEL_REQUEST_MS = 15 * 60 * 1000;

export class RuntimeCleanupService {
  constructor(
    private readonly connectionChatRepository: ConnectionChatRepository,
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly logger?: Logger,
  ) {}

  cleanup(now = new Date()): RuntimeCleanupResult {
    const connectionResult = this.connectionChatRepository.cleanupConnectionLifecycle(now);
    const blockedDispatchIds: string[] = [];
    const forceCancelledDispatchIds: string[] = [];

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
      forceCancelledDispatchIds.push(dispatch.id);
      if (dispatch.sprintRunId) {
        this.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
      }
    }

    if (
      connectionResult.staleConnectionIds.length > 0
      || connectionResult.offlineConnectionIds.length > 0
      || connectionResult.prunedConnectionIds.length > 0
      || blockedDispatchIds.length > 0
      || forceCancelledDispatchIds.length > 0
    ) {
      this.logger?.info("Runtime cleanup sweep completed", {
        staleConnections: connectionResult.staleConnectionIds.length,
        offlineConnections: connectionResult.offlineConnectionIds.length,
        prunedConnections: connectionResult.prunedConnectionIds.length,
        blockedDispatches: blockedDispatchIds.length,
        forceCancelledDispatches: forceCancelledDispatchIds.length,
      });
    }

    return {
      ...connectionResult,
      blockedDispatchIds,
      forceCancelledDispatchIds,
    };
  }
}
