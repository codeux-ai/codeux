import { describe, expect, it } from "vitest";
import { computeStats, mergeLiveActivities, processDashboardTasks } from "../../../dashboard/src/lib/status.js";

describe("dashboard status helpers", () => {
  it("computes stats by display phase", () => {
    const stats = computeStats([
      { id: "1", title: "a", prompt: "", depends_on: [], is_independent: true, status: "RUNNING", merge_indicator: "CI" },
      { id: "2", title: "b", prompt: "", depends_on: [], is_independent: true, status: "COMPLETED", is_merged: true, merge_indicator: "AUTOMERGE" },
      { id: "3", title: "c", prompt: "", depends_on: [], is_independent: true, status: "FAILED" },
      { id: "4", title: "d", prompt: "", depends_on: [], is_independent: true, status: "RUNNING", merge_indicator: "MERGE_BLOCKED" },
      { id: "5", title: "e", prompt: "", depends_on: [], is_independent: true, status: "CODING_COMPLETED", merge_indicator: "MERGE_CONFLICT", worker_branch: "worker/task-5" },
    ]);

    expect(stats).toEqual({
      total: 5,
      running: 0,
      codingCompleted: 3,
      completed: 1,
      failed: 1,
      ci: 1,
      automerge: 1,
      merged: 1,
      mergeBlocked: 1,
      mergeConflicts: 1,
    });
  });

  it("merges live activities by normalized session", () => {
    const merged = mergeLiveActivities(
      [{ id: "1", title: "a", prompt: "", depends_on: [], is_independent: true, session_id: "abc" }],
      { "sessions/abc": [{ id: "act-1", name: "x", createTime: "t" }] }
    );

    expect(merged[0].session_name).toBe("sessions/abc");
    expect(merged[0].activities?.[0]?.id).toBe("act-1");
  });

  it("processes stats and live activities in one pass", () => {
    const result = processDashboardTasks(
      [{ id: "1", title: "a", prompt: "", depends_on: [], is_independent: true, status: "RUNNING", merge_indicator: "CI", session_id: "abc" }],
      { "sessions/abc": [{ id: "act-1", name: "x", createTime: "t" }] },
    );

    expect(result.stats.running).toBe(0);
    expect(result.stats.codingCompleted).toBe(1);
    expect(result.tasks[0]?.session_name).toBe("sessions/abc");
    expect(result.tasks[0]?.activities?.[0]?.id).toBe("act-1");
  });
});
