/** @vitest-environment jsdom */
import { h, Fragment } from "preact";
/** @jsx h */
/** @jsxFrag Fragment */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/preact";
import { useDashboardRuntimeData } from "../../../dashboard/src/hooks/use-dashboard-runtime-data.js";
import * as api from "../../../dashboard/src/lib/api/dashboard-api.js";
import * as realtime from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js");
vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js");

const mockPayload = {
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

describe("useDashboardRuntimeData", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(api.fetchLivePayload).mockResolvedValue(mockPayload as any);
  });

  it("handles initial load and sets transport state based on realtime callback", async () => {
    let realtimeCallback: (message: any) => void;
    let transportCallback: (state: string) => void;

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

    // Fire realtime event for live update
    act(() => {
      realtimeCallback({
        type: "event",
        event: {
          eventType: "project.live.updated",
          payload: { ...mockPayload, updatedAt: "2024-01-02T00:00:00Z" },
        },
      });
    });

    expect(result.current.snapshotUpdatedAt).toBe("2024-01-02T00:00:00Z");
  });
});
