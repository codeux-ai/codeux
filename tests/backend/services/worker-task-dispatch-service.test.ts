import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkerTaskDispatchService } from "../../../src/services/worker-task-dispatch-service.js";

describe("WorkerTaskDispatchService", () => {
  let deps: any;
  let service: WorkerTaskDispatchService;

  beforeEach(() => {
    deps = {
      executionRepository: {
        getTaskDispatch: vi.fn(() => ({
          id: "dispatch-1",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskId: "task-1",
          sprintRunId: "run-1",
          status: "running",
          startedAt: "2026-01-01T00:00:00.000Z",
          connectionId: null,
          errorMessage: null,
        })),
        getTaskRunByDispatchId: vi.fn(() => ({
          id: "task-run-1",
          provider: "codex",
          mode: "docker_cli",
          sessionId: null,
          sessionName: null,
          workerBranch: null,
          prUrl: null,
          startedAt: "2026-01-01T00:00:00.000Z",
          connectionId: null,
        })),
        getLease: vi.fn(() => ({ leaseToken: "lease-1" })),
        updateTaskDispatch: vi.fn((id: string, patch: Record<string, unknown>) => ({ id, ...patch })),
        updateTaskRun: vi.fn(),
        appendTaskRunEvent: vi.fn(),
        renewLease: vi.fn(),
        releaseLease: vi.fn(),
        finalizeSprintRunCancellationIfIdle: vi.fn(),
      },
      projectManagementRepository: {
        updateTask: vi.fn(),
        getTask: vi.fn(() => ({ id: "task-1", taskKey: "T01" })),
      },
      connectionChatRepository: {
        getConnectionByKey: vi.fn(() => ({ id: "conn-1", connectionKey: "worker-1", role: "worker" })),
        touchConnectionHeartbeat: vi.fn(),
      },
      workerEndpointRepository: {
        getWorkerEndpointByConnectionId: vi.fn(() => ({
          id: "worker-endpoint-1",
          endpointKey: "worker-1",
          capabilities: { canExecuteTasks: true },
        })),
        getWorkerEndpoint: vi.fn(() => ({
          id: "worker-endpoint-1",
          endpointKey: "worker-1",
        })),
      },
      projectWorkerAssignmentService: {
        noteWorkerActivity: vi.fn(),
      },
      projectAttentionService: {
        resolveItemsForDispatch: vi.fn(),
        openItem: vi.fn(),
      },
    };
    service = new WorkerTaskDispatchService(
      deps.executionRepository,
      deps.projectManagementRepository,
      deps.connectionChatRepository,
      deps.workerEndpointRepository,
      deps.projectWorkerAssignmentService,
      deps.projectAttentionService,
      (() => ({})) as any,
    );
  });

  it("does not return queued dispatches to connected workers anymore", () => {
    const result = service.pullNextDispatch({ connectionKey: "worker-1", projectId: "project-1" });

    expect(result).toBeNull();
    expect(deps.connectionChatRepository.touchConnectionHeartbeat).toHaveBeenCalledWith("conn-1", "listening");
  });

  it("updates dispatch state and resolves dispatch attention on completion", () => {
    const result = service.updateDispatch({
      connectionKey: "worker-1",
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "COMPLETED",
      summaryMarkdown: "done",
    });

    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", { status: "coding_completed" });
    expect(deps.projectAttentionService.resolveItemsForDispatch).toHaveBeenCalledWith("dispatch-1", "worker_completed_dispatch");
    expect(deps.executionRepository.releaseLease).toHaveBeenCalledWith("task_dispatch", "dispatch-1", "lease-1");
    expect(result.controlAction).toBeNull();
  });

  it("opens a worker attention item when the worker reports BLOCKED", () => {
    service.updateDispatch({
      connectionKey: "worker-1",
      dispatchId: "dispatch-1",
      leaseToken: "lease-1",
      state: "BLOCKED",
      errorMessage: "waiting on human input",
    });

    expect(deps.projectAttentionService.openItem).toHaveBeenCalledWith(expect.objectContaining({
      attentionType: "worker_dispatch_blocked",
      ownerType: "worker",
      preferredWorkerEndpointId: "worker-endpoint-1",
    }));
  });

  it("renews the lease and keeps the dispatch running on a RUNNING heartbeat", () => {
    deps.connectionChatRepository.getConnectionByKey.mockReturnValue({ id: "conn-1", connectionKey: "worker-1", role: "worker" });
    deps.executionRepository.getTaskDispatch.mockReturnValue({
      id: "dispatch-1", projectId: "project-1", sprintId: "sprint-1", taskId: "task-1", sprintRunId: "run-1",
      status: "running", startedAt: "2026-01-01T00:00:00.000Z", connectionId: "conn-1", errorMessage: null,
    });

    const result = service.updateDispatch({
      connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "RUNNING",
    });

    expect(deps.executionRepository.renewLease).toHaveBeenCalledWith(expect.objectContaining({ scopeType: "task_dispatch", scopeId: "dispatch-1" }));
    expect(deps.executionRepository.releaseLease).not.toHaveBeenCalled();
    expect(deps.connectionChatRepository.touchConnectionHeartbeat).toHaveBeenCalledWith("conn-1", "connected");
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", { status: "in_progress" });
    expect(result.controlAction).toBeNull();
  });

  it("signals cancel while running when the dispatch was cancel_requested", () => {
    deps.executionRepository.getTaskDispatch.mockReturnValue({
      id: "dispatch-1", projectId: "project-1", sprintId: "sprint-1", taskId: "task-1", sprintRunId: "run-1",
      status: "cancel_requested", startedAt: "2026-01-01T00:00:00.000Z", connectionId: null, errorMessage: null,
    });

    const result = service.updateDispatch({
      connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "RUNNING",
    });

    expect(deps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith("dispatch-1", expect.objectContaining({ status: "cancel_requested" }));
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", { status: "pending" });
    expect(result.controlAction).toBe("cancel");
  });

  it("returns a cancel control action when the dispatch is paused", () => {
    deps.executionRepository.getTaskDispatch.mockReturnValue({
      id: "dispatch-1", projectId: "project-1", sprintId: "sprint-1", taskId: "task-1", sprintRunId: "run-1",
      status: "paused", startedAt: "2026-01-01T00:00:00.000Z", connectionId: null, errorMessage: null,
    });

    const result = service.updateDispatch({
      connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "RUNNING",
    });

    expect(deps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith("dispatch-1", expect.objectContaining({ status: "paused" }));
    expect(deps.executionRepository.updateTaskRun).toHaveBeenCalledWith("task-run-1", expect.objectContaining({ state: "PAUSED" }));
    expect(deps.executionRepository.releaseLease).not.toHaveBeenCalled();
    expect(result.controlAction).toBe("cancel");
  });

  it("resolves failure attention items on FAILED", () => {
    service.updateDispatch({ connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "FAILED", errorMessage: "crash" });
    expect(deps.projectAttentionService.resolveItemsForDispatch).toHaveBeenCalledWith("dispatch-1", "worker_failed_dispatch");
    expect(deps.executionRepository.releaseLease).toHaveBeenCalledWith("task_dispatch", "dispatch-1", "lease-1");
  });

  it("finalizes the sprint run when the updated dispatch carries a sprint run id", () => {
    deps.executionRepository.updateTaskDispatch.mockImplementation((id: string, patch: Record<string, unknown>) => ({ id, sprintRunId: "run-1", ...patch }));
    service.updateDispatch({ connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "FAILED" });
    expect(deps.executionRepository.finalizeSprintRunCancellationIfIdle).toHaveBeenCalledWith("run-1");
  });

  it("maps QUOTA to a quota dispatch status with the task still in progress", () => {
    service.updateDispatch({ connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "QUOTA" });
    expect(deps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith("dispatch-1", expect.objectContaining({ status: "quota" }));
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", { status: "in_progress" });
  });

  it("rejects updates when the lease token does not match", () => {
    deps.executionRepository.getLease.mockReturnValue({ leaseToken: "other-token" });
    expect(() =>
      service.updateDispatch({ connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "RUNNING" }),
    ).toThrow(/Worker lease is not active/);
  });

  it("rejects updates from a different connection than the one assigned", () => {
    deps.executionRepository.getTaskDispatch.mockReturnValue({
      id: "dispatch-1", projectId: "project-1", sprintId: "sprint-1", taskId: "task-1", sprintRunId: "run-1",
      status: "running", startedAt: "2026-01-01T00:00:00.000Z", connectionId: "conn-OTHER", errorMessage: null,
    });
    expect(() =>
      service.updateDispatch({ connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "RUNNING" }),
    ).toThrow(/assigned to another connection/);
  });

  describe("worker connection guards", () => {
    it("throws when the connection is unknown", () => {
      deps.connectionChatRepository.getConnectionByKey.mockReturnValue(null);
      expect(() => service.pullNextDispatch({ connectionKey: "missing" })).toThrow(/Connection not found/);
    });

    it("throws when the connection is not a worker", () => {
      deps.connectionChatRepository.getConnectionByKey.mockReturnValue({ id: "c", connectionKey: "k", role: "project_manager" });
      expect(() => service.pullNextDispatch({ connectionKey: "k" })).toThrow(/is not registered as a worker/);
    });

    it("throws when the worker endpoint is missing", () => {
      deps.workerEndpointRepository.getWorkerEndpointByConnectionId.mockReturnValue(null);
      expect(() => service.pullNextDispatch({ connectionKey: "worker-1" })).toThrow(/Worker endpoint not found for connection/);
    });

    it("throws when the worker cannot execute tasks", () => {
      deps.workerEndpointRepository.getWorkerEndpointByConnectionId.mockReturnValue({
        id: "w", endpointKey: "k", capabilities: { canExecuteTasks: false },
      });
      expect(() => service.pullNextDispatch({ connectionKey: "worker-1" })).toThrow(/cannot execute task dispatches/);
    });
  });

  describe("require* lookups", () => {
    it("throws when the worker endpoint id cannot be resolved", () => {
      deps.workerEndpointRepository.getWorkerEndpoint.mockReturnValue(null);
      expect(() =>
        service.updateDispatchForWorker({ workerEndpointId: "missing", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "RUNNING" }),
      ).toThrow(/Worker endpoint not found: missing/);
    });

    it("throws when the dispatch cannot be found", () => {
      deps.executionRepository.getTaskDispatch.mockReturnValue(null);
      expect(() =>
        service.updateDispatchForWorker({ workerEndpointId: "worker-endpoint-1", dispatchId: "nope", leaseToken: "lease-1", state: "RUNNING" }),
      ).toThrow(/Task dispatch not found: nope/);
    });

    it("throws when the task run cannot be found", () => {
      deps.executionRepository.getTaskRunByDispatchId.mockReturnValue(null);
      expect(() =>
        service.updateDispatchForWorker({ workerEndpointId: "worker-endpoint-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "RUNNING" }),
      ).toThrow(/Task run not found for dispatch/);
    });
  });

  it("claimNextDispatchForWorker is a no-op that returns null", () => {
    const result = service.claimNextDispatchForWorker({
      projectId: "p", workerEndpointId: "w", executionMode: "VIRTUAL",
    });
    expect(result).toBeNull();
  });

  it("captures a sprint memory on completion when auto-capture is enabled", async () => {
    const memoryService = { createMemory: vi.fn().mockResolvedValue({ id: "mem-1" }) };
    const getDashboardSettings = vi.fn(() => ({ memory: { enabled: true, autoCaptureSprint: true } }));
    const resolveWorkerAgentPresetId = vi.fn().mockResolvedValue("preset-1");
    const svc = new WorkerTaskDispatchService(
      deps.executionRepository,
      deps.projectManagementRepository,
      deps.connectionChatRepository,
      deps.workerEndpointRepository,
      deps.projectWorkerAssignmentService,
      deps.projectAttentionService,
      getDashboardSettings as any,
      undefined,
      undefined,
      memoryService as any,
      resolveWorkerAgentPresetId as any,
    );

    svc.updateDispatch({
      connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "COMPLETED", summaryMarkdown: "shipped it",
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(resolveWorkerAgentPresetId).toHaveBeenCalledWith("project-1");
    expect(memoryService.createMemory).toHaveBeenCalledWith("project-1", expect.objectContaining({
      scope: "sprint",
      agentPresetId: "preset-1",
      content: expect.stringContaining("shipped it"),
    }));
  });

  it("does not capture memory when auto-capture is disabled", () => {
    const memoryService = { createMemory: vi.fn() };
    const getDashboardSettings = vi.fn(() => ({ memory: { enabled: true, autoCaptureSprint: false } }));
    const svc = new WorkerTaskDispatchService(
      deps.executionRepository, deps.projectManagementRepository, deps.connectionChatRepository,
      deps.workerEndpointRepository, deps.projectWorkerAssignmentService, deps.projectAttentionService,
      getDashboardSettings as any, undefined, undefined, memoryService as any,
    );

    svc.updateDispatch({ connectionKey: "worker-1", dispatchId: "dispatch-1", leaseToken: "lease-1", state: "COMPLETED", summaryMarkdown: "x" });
    expect(memoryService.createMemory).not.toHaveBeenCalled();
  });
});
