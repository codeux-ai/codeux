// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/preact";
import { useProjectTasks } from "../../../dashboard/src/v2/hooks/use-project-tasks.js";
import * as projectApi from "../../../dashboard/src/v2/lib/project-api.js";

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchTasks: vi.fn(),
}));

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => () => {}),
}));

describe("useProjectTasks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should clear tasks immediately on project change", async () => {
    const fetchSpy = vi.mocked(projectApi.fetchTasks);
    fetchSpy.mockResolvedValueOnce([{
      id: "t1", projectId: "p1", sprintId: "s1", taskKey: "t1", title: "Task 1",
      promptMarkdown: "", description: "", status: "pending", priority: "high",
      executorType: "jules", sortOrder: 0, isIndependent: false, isMerged: false,
      mergeIndicator: "none", sourceType: "project", sourcePath: "", createdAt: "", updatedAt: "",
      dependsOnTaskIds: []
    }]);

    const { result, rerender } = renderHook(
      (props) => useProjectTasks(props.projectId, [], [], props.sprintId),
      { initialProps: { projectId: "p1", sprintId: "s1" } }
    );

    await waitFor(() => {
      expect(result.current.tasks.length).toBe(1);
    });

    fetchSpy.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve([]), 100)));

    rerender({ projectId: "p2", sprintId: "s1" });

    // Should clear immediately because project changed
    expect(result.current.tasks.length).toBe(0);
  });

  it("should not clear tasks immediately on sprint change within same project", async () => {
    const fetchSpy = vi.mocked(projectApi.fetchTasks);
    fetchSpy.mockResolvedValueOnce([{
      id: "t1", projectId: "p1", sprintId: "s1", taskKey: "t1", title: "Task 1",
      promptMarkdown: "", description: "", status: "pending", priority: "high",
      executorType: "jules", sortOrder: 0, isIndependent: false, isMerged: false,
      mergeIndicator: "none", sourceType: "project", sourcePath: "", createdAt: "", updatedAt: "",
      dependsOnTaskIds: []
    }]);

    const { result, rerender } = renderHook(
      (props) => useProjectTasks(props.projectId, [], [], props.sprintId),
      { initialProps: { projectId: "p1", sprintId: "s1" } }
    );

    await waitFor(() => {
      expect(result.current.tasks.length).toBe(1);
    });

    let resolveSecond: (val: any) => void;
    fetchSpy.mockImplementationOnce(() => new Promise((resolve) => {
      resolveSecond = resolve;
    }));

    rerender({ projectId: "p1", sprintId: "s2" });

    // Should NOT clear immediately because only sprint changed
    expect(result.current.tasks.length).toBe(1);

    resolveSecond!([{
      id: "t2", projectId: "p1", sprintId: "s2", taskKey: "t2", title: "Task 2",
      promptMarkdown: "", description: "", status: "pending", priority: "high",
      executorType: "jules", sortOrder: 0, isIndependent: false, isMerged: false,
      mergeIndicator: "none", sourceType: "project", sourcePath: "", createdAt: "", updatedAt: "",
      dependsOnTaskIds: []
    }]);

    await waitFor(() => {
      expect(result.current.tasks.length).toBe(1);
      expect(result.current.tasks[0].id).toBe("t2");
    });
  });
});
