/**
 * @vitest-environment happy-dom
 */
import { renderHook, waitFor } from "@testing-library/preact";
import { h } from "preact";
import { render, screen } from "@testing-library/preact";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import { fetchSprints, selectSprint } from "../../../dashboard/src/v2/lib/project-api.js";

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => vi.fn()),
}));

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchSprints: vi.fn(),
  selectSprint: vi.fn(),
}));

const makeCollection = () => ({
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
      showcasePinned: true,
      latestReview: null,
    },
  ],
});

describe("useSprints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(selectSprint).mockResolvedValue(null);
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
});
