import { randomUUID } from "crypto";
import { formatSprintBranch } from "../git/sprint-branch-scheme.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { WorkerTaskDispatchClaim, TaskRunState } from "../contracts/execution-types.js";
import type { McpConnectionRecord } from "../contracts/connection-chat-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { WorkerEndpointRepository } from "../repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { Logger } from "../shared/logging/logger.js";

export interface PullWorkerTaskDispatchArgs {
  connectionKey: string;
  projectId?: string;
  sprintId?: string;
}

export interface UpdateWorkerTaskDispatchArgs {
  connectionKey: string;
  dispatchId: string;
  leaseToken: string;
  state: Extract<TaskRunState, "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED">;
  provider?: string;
  sessionId?: string;
  sessionName?: string;
  workerBranch?: string;
  prUrl?: string;
  summaryMarkdown?: string;
  errorMessage?: string;
}

export interface UpdateWorkerTaskDispatchResult {
  dispatch: WorkerTaskDispatchClaim["dispatch"];
  controlAction: "cancel" | null;
}

export class WorkerTaskDispatchService {
  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly connectionChatRepository: ConnectionChatRepository,
    private readonly workerEndpointRepository: WorkerEndpointRepository,
    private readonly projectWorkerAssignmentService: ProjectWorkerAssignmentService,
    private readonly projectAttentionService: ProjectAttentionService,
    private readonly getDashboardSettings: () => DashboardSettings,
    private readonly logger?: Logger,
  ) {}

  pullNextDispatch(args: PullWorkerTaskDispatchArgs): WorkerTaskDispatchClaim | null {
    const { connection, workerEndpoint } = this.requireWorkerConnection(args.connectionKey);
    const projectIds = this.resolveProjectIds(connection, args.projectId);

    for (const projectId of projectIds) {
      const claimed = this.executionRepository.claimNextTaskDispatch({
        projectId,
        sprintId: args.sprintId,
        executorType: "mcp_worker",
        connectionId: connection.id,
      });
      if (!claimed) {
        continue;
      }

      const now = new Date().toISOString();
      const leaseToken = randomUUID();
      this.executionRepository.acquireLease({
        scopeType: "task_dispatch",
        scopeId: claimed.id,
        ownerKey: connection.connectionKey,
        leaseToken,
        expiresAt: this.createLeaseExpiry(),
      });

      const dispatch = this.executionRepository.updateTaskDispatch(claimed.id, {
        connectionId: connection.id,
        status: "running",
        startedAt: claimed.startedAt || now,
        lastHeartbeatAt: now,
      });
      const taskRun = this.requireTaskRun(dispatch.id);
      this.executionRepository.updateTaskRun(taskRun.id, {
        connectionId: connection.id,
        mode: "mcp_worker",
        state: "RUNNING",
        startedAt: taskRun.startedAt || now,
      });

      const project = this.requireProject(dispatch.projectId);
      const sprint = this.requireSprint(dispatch.sprintId);
      const task = this.requireTask(dispatch.taskId);
      this.projectWorkerAssignmentService.noteWorkerActivity(project.id, workerEndpoint.id);
      const featureBranch = sprint.featureBranch?.trim()
        || (typeof sprint.number === "number"
          ? formatSprintBranch(this.getDashboardSettings().git.sprintBranchScheme, sprint.number)
          : this.getDashboardSettings().git.featureBranchPrefix + task.taskKey.toLowerCase());
      const defaultBranch = project.defaultBranch?.trim() || this.getDashboardSettings().git.defaultBranch || "main";
      const repoPath = project.baseDir;

      this.projectManagementRepository.updateTask(task.id, {
        status: "in_progress",
      });
      this.executionRepository.appendTaskRunEvent(taskRun.id, "worker_claimed", "connection", {
        dispatchId: dispatch.id,
        connectionId: connection.id,
        connectionKey: connection.connectionKey,
      });
      this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "connected");
      this.logger?.info("Worker claimed task dispatch", {
        connectionKey: connection.connectionKey,
        dispatchId: dispatch.id,
        taskId: task.id,
        projectId: project.id,
        sprintId: sprint.id,
      });

      return {
        dispatch,
        leaseToken,
        project: {
          id: project.id,
          name: project.name,
          baseDir: project.baseDir,
          sourceType: project.sourceType,
          sourceRef: project.sourceRef,
          defaultBranch: project.defaultBranch,
          featureBranchPrefix: project.featureBranchPrefix,
        },
        sprint: {
          id: sprint.id,
          name: sprint.name,
          number: sprint.number,
          goal: sprint.goal,
          featureBranch: sprint.featureBranch,
        },
        task: {
          id: task.id,
          taskKey: task.taskKey,
          title: task.title,
          promptMarkdown: task.promptMarkdown,
          description: task.description,
          priority: task.priority,
          dependsOnTaskIds: task.dependsOnTaskIds,
          executorType: task.executorType,
        },
        executionContext: {
          repoPath,
          defaultBranch,
          featureBranch,
        },
      };
    }

    this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "listening");
    return null;
  }

  updateDispatch(args: UpdateWorkerTaskDispatchArgs): UpdateWorkerTaskDispatchResult {
    const { connection, workerEndpoint } = this.requireWorkerConnection(args.connectionKey);
    const dispatch = this.requireDispatch(args.dispatchId);
    const taskRun = this.requireTaskRun(dispatch.id);
    const lease = this.executionRepository.getLease("task_dispatch", dispatch.id);

    if (!lease || lease.leaseToken !== args.leaseToken) {
      throw new Error(`Worker lease is not active for dispatch ${dispatch.id}`);
    }
    if (dispatch.connectionId && dispatch.connectionId !== connection.id) {
      throw new Error(`Dispatch ${dispatch.id} is assigned to another connection.`);
    }

    const now = new Date().toISOString();
    this.projectWorkerAssignmentService.noteWorkerActivity(dispatch.projectId, workerEndpoint.id);
    const cancelRequested = dispatch.status === "cancel_requested";
    const taskUpdateStatus = cancelRequested
      ? "pending"
      : args.state === "COMPLETED"
      ? "completed"
      : args.state === "RUNNING"
        ? "in_progress"
        : "pending";

    const nextDispatch = this.executionRepository.updateTaskDispatch(dispatch.id, {
      connectionId: connection.id,
      status: this.mapTaskRunStateToDispatchStatus(args.state, cancelRequested),
      startedAt: dispatch.startedAt || now,
      finishedAt: args.state === "RUNNING" ? dispatch.finishedAt : now,
      lastHeartbeatAt: now,
      errorMessage: args.errorMessage === undefined ? dispatch.errorMessage : args.errorMessage,
    });

    this.executionRepository.updateTaskRun(taskRun.id, {
      connectionId: connection.id,
      provider: args.provider === undefined ? taskRun.provider : args.provider,
      mode: "mcp_worker",
      sessionId: args.sessionId === undefined ? taskRun.sessionId : args.sessionId,
      sessionName: args.sessionName === undefined ? taskRun.sessionName : args.sessionName,
      state: args.state,
      workerBranch: args.workerBranch === undefined ? taskRun.workerBranch : args.workerBranch,
      prUrl: args.prUrl === undefined ? taskRun.prUrl : args.prUrl,
      startedAt: taskRun.startedAt || now,
      finishedAt: args.state === "RUNNING" ? null : now,
      durationMs: args.state === "RUNNING" || !(taskRun.startedAt || nextDispatch.startedAt)
        ? null
        : Math.max(0, new Date(now).getTime() - new Date(taskRun.startedAt || nextDispatch.startedAt || now).getTime()),
    });

    this.projectManagementRepository.updateTask(dispatch.taskId, {
      status: taskUpdateStatus,
    });

    this.executionRepository.appendTaskRunEvent(taskRun.id, this.mapTaskRunStateToEventType(args.state, cancelRequested), "connection", {
      dispatchId: dispatch.id,
      connectionId: connection.id,
      connectionKey: connection.connectionKey,
      provider: args.provider ?? taskRun.provider,
      sessionId: args.sessionId ?? taskRun.sessionId,
      sessionName: args.sessionName ?? taskRun.sessionName,
      workerBranch: args.workerBranch ?? taskRun.workerBranch,
      prUrl: args.prUrl ?? taskRun.prUrl,
      summaryMarkdown: args.summaryMarkdown ?? null,
      errorMessage: args.errorMessage ?? null,
    });

    if (args.state === "RUNNING") {
      this.executionRepository.renewLease({
        scopeType: "task_dispatch",
        scopeId: dispatch.id,
        leaseToken: args.leaseToken,
        expiresAt: this.createLeaseExpiry(),
      });
      this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "connected");
      this.logger?.debug("Worker heartbeat updated", {
        connectionKey: connection.connectionKey,
        dispatchId: dispatch.id,
        state: args.state,
      });
      return {
        dispatch: nextDispatch,
        controlAction: cancelRequested ? "cancel" : null,
      };
    }

    this.executionRepository.releaseLease("task_dispatch", dispatch.id, args.leaseToken);
    if (args.state === "COMPLETED") {
      this.projectAttentionService.resolveItemsForDispatch(dispatch.id, "worker_completed_dispatch");
    } else if (args.state === "FAILED") {
      this.projectAttentionService.resolveItemsForDispatch(dispatch.id, "worker_failed_dispatch");
    } else if (args.state === "BLOCKED") {
      this.projectAttentionService.openItem({
        projectId: dispatch.projectId,
        sprintId: dispatch.sprintId,
        taskId: dispatch.taskId,
        sprintRunId: dispatch.sprintRunId,
        dispatchId: dispatch.id,
        attentionType: "worker_dispatch_blocked",
        severity: "high",
        ownerType: "worker",
        preferredWorkerEndpointId: workerEndpoint.id,
        title: `Worker blocked on task ${this.requireTask(dispatch.taskId).taskKey}`,
        summaryMarkdown: args.summaryMarkdown?.trim()
          || args.errorMessage?.trim()
          || "Worker marked the dispatch as blocked and requested follow-up supervision.",
        payload: {
          dispatchId: dispatch.id,
          taskId: dispatch.taskId,
          sprintId: dispatch.sprintId,
          provider: args.provider ?? taskRun.provider ?? null,
          sessionId: args.sessionId ?? taskRun.sessionId ?? null,
          sessionName: args.sessionName ?? taskRun.sessionName ?? null,
          workerBranch: args.workerBranch ?? taskRun.workerBranch ?? null,
          prUrl: args.prUrl ?? taskRun.prUrl ?? null,
          errorMessage: args.errorMessage ?? null,
        },
      });
    }
    if (nextDispatch.sprintRunId) {
      this.executionRepository.finalizeSprintRunCancellationIfIdle(nextDispatch.sprintRunId);
    }
    this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "listening");
    this.logger?.info("Worker finished task dispatch", {
      connectionKey: connection.connectionKey,
      dispatchId: dispatch.id,
      state: args.state,
    });
    return {
      dispatch: nextDispatch,
      controlAction: null,
    };
  }

  private requireWorkerConnection(connectionKey: string): { connection: McpConnectionRecord; workerEndpoint: NonNullable<ReturnType<WorkerEndpointRepository["getWorkerEndpointByConnectionId"]>> } {
    const connection = this.connectionChatRepository.getConnectionByKey(connectionKey);
    if (!connection) {
      throw new Error(`Connection not found for key: ${connectionKey}`);
    }
    if (connection.role !== "worker") {
      throw new Error(`Connection ${connectionKey} is not registered as a worker.`);
    }
    const workerEndpoint = this.workerEndpointRepository.getWorkerEndpointByConnectionId(connection.id);
    if (!workerEndpoint) {
      throw new Error(`Worker endpoint not found for connection ${connectionKey}.`);
    }
    if (!workerEndpoint.capabilities.canExecuteTasks) {
      throw new Error(`Worker ${connectionKey} cannot execute task dispatches.`);
    }
    return { connection, workerEndpoint };
  }

  private resolveProjectIds(
    connection: McpConnectionRecord,
    requestedProjectId?: string,
  ): string[] {
    if (requestedProjectId) {
      const projectId = requestedProjectId.trim();
      if (!projectId) {
        throw new Error("Project id cannot be blank.");
      }
      if (!connection.projectIds.includes(projectId)) {
        throw new Error(`Connection ${connection.connectionKey} is not bound to project ${projectId}`);
      }
      return [projectId];
    }

    const projectIds = connection.activeProjectIds.length > 0 ? connection.activeProjectIds : connection.projectIds;
    if (projectIds.length === 0) {
      throw new Error(`Connection ${connection.connectionKey} is not bound to any active project.`);
    }

    const affinityProjectIds = this.executionRepository.listWorkerProjectAffinity(connection.id);
    if (affinityProjectIds.length === 0) {
      return projectIds;
    }

    const availableProjectIds = new Set(projectIds);
    const orderedProjectIds: string[] = [];

    for (const projectId of affinityProjectIds) {
      if (availableProjectIds.has(projectId)) {
        orderedProjectIds.push(projectId);
        availableProjectIds.delete(projectId);
      }
    }

    for (const projectId of projectIds) {
      if (availableProjectIds.has(projectId)) {
        orderedProjectIds.push(projectId);
      }
    }

    return orderedProjectIds;
  }

  private requireProject(projectId: string) {
    const project = this.projectManagementRepository.getProject(projectId);
    if (!project) {
      throw new Error(`Project not found: ${projectId}`);
    }
    return project;
  }

  private requireSprint(sprintId: string) {
    const sprint = this.projectManagementRepository.getSprint(sprintId);
    if (!sprint) {
      throw new Error(`Sprint not found: ${sprintId}`);
    }
    return sprint;
  }

  private requireTask(taskId: string) {
    const task = this.projectManagementRepository.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return task;
  }

  private requireDispatch(dispatchId: string) {
    const dispatch = this.executionRepository.getTaskDispatch(dispatchId);
    if (!dispatch) {
      throw new Error(`Task dispatch not found: ${dispatchId}`);
    }
    if (dispatch.executorType !== "mcp_worker") {
      throw new Error(`Dispatch ${dispatchId} is not a worker dispatch.`);
    }
    return dispatch;
  }

  private requireTaskRun(dispatchId: string) {
    const taskRun = this.executionRepository.getTaskRunByDispatchId(dispatchId);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${dispatchId}`);
    }
    return taskRun;
  }

  private mapTaskRunStateToDispatchStatus(
    state: UpdateWorkerTaskDispatchArgs["state"],
    cancelRequested: boolean,
  ) {
    if (cancelRequested) {
      if (state === "RUNNING") {
        return "cancel_requested";
      }
      return "cancelled";
    }
    switch (state) {
      case "COMPLETED":
        return "completed";
      case "FAILED":
        return "failed";
      case "BLOCKED":
        return "blocked";
      case "RUNNING":
      default:
        return "running";
    }
  }

  private mapTaskRunStateToEventType(
    state: UpdateWorkerTaskDispatchArgs["state"],
    cancelRequested: boolean,
  ): string {
    if (cancelRequested) {
      return state === "RUNNING" ? "worker_cancel_pending" : "worker_cancelled";
    }
    switch (state) {
      case "COMPLETED":
        return "worker_completed";
      case "FAILED":
        return "worker_failed";
      case "BLOCKED":
        return "worker_blocked";
      case "RUNNING":
      default:
        return "worker_heartbeat";
    }
  }

  private createLeaseExpiry(): string {
    return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }
}
