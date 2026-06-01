import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Subtask } from "../../../src/contracts/app-types.js";
import { TaskRerunService } from "../../../src/services/task-rerun-service.js";

describe("TaskRerunService", () => {
  const resolveTaskContext = vi.fn();
  const listSprintTaskDependencies = vi.fn();
  const updateTaskPlanningStatus = vi.fn();
  const resolveSprintRunId = vi.fn();
  const startTask = vi.fn();
  const persistMergedFlag = vi.fn();
  const createResetTaskRun = vi.fn();
  const resumeSprintRun = vi.fn();
  const resolveTaskAttention = vi.fn();
  const cancelActiveDispatch = vi.fn();
  const clearTaskWorktree = vi.fn();
  let service: TaskRerunService;
  let context: any;

  beforeEach(() => {
    vi.clearAllMocks();
    const task: Subtask = {
      record_id: "task-record-1",
      id: "01-task",
      title: "Test task",
      prompt: "Do work",
      depends_on: [],
      is_independent: true,
      status: "FAILED",
      session_id: "old-session",
      session_name: "sessions/old-session",
      session_state: "FAILED",
      pr_url: "https://example.com/pr/12",
      worker_branch: "worker/task-1",
      is_merged: true,
      merge_indicator: "MERGED",
      activities: [{ id: "1", name: "a", createTime: "2025-01-01T00:00:00.000Z" }],
    };

    context = {
      task,
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintNumber: 7,
      sourceId: "source-123",
      repoPath: "/tmp/repo",
      featureBranch: "feature/sprint7-implementation",
    };
    resolveTaskContext.mockImplementation((taskId: string) => (
      taskId === "task-record-1" || taskId === "01-task" ? context : null
    ));
    listSprintTaskDependencies.mockReturnValue([]);

    service = new TaskRerunService({
      resolveTaskContext,
      listSprintTaskDependencies,
      updateTaskPlanningStatus,
      resolveSprintRunId,
      startTask,
      resolveSessionName: (session) => session.name,
      extractSessionId: (session) => session.id,
      persistMergedFlag,
      createResetTaskRun,
      resumeSprintRun,
      resolveTaskAttention,
      cancelActiveDispatch,
      clearTaskWorktree,
    });
  });

  it("resets task state and starts a fresh session", async () => {
    resolveSprintRunId.mockResolvedValue({ sprintRunId: "run-1", created: false });
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "claude-code",
    });

    const rerunTask = await service.rerunTask("task-record-1");

    expect(persistMergedFlag).toHaveBeenCalledWith({
      taskId: "task-record-1",
      merged: false,
    });
    expect(updateTaskPlanningStatus).toHaveBeenCalledWith("task-record-1", "pending");
    expect(resolveSprintRunId).toHaveBeenCalledWith({
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintNumber: 7,
      featureBranch: "feature/sprint7-implementation",
    });
    expect(resumeSprintRun).not.toHaveBeenCalled();
    expect(startTask).toHaveBeenCalledWith({
      task: expect.objectContaining({
        id: "01-task",
        status: "PENDING",
        session_id: undefined,
        session_name: undefined,
        session_state: undefined,
        worker_branch: undefined,
        pr_url: undefined,
        is_merged: false,
        merge_indicator: undefined,
      }),
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      sourceId: "source-123",
      featureBranch: "feature/sprint7-implementation",
      repoPath: "/tmp/repo",
      sprintNumber: 7,
      providerConfigId: undefined,
      resumeWorkspaceSessionId: "old-session",
      resumeWorkerBranch: "worker/task-1",
      forceFreshWorkspace: false,
    });
    expect(rerunTask.session_id).toBe("new-session");
    expect(rerunTask.session_name).toBe("sessions/new-session");
    expect(rerunTask.provider).toBe("claude-code");
    expect(cancelActiveDispatch).toHaveBeenCalledWith("task-record-1", "project-1");
    expect(resolveTaskAttention).toHaveBeenCalledWith({
      taskId: "task-record-1",
      projectId: "project-1",
    });
    expect(createResetTaskRun).not.toHaveBeenCalled();
  });

  it("keeps newer CLI providers on the restarted task", async () => {
    resolveSprintRunId.mockResolvedValue({ sprintRunId: "run-1", created: false });
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "antigravity",
    });

    const rerunTask = await service.rerunTask("task-record-1", { provider: "antigravity" });

    expect(rerunTask.provider).toBe("antigravity");
  });

  it("passes selected provider instance and model into the restarted task dispatch", async () => {
    resolveSprintRunId.mockResolvedValue({ sprintRunId: "run-1", created: false });
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "gemini",
    });

    await service.rerunTask("task-record-1", {
      provider: "gemini",
      providerConfigId: "gemini-secondary",
      model: "gemini-2.5-flash",
    });

    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      providerConfigId: "gemini-secondary",
      task: expect.objectContaining({
        provider: "gemini",
        model: "gemini-2.5-flash",
      }),
    }));
  });

  it("marks the task failed when fresh session start fails", async () => {
    resolveSprintRunId.mockResolvedValue({ sprintRunId: "run-1", created: false });
    startTask.mockRejectedValue(new Error("provider unavailable"));

    await expect(service.rerunTask("01-task")).rejects.toThrow("provider unavailable");
    expect(updateTaskPlanningStatus).toHaveBeenCalledWith("task-record-1", "pending");
  });

  it("still reruns when merged-flag persistence fails", async () => {
    persistMergedFlag.mockRejectedValue(new Error("disk error"));
    resolveSprintRunId.mockResolvedValue({ sprintRunId: "run-1", created: false });
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "codex",
    });

    await expect(service.rerunTask("01-task")).resolves.toEqual(
      expect.objectContaining({
        status: "RUNNING",
        session_id: "new-session",
      })
    );
    expect(startTask).toHaveBeenCalledTimes(1);
  });

  it("resets downstream tasks into clean pending snapshots before rerunning the selected task", async () => {
    const dependentTask: Subtask = {
      record_id: "task-record-2",
      id: "02-task",
      title: "Dependent task",
      prompt: "Follow up",
      depends_on: ["01-task"],
      is_independent: false,
      status: "COMPLETED",
      session_id: "dep-session",
      session_name: "sessions/dep-session",
      session_state: "COMPLETED",
      pr_url: "https://example.com/pr/13",
      worker_branch: "worker/task-2",
      is_merged: true,
      merge_indicator: "MERGED",
    };

    resolveTaskContext.mockImplementation((taskId: string) => {
      if (taskId === "task-record-1" || taskId === "01-task") {
        return context;
      }
      if (taskId === "task-record-2") {
        return {
          ...context,
          task: dependentTask,
        };
      }
      return null;
    });
    listSprintTaskDependencies.mockReturnValue([
      { taskId: "task-record-1", dependsOnTaskIds: [] },
      { taskId: "task-record-2", dependsOnTaskIds: ["task-record-1"] },
    ]);
    resolveSprintRunId.mockResolvedValue({ sprintRunId: "run-1", created: false });
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "jules",
    });

    await service.rerunTask("task-record-1", {
      resetDependents: true,
      clearWorktree: true,
    });

    expect(cancelActiveDispatch).toHaveBeenNthCalledWith(1, "task-record-2", "project-1");
    expect(cancelActiveDispatch).toHaveBeenNthCalledWith(2, "task-record-1", "project-1");
    expect(clearTaskWorktree).toHaveBeenNthCalledWith(1, {
      taskId: "task-record-2",
      repoPath: "/tmp/repo",
    });
    expect(clearTaskWorktree).toHaveBeenNthCalledWith(2, {
      taskId: "task-record-1",
      repoPath: "/tmp/repo",
    });
    expect(updateTaskPlanningStatus).toHaveBeenNthCalledWith(1, "task-record-2", "pending");
    expect(updateTaskPlanningStatus).toHaveBeenNthCalledWith(2, "task-record-1", "pending");
    expect(createResetTaskRun).toHaveBeenCalledWith({
      taskId: "task-record-2",
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      reason: "dependent_task_reset",
    });
    expect(persistMergedFlag).toHaveBeenNthCalledWith(1, {
      taskId: "task-record-2",
      merged: false,
    });
    expect(startTask).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({
        id: "01-task",
        session_id: undefined,
        pr_url: undefined,
        is_merged: false,
      }),
      resumeWorkspaceSessionId: undefined,
      resumeWorkerBranch: undefined,
      forceFreshWorkspace: true,
    }));
  });

  it("rejects rerun when sprint context is incomplete", async () => {
    resolveTaskContext.mockReturnValue(null);

    await expect(service.rerunTask("01-task")).rejects.toThrow("sprint context is incomplete");
    expect(resolveSprintRunId).not.toHaveBeenCalled();
    expect(startTask).not.toHaveBeenCalled();
    expect(updateTaskPlanningStatus).not.toHaveBeenCalled();
  });

  it("resumes sprint orchestration when rerun creates a fresh sprint run", async () => {
    resolveSprintRunId.mockResolvedValue({ sprintRunId: "run-created", created: true });
    startTask.mockResolvedValue({
      id: "new-session",
      name: "sessions/new-session",
      prompt: "",
      provider: "gemini",
    });

    await service.rerunTask("task-record-1");

    expect(resumeSprintRun).toHaveBeenCalledWith("run-created");
  });
});
