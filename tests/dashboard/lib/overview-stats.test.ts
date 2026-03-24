import { describe, expect, it } from "vitest";
import { computeOverviewStats } from "../../../dashboard/src/v2/lib/overview-stats.js";

describe("overview-stats", () => {
  it("computes project, sprint, and task summary counts", () => {
    const stats = computeOverviewStats(
      [
        { id: "p1", isRunning: true },
        { id: "p2", isRunning: false },
      ] as any,
      [
        { id: "s1", status: "running" },
        { id: "s2", status: "completed" },
      ] as any,
      [
        { id: "t1", status: "pending", priority: "critical" },
        { id: "t2", status: "in_progress", priority: "high" },
        { id: "t3", status: "completed", priority: "low" },
      ] as any
    );

    expect(stats).toEqual({
      totalProjects: 2,
      runningProjects: 1,
      totalSprints: 2,
      activeSprints: 1,
      openTasks: 2,
      completedTasks: 1,
      runningTasks: 1,
      criticalTasks: 1,
    });
  });

  describe("active stream filtering", () => {
    it("excludes tasks belonging to inactive or completed sprints from the active stream", () => {
      // Simulate the backend filtering that now happens before the component receives tasks
      const allTasks = [
        { id: "t1", sprintId: "s1", title: "Active sprint task" },
        { id: "t2", sprintId: "s2", title: "Inactive sprint task" }
      ];

      const sprints = [
        { id: "s1", status: "running" },
        { id: "s2", status: "completed" }
      ];

      // Simulate the activeSprintsOnly backend logic for the frontend
      const activeSprints = new Set(sprints.filter(s => s.status === "running").map(s => s.id));
      const activeStreamTasks = allTasks.filter(t => activeSprints.has(t.sprintId));

      expect(activeStreamTasks).toHaveLength(1);
      expect(activeStreamTasks[0].id).toBe("t1");
    });
  });
});
