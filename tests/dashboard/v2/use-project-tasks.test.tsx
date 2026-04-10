/** @vitest-environment happy-dom */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderHook, act, cleanup, waitFor } from "@testing-library/preact";
import { useProjectTasks } from "../../../dashboard/src/v2/hooks/use-project-tasks.js";
import { useRealtimeResource } from "../../../dashboard/src/hooks/use-realtime-resource.js";
import * as api from "../../../dashboard/src/v2/lib/project-api.js";

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchTasks: vi.fn(),
}));

let mockRealtimeCallback: any = null;

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn((scopes, callback) => {
    mockRealtimeCallback = callback;
    return () => {};
  })
}));

describe("useProjectTasks integration", () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    mockRealtimeCallback = null;
  });

  it("handles empty project ID correctly without fetching", async () => {
    const { result } = renderHook(() => useProjectTasks(null, [], []));

    expect(result.current.loading).toBe(false);
    expect(result.current.tasks).toEqual([]);
    expect(api.fetchTasks).not.toHaveBeenCalled();
  });

  it("fetches tasks successfully and handles realtime refetch requests", async () => {
    const mockTasks = [
      { id: "record-1", taskKey: "task-1", title: "Task 1", priority: "high", status: "open", dependsOnTaskIds: [] },
    ] as any;

    vi.mocked(api.fetchTasks).mockResolvedValueOnce(mockTasks);

    // We provide a source map properly so view model mapper doesn't error out unexpectedly
    // or return undefined values if it checks missing fields
    const { result } = renderHook(() => useProjectTasks("proj-1", [{ id: "proj-1", name: "Proj" }] as any, []));

    // Initially loading state kicks in because of realtime resource behavior
    expect(result.current.loading).toBe(true);

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    expect(api.fetchTasks).toHaveBeenCalledTimes(1);
    expect(result.current.tasks.length).toBe(1);
    expect(result.current.tasks[0].id).toBe("task-1");
    expect(result.current.tasks[0].recordId).toBe("record-1");

    vi.mocked(api.fetchTasks).mockResolvedValueOnce([
      ...mockTasks,
      { id: "record-2", taskKey: "task-2", title: "Task 2", priority: "normal", status: "open", dependsOnTaskIds: [] },
    ] as any);

    // Fire structure update which should trigger refetch internally in `useRealtimeResource`
    await act(async () => {
      if (mockRealtimeCallback) {
        mockRealtimeCallback({
          type: "event",
          event: {
            eventType: "project.structure.updated",
          }
        });
      }

      // Wait for debounce logic inside useRealtimeResource
      await new Promise(r => setTimeout(r, 200));
    });

    expect(api.fetchTasks).toHaveBeenCalledTimes(2);
    expect(result.current.tasks.length).toBe(2);
    expect(result.current.tasks[1].id).toBe("task-2");
  });

  it("suppresses duplicate fetch when returning same list structure", async () => {
    const mockTasks = [
      { id: "task-1", title: "Task 1", priority: "high", status: "open", dependsOnTaskIds: [] },
    ] as any;

    vi.mocked(api.fetchTasks).mockResolvedValue(mockTasks);

    const { result } = renderHook(() => useProjectTasks("proj-1", [], []));

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    const prevTasksReference = result.current.tasks;

    await act(async () => {
      await result.current.refresh();
      await new Promise(r => setTimeout(r, 200));
    });

    expect(result.current.tasks).toBe(prevTasksReference);
  });
});
