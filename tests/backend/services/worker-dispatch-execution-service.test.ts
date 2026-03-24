import { describe, expect, it, vi } from "vitest";
import { WorkerDispatchExecutionService } from "../../../src/services/worker-dispatch-execution-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

describe("WorkerDispatchExecutionService", () => {
  it("starts a local worker dispatch through TaskService", async () => {
    const executionRepository = {
      getTaskDispatch: vi.fn().mockReturnValue({
        id: "dispatch-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        executorType: "mcp_worker",
      }),
      getTaskRunByDispatchId: vi.fn().mockReturnValue({
        id: "task-run-1",
      }),
    } as any;
    const projectManagementRepository = {
      getProject: vi.fn().mockReturnValue({
        id: "project-1",
        name: "Project",
        baseDir: "/repo",
        defaultBranch: "main",
      }),
      getSprint: vi.fn().mockReturnValue({
        id: "sprint-1",
        name: "Sprint 1",
        number: 4,
        featureBranch: "feature/sprint-4",
      }),
      getTask: vi.fn().mockReturnValue({
        id: "task-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskKey: "TASK-1",
        title: "Implement worker",
        promptMarkdown: "Build the worker client",
        dependsOnTaskIds: ["task-0"],
        isIndependent: false,
      }),
    } as any;
    const taskService = {
      startSprintTask: vi.fn().mockResolvedValue({
        id: "sessions/123",
        name: "sessions/123",
        provider: "codex",
        state: "RUNNING",
      }),
    } as any;

    const service = new WorkerDispatchExecutionService(
      executionRepository,
      projectManagementRepository,
      taskService,
      { requestStop: vi.fn() } as any,
      { sendSessionMessage: vi.fn() } as any,
      () => DEFAULT_DASHBOARD_SETTINGS,
    );

    const result = await service.executeDispatch("dispatch-1");

    expect(taskService.startSprintTask).toHaveBeenCalledWith(expect.objectContaining({
      record_id: "task-1",
      id: "TASK-1",
      title: "Implement worker",
      prompt: "Build the worker client",
      depends_on: ["task-0"],
    }), undefined, "feature/sprint-4", "/repo", 4, { projectId: "project-1", sprintId: "sprint-1" }, "dispatch-1", "task-run-1");
    expect(result.session.provider).toBe("codex");
  });

  it("prioritizes dashboard settings for defaultBranch over project metadata", async () => {
    const executionRepository = {
      getTaskDispatch: vi.fn().mockReturnValue({
        id: "dispatch-2",
        projectId: "project-2",
        sprintId: "sprint-2",
        taskId: "task-2",
        executorType: "mcp_worker",
      }),
      getTaskRunByDispatchId: vi.fn().mockReturnValue({ id: "task-run-2" }),
    } as any;
    const projectManagementRepository = {
      getProject: vi.fn().mockReturnValue({
        id: "project-2",
        name: "Project 2",
        baseDir: "/repo-2",
        defaultBranch: "main", // DB says main
      }),
      getSprint: vi.fn().mockReturnValue({ id: "sprint-2", number: 1 }),
      getTask: vi.fn().mockReturnValue({
        id: "task-2",
        projectId: "project-2",
        sprintId: "sprint-2",
        taskKey: "T-2",
        title: "T-2",
        promptMarkdown: "T-2",
        dependsOnTaskIds: [],
        isIndependent: true,
      }),
    } as any;
    const taskService = {
      startSprintTask: vi.fn().mockResolvedValue({ id: "s-2", name: "s-2", state: "RUNNING" }),
    } as any;

    const getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      git: { ...DEFAULT_DASHBOARD_SETTINGS.git, defaultBranch: "dev" }, // Dashboard says dev
    });

    const service = new WorkerDispatchExecutionService(
      executionRepository,
      projectManagementRepository,
      taskService,
      { requestStop: vi.fn() } as any,
      { sendSessionMessage: vi.fn() } as any,
      getDashboardSettings,
    );

    await service.executeDispatch("dispatch-2");

    expect(getDashboardSettings).toHaveBeenCalledWith({ projectId: "project-2", sprintId: "sprint-2" });
    // Should use "dev" because settings override metadata "main"
    expect(taskService.startSprintTask).toHaveBeenCalledWith(
      expect.anything(),
      undefined,
      "dev",
      "/repo-2",
      1,
      expect.anything(),
      "dispatch-2",
      "task-run-2"
    );
  });

  it("cancels active local dispatch handles directly", async () => {
    const requestStop = vi.fn().mockResolvedValue({ accepted: true, message: "stopped" });
    const service = new WorkerDispatchExecutionService(
      { getTaskRunByDispatchId: vi.fn() } as any,
      {} as any,
      {} as any,
      { requestStop } as any,
      { sendSessionMessage: vi.fn() } as any,
      () => DEFAULT_DASHBOARD_SETTINGS,
    );

    const result = await service.cancelLocalDispatch("dispatch-1", "Dashboard stop");

    expect(requestStop).toHaveBeenCalledWith("dispatch-1", "Dashboard stop");
    expect(result.mode).toBe("active_handle");
    expect(result.accepted).toBe(true);
  });

  it("falls back to a Jules soft stop when no active handle exists", async () => {
    const sendSessionMessage = vi.fn().mockResolvedValue({});
    const service = new WorkerDispatchExecutionService(
      {
        getTaskRunByDispatchId: vi.fn().mockReturnValue({
          sessionId: "sessions/456",
          provider: "jules",
        }),
      } as any,
      {} as any,
      {} as any,
      { requestStop: vi.fn().mockResolvedValue({ accepted: false, message: "not local" }) } as any,
      { sendSessionMessage } as any,
      () => DEFAULT_DASHBOARD_SETTINGS,
    );

    const result = await service.cancelLocalDispatch("dispatch-1", "Please stop");

    expect(sendSessionMessage).toHaveBeenCalledWith("sessions/456", expect.stringContaining("Please stop"));
    expect(result.mode).toBe("jules_soft_stop");
    expect(result.accepted).toBe(true);
  });
});
