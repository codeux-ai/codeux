import { describe, expect, it } from "vitest";
import { computeStats, mergeLiveActivities } from "./status.js";

describe("dashboard status helpers", () => {
  it("computes stats by status", () => {
    const stats = computeStats([
      { id: "1", title: "a", prompt: "", depends_on: [], is_independent: true, status: "RUNNING" },
      { id: "2", title: "b", prompt: "", depends_on: [], is_independent: true, status: "COMPLETED" },
      { id: "3", title: "c", prompt: "", depends_on: [], is_independent: true, status: "FAILED" },
    ]);

    expect(stats).toEqual({ total: 3, running: 1, completed: 1, failed: 1 });
  });

  it("merges live activities by normalized session", () => {
    const merged = mergeLiveActivities(
      [{ id: "1", title: "a", prompt: "", depends_on: [], is_independent: true, session_id: "abc" }],
      { "sessions/abc": [{ id: "act-1", name: "x", createTime: "t" }] }
    );

    expect(merged[0].session_name).toBe("sessions/abc");
    expect(merged[0].activities?.[0]?.id).toBe("act-1");
  });
});
