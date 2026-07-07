import { randomUUID } from "crypto";
import type { DashboardSettings, DashboardSettingsScope } from "../contracts/app-types.js";
import type { TaskDispatchExecutorType, WorkerTaskDispatchClaim, TaskRunState } from "../contracts/execution-types.js";
import type { McpConnectionRecord } from "../contracts/connection-chat-types.js";
import type { WorkerExecutionMode } from "../contracts/app-types.js";
import type { UpsertExternalWorkerEndpointInput, WorkerEndpointRecord } from "../contracts/worker-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../repositories/connection-chat-repository.js";
import { WorkerEndpointRepository } from "../repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentService } from "../domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionService } from "../domain/workers/project-attention-service.js";
import type { MemoryService } from "./memory-service.js";
import type { Logger } from "../shared/logging/logger.js";
import type { SprintRunLifecycleService } from "./sprint-run-lifecycle-service.js";
import { isAssignableWorkerStatus } from "../domain/workers/worker-status-utils.js";
import { formatSprintBranch } from "../domain/sprint/branch-name-generator.js";

export interface PullWorkerTaskDispatchArgs {
  connectionKey: string;
  projectId?: string;
  sprintId?: string;
}

export interface RegisterExternalWorkerEndpointArgs extends UpsertExternalWorkerEndpointInput {}

