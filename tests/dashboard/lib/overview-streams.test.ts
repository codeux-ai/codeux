import { describe, expect, it } from "vitest";
import { deriveActiveSprintIds, filterTasksToActiveSprints } from "../../../dashboard/src/v2/lib/overview-streams.js";
import type { Sprint, Task } from "../../../dashboard/src/v2/types.js";

describe("overview-streams", () => {
  describe("deriveActiveSprintIds", () => {
    it("returns a set of IDs for sprints with 'active' status", () => {
      const sprints = [
        { id: "s1", status: "running" },
        { id: "s2", status: "completed" },
        { id: "s3", status: "running" },
        { id: "s4", status: "pending" },
      ] as Sprint[];

      const activeIds = deriveActiveSprintIds(sprints);
      expect(activeIds.size).toBe(2);
      expect(activeIds.has("s1")).toBe(true);
      expect(activeIds.has("s3")).toBe(true);
    });

    it("returns an empty set if no sprints are active", () => {
      const sprints = [
        { id: "s2", status: "completed" },
        { id: "s4", status: "pending" },
      ] as Sprint[];

      const activeIds = deriveActiveSprintIds(sprints);
      expect(activeIds.size).toBe(0);
    });
  });

  describe("filterTasksToActiveSprints", () => {
    it("filters tasks down to only those matching active sprint IDs", () => {
      const activeIds = new Set(["s1", "s3"]);
      const tasks = [
        { id: "t1", sprintId: "s1" },
        { id: "t2", sprintId: "s2" },
        { id: "t3", sprintId: "s3" },
        { id: "t4", sprintId: "s4" },
      ] as Task[];

      const filtered = filterTasksToActiveSprints(tasks, activeIds);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(t => t.id)).toEqual(["t1", "t3"]);
    });

    it("returns empty array if activeSprintIds is empty", () => {
      const tasks = [
        { id: "t1", sprintId: "s1" },
      ] as Task[];

      const filtered = filterTasksToActiveSprints(tasks, new Set());
      expect(filtered).toHaveLength(0);
    });
  });
});
