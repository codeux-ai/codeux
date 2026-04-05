import { describe, expect, it, vi } from "vitest";
import { queryProjectStatsSnapshot } from "../../../../src/repositories/execution/project-stats-snapshot-query.js";
import { ProjectStatsQueryDependencies } from "../../../../src/repositories/execution/project-stats-snapshot-query.js";

describe("queryProjectStatsSnapshot", () => {
  it("computes stats snapshot calling the expected dependencies", () => {
    const dbMock = {
      prepare: vi.fn().mockImplementation((query) => {
        return {
          get: vi.fn().mockReturnValue({ id: "proj-1", name: "Project 1", sprint_id: "sprint-1", sprint_name: "Sprint 1", sprint_number: 1 }),
          all: vi.fn().mockReturnValue([]),
        };
      })
    };

    const depsMock: ProjectStatsQueryDependencies = {
      requireProject: vi.fn(),
      getWallTimeTotalsByTaskIdsForRange: vi.fn().mockReturnValue(new Map()),
      getWallTimeTotalsBySprintRunIdsForRange: vi.fn().mockReturnValue(new Map()),
      getTaskMetadata: vi.fn().mockReturnValue(new Map()),
      getSprintMetadata: vi.fn().mockReturnValue(new Map()),
      mapProviderInvocationUsageRow: vi.fn(),
      mergeUsageTotals: vi.fn(),
      mergeUsageMap: vi.fn(),
      updateLastActivity: vi.fn(),
    };

    const snapshot = queryProjectStatsSnapshot(dbMock as any, "proj-1", "7d", depsMock);

    expect(depsMock.requireProject).toHaveBeenCalledWith("proj-1");
    expect(snapshot.projectId).toBe("proj-1");
    expect(snapshot.projectName).toBe("Project 1");
    expect(snapshot.window).toBe("7d");
    expect(snapshot.git).toBeDefined();
    expect(snapshot.git.totals).toEqual({ insertions: 0, deletions: 0, filesChanged: 0, prCount: 0, mergedCount: 0 });
    expect(snapshot.activeSprint?.sprintId).toBe("sprint-1");
  });
});