export interface UpdateWorkerTaskDispatchArgs {
  connectionKey: string;
  dispatchId: string;
  leaseToken: string;
  state: Extract<TaskRunState, "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED" | "QUOTA">;
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
    private readonly getDashboardSettings: (scope?: DashboardSettingsScope) => DashboardSettings,
    private readonly resolveWorkerExecutionMode: (projectId: string, sprintId?: string | null) => WorkerExecutionMode = () => "VIRTUAL",
    private readonly logger?: Logger,
    private readonly memoryService?: MemoryService,
    private readonly resolveWorkerAgentPresetId?: (projectId: string) => Promise<string | undefined>,
    private readonly sprintRunLifecycleService?: Pick<SprintRunLifecycleService, "finalizeCancellationIfIdle">,
  ) {}

  pullNextDispatch(args: PullWorkerTaskDispatchArgs): WorkerTaskDispatchClaim | null {
    const { connection, workerEndpoint } = this.requireWorkerConnection(args.connectionKey);
    const projectIds = this.resolveProjectIds(connection, args.projectId);
    this.connectionChatRepository.touchConnectionHeartbeat(connection.id, "listening");
    const refreshedEndpoint = this.workerEndpointRepository.getWorkerEndpointByConnectionId(connection.id);
    if (refreshedEndpoint) {
      this.workerEndpointRepository.touchWorkerEndpointHeartbeat(refreshedEndpoint.id, "connected");
    }
    for (const projectId of projectIds) {
      const claim = this.claimNextDispatchForWorker({
        projectId,
        workerEndpointId: refreshedEndpoint?.id || workerEndpoint.id,
        executionMode: this.resolveWorkerExecutionMode(projectId, args.sprintId),
        ownerKey: `worker:${args.connectionKey}`,
        connectionId: connection.id,
        connectionKey: connection.connectionKey,
        sprintId: args.sprintId,
        executorType: "mcp_worker",
      });
      if (claim) {
        return claim;
      }
    }
    return null;
  }

  registerExternalWorkerEndpoint(args: RegisterExternalWorkerEndpointArgs): WorkerEndpointRecord {
    const endpoint = this.workerEndpointRepository.upsertExternalWorkerEndpoint(args);
    const activeProjectIds = args.activeProjectIds && args.activeProjectIds.length > 0
      ? args.activeProjectIds
      : args.projectIds || [];
    for (const projectId of activeProjectIds) {
      this.projectWorkerAssignmentService.ensureWorkerAssignment(projectId, endpoint.id);
    }
    return endpoint;
  }

  claimNextDispatchForWorker(args: {
    projectId: string;
    workerEndpointId: string;
    executionMode: WorkerExecutionMode;
    ownerKey?: string;
    connectionId?: string | null;
    connectionKey?: string | null;
    sprintId?: string;
    executorType?: TaskDispatchExecutorType;
  }): WorkerTaskDispatchClaim | null {
    const workerEndpoint = this.requireWorkerEndpoint(args.workerEndpointId);
    if (!workerEndpoint.capabilities.canExecuteTasks || !isAssignableWorkerStatus(workerEndpoint.status)) {
      return null;
    }
    const assignment = workerEndpoint.endpointType === "virtual_cli"
      ? this.projectWorkerAssignmentService.ensureWorkerAssignment(args.projectId, workerEndpoint.id)
      : this.projectWorkerAssignmentService.getActiveWorkerAssignment(args.projectId, workerEndpoint.id);
    if (!assignment) {
      return null;
    }
    if (!assignment.capabilities.canExecuteTasks || !isAssignableWorkerStatus(assignment.workerStatus)) {
      return null;
    }

    const executorType = args.executorType || this.resolveDispatchExecutorType(args.executionMode);
    const claimed = this.executionRepository.claimNextTaskDispatch({
      projectId: args.projectId,
      sprintId: args.sprintId,
      executorType,
      connectionId: args.connectionId ?? workerEndpoint.connectionId,
      ownerKey: args.ownerKey || workerEndpoint.endpointKey,
      leaseToken: randomUUID(),
      leaseExpiresAt: this.createLeaseExpiry(),
    });
    if (!claimed) {
      return null;
    }

    this.projectWorkerAssignmentService.noteWorkerActivity(claimed.projectId, workerEndpoint.id);
    this.workerEndpointRepository.touchWorkerEndpointHeartbeat(workerEndpoint.id, "connected");
    return this.buildDispatchClaim(claimed, claimed.leaseToken);
  }

  updateDispatch(args: UpdateWorkerTaskDispatchArgs): UpdateWorkerTaskDispatchResult {
    const { connection, workerEndpoint } = this.requireWorkerConnection(args.connectionKey);
    return this.updateDispatchForWorker({
      ...args,
      workerEndpointId: workerEndpoint.id,
      connectionId: connection.id,
      connectionKey: connection.connectionKey,
    });
  }

  updateDispatchForWorker(args: Omit<UpdateWorkerTaskDispatchArgs, "connectionKey"> & {
    workerEndpointId: string;
    connectionId?: string | null;
    connectionKey?: string | null;
  }): UpdateWorkerTaskDispatchResult {
    const workerEndpoint = this.requireWorkerEndpoint(args.workerEndpointId);
    const dispatch = this.requireDispatch(args.dispatchId);
    const taskRun = this.requireTaskRun(dispatch.id);
    const lease = this.executionRepository.getLease("task_dispatch", dispatch.id);

    if (!lease || lease.leaseToken !== args.leaseToken) {
      throw new Error(`Worker lease is not active for dispatch ${dispatch.id}`);
    }
    if (dispatch.connectionId && args.connectionId && dispatch.connectionId !== args.connectionId) {
      throw new Error(`Dispatch ${dispatch.id} is assigned to another connection.`);
    }

    const now = new Date().toISOString();
    this.projectWorkerAssignmentService.noteWorkerActivity(dispatch.projectId, workerEndpoint.id);
    const cancelRequested = dispatch.status === "cancel_requested";
    const pauseRequested = dispatch.status === "paused";
    const taskUpdateStatus = cancelRequested || pauseRequested
      ? "pending"
      : args.state === "COMPLETED"
        ? "coding_completed"
        : args.state === "RUNNING"
          ? "in_progress"
          : args.state === "QUOTA"
            ? "in_progress"
            : "pending";

    const nextDispatch = this.executionRepository.updateTaskDispatch(dispatch.id, {
      connectionId: args.connectionId ?? dispatch.connectionId ?? null,
      status: this.mapTaskRunStateToDispatchStatus(args.state, cancelRequested, pauseRequested),
      startedAt: dispatch.startedAt || now,
      finishedAt: args.state === "RUNNING" && !pauseRequested ? dispatch.finishedAt : now,
      lastHeartbeatAt: now,
      errorMessage: args.errorMessage === undefined ? dispatch.errorMessage : args.errorMessage,
    });

    this.executionRepository.updateTaskRun(taskRun.id, {
      connectionId: args.connectionId ?? taskRun.connectionId ?? null,
      provider: args.provider === undefined ? taskRun.provider : args.provider,
      mode: taskRun.mode ?? "docker_cli",
      sessionId: args.sessionId === undefined ? taskRun.sessionId : args.sessionId,
      sessionName: args.sessionName === undefined ? taskRun.sessionName : args.sessionName,
      state: pauseRequested ? "PAUSED" : args.state,
      workerBranch: args.workerBranch === undefined ? taskRun.workerBranch : args.workerBranch,
      prUrl: args.prUrl === undefined ? taskRun.prUrl : args.prUrl,
      startedAt: taskRun.startedAt || now,
      finishedAt: args.state === "RUNNING" && !pauseRequested ? null : now,
      durationMs: args.state === "RUNNING" && !pauseRequested || !(taskRun.startedAt || nextDispatch.startedAt)
        ? null
        : Math.max(0, new Date(now).getTime() - new Date(taskRun.startedAt || nextDispatch.startedAt || now).getTime()),
    });

    this.projectManagementRepository.updateTask(dispatch.taskId, {
      status: taskUpdateStatus,
    });

    this.executionRepository.appendTaskRunEvent(taskRun.id, this.mapTaskRunStateToEventType(args.state, cancelRequested, pauseRequested), args.connectionId ? "connection" : "system", {
      dispatchId: dispatch.id,
      connectionId: args.connectionId ?? null,
      connectionKey: args.connectionKey ?? null,
      workerEndpointId: workerEndpoint.id,
      workerEndpointKey: workerEndpoint.endpointKey,
      provider: args.provider ?? taskRun.provider,
      sessionId: args.sessionId ?? taskRun.sessionId,
      sessionName: args.sessionName ?? taskRun.sessionName,
      workerBranch: args.workerBranch ?? taskRun.workerBranch,
      prUrl: args.prUrl ?? taskRun.prUrl,
      summaryMarkdown: args.summaryMarkdown ?? null,
      errorMessage: args.errorMessage ?? null,
    });

    if (args.state === "COMPLETED" && args.summaryMarkdown?.trim()) {
      this.captureDispatchSummaryMemory(dispatch, args.summaryMarkdown);
    }

    if (args.state === "RUNNING" && !pauseRequested) {
      this.executionRepository.renewLease({
        scopeType: "task_dispatch",
        scopeId: dispatch.id,
        leaseToken: args.leaseToken,
        expiresAt: this.createLeaseExpiry(),
      });
      if (args.connectionId) {
        this.connectionChatRepository.touchConnectionHeartbeat(args.connectionId, "connected");
      }
      this.logger?.debug("Worker heartbeat updated", {
        connectionKey: args.connectionKey ?? null,
        workerEndpointId: workerEndpoint.id,
        dispatchId: dispatch.id,
        state: args.state,
      });
      return {
        dispatch: nextDispatch,
        controlAction: cancelRequested ? "cancel" : null,
      };
    }

    if (pauseRequested) {
        return {
            dispatch: nextDispatch,
            controlAction: "cancel",
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
      if (!this.sprintRunLifecycleService) {
        throw new Error("Sprint run lifecycle service is required to finalize sprint cancellation.");
      }
      this.sprintRunLifecycleService.finalizeCancellationIfIdle(nextDispatch.sprintRunId);
    }
    if (args.connectionId) {
      this.connectionChatRepository.touchConnectionHeartbeat(args.connectionId, "listening");
    }
    this.logger?.info("Worker finished task dispatch", {
      connectionKey: args.connectionKey ?? null,
      workerEndpointId: workerEndpoint.id,
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

  private requireWorkerEndpoint(workerEndpointId: string): NonNullable<ReturnType<WorkerEndpointRepository["getWorkerEndpoint"]>> {
    const workerEndpoint = this.workerEndpointRepository.getWorkerEndpoint(workerEndpointId);
    if (!workerEndpoint) {
      throw new Error(`Worker endpoint not found: ${workerEndpointId}.`);
    }
    return workerEndpoint;
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
    return dispatch;
  }

  private requireTaskRun(dispatchId: string) {
    const taskRun = this.executionRepository.getTaskRunByDispatchId(dispatchId);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${dispatchId}`);
    }
    return taskRun;
  }

  private resolveDispatchExecutorType(executionMode: WorkerExecutionMode): TaskDispatchExecutorType {
    switch (executionMode) {
      case "VIRTUAL":
      default:
        return "docker_cli";
    }
  }

  private buildDispatchClaim(
    dispatch: WorkerTaskDispatchClaim["dispatch"],
    leaseToken: string,
  ): WorkerTaskDispatchClaim {
    const project = this.requireProject(dispatch.projectId);
    const sprint = this.requireSprint(dispatch.sprintId);
    const task = this.requireTask(dispatch.taskId);
    const settings = this.getDashboardSettings({
      projectId: dispatch.projectId,
      sprintId: dispatch.sprintId,
    });
    const sprintNumber = sprint.number ?? 0;
    const defaultBranch = project.defaultBranch || settings.git?.defaultBranch || "main";
    const featureBranch = sprint.featureBranch?.trim()
      || formatSprintBranch(settings.git.sprintBranchScheme, {
        sprint_key_prefix: settings.git.sprintKeyPrefix,
        sprint_number: sprintNumber,
        sprint_name: sprint.name || "",
        sprint_id: sprint.slug || "",
        planning_agent: settings.agents.routing.planning.agentPresetId || "default",
        agent_routing: settings.agents.routing.taskCoding.mode,
        worker_agent: settings.agents.routing.taskCoding.agentPresetId || "default",
        worker_provider: settings.workers.virtualWorkerProvider,
        worker_model: settings.workers.model,
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
        dependsOnTaskIds: [...task.dependsOnTaskIds],
        executorType: task.executorType,
      },
      executionContext: {
        repoPath: project.baseDir,
        defaultBranch,
        featureBranch,
      },
    };
  }

  private mapTaskRunStateToDispatchStatus(
    state: UpdateWorkerTaskDispatchArgs["state"] | "PAUSED",
    cancelRequested: boolean,
    pauseRequested: boolean,
  ) {
    if (pauseRequested) {
      if (state === "RUNNING") {
        return "paused";
      }
      return "paused";
    }
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
      case "QUOTA":
        return "quota";
      case "PAUSED":
        return "paused";
      case "RUNNING":
      default:
        return "running";
    }
  }

  private mapTaskRunStateToEventType(
    state: UpdateWorkerTaskDispatchArgs["state"] | "PAUSED",
    cancelRequested: boolean,
    pauseRequested: boolean,
  ): string {
    if (pauseRequested) {
      return state === "RUNNING" ? "worker_pause_pending" : "worker_paused";
    }
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
      case "QUOTA":
        return "worker_quota";
      case "PAUSED":
        return "worker_paused";
      case "RUNNING":
      default:
        return "worker_heartbeat";
    }
  }

  private createLeaseExpiry(): string {
    return new Date(Date.now() + 5 * 60 * 1000).toISOString();
  }

  private captureDispatchSummaryMemory(
    dispatch: ReturnType<ExecutionRepository["getTaskDispatch"]> & { projectId: string; taskId: string; sprintId?: string | null },
    summaryMarkdown: string,
  ): void {
    if (!this.memoryService) return;
    const settings = this.getDashboardSettings({
      projectId: dispatch.projectId,
      sprintId: dispatch.sprintId ?? undefined,
    });
    if (!settings.memory?.enabled || !settings.memory.autoCaptureSprint) return;

    const task = this.projectManagementRepository.getTask(dispatch.taskId);
    const content = `Worker completed task ${task?.taskKey || dispatch.taskId}: ${task?.title || "unknown"}.\n\nSummary:\n${summaryMarkdown.trim()}`;

    const createMemory = (agentPresetId?: string) => {
      this.memoryService!.createMemory(dispatch.projectId, {
        scope: "sprint",
        sprintId: dispatch.sprintId ?? undefined,
        agentPresetId: agentPresetId ?? null,
        content,
        category: "context",
        strength: 0.7,
        source: {
          type: "auto_capture",
          originType: "worker_dispatch_summary",
          originId: dispatch.id,
        },
      }).catch((err) => {
        this.logger?.warn("Failed to capture dispatch summary memory", {
          dispatchId: dispatch.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    };

    if (this.resolveWorkerAgentPresetId) {
      this.resolveWorkerAgentPresetId(dispatch.projectId)
        .then((id) => createMemory(id))
        .catch(() => createMemory());
    } else {
      createMemory();
    }
  }
}
