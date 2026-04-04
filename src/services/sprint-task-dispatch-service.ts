import type { JulesSession, Subtask } from "../contracts/app-types.js";
import type { TaskDispatchExecutorType, TaskRunRecord } from "../contracts/execution-types.js";
import { ExecutionRepository } from "../repositories/execution-repository.js";
import { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import { TaskService } from "./task-service.js";
import type { Logger } from "../shared/logging/logger.js";

export interface StartSprintDispatchArgs {
  task: Subtask;
  projectId: string;
  sprintId: string;
  sprintRunId: string;
  sourceId?: string;
  featureBranch: string;
  repoPath: string;
  sprintNumber: number;
}

export interface StartSprintDispatchResult {
  id?: string;
  name?: string;
  provider?: string;
  runtimeLabel?: string;
}

export class SprintTaskDispatchService {
  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly taskService: TaskService,
    private readonly onWorkerDispatchQueued?: (projectId: string) => void,
    private readonly logger?: Logger,
  ) {}

  async startTask(args: StartSprintDispatchArgs): Promise<StartSprintDispatchResult> {
    const taskRecordId = this.requireTaskRecordId(args.task);
    const taskRecord = this.projectManagementRepository.getTask(taskRecordId);
    if (!taskRecord) {
      throw new Error(`Task record not found: ${taskRecordId}`);
    }

    const preferredExecutor = taskRecord.executorType;
    const settingsScope = {
      projectId: args.projectId,
      sprintId: args.sprintId,
    };
    const provider = this.taskService.resolveTaskProvider(args.task, settingsScope, preferredExecutor);
    const executorType: TaskDispatchExecutorType = preferredExecutor === "mcp_worker" && !args.task.provider
      ? "mcp_worker"
      : provider === "jules"
        ? "jules"
        : "docker_cli";
    const queuedAt = new Date().toISOString();
    const dispatch = this.executionRepository.createTaskDispatch({
      projectId: args.projectId,
      sprintId: args.sprintId,
      taskId: taskRecordId,
      sprintRunId: args.sprintRunId,
      executorType,
      queuedAt,
    });

    const taskRun = this.executionRepository.createTaskRun({
      projectId: args.projectId,
      sprintId: args.sprintId,
      taskId: taskRecordId,
      sprintRunId: args.sprintRunId,
      dispatchId: dispatch.id,
      provider,
      mode: executorType,
      state: "RUNNING",
      startedAt: queuedAt,
    });

    this.executionRepository.appendTaskRunEvent(taskRun.id, executorType === "mcp_worker" ? "dispatch_queued" : "dispatch_started", "system", {
      dispatchId: dispatch.id,
      executorType,
      provider,
    });
    this.projectManagementRepository.updateTask(taskRecordId, {
      status: "in_progress",
    });

    if (executorType === "mcp_worker") {
      this.onWorkerDispatchQueued?.(args.projectId);
      return {
        id: dispatch.id,
        name: `dispatches/${dispatch.id}`,
        runtimeLabel: "MCP WORKER",
      };
    }

    this.executionRepository.updateTaskDispatch(dispatch.id, {
      status: "running",
      claimedAt: queuedAt,
      startedAt: queuedAt,
      lastHeartbeatAt: queuedAt,
    });

    try {
      const session = await this.taskService.startSprintTask(
        args.task,
        args.sourceId,
        args.featureBranch,
        args.repoPath,
        args.sprintNumber,
        settingsScope,
        dispatch.id,
        taskRun.id,
      );
      const sessionName = session.name || null;
      const sessionId = session.id || null;
      const nextProvider = session.provider || provider;

      this.executionRepository.updateTaskRun(taskRun.id, {
        provider: nextProvider,
        sessionId,
        sessionName,
        workerBranch: this.resolveWorkerBranch(session),
        prUrl: this.resolvePrUrl(session),
      });
      this.executionRepository.updateTaskDispatch(dispatch.id, {
        status: "running",
        lastHeartbeatAt: new Date().toISOString(),
      });
      this.executionRepository.appendTaskRunEvent(taskRun.id, "session_created", "system", {
        sessionId,
        sessionName,
        provider: nextProvider,
      });

      return {
        id: session.id,
        name: session.name,
        provider: nextProvider || undefined,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const finishedAt = new Date().toISOString();
      this.executionRepository.updateTaskRun(taskRun.id, {
        state: "FAILED",
        finishedAt,
        durationMs: this.calculateDurationMs(taskRun, finishedAt),
      });
      this.executionRepository.updateTaskDispatch(dispatch.id, {
        status: "failed",
        finishedAt,
        errorMessage: message,
        lastHeartbeatAt: finishedAt,
      });
      this.executionRepository.appendTaskRunEvent(taskRun.id, "dispatch_failed", "system", {
        dispatchId: dispatch.id,
        error: message,
      });
      this.logger?.error("Sprint task dispatch failed", {
        taskId: args.task.id,
        taskRecordId: args.task.record_id,
        projectId: args.projectId,
        sprintId: args.sprintId,
        sprintRunId: args.sprintRunId,
        error: message,
      });
      throw error;
    }
  }

  private requireTaskRecordId(task: Subtask): string {
    if (typeof task.record_id === "string" && task.record_id.trim().length > 0) {
      return task.record_id;
    }
    throw new Error(`Task ${task.id} is missing its database record id.`);
  }

  private resolveWorkerBranch(session: JulesSession): string | null {
    const output = Array.isArray(session.outputs) ? session.outputs[0] : undefined;
    const branch = output?.pullRequest?.workerBranch;
    return typeof branch === "string" && branch.trim().length > 0 ? branch : null;
  }

  private resolvePrUrl(session: JulesSession): string | null {
    const output = Array.isArray(session.outputs) ? session.outputs[0] : undefined;
    const prUrl = output?.pullRequest?.url;
    return typeof prUrl === "string" && prUrl.trim().length > 0 ? prUrl : null;
  }

  private calculateDurationMs(taskRun: TaskRunRecord, finishedAt: string): number | null {
    if (!taskRun.startedAt) {
      return null;
    }

    return Math.max(0, new Date(finishedAt).getTime() - new Date(taskRun.startedAt).getTime());
  }
}
