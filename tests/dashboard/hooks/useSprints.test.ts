// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/preact";
import { useSprints } from "../../../dashboard/src/hooks/useSprints.js";
import * as projectApi from "../../../dashboard/src/v2/lib/project-api.js";

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchSprints: vi.fn(),
  selectSprint: vi.fn(),
}));

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => () => {}),
}));

describe("useSprints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should clear collection when project changes if no cache", async () => {
    const fetchSpy = vi.mocked(projectApi.fetchSprints);
    fetchSpy.mockResolvedValueOnce({ sprints: [{
      id: "s1", projectId: "p1", number: 1, slug: "s1", name: "Sprint 1",
      goal: "", status: "active", showcasePinned: false, startDate: "", endDate: "",
      featureBranch: "", tasksCount: 0, completion: 0, createdAt: "", updatedAt: "", date: ""
    }], selectedSprintId: "s1" });

    const { result, rerender } = renderHook(
      (props) => useSprints(props.projectId),
      { initialProps: { projectId: "p1" } }
    );

    await waitFor(() => {
      expect(result.current.data.length).toBe(1);
    });

    fetchSpy.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve({ sprints: [], selectedSprintId: null }), 100)));

    rerender({ projectId: "p2" });

    // Should clear immediately because project changed and there is no cache for p2 yet
    expect(result.current.data.length).toBe(0);
  });
});
