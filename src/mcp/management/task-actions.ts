import type { ManageSprintOsArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import type { ExecutionControlService } from "../../services/execution-control-service.js";
import type { ExecutionRepository } from "../../repositories/execution-repository.js";
import type { TaskRerunService } from "../../services/task-rerun-service.js";
import type { ProviderId } from "../../contracts/app-types.js";
import type { TaskPriority } from "../../contracts/project-management-types.js";
import { z } from "zod";

const listTasksSchema = z.object({
  projectId: z.string(),
  sprintId: z.string(),
});

const getTaskSchema = z.object({
  taskId: z.string(),
});

const createTaskSchema = z.object({
  projectId: z.string(),
  sprintId: z.string(),
  title: z.string().optional().default("New Task"),
  promptMarkdown: z.string().optional().default(""),
  description: z.string().optional().default(""),
  priority: z.enum(["critical", "high", "medium", "low"]).optional().default("medium"),
  dependsOnTaskIds: z.array(z.string()).optional().default([]),
});

const updateTaskSchema = z.object({
  taskId: z.string(),
  title: z.string().optional(),
  promptMarkdown: z.string().optional(),
  description: z.string().optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  dependsOnTaskIds: z.array(z.string()).optional(),
});

const startTaskSchema = z.object({
  taskId: z.string(),
  provider: z.string().optional(),
});

export class TaskActions {
  constructor(
    private readonly projectManagementRepository: ProjectManagementRepository,
    private readonly executionControlService: ExecutionControlService,
    private readonly executionRepository: ExecutionRepository,
    private readonly taskRerunService: TaskRerunService,
  ) {}

  async handleTaskAction(args: ManageSprintOsArgs): Promise<ManagementResponseEnvelope> {
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
    const parsed = listTasksSchema.parse(payload);
    const tasks = this.projectManagementRepository.listTasks(parsed.projectId, parsed.sprintId);
    return { result: { tasks } };
  }

  private getTask(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const parsed = getTaskSchema.parse(payload);
    const task = this.projectManagementRepository.getTask(parsed.taskId);
    if (!task) {
      throw new Error(`Task not found: ${parsed.taskId}`);
    }
    return { result: { task } };
  }

  private createTask(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const parsed = createTaskSchema.parse(payload);
    const task = this.projectManagementRepository.createTask(parsed.projectId, {
      sprintId: parsed.sprintId,
      title: parsed.title,
      promptMarkdown: parsed.promptMarkdown,
      description: parsed.description,
      priority: parsed.priority as TaskPriority,
      dependsOnTaskIds: parsed.dependsOnTaskIds,
      executorType: "auto",
      status: "pending"
    });

    return { result: { task } };
  }

  private updateTask(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const parsed = updateTaskSchema.parse(payload);

    const updateInput: Record<string, unknown> = {};
    if (parsed.title !== undefined) updateInput.title = parsed.title;
    if (parsed.promptMarkdown !== undefined) updateInput.promptMarkdown = parsed.promptMarkdown;
    if (parsed.description !== undefined) updateInput.description = parsed.description;
    if (parsed.priority !== undefined) updateInput.priority = parsed.priority as TaskPriority;
    if (parsed.dependsOnTaskIds !== undefined) updateInput.dependsOnTaskIds = parsed.dependsOnTaskIds;

    const task = this.projectManagementRepository.updateTask(parsed.taskId, updateInput);
    if (!task) {
        throw new Error(`Task not found: ${parsed.taskId}`);
    }

    return { result: { task } };
  }

  private deleteTask(args: ManageSprintOsArgs): ManagementResponseEnvelope {
    const parsed = getTaskSchema.parse(args.payload);

    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Are you sure you want to delete task ${parsed.taskId}?`,
      };
    }

    this.projectManagementRepository.deleteTask(parsed.taskId);
    return { result: { success: true } };
  }

  private async startTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = startTaskSchema.parse(payload);

    const task = await this.taskRerunService.rerunTask(parsed.taskId, {
        provider: parsed.provider as ProviderId | undefined,
    });
    return { result: { task } };
  }

  private async stopTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = getTaskSchema.parse(payload);

    const task = this.projectManagementRepository.getTask(parsed.taskId);
    if (!task) {
        throw new Error(`Task not found: ${parsed.taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === parsed.taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        throw new Error(`No dispatch found for task: ${parsed.taskId}`);
    }

    const dispatch = await this.executionControlService.cancelTaskDispatch(latestDispatch.id);
    return { result: { dispatch } };
  }

  private async forceStopTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = getTaskSchema.parse(payload);

    const task = this.projectManagementRepository.getTask(parsed.taskId);
    if (!task) {
        throw new Error(`Task not found: ${parsed.taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === parsed.taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        throw new Error(`No dispatch found for task: ${parsed.taskId}`);
    }

    const dispatch = await this.executionControlService.forceCancelTaskDispatch(latestDispatch.id);
    return { result: { dispatch } };
  }

  private async pauseTask(payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const parsed = getTaskSchema.parse(payload);

    const task = this.projectManagementRepository.getTask(parsed.taskId);
    if (!task) {
        throw new Error(`Task not found: ${parsed.taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === parsed.taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        throw new Error(`No dispatch found for task: ${parsed.taskId}`);
    }

    const dispatch = await this.executionControlService.pauseTaskDispatch(latestDispatch.id);
    return { result: { dispatch } };
  }

  private inspectRun(payload: Record<string, unknown>): ManagementResponseEnvelope {
    const parsed = getTaskSchema.parse(payload);

    const task = this.projectManagementRepository.getTask(parsed.taskId);
    if (!task) {
        throw new Error(`Task not found: ${parsed.taskId}`);
    }

    const dispatches = this.executionRepository.listTaskDispatches({ projectId: task.projectId });
    const latestDispatch = dispatches.filter(d => d.taskId === parsed.taskId).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())[0];

    if (!latestDispatch) {
        return { result: { task, dispatch: null, taskRun: null } };
    }

    const taskRun = this.executionRepository.getTaskRunByDispatchId(latestDispatch.id);
    return { result: { task, dispatch: latestDispatch, taskRun } };
  }
}
