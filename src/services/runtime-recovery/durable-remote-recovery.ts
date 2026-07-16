import type { JulesSession } from "../../contracts/app-types.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { SprintRunLifecycleService } from "../sprint-run-lifecycle-service.js";

const ACTIVE_JULES_SESSION_STATES = new Set([
  "QUEUED",
  "PLANNING",
  "AWAITING_PLAN_APPROVAL",
  "AWAITING_USER_FEEDBACK",
  "IN_PROGRESS",
  "PAUSED",
]);

interface DurableRemoteRecoveryDeps {
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  sprintRunLifecycleService: SprintRunLifecycleService;
}

export interface DurableRemoteRecoveryResult {
  reactivatedTaskRunIds: string[];
  reactivatedSprintRunIds: string[];
}

export interface DurableRemoteRecoveryOptions {
  evidence?: "remote_snapshot" | "local_fail_safe";
}

/**
 * Restores local projections that an earlier process may have terminalized
 * while their hosted Jules session kept running. The remote active state is
 * authoritative; completed/cancelled local sprints and merged tasks remain
 * untouched so an intentional stop cannot be undone on startup.
 */
export class DurableRemoteRecoveryService {
  constructor(private readonly deps: DurableRemoteRecoveryDeps) {}

  reconcileActiveJulesSessions(
    sessions: readonly JulesSession[],
    options: DurableRemoteRecoveryOptions = {},
  ): DurableRemoteRecoveryResult {
    const now = new Date().toISOString();
    const evidence = options.evidence ?? "remote_snapshot";
    const reactivatedTaskRunIds = new Set<string>();
    const reactivatedSprintRunIds = new Set<string>();

    for (const session of sessions) {
      if (!ACTIVE_JULES_SESSION_STATES.has(String(session.state || "").toUpperCase())) {
        continue;
      }
      const sessionId = this.resolveSessionId(session);
      if (!sessionId) {
        continue;
      }
      const taskRun = this.deps.executionRepository.getLatestTaskRunBySessionId(sessionId);
      if (!taskRun || taskRun.provider !== "jules" || taskRun.mode !== "jules") {
        continue;
      }
      const task = this.deps.projectManagementRepository.getTask(taskRun.taskId);
      if (!task || task.isMerged || task.status === "QA_REVIEW_FAILED") {
        continue;
      }
      const rawSprintStatus = this.deps.projectManagementRepository.getRawSprintStatus(taskRun.sprintId);
      if (rawSprintStatus === null || rawSprintStatus === "completed" || rawSprintStatus === "cancelled") {
        continue;
      }
      const sprintRun = taskRun.sprintRunId
        ? this.deps.executionRepository.getSprintRun(taskRun.sprintRunId)
        : null;
      if (!sprintRun || sprintRun.status === "completed" || sprintRun.status === "cancelled") {
        continue;
      }

      const dispatch = taskRun.dispatchId
        ? this.deps.executionRepository.getTaskDispatch(taskRun.dispatchId)
        : null;
      let changed = false;
      const taskRunNeedsReactivation = taskRun.state !== "RUNNING" || taskRun.finishedAt !== null;
      if (taskRunNeedsReactivation) {
        this.deps.executionRepository.updateTaskRun(taskRun.id, {
          state: "RUNNING",
          finishedAt: null,
          durationMs: null,
        });
        changed = true;
      }
      if (dispatch && (
        dispatch.status !== "running"
        || dispatch.finishedAt !== null
        || dispatch.errorMessage !== null
      )) {
        this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
          status: "running",
          startedAt: dispatch.startedAt || taskRun.startedAt || now,
          finishedAt: null,
          lastHeartbeatAt: now,
          errorMessage: null,
        });
        changed = true;
      }
      if (task.status !== "in_progress") {
        this.deps.projectManagementRepository.updateTask(task.id, { status: "in_progress" });
        changed = true;
      }
      if (sprintRun.status !== "running" || sprintRun.finishedAt !== null) {
        this.deps.sprintRunLifecycleService.updateRun(sprintRun.id, {
          status: "running",
          startedAt: sprintRun.startedAt || now,
          finishedAt: null,
          lastHeartbeatAt: now,
        });
        reactivatedSprintRunIds.add(sprintRun.id);
        changed = true;
      }
      if (rawSprintStatus === "failed") {
        this.deps.projectManagementRepository.updateSprint(taskRun.sprintId, { status: "running" });
        changed = true;
      }

      const usage = this.deps.executionRepository.getLatestProviderInvocationUsageBySession(
        sessionId,
        "task_coding",
      );
      if (usage?.provider === "jules") {
        if (usage.status !== "running" || usage.finishedAt !== null) {
          this.deps.executionRepository.updateProviderInvocationUsage(usage.id, {
            status: "running",
            finishedAt: null,
            durationMs: null,
          });
          changed = true;
        }
        for (const invocation of this.deps.executionRepository.listExecutionInvocationsByProviderInvocationId(usage.id)) {
          if (invocation.status === "running" && invocation.finishedAt === null) {
            continue;
          }
          this.deps.executionRepository.updateExecutionInvocation(invocation.id, {
            status: "running",
            finishedAt: null,
            errorMessage: null,
            lastErrorCategory: null,
            lastErrorMessage: null,
            lastRetryAfterIso: null,
          });
          this.deps.executionRepository.appendExecutionInvocationMessage(invocation.id, {
            role: "system",
            contentMarkdown: evidence === "remote_snapshot"
              ? "Restored the invocation because its Jules session is still active after restart."
              : "Preserved the invocation while the Jules startup snapshot is unavailable. Session sync will verify the remote state.",
            metadata: {
              recovery: evidence === "remote_snapshot"
                ? "startup_durable_remote_session_reactivated"
                : "startup_durable_remote_session_preserved_unverified",
              provider: "jules",
              sessionId,
              remoteState: evidence === "remote_snapshot" ? session.state || null : null,
            },
            createdAt: now,
          });
          changed = true;
        }
      }

      if (changed) {
        this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "task_run_rehydrated", "system", {
          reason: evidence === "remote_snapshot"
            ? "durable_remote_session_still_active"
            : "durable_remote_session_preserved_pending_verification",
          provider: "jules",
          sessionId,
          remoteState: evidence === "remote_snapshot" ? session.state || null : null,
          previousTaskRunState: taskRun.state,
          previousDispatchStatus: dispatch?.status || null,
          previousSprintRunStatus: sprintRun.status,
        }, {
          sourceEventKey: `startup-recovery:durable-remote-${evidence}:${taskRun.id}:${session.state || "active"}`,
        });
        reactivatedTaskRunIds.add(taskRun.id);
      }
    }

    return {
      reactivatedTaskRunIds: [...reactivatedTaskRunIds],
      reactivatedSprintRunIds: [...reactivatedSprintRunIds],
    };
  }

  private resolveSessionId(session: JulesSession): string | null {
    const raw = (session.id || session.name || "").trim().replace(/^sessions\//, "");
    return raw || null;
  }
}
