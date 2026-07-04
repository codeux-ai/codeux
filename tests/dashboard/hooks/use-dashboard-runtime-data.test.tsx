/** @vitest-environment happy-dom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/preact";
import { useDashboardRuntimeData } from "../../../dashboard/src/hooks/use-dashboard-runtime-data.js";
import * as api from "../../../dashboard/src/lib/api/dashboard-api.js";
import * as realtime from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";
import type { DashboardRealtimeServerMessage, ProjectLiveDashboardSnapshot } from "../../../dashboard/src/types.js";
import type { TransportState } from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js");
vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");

const mockPayload: ProjectLiveDashboardSnapshot = {
  projectId: "p1",
  selectedSprintId: "s1",
  status: { subtasks: [], timestamp: "2024-01-01T00:00:00Z" },
  execution: {
    projectId: "p1",
    projectName: "Project 1",
    sprintRuns: [],
    taskDispatches: [],
    connections: [],
    primaryAssignedWorker: null,
    overflowAssignedWorkers: [],
    attentionItems: [],
    recentEvents: [],
    updatedAt: "2024-01-01T00:00:00Z",
  },
  gitStatus: null,
  gitStatusError: null,
  updatedAt: "2024-01-01T00:00:00Z",
};

function createRunningPayload(overrides: Partial<ProjectLiveDashboardSnapshot> = {}): ProjectLiveDashboardSnapshot {
  return {
    ...mockPayload,
    status: {
      project_id: "p1",
      sprint_id: "s1",
      subtasks: [{
        id: "TASK-1",
        title: "Ship it",
        prompt: "Do the work",
        depends_on: [],
        status: "RUNNING",
        is_independent: true,
      }],
      timestamp: "2024-01-01T00:00:00Z",
    },
    execution: {
      ...mockPayload.execution,
      sprintRuns: [{
        id: "run-1",
        projectId: "p1",
        sprintId: "s1",
        sprintName: "Sprint 1",
        sprintNumber: 1,
        status: "running",
        triggerType: "manual",
        triggeredBy: null,
        executorMode: "mixed",
        startedAt: "2024-01-01T00:00:00Z",
        finishedAt: null,
        lastHeartbeatAt: null,
        createdAt: "2024-01-01T00:00:00Z",
        activeLeaseOwnerKey: null,
        activeLeaseExpiresAt: null,
        humanIntervention: null,
      }],
    },
    ...overrides,
  };
}

function createLiveUpdate(payload: ProjectLiveDashboardSnapshot): DashboardRealtimeServerMessage {
  return {
    type: "event",
    event: {
      eventType: "project.live.updated",
      payload,
    },
  };
}

async function flushRealtimeUpdate(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}

describe("useDashboardRuntimeData", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(api.fetchLivePayload).mockResolvedValue(mockPayload);
  });

  it("handles initial load and sets transport state based on realtime callback", async () => {
    let realtimeCallback: (message: DashboardRealtimeServerMessage) => void;
    let transportCallback: (state: TransportState) => void;

    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, rc, tc) => {
      realtimeCallback = rc;
      transportCallback = tc!;
      return () => {};
    });

    const { result } = renderHook(() => useDashboardRuntimeData("p1"));

    expect(result.current.isRecovering).toBe(true);

    // Wait for async fetch to resolve
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(result.current.isRecovering).toBe(false);
    expect(result.current.snapshotUpdatedAt).toBe("2024-01-01T00:00:00Z");
    expect(result.current.initialLoadComplete).toBe(true);
    expect(result.current.transportState).toBe("disconnected");

    // Fire transport state update
    act(() => {
      transportCallback!("connected");
    });

    expect(result.current.transportState).toBe("connected");

    // Fire realtime event for live update (identical semantics, different timestamp)
    act(() => {
      realtimeCallback(createLiveUpdate({ ...mockPayload, updatedAt: "2024-01-02T00:00:00Z" }));
    });
    await flushRealtimeUpdate();

    // We no longer update the state just for metadata changes to avoid re-renders
    expect(result.current.snapshotUpdatedAt).toBe("2024-01-01T00:00:00Z");
  });

  it("does not rerender consumers for timestamp-only websocket updates", async () => {
    let realtimeCallback: (message: DashboardRealtimeServerMessage) => void;
    let renderCount = 0;

    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, rc) => {
      realtimeCallback = rc;
      return () => {};
    });

    const { result } = renderHook(() => {
      renderCount += 1;
      return useDashboardRuntimeData("p1");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const renderCountAfterLoad = renderCount;

    act(() => {
      realtimeCallback(createLiveUpdate({
        ...mockPayload,
        status: { ...mockPayload.status, timestamp: "2024-01-02T00:00:00Z" },
        execution: { ...mockPayload.execution, updatedAt: "2024-01-02T00:00:00Z" },
        updatedAt: "2024-01-02T00:00:00Z",
      }));
    });
    await flushRealtimeUpdate();

    expect(renderCount).toBe(renderCountAfterLoad);
    expect(result.current.snapshotUpdatedAt).toBe("2024-01-01T00:00:00Z");
    expect(result.current.status.timestamp).toBe("2024-01-01T00:00:00Z");
    expect(result.current.execution.updatedAt).toBe("2024-01-01T00:00:00Z");
  });

  it("keeps active runtime data when a transient empty websocket snapshot arrives", async () => {
    const runningPayload = createRunningPayload();
    let realtimeCallback: (message: DashboardRealtimeServerMessage) => void;
    let renderCount = 0;

    vi.mocked(api.fetchLivePayload).mockResolvedValue(runningPayload);
    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, rc) => {
      realtimeCallback = rc;
      return () => {};
    });

    const { result } = renderHook(() => {
      renderCount += 1;
      return useDashboardRuntimeData("p1");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const renderCountAfterLoad = renderCount;

    act(() => {
      realtimeCallback(createLiveUpdate({
        ...runningPayload,
        status: {
          project_id: "p1",
          sprint_id: "s1",
          subtasks: [],
          timestamp: "2024-01-01T00:00:05Z",
        },
        execution: {
          projectId: null,
          projectName: null,
          sprintRuns: [],
          taskDispatches: [],
          connections: [],
          primaryAssignedWorker: null,
          overflowAssignedWorkers: [],
          attentionItems: [],
          recentEvents: [],
          updatedAt: null,
        },
        updatedAt: "2024-01-01T00:00:05Z",
      }));
    });
    await flushRealtimeUpdate();

    expect(renderCount).toBe(renderCountAfterLoad);
    expect(result.current.status.subtasks).toHaveLength(1);
    expect(result.current.execution.sprintRuns).toHaveLength(1);
    expect(result.current.snapshotUpdatedAt).toBe("2024-01-01T00:00:00Z");
  });

  it("updates consumers for real semantic websocket changes", async () => {
    let realtimeCallback: (message: DashboardRealtimeServerMessage) => void;
    let renderCount = 0;

    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, rc) => {
      realtimeCallback = rc;
      return () => {};
    });

    const { result } = renderHook(() => {
      renderCount += 1;
      return useDashboardRuntimeData("p1");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const renderCountAfterLoad = renderCount;

    act(() => {
      realtimeCallback(createLiveUpdate({
        ...mockPayload,
        execution: {
          ...mockPayload.execution,
          taskDispatches: [{
            id: "dispatch-1",
            projectId: "p1",
            sprintId: "s1",
            sprintRunId: "run-1",
            sprintName: "Sprint 1",
            sprintNumber: 1,
            taskId: "task-1",
            taskKey: "TASK-1",
            taskTitle: "Ship it",
            status: "running",
            executorType: "docker_cli",
            priority: 10,
            connectionId: null,
            connectionDisplayName: null,
            connectionRole: null,
            taskRunId: "task-run-1",
            taskRunState: "RUNNING",
            provider: "codex",
            sessionId: "session-1",
            sessionName: "sessions/session-1",
            workerBranch: "feature/task-1",
            prUrl: null,
            queuedAt: "2024-01-01T00:00:00Z",
            claimedAt: "2024-01-01T00:00:01Z",
            startedAt: "2024-01-01T00:00:02Z",
            finishedAt: null,
            lastHeartbeatAt: "2024-01-01T00:00:03Z",
            errorMessage: null,
            activeLeaseOwnerKey: null,
            activeLeaseExpiresAt: null,
          }],
          updatedAt: "2024-01-01T00:00:03Z",
        },
        updatedAt: "2024-01-01T00:00:03Z",
      }));
    });
    await flushRealtimeUpdate();

    expect(renderCount).toBeGreaterThan(renderCountAfterLoad);
    expect(result.current.execution.taskDispatches).toHaveLength(1);
    expect(result.current.snapshotUpdatedAt).toBe("2024-01-01T00:00:03Z");
  });

  it("handles snapshot_required fallback by triggering a silent refetch through the shared hook", async () => {
    let realtimeCallback: (message: DashboardRealtimeServerMessage) => void;

    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, rc, tc) => {
      realtimeCallback = rc;
      return () => {};
    });

    const { result } = renderHook(() => useDashboardRuntimeData("p1"));

    // Wait for initial fetch to resolve
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(api.fetchLivePayload).toHaveBeenCalledTimes(1);

    // Provide a new payload for the next fetch (with a semantic change)
    vi.mocked(api.fetchLivePayload).mockResolvedValueOnce({
        ...mockPayload,
        status: { ...mockPayload.status, project_id: "changed" },
        updatedAt: "2025-01-01T00:00:00Z",
    });

    // Fire snapshot_required realtime fallback
    await act(async () => {
      realtimeCallback({
        type: "snapshot_required",
      });
      // Allow the internal silent refresh promise to settle and debounce timeout to trigger
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    // Validates the fallback strategy triggered the REST fetch properly
    expect(api.fetchLivePayload).toHaveBeenCalledTimes(2);
    expect(result.current.snapshotUpdatedAt).toBe("2025-01-01T00:00:00Z");
  });
});
