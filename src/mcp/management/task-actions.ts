import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { TaskRerunService } from "../../services/task-rerun-service.js";
import type { TaskPriority, UpdateTaskInput } from "../../contracts/project-management-types.js";
import type { ProviderId } from "../../contracts/app-types.js";
import { randomUUID } from "crypto";

const VALID_PRIORITIES: TaskPriority[] = ["critical", "high", "medium", "low"];

function parsePriority(val: unknown): TaskPriority | undefined {
  if (typeof val === "string") {
    const normalized = val.toLowerCase();
    if (VALID_PRIORITIES.includes(normalized as TaskPriority)) {
      return normalized as TaskPriority;
    }
  }
  return undefined;
}

export class TaskActions {
  constructor(
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly executionControlService: ExecutionControlService,
    private readonly executionRepository: ExecutionRepository,
    private readonly taskRerunService: TaskRerunService,
  ) {}

  async handleTaskAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "list":
        return this.listTasks(payload);
      case "get":
        return this.getTask(payload);
      case "create":
        return this.createTask(payload);
      case "update":
        return this.updateTask(payload);
      case "delete":
        return this.deleteTask(args);
      case "start":
        return this.startTask(payload);
      case "stop":
        return this.stopTask(payload);
      case "force_stop":
        return this.forceStopTask(payload);
      case "pause":
        return this.pauseTask(payload);
      case "inspect_run":
        return this.inspectRun(payload);
      default:
        throw new Error(`Unknown task action: ${args.action}`);
    }
  }

  private listTasks(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;

    if (!projectId || !sprintId) {
      throw new Error("projectId and sprintId are required for listing tasks");
    }

    const tasks = this.projectManagementRepository.listTasks(projectId, sprintId);
    return { result: { tasks } };
  }

  private getTask(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;

    if (!taskId) {
      throw new Error("taskId is required");
    }

    const task = this.projectManagementRepository.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    return { result: { task } };
  }

  private createTask(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectId = typeof payload.projectId === "string" ? payload.projectId : undefined;
    const sprintId = typeof payload.sprintId === "string" ? payload.sprintId : undefined;

    if (!projectId || !sprintId) {
      throw new Error("projectId and sprintId are required for creating tasks");
    }

    const title = typeof payload.title === "string" ? payload.title : "New Task";
    const promptMarkdown = typeof payload.promptMarkdown === "string" ? payload.promptMarkdown : "";
    const description = typeof payload.description === "string" ? payload.description : "";
    const priority = parsePriority(payload.priority) || "medium";

    const task = this.projectManagementRepository.createTask(projectId, {
      sprintId,
      title,
      promptMarkdown,
      description,
      priority,
      dependsOnTaskIds: Array.isArray(payload.dependsOnTaskIds) ? payload.dependsOnTaskIds.filter(id => typeof id === 'string') : [],
      executorType: "auto",
      status: "pending"
    });

    return { result: { task } };
  }

  private updateTask(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (!taskId) {
      throw new Error("taskId is required");
    }

    const updateInput: UpdateTaskInput = {};
    if (typeof payload.title === "string") updateInput.title = payload.title;
    if (typeof payload.promptMarkdown === "string") updateInput.promptMarkdown = payload.promptMarkdown;
    if (typeof payload.description === "string") updateInput.description = payload.description;

    const priority = parsePriority(payload.priority);
    if (priority) {
      updateInput.priority = priority;
    }

    if (Array.isArray(payload.dependsOnTaskIds)) {
        updateInput.dependsOnTaskIds = payload.dependsOnTaskIds.filter(id => typeof id === "string");
    }

    const task = this.projectManagementRepository.updateTask(taskId, updateInput);
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    return { result: { task } };
  }

  private deleteTask(args: ManageCodeUxArgs): ManagementResponseEnvelope {
    const taskId = typeof args.payload.taskId === "string" ? args.payload.taskId : undefined;
    if (!taskId) {
      throw new Error("taskId is required");
    }

    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Are you sure you want to delete task ${taskId}?`,
      };
    }

    this.projectManagementRepository.deleteTask(taskId);
    return { result: { success: true } };
  }

  private async startTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (!taskId) {
      throw new Error("taskId is required");
    }

    const providerStr = typeof payload.provider === "string" ? payload.provider : undefined;
    const providerId = providerStr as ProviderId | undefined;

    const task = await this.taskRerunService.rerunTask(taskId, {
        provider: providerId,
    });
    return { result: { task } };
  }

  private async stopTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (!taskId) {
      throw new Error("taskId is required");
    }

    const task = this.projectManagementRepository.getTask(taskId);
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        throw new Error(`No dispatch found for task: ${taskId}`);
    }

    const dispatch = await this.executionControlService.cancelTaskDispatch(latestDispatch.id);
    return { result: { dispatch } };
  }

  private async forceStopTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (!taskId) {
      throw new Error("taskId is required");
    }

    const task = this.projectManagementRepository.getTask(taskId);
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        throw new Error(`No dispatch found for task: ${taskId}`);
    }

    const dispatch = await this.executionControlService.forceCancelTaskDispatch(latestDispatch.id);
    return { result: { dispatch } };
  }

  private async pauseTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (!taskId) {
      throw new Error("taskId is required");
    }

    const task = this.projectManagementRepository.getTask(taskId);
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        throw new Error(`No dispatch found for task: ${taskId}`);
    }

    const dispatch = await this.executionControlService.pauseTaskDispatch(latestDispatch.id);
    return { result: { dispatch } };
  }

  private inspectRun(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const taskId = typeof payload.taskId === "string" ? payload.taskId : undefined;
    if (!taskId) {
      throw new Error("taskId is required");
    }

    const task = this.projectManagementRepository.getTask(taskId);
    if (!task) {
        throw new Error(`Task not found: ${taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        return { result: { task, dispatch: null, taskRun: null } };
    }

    const taskRun = this.executionRepository.getTaskRunByDispatchId(latestDispatch.id);
    return { result: { task, dispatch: latestDispatch, taskRun } };
  }
}
