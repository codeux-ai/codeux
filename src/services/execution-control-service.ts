import type { Subtask } from "../contracts/app-types.js";
import type { TaskDispatchRecord, SprintRunRecord, TaskRunRecord } from "../contracts/execution-types.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { TaskRerunService } from "./task-rerun-service.js";
import type { SprintOrchestrator } from "../sprint/sprint-orchestrator.js";
import type { JulesApiClient } from "../integrations/jules-api-client.js";
import type { ActiveDispatchRegistry } from "./active-dispatch-registry.js";
import type { Logger } from "../shared/logging/logger.js";

interface ExecutionControlServiceDeps {
  projectManagementRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  projectAttentionService: ProjectAttentionService;
  taskRerunService?: TaskRerunService;
  sprintOrchestrator: SprintOrchestrator;
  julesApi: JulesApiClient;
  activeDispatchRegistry: ActiveDispatchRegistry;
  logger?: Logger;
}

export class ExecutionControlService {
  constructor(private readonly deps: ExecutionControlServiceDeps) {}

  setTaskRerunService(taskRerunService: TaskRerunService): void {
    this.deps.taskRerunService = taskRerunService;
  }

  async orchestrateSprint(projectId: string, sprintId: string): Promise<{ ok: true }> {
    const project = this.deps.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    const sprint = this.deps.projectManagementRepository.getSprint(sprintId);
    if (!sprint || sprint.projectId !== projectId) {
      throw new Error(`Sprint not found in project: ${sprintId}`);
    }

    const blockingRun = this.resolveBlockingSprintRun(projectId, sprintId);
    if (blockingRun) {
      const label = blockingRun.status === "cancel_requested" ? "cancellation is still pending" : "another run is already active";
      throw new Error(
        `Sprint ${sprint.number ?? sprint.name} cannot be started because ${label} (run ${blockingRun.id}, status ${blockingRun.status}).`,
      );
    }

    this.deps.executionRepository.releaseStaleSprintLease(projectId, sprintId);

    const lingeringLease = this.deps.executionRepository.getLease("sprint", sprintId);
    if (lingeringLease) {
      throw new Error(
        `Sprint ${sprint.number ?? sprint.name} cannot be started because the previous orchestration still owns the sprint lease.`,
      );
    }

    void this.deps.sprintOrchestrator.execute({
      action: "orchestrate",
      project_id: projectId,
      sprint_id: sprintId,
      wait: true,
    }).catch((error) => {
      this.deps.logger?.error("Dashboard-triggered sprint orchestration failed", {
        projectId,
        sprintId,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    return { ok: true };
  }

  pauseSprintRun(sprintRunId: string): SprintRunRecord {
    const sprintRun = this.requireSprintRun(sprintRunId);
    if (sprintRun.status === "completed" || sprintRun.status === "failed" || sprintRun.status === "cancelled" || sprintRun.status === "cancel_requested") {
      throw new Error(`Sprint run ${sprintRunId} is already terminal.`);
    }
    const now = new Date().toISOString();
    const updated = this.deps.executionRepository.updateSprintRun(sprintRunId, {
      status: "paused",
      lastHeartbeatAt: now,
    });
    this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_pause_requested", "user", {
      requestedBy: "dashboard",
    }, {
      sourceEventKey: `dashboard-pause:${sprintRunId}`,
    });
    return updated;
  }

  cancelSprintRun(sprintRunId: string): SprintRunRecord {
    const sprintRun = this.requireSprintRun(sprintRunId);
    if (sprintRun.status === "completed" || sprintRun.status === "failed" || sprintRun.status === "cancelled") {
      throw new Error(`Sprint run ${sprintRunId} is already terminal.`);
    }
    if (sprintRun.status === "cancel_requested") {
      return sprintRun;
    }

    const now = new Date().toISOString();
    const updated = this.deps.executionRepository.updateSprintRun(sprintRunId, {
      status: "cancel_requested",
      lastHeartbeatAt: now,
    });
    this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_cancel_requested", "user", {
      requestedBy: "dashboard",
    }, {
      sourceEventKey: `dashboard-cancel:${sprintRunId}`,
    });

    for (const dispatch of this.deps.executionRepository.listTaskDispatches({
      projectId: sprintRun.projectId,
      sprintRunId,
    })) {
      if (dispatch.status === "queued" || dispatch.status === "claimed") {
        this.cancelDispatchInternal(dispatch, now, "Sprint run was cancelled from the dashboard.");
        continue;
      }
      if (dispatch.status === "running") {
        void this.requestRunningDispatchStop(dispatch, "Sprint run was cancelled from the dashboard.");
      }
    }

    return this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(sprintRunId) || updated;
  }

