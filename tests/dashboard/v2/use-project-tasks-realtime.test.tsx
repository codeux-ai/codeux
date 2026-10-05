/** @vitest-environment happy-dom */
import { act, renderHook, waitFor } from "@testing-library/preact";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useProjectTasks } from "../../../dashboard/src/v2/hooks/use-project-tasks.js";
import { fetchTasks } from "../../../dashboard/src/v2/lib/project-api.js";
import * as realtime from "../../../dashboard/src/lib/realtime/dashboard-realtime-client.js";
import type { TaskRecord } from "../../../dashboard/src/v2/types.js";

vi.mock("../../../dashboard/src/v2/lib/project-api.js", () => ({
  fetchTasks: vi.fn(),
}));

vi.mock("../../../dashboard/src/lib/realtime/dashboard-realtime-client.js", () => ({
  subscribeToDashboardRealtime: vi.fn(() => vi.fn()),
}));

const makeTaskRecord = (executionStatus?: TaskRecord["executionStatus"]): TaskRecord => ({
  id: "task-1",
  projectId: "project-1",
  sprintId: "sprint-1",
  taskKey: "T01",
  title: "Task",
  promptMarkdown: "Do the task",
  description: "Task description",
  status: "pending",
  executionStatus,
  priority: "medium",
  executorType: "docker_cli",
  agentPresetId: null,
  sortOrder: 0,
  dependsOnTaskIds: [],
  isIndependent: false,
  isMerged: false,
  latestReview: null,
  mergeIndicator: null,
  sourceType: null,
  sourcePath: null,
  createdAt: "2026-09-28T00:00:00.000Z",
  updatedAt: "2026-09-28T00:00:00.000Z",
});

describe("useProjectTasks realtime execution refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes task execution status after project.execution.updated", async () => {
    const projectId = "project-" + crypto.randomUUID();
    let realtimeCallback: Parameters<typeof realtime.subscribeToDashboardRealtime>[1] | undefined;
    vi.mocked(realtime.subscribeToDashboardRealtime).mockImplementation((_scopes, callback) => {
      realtimeCallback = callback;
      return vi.fn();
    });
    vi.mocked(fetchTasks)
      .mockResolvedValueOnce([makeTaskRecord()])
      .mockResolvedValueOnce([makeTaskRecord("FAILED")]);

    const { result } = renderHook(() => useProjectTasks(projectId, [], [], null));

    await waitFor(() => {
      expect(result.current.tasks).toHaveLength(1);
      expect(fetchTasks).toHaveBeenCalledTimes(1);
    });

    await act(async () => {
      realtimeCallback?.({
        type: "event",
        event: {
          sequence: 1,
          emittedAt: "2026-09-28T00:00:01.000Z",
          scopeType: "project",
          scopeId: projectId,
          scope: "project:" + projectId,
          eventType: "project.execution.updated",
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
    });

    await waitFor(() => {
      expect(result.current.tasks[0]?.executionStatus).toBe("FAILED");
    });
    expect(fetchTasks).toHaveBeenCalledTimes(2);
  });
});
