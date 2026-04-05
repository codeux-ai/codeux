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
