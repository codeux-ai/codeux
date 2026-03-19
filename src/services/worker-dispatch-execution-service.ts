import type { JulesApiClient } from "../integrations/jules-api-client.js";
import type { JulesSession, Subtask } from "../contracts/app-types.js";
import type { ActiveDispatchRegistry, ActiveDispatchStopResult } from "./active-dispatch-registry.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { TaskService } from "./task-service.js";
import type { Logger } from "../shared/logging/logger.js";

export interface ExecuteWorkerDispatchResult {
  dispatchId: string;
  taskRunId: string;
  session: {
    id: string;
    name: string;
    title?: string;
    state?: string;
    provider?: string;
    createTime?: string;
    workerBranch?: string | null;
    prUrl?: string | null;
  };
}

export interface CancelLocalDispatchResult extends ActiveDispatchStopResult {
  mode: "active_handle" | "jules_soft_stop" | "not_running";
}

export class WorkerDispatchExecutionService {
  constructor(
    private readonly executionRepository: ExecutionRepository,
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly taskService: TaskService,
    private readonly activeDispatchRegistry: ActiveDispatchRegistry,
    private readonly julesApi: JulesApiClient,
    private readonly logger?: Logger,
  ) {}

  async executeDispatch(dispatchId: string): Promise<ExecuteWorkerDispatchResult> {
    const dispatch = this.executionRepository.getTaskDispatch(dispatchId);
    if (!dispatch) {
      throw new Error(`Task dispatch not found: ${dispatchId}`);
    }
    if (dispatch.executorType !== "mcp_worker") {
      throw new Error(`Dispatch ${dispatchId} is not a worker dispatch.`);
    }

    const taskRun = this.executionRepository.getTaskRunByDispatchId(dispatchId);
    if (!taskRun) {
      throw new Error(`Task run not found for dispatch ${dispatchId}`);
    }

    const project = this.projectManagementRepository.getProject(dispatch.projectId);
    if (!project) {
      throw new Error(`Project not found: ${dispatch.projectId}`);
    }
    const sprint = this.projectManagementRepository.getSprint(dispatch.sprintId);
    if (!sprint) {
      throw new Error(`Sprint not found: ${dispatch.sprintId}`);
    }
    const task = this.projectManagementRepository.getTask(dispatch.taskId);
    if (!task) {
      throw new Error(`Task not found: ${dispatch.taskId}`);
    }

    const session = await this.taskService.startSprintTask(
      this.toSubtask(task),
      undefined,
      sprint.featureBranch?.trim() || project.defaultBranch?.trim() || "main",
      project.baseDir,
      sprint.number ?? 0,
      {
        projectId: project.id,
        sprintId: sprint.id,
      },
      dispatch.id,
      taskRun.id,
    );

    this.logger?.info("Started local execution for worker dispatch", {
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      provider: session.provider,
      sessionId: session.id,
      sprintId: sprint.id,
      projectId: project.id,
    });

    return {
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      session: this.toSessionSummary(session),
    };
  }

  async cancelLocalDispatch(dispatchId: string, reason?: string): Promise<CancelLocalDispatchResult> {
    const stopReason = reason?.trim() || "Worker dispatch cancelled by Sprint OS control plane.";
    const stopResult = await this.activeDispatchRegistry.requestStop(dispatchId, stopReason);
    if (stopResult.accepted) {
      this.logger?.info("Cancelled active local worker dispatch", { dispatchId, reason: stopReason });
      return {
        ...stopResult,
        mode: "active_handle",
      };
    }

    const taskRun = this.executionRepository.getTaskRunByDispatchId(dispatchId);
    if (!taskRun?.sessionId || taskRun.provider !== "jules") {
      return {
        accepted: false,
        message: stopResult.message,
        mode: "not_running",
      };
    }

    await this.julesApi.sendSessionMessage(taskRun.sessionId, [
      "Sprint OS dashboard requested cancellation for this worker-owned task.",
      "Please stop further work, summarize current progress, and do not continue coding.",
      `Reason: ${stopReason}`,
    ].join("\n\n"));

    this.logger?.info("Requested soft stop for worker-owned Jules session", {
      dispatchId,
      sessionId: taskRun.sessionId,
    });
    return {
      accepted: true,
      message: "Requested soft stop from the active Jules session.",
      mode: "jules_soft_stop",
    };
  }

  private toSubtask(task: {
    id: string;
    projectId: string;
    sprintId: string;
    taskKey: string;
    title: string;
    promptMarkdown: string;
    dependsOnTaskIds: string[];
    isIndependent: boolean;
  }): Subtask {
    return {
      record_id: task.id,
      project_id: task.projectId,
      sprint_id: task.sprintId,
      id: task.taskKey,
      title: task.title,
      prompt: task.promptMarkdown,
      depends_on: [...task.dependsOnTaskIds],
      status: "PENDING",
      is_independent: task.isIndependent,
    };
  }

  private toSessionSummary(session: JulesSession): ExecuteWorkerDispatchResult["session"] {
    const pullRequest = (session.outputs || [])
      .map((entry) => entry.pullRequest)
      .find((entry): entry is { url?: string; workerBranch?: string } => !!entry);

    return {
      id: session.id,
      name: session.name,
      title: session.title,
      state: session.state,
      provider: session.provider,
      createTime: session.createTime,
      workerBranch: pullRequest?.workerBranch ?? null,
      prUrl: pullRequest?.url ?? null,
    };
  }
}