  async forceCancelSprintRun(sprintRunId: string): Promise<SprintRunRecord> {
    const sprintRun = this.requireSprintRun(sprintRunId);
    if (sprintRun.status === "completed" || sprintRun.status === "failed" || sprintRun.status === "cancelled") {
      return sprintRun;
    }

    const now = new Date().toISOString();
    for (const dispatch of this.deps.executionRepository.listTaskDispatches({
      projectId: sprintRun.projectId,
      sprintRunId,
    })) {
      if (!["queued", "claimed", "running", "cancel_requested"].includes(dispatch.status)) {
        continue;
      }
      await this.forceCancelDispatchInternal(dispatch, now, "Sprint run was force-cancelled from the dashboard.");
    }

    this.deps.executionRepository.releaseLease("sprint", sprintRun.sprintId);
    const updated = this.deps.executionRepository.updateSprintRun(sprintRunId, {
      status: "cancelled",
      finishedAt: now,
      lastHeartbeatAt: now,
    });
    this.deps.executionRepository.appendSprintRunEvent(sprintRunId, "sprint_cancelled", "user", {
      requestedBy: "dashboard",
      reason: "force_cancelled",
    }, {
      sourceEventKey: `dashboard-force-cancel:${sprintRunId}`,
    });

    return updated;
  }

  async cancelTaskDispatch(dispatchId: string): Promise<TaskDispatchRecord> {
    const dispatch = this.requireTaskDispatch(dispatchId);
    if (dispatch.status === "queued" || dispatch.status === "claimed") {
      const now = new Date().toISOString();
      return this.cancelDispatchInternal(dispatch, now, "Dispatch was cancelled from the dashboard.");
    }

    if (dispatch.status === "paused") {
      const now = new Date().toISOString();
      return await this.forceCancelDispatchInternal(dispatch, now, "Dispatch was cancelled from the dashboard.");
    }

    if (dispatch.status !== "running") {
      throw new Error(`Only queued, claimed, paused, or running dispatches can be cancelled. Current status: ${dispatch.status}`);
    }

    return await this.requestRunningDispatchStop(dispatch, "Dispatch was cancelled from the dashboard.");
  }

