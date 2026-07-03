import { describe, it, expect, vi, beforeEach } from "vitest";
import { TaskActions } from "../../../src/mcp/management/task-actions.js";
import type { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import type { ExecutionControlService } from "../../../src/services/execution-control-service.js";
import type { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import type { TaskRerunService } from "../../../src/services/task-rerun-service.js";

describe("TaskActions", () => {
  let taskActions: TaskActions;
  let projectManagementRepository: ReturnType<typeof vi.mocked<ProjectManagementRepository>>;
  let executionControlService: ReturnType<typeof vi.mocked<ExecutionControlService>>;
  let executionRepository: ReturnType<typeof vi.mocked<ExecutionRepository>>;
  let taskRerunService: ReturnType<typeof vi.mocked<TaskRerunService>>;

  beforeEach(() => {
    projectManagementRepository = {
      listTasks: vi.fn(),
      listSprintTasks: vi.fn(),
      getTask: vi.fn(),
      createTask: vi.fn(),
      updateTask: vi.fn(),
      deleteTask: vi.fn(),
    } as any;

    executionControlService = {
      cancelTaskDispatch: vi.fn(),
      forceCancelTaskDispatch: vi.fn(),
      pauseTaskDispatch: vi.fn(),
    } as any;

    executionRepository = {
      listTaskDispatches: vi.fn(),
      getTaskRunByDispatchId: vi.fn(),
    } as any;

    taskRerunService = {
      rerunTask: vi.fn(),
    } as any;

    taskActions = new TaskActions(
      projectManagementRepository,
      executionControlService,
      executionRepository,
      taskRerunService,
    );
  });

  it("handles get action", async () => {
    const task = { id: "t1" };
    projectManagementRepository.getTask.mockReturnValue(task as any);
    const result = await taskActions.handleTaskAction({
      domain: "tasks",
      action: "get",
      payload: { taskId: "t1" },
    });
    expect(result.result).toEqual({ task });
  });

  it("lists all project tasks when sprintId is omitted", async () => {
    const tasks = [{ id: "t1" }];
    projectManagementRepository.listTasks.mockReturnValue(tasks as any);

    const result = await taskActions.handleTaskAction({
      domain: "tasks",
      action: "list",
      payload: { projectId: "p1" },
    });

    expect(projectManagementRepository.listTasks).toHaveBeenCalledWith("p1", undefined);
    expect(result.result).toEqual({ tasks });
  });

  it("creates a task from normalized MCP payload fields", async () => {
    const task = { id: "t1" };
    projectManagementRepository.createTask.mockReturnValue(task as any);

    const result = await taskActions.handleTaskAction({
      domain: "tasks",
      action: "create",
      payload: {
        projectId: "p1",
        sprintId: "s1",
        name: " Task title ",
        promptMarkdown: " Do work ",
        priority: "HIGH",
        executorType: "docker_cli",
        dependsOnTaskIds: [" dep-1 ", "", 42],
      },
    });

    expect(projectManagementRepository.createTask).toHaveBeenCalledWith("p1", {
      sprintId: "s1",
      title: "Task title",
      promptMarkdown: "Do work",
      description: "",
      priority: "high",
      executorType: "docker_cli",
      status: "pending",
      dependsOnTaskIds: ["dep-1"],
    });
    expect(result.result).toEqual({ task });
  });

  it("rejects invalid task priority enum values", async () => {
    await expect(taskActions.handleTaskAction({
      domain: "tasks",
      action: "create",
      payload: {
        projectId: "p1",
        sprintId: "s1",
        title: "Task title",
        priority: "urgent",
      },
    })).rejects.toThrow("Invalid value for priority. Must be one of: critical, high, medium, low");

    expect(projectManagementRepository.createTask).not.toHaveBeenCalled();
  });

  it("rejects invalid task status enum values", async () => {
    await expect(taskActions.handleTaskAction({
      domain: "tasks",
      action: "update",
      payload: {
        taskId: "t1",
        status: "done",
      },
    })).rejects.toThrow("Invalid value for status. Must be one of: pending, in_progress, coding_completed, completed, QA_REVIEW_FAILED");

    expect(projectManagementRepository.updateTask).not.toHaveBeenCalled();
  });

  it("updates task edit fields from MCP payload", async () => {
    const task = { id: "t1", title: "Updated" };
    projectManagementRepository.updateTask.mockReturnValue(task as any);

    const result = await taskActions.handleTaskAction({
      domain: "tasks",
      action: "update",
      payload: {
        taskId: "t1",
        title: " Updated ",
        status: "completed",
        priority: "low",
        agentPresetId: null,
        model: " model-x ",
        dependsOnTaskIds: ["dep-1"],
      },
    });

    expect(projectManagementRepository.updateTask).toHaveBeenCalledWith("t1", {
      title: "Updated",
      status: "completed",
      priority: "low",
      agentPresetId: null,
      model: "model-x",
      dependsOnTaskIds: ["dep-1"],
    });
    expect(result.result).toEqual({ task });
  });

  it("handles pause action", async () => {
    const dispatch = { id: "d1" };
    projectManagementRepository.getTask.mockReturnValue({ id: "t1", projectId: "p1" } as any);
    executionRepository.listTaskDispatches.mockReturnValue([{ id: "d1", taskId: "t1", createdAt: "2023-01-01" }] as any);
    executionControlService.pauseTaskDispatch.mockResolvedValue(dispatch as any);

    const result = await taskActions.handleTaskAction({
      domain: "tasks",
      action: "pause",
      payload: { taskId: "t1" },
    });
    expect(result.result).toEqual({ dispatch });
  });
});
