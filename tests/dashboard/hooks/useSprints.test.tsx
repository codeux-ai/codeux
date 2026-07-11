/**
 * @vitest-environment happy-dom
 */
import { act, renderHook, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import { fetchSprints, selectSprint } from "../../../dashboard/src/v2/lib/project-api.js";
import { invalidateLivePayloadCache } from "../../../dashboard/src/lib/api/dashboard-api.js";
import * as realtime from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => vi.fn()),
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchSprints: vi.fn(),
  selectSprint: vi.fn(),
}));

vi.mock("../../../dashboard/src/lib/api/dashboard-api.js", () => ({
  invalidateLivePayloadCache: vi.fn(),
}));

const makeCollection = (completion = 0) => ({
  selectedSprintId: null,
  sprints: [
    {
      id: "sprint-1",
      projectId: "project-1",
      number: 1,
      slug: "sprint-1",
      name: "Sprint 1",
      goal: "Investigate dashboard polling",
      originalPrompt: null,
      status: "idle",
      startDate: null,
      endDate: null,
      createdAt: "2026-04-29T06:00:00.000Z",
      updatedAt: "2026-04-29T06:00:00.000Z",
      tasksCount: 0,
      completedTasksCount: 0,
      completion,
      showcasePinned: true,
      latestReview: null,
    },
  ],
});

describe("useSprints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selectSprint).mockResolvedValue(null);
    vi.mocked(invalidateLivePayloadCache).mockReturnValue(undefined);
  });

  it("does not enter a cache-driven refetch loop after the first sprint load", async () => {
    const projectId = `project-${crypto.randomUUID()}`;
    vi.mocked(fetchSprints).mockImplementation(async () => makeCollection() as any);

    const { result } = renderHook(() => useSprints(projectId));

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(fetchSprints).toHaveBeenCalledTimes(1);
  });

  it("deduplicates concurrent sprint loads for the same project", async () => {
    const projectId = `project-${crypto.randomUUID()}`;
    vi.mocked(fetchSprints).mockImplementation(async () => makeCollection() as any);

    function TwoSprintConsumers() {
      const first = useSprints(projectId);
      const second = useSprints(projectId);
      return h("div", null, `${first.data.length}:${second.data.length}`);
    }

    render(h(TwoSprintConsumers, null));

    await waitFor(() => {
      expect(screen.getByText("1:1")).toBeTruthy();
    });

    expect(fetchSprints).toHaveBeenCalledTimes(1);
  });

  it("refetches seamlessly if a shared in-flight request is aborted by a different caller", async () => {
    const projectId = `project-${crypto.randomUUID()}`;

    vi.mocked(fetchSprints).mockImplementation(async (_pid, signal) => {
      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve(makeCollection() as any);
        }, 100);
        if (signal) {
          signal.addEventListener("abort", () => {
            clearTimeout(timeout);
            const e = new Error("AbortError");
            e.name = "AbortError";
            reject(e);
          });
        }
      });
    });

    const Wrapper1 = () => {
      const data = useSprints(projectId);
      return h("div", { "data-testid": "w1" }, data.data.length);
    };
    const Wrapper2 = () => {
      const data = useSprints(projectId);
      return h("div", { "data-testid": "w2" }, data.data.length);
    };

    const { unmount: unmount1 } = render(h(Wrapper1, null));
    render(h(Wrapper2, null));

    // Abort the first one right away
    unmount1();

    await waitFor(() => {
      expect(screen.getByTestId("w2").textContent).toBe("1");
    });

    expect(fetchSprints).toHaveBeenCalledTimes(2);
  });

  it("invalidates the live payload cache when selected sprint changes", async () => {
    const projectId = `project-${crypto.randomUUID()}`;
    vi.mocked(fetchSprints).mockResolvedValue(makeCollection() as any);
    vi.mocked(selectSprint).mockResolvedValue("sprint-1");

    const { result } = renderHook(() => useSprints(projectId));

    await waitFor(() => {
      expect(result.current.data).toHaveLength(1);
    });

    await act(async () => {
      await result.current.selectSprint("sprint-1");
    });

    expect(invalidateLivePayloadCache).toHaveBeenCalledWith(projectId);
  });

  it.each([
    "project.structure.updated",
    "project.execution.updated",
  ])("refreshes sprint summaries after %s", async (eventType) => {
    const projectId = `project-${crypto.randomUUID()}`;
    let realtimeCallback: Parameters<typeof realtime.subscribeToDashboardRealtime>[1] | undefined;
    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((scopes, callback) => {
      expect(scopes).toEqual([`project:${projectId}`]);
      realtimeCallback = callback;
      return vi.fn();
    });
    vi.mocked(fetchSprints)
      .mockResolvedValueOnce(makeCollection(5) as any)
      .mockResolvedValue(makeCollection(7.5) as any);

    const { result } = renderHook(() => useSprints(projectId));

    await waitFor(() => {
      expect(result.current.data[0]?.completion).toBe(5);
    });

    await act(async () => {
      realtimeCallback?.({
        type: "event",
        event: {
          sequence: 1,
          emittedAt: "2026-07-11T00:00:00.000Z",
          scopeType: "project",
          scopeId: projectId,
          scope: `project:${projectId}`,
          eventType,
          entityType: "project",
          entityId: projectId,
          projectId,
          sprintId: null,
          threadId: null,
          taskId: null,
          dispatchId: null,
          sprintRunId: null,
          taskRunId: null,
          connectionId: null,
          correlationId: null,
          payload: {},
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    await waitFor(() => {
      expect(result.current.data[0]?.completion).toBe(7.5);
    });
    expect(fetchSprints).toHaveBeenCalledTimes(2);
  });
});
