import { describe, it, expect, vi, beforeEach } from "vitest";
import { forceCompleteTask } from "../../../../../src/domain/sprint/tasks/force-complete-task.js";
import type { ForceCompleteTaskDependencies } from "../../../../../src/domain/sprint/tasks/force-complete-task.js";

describe("forceCompleteTask", () => {
  let deps: ForceCompleteTaskDependencies;
  const projectId = "project-1";
  const taskId = "task-1";
  const sprintId = "sprint-1";
  const taskKey = "T01";

  beforeEach(() => {
    deps = {
      executionRepository: {
        listTaskDispatches: vi.fn().mockReturnValue([]),
        updateTaskDispatch: vi.fn(),
        getTaskRunByDispatchId: vi.fn(),
        updateTaskRun: vi.fn(),
        appendTaskRunEvent: vi.fn(),
        findActiveSprintRun: vi.fn(),
        appendSprintRunEvent: vi.fn(),
      } as any,
      projectManagementRepository: {
        getTask: vi.fn().mockReturnValue({ id: taskId, projectId, sprintId, taskKey }),
        updateTask: vi.fn(),
      } as any,
      activeDispatchRegistry: {
        requestStop: vi.fn().mockResolvedValue(undefined),
      } as any,
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as any,
    };
  });

  it("should update task status to completed", async () => {
    await forceCompleteTask(deps, { projectId, taskId, reason: "Manual completion" });

    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(taskId, {
      status: "completed",
      isMerged: true,
    });
  });

  it("should terminate active dispatches", async () => {
    const dispatchId = "dispatch-1";
    (deps.executionRepository.listTaskDispatches as any).mockReturnValue([
      { id: dispatchId, status: "running", taskId, projectId },
    ]);
    const taskRunId = "run-1";
    (deps.executionRepository.getTaskRunByDispatchId as any).mockReturnValue({ id: taskRunId, startedAt: new Date().toISOString() });

    await forceCompleteTask(deps, { projectId, taskId, reason: "Manual completion" });

    expect(deps.activeDispatchRegistry.requestStop).toHaveBeenCalledWith(dispatchId, expect.stringContaining("Manual completion"));
    expect(deps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith(dispatchId, expect.objectContaining({
      status: "cancelled",
    }));
    expect(deps.executionRepository.updateTaskRun).toHaveBeenCalledWith(taskRunId, expect.objectContaining({
      state: "COMPLETED",
    }));
    expect(deps.executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(taskRunId, "task_force_completed", "system", expect.objectContaining({
      reason: "Manual completion",
    }), expect.any(Object));
  });

  it("should fail if task does not belong to project", async () => {
    (deps.projectManagementRepository.getTask as any).mockReturnValue({ id: taskId, projectId: "other-project" });

    await expect(forceCompleteTask(deps, { projectId, taskId, reason: "Manual completion" }))
      .rejects.toThrow(/does not belong to project/);
  });

  it("should record event in active sprint run", async () => {
    const sprintRunId = "sprint-run-1";
    (deps.executionRepository.findActiveSprintRun as any).mockReturnValue({ id: sprintRunId });

    await forceCompleteTask(deps, { projectId, taskId, reason: "Manual completion" });

    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(sprintRunId, "task_force_completed", "system", expect.objectContaining({
      taskId,
      reason: "Manual completion",
    }), expect.any(Object));
  });
});
