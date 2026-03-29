import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { computeOverviewStats, buildEmptyTrend, extractProjectsTrend, extractSprintsTrend, extractOpenTasksTrend, extractCompletedTasksTrend } from "../../../dashboard/src/v2/lib/overview-stats.js";

describe("overview-stats", () => {
  const fakeNow = new Date("2024-03-10T12:00:00Z");

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(fakeNow);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes project, sprint, and task summary counts", () => {
    const stats = computeOverviewStats(
      [
        { id: "p1", isRunning: true },
        { id: "p2", isRunning: false },
      ] as any,
      [
        { id: "s1", status: "running", createdAt: "2024-03-08T10:00:00Z" },
        { id: "s2", status: "completed", createdAt: "2024-03-09T10:00:00Z" },
      ] as any,
      [
        { id: "t1", status: "pending", priority: "critical", createdAt: "2024-03-07T10:00:00Z" },
        { id: "t2", status: "in_progress", priority: "high", createdAt: "2024-03-08T10:00:00Z" },
        { id: "t3", status: "completed", priority: "low", createdAt: "2024-03-08T10:00:00Z", updatedAt: "2024-03-09T10:00:00Z" },
      ] as any
    );

    expect(stats.totalProjects).toBe(2);
    expect(stats.runningProjects).toBe(1);
    expect(stats.totalSprints).toBe(2);
    expect(stats.activeSprints).toBe(1);
    expect(stats.openTasks).toBe(2);
    expect(stats.completedTasks).toBe(1);
    expect(stats.runningTasks).toBe(1);
    expect(stats.criticalTasks).toBe(1);

    expect(stats.projectsTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
    // Mar 4(idx0), Mar 5(idx1), Mar 6(idx2), Mar 7(idx3), Mar 8(idx4), Mar 9(idx5), Mar 10(idx6)
    // s1=Mar 8(idx4), s2=Mar 9(idx5)
    expect(stats.sprintsTrend).toEqual([0, 0, 0, 0, 1, 2, 2]);
    // t1=Mar 7(idx3), t2=Mar 8(idx4) -> cumulative open tasks
    expect(stats.openTasksTrend).toEqual([0, 0, 0, 1, 2, 2, 2]);
    // t3 updated Mar 9(idx5) -> daily activity
    expect(stats.completedTasksTrend).toEqual([0, 0, 0, 0, 0, 1, 0]);
  });

  describe("empty-state handling", () => {
    it("returns empty 7-day arrays when no data provided", () => {
      const stats = computeOverviewStats([], [], []);
      expect(stats.projectsTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(stats.sprintsTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(stats.openTasksTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
      expect(stats.completedTasksTrend).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });

    it("buildEmptyTrend returns array of zeros", () => {
      expect(buildEmptyTrend(7)).toEqual([0, 0, 0, 0, 0, 0, 0]);
    });
  });

  describe("extractProjectsTrend (token series extraction)", () => {
    it("extracts total tokens from usage buckets", () => {
      const buckets = [
        { usage: { totalTokens: 100 } },
        { usage: { totalTokens: 200 } },
        { usage: { totalTokens: 300 } },
      ] as any;
      expect(extractProjectsTrend(buckets, 7)).toEqual([0, 0, 0, 0, 100, 200, 300]);
    });

    it("handles more than 7 buckets by taking the last 7", () => {
      const buckets = Array.from({ length: 10 }).map((_, i) => ({ usage: { totalTokens: i * 10 } })) as any;
      expect(extractProjectsTrend(buckets, 7)).toEqual([30, 40, 50, 60, 70, 80, 90]);
    });
  });

  describe("extractSprintsTrend (cumulative daily sprint totals)", () => {
    it("accumulates sprints correctly across 7 days", () => {
      const sprints = [
        { createdAt: "2024-03-01T10:00:00Z" }, // Before 7d window (Mar 4)
        { createdAt: "2024-03-06T10:00:00Z" }, // Mar 6
        { createdAt: "2024-03-08T10:00:00Z" }, // Mar 8
        { createdAt: "2024-03-08T15:00:00Z" }, // Mar 8
      ] as any;

      const trend = extractSprintsTrend(sprints);
      // Window: Mar 4(idx0), 5(idx1), 6(idx2), 7(idx3), 8(idx4), 9(idx5), 10(idx6)
      // Mar 1 sprint counts as totalBeforeWindow = 1
      // idx0(Mar 4): 1
      // idx1(Mar 5): 1
      // idx2(Mar 6): 2 (+1)
      // idx3(Mar 7): 2
      // idx4(Mar 8): 4 (+2)
      // idx5(Mar 9): 4
      // idx6(Mar 10): 4
      expect(trend).toEqual([1, 1, 2, 2, 4, 4, 4]);
    });
  });

  describe("extractOpenTasksTrend (open-task backlog series)", () => {
    it("accumulates open tasks only", () => {
      const tasks = [
        { status: "in_progress", createdAt: "2024-03-07T10:00:00Z" }, // Mar 7 (idx 3)
        { status: "pending", createdAt: "2024-03-09T10:00:00Z" },     // Mar 9 (idx 5)
        { status: "completed", createdAt: "2024-03-08T10:00:00Z" },   // Ignored
      ] as any;

      const trend = extractOpenTasksTrend(tasks);
      // Window: Mar 4(idx0) to Mar 10(idx6)
      // Mar 7(idx3): 1
      // Mar 9(idx5): 2
      expect(trend).toEqual([0, 0, 0, 1, 1, 2, 2]);
    });
  });

  describe("extractCompletedTasksTrend (completed-task series)", () => {
    it("counts completed tasks per day (non-cumulative)", () => {
      const tasks = [
        { status: "completed", updatedAt: "2024-03-08T10:00:00Z" }, // Mar 8 (idx 4)
        { status: "completed", updatedAt: "2024-03-08T15:00:00Z" }, // Mar 8 (idx 4)
        { status: "completed", updatedAt: "2024-03-10T10:00:00Z" }, // Mar 10 (idx 6)
        { status: "in_progress", updatedAt: "2024-03-09T10:00:00Z" }, // Ignored
      ] as any;

      const trend = extractCompletedTasksTrend(tasks);
      // Window: Mar 4(idx0) to Mar 10(idx6)
      // Mar 8(idx4): 2
      // Mar 10(idx6): 1
      expect(trend).toEqual([0, 0, 0, 0, 2, 0, 1]);
    });
  });
});