  async pauseTaskDispatch(dispatchId: string): Promise<TaskDispatchRecord> {
    const dispatch = this.requireTaskDispatch(dispatchId);
    if (dispatch.status !== "running") {
      throw new Error(`Only running dispatches can be paused. Current status: ${dispatch.status}`);
    }

    const now = new Date().toISOString();
    const taskRun = this.requireTaskRunForDispatch(dispatch.id);

    if (dispatch.executorType === "jules") {
      if (taskRun?.sessionId) {
        try {
          await this.deps.julesApi.sendSessionMessage(
            taskRun.sessionId,
            "Task paused. Please halt your implementation.",
          );
          this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "jules_pause_requested", "user", {
            dispatchId: dispatch.id,
            sessionId: taskRun.sessionId,
          }, {
            sourceEventKey: `dashboard-jules-pause-request:${dispatch.id}`,
          });
        } catch (error) {
          this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "jules_pause_request_failed", "system", {
            dispatchId: dispatch.id,
            sessionId: taskRun.sessionId,
            errorMessage: error instanceof Error ? error.message : String(error),
          }, {
            sourceEventKey: `dashboard-jules-pause-request-failed:${dispatch.id}`,
          });
        }
      }
    }

    if (dispatch.executorType === "docker_cli") {
      // NOTE: We don't have a specific `activeDispatchRegistry.requestPause`,
      // so for now we fallback to stop, or we just let it keep running and let it hit a lease timeout.
      // But we will mark it paused in DB so that it correctly updates.
      // For now we will call requestStop to avoid keeping the container running.
      await this.deps.activeDispatchRegistry.requestStop(dispatch.id, "Dispatch paused from the dashboard.").catch(() => undefined);
    }

    this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);

    const updated = this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
      status: "paused",
      lastHeartbeatAt: now,
    });

    if (taskRun) {
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        state: "PAUSED",
        durationMs: this.calculateDurationMs(taskRun, now),
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_paused", "user", {
        dispatchId: dispatch.id,
        requestedBy: "dashboard",
      }, {
        sourceEventKey: `dashboard-dispatch-pause:${dispatch.id}`,
      });
    }

    this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
      status: "pending",
    });

    return updated;
  }

  async forceCancelTaskDispatch(dispatchId: string): Promise<TaskDispatchRecord> {
    const dispatch = this.requireTaskDispatch(dispatchId);
    if (dispatch.status === "completed" || dispatch.status === "failed" || dispatch.status === "cancelled" || dispatch.status === "blocked") {
      return dispatch;
    }

    const now = new Date().toISOString();
    return await this.forceCancelDispatchInternal(dispatch, now, "Dispatch was force-cancelled from the dashboard.");
  }

  async retryTaskDispatch(dispatchId: string): Promise<Subtask> {
    const dispatch = this.requireTaskDispatch(dispatchId);
    if (dispatch.status === "queued" || dispatch.status === "claimed" || dispatch.status === "running") {
      throw new Error(`Only terminal dispatches can be retried. Current status: ${dispatch.status}`);
    }

    const task = this.deps.projectManagementRepository.getTask(dispatch.taskId);
    if (!task) {
      throw new Error(`Task not found for dispatch: ${dispatchId}`);
    }

    this.deps.executionRepository.appendTaskRunEvent(
      this.requireTaskRunForDispatch(dispatchId)?.id || this.ensureSyntheticTaskRun(dispatch),
      "dispatch_retry_requested",
      "user",
      {
        dispatchId,
        requestedBy: "dashboard",
      },
      {
        sourceEventKey: `dashboard-retry:${dispatchId}`,
      },
    );

    this.deps.projectAttentionService.resolveItemsForDispatch(dispatchId, "dispatch_retry_requested");

    if (!this.deps.taskRerunService) {
      throw new Error("taskRerunService not initialized");
    }

    return await this.deps.taskRerunService.rerunTask(task.id);
  }

  private cancelDispatchInternal(dispatch: TaskDispatchRecord, now: string, message: string): TaskDispatchRecord {
    const updated = this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
      status: "cancelled",
      finishedAt: now,
      lastHeartbeatAt: now,
      errorMessage: message,
    });
    const taskRun = this.requireTaskRunForDispatch(dispatch.id);
    if (taskRun) {
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        state: "BLOCKED",
        finishedAt: now,
        durationMs: this.calculateDurationMs(taskRun, now),
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_cancelled", "user", {
        dispatchId: dispatch.id,
        requestedBy: "dashboard",
        reason: message,
      }, {
        sourceEventKey: `dashboard-dispatch-cancel:${dispatch.id}`,
      });
    }
    this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
      status: "pending",
    });
    return updated;
  }

  private async requestRunningDispatchStop(dispatch: TaskDispatchRecord, message: string): Promise<TaskDispatchRecord> {
    const now = new Date().toISOString();
    const taskRun = this.requireTaskRunForDispatch(dispatch.id);
    if (dispatch.executorType === "jules") {
      if (taskRun?.sessionId) {
        try {
          await this.deps.julesApi.sendSessionMessage(
            taskRun.sessionId,
            "Task cancelled, please close this task now. Do not continue implementation.",
          );
          this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "jules_stop_requested", "user", {
            dispatchId: dispatch.id,
            sessionId: taskRun.sessionId,
          }, {
            sourceEventKey: `dashboard-jules-stop-request:${dispatch.id}`,
          });
        } catch (error) {
          this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "jules_stop_request_failed", "system", {
            dispatchId: dispatch.id,
            sessionId: taskRun.sessionId,
            errorMessage: error instanceof Error ? error.message : String(error),
          }, {
            sourceEventKey: `dashboard-jules-stop-request-failed:${dispatch.id}`,
          });
        }
      }

      return await this.forceCancelDispatchInternal(
        dispatch,
        now,
        "Jules dispatch was cancelled from the dashboard.",
        {
          force: false,
          skipJulesStop: true,
          sourceEventKey: `dashboard-dispatch-cancel:${dispatch.id}`,
        },
      );
    }

    const updated = this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
      status: "cancel_requested",
      lastHeartbeatAt: now,
      errorMessage: message,
    });
    if (taskRun) {
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_cancel_requested", "user", {
        dispatchId: dispatch.id,
        requestedBy: "dashboard",
        reason: message,
      }, {
        sourceEventKey: `dashboard-dispatch-cancel-request:${dispatch.id}`,
      });
    }

    if (dispatch.executorType === "docker_cli") {
      await this.deps.activeDispatchRegistry.requestStop(dispatch.id, message);
      return this.deps.executionRepository.getTaskDispatch(dispatch.id) || updated;
    }

    return this.deps.executionRepository.getTaskDispatch(dispatch.id) || updated;
  }

  private async forceCancelDispatchInternal(
    dispatch: TaskDispatchRecord,
    now: string,
    message: string,
    options: {
      force?: boolean;
      skipJulesStop?: boolean;
      sourceEventKey?: string;
    } = {},
  ): Promise<TaskDispatchRecord> {
    const taskRun = this.requireTaskRunForDispatch(dispatch.id);
    const force = options.force ?? true;

    if (dispatch.executorType === "docker_cli") {
      await this.deps.activeDispatchRegistry.requestStop(dispatch.id, message).catch(() => undefined);
    }

    if (dispatch.executorType === "jules" && taskRun?.sessionId && !options.skipJulesStop) {
      await this.deps.julesApi.sendSessionMessage(
        taskRun.sessionId,
        "Task cancelled. Please close this task now.",
      ).catch(() => undefined);
    }

    this.deps.executionRepository.releaseLease("task_dispatch", dispatch.id);
    const updated = this.deps.executionRepository.updateTaskDispatch(dispatch.id, {
      connectionId: null,
      status: "cancelled",
      finishedAt: now,
      lastHeartbeatAt: now,
      errorMessage: message,
    });

    if (taskRun) {
      this.deps.executionRepository.updateTaskRun(taskRun.id, {
        connectionId: null,
        state: "BLOCKED",
        finishedAt: now,
        durationMs: this.calculateDurationMs(taskRun, now),
      });
      this.deps.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_cancelled", "user", {
        dispatchId: dispatch.id,
        requestedBy: "dashboard",
        reason: message,
        force,
      }, {
        sourceEventKey: options.sourceEventKey || `dashboard-force-dispatch-cancel:${dispatch.id}`,
      });
    }

    this.deps.projectManagementRepository.updateTask(dispatch.taskId, {
      status: "pending",
    });

    if (dispatch.sprintRunId) {
      this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(dispatch.sprintRunId);
    }

    return updated;
  }

  private ensureSyntheticTaskRun(dispatch: TaskDispatchRecord): string {
    const taskRun = this.deps.executionRepository.createTaskRun({
      projectId: dispatch.projectId,
      sprintId: dispatch.sprintId,
      taskId: dispatch.taskId,
      sprintRunId: dispatch.sprintRunId,
      dispatchId: dispatch.id,
      state: "BLOCKED",
      startedAt: dispatch.startedAt || dispatch.queuedAt,
      finishedAt: dispatch.finishedAt || new Date().toISOString(),
    });
    return taskRun.id;
  }

  private requireSprintRun(sprintRunId: string): SprintRunRecord {
    const sprintRun = this.deps.executionRepository.getSprintRun(sprintRunId);
    if (!sprintRun) {
      throw new Error(`Sprint run not found: ${sprintRunId}`);
    }
    return sprintRun;
  }

  private requireTaskDispatch(dispatchId: string): TaskDispatchRecord {
    const dispatch = this.deps.executionRepository.getTaskDispatch(dispatchId);
    if (!dispatch) {
      throw new Error(`Task dispatch not found: ${dispatchId}`);
    }
    return dispatch;
  }

  private requireTaskRunForDispatch(dispatchId: string): TaskRunRecord | null {
    return this.deps.executionRepository.getTaskRunByDispatchId(dispatchId);
  }

  private calculateDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
    if (!taskRun.startedAt) {
      return null;
    }
    return Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime());
  }

  private resolveBlockingSprintRun(projectId: string, sprintId: string): SprintRunRecord | null {
    const activeRun = this.deps.executionRepository.findActiveSprintRun(projectId, sprintId);
    if (!activeRun) {
      return null;
    }

    if (activeRun.status === "cancel_requested") {
      const finalized = this.deps.executionRepository.finalizeSprintRunCancellationIfIdle(activeRun.id);
      if (finalized?.status === "cancelled") {
        return null;
      }
      return activeRun;
    }

    if (activeRun.status === "running" || activeRun.status === "queued") {
      return activeRun;
    }

    return null;
  }
}
