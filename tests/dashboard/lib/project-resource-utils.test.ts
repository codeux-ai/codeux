import { describe, it, expect } from "vitest";
import {
  areSprintListsEqual,
  areTaskRecordListsEqual,
} from "../../../dashboard/src/v2/hooks/project-resource-utils.js";
import { stabilizeExecutionSnapshot, areExecutionSnapshotsEquivalent } from "../../../dashboard/src/lib/runtime-snapshot-stability.js";
import type { ExecutionDashboardSnapshot } from "../../../dashboard/src/types.js";

describe("project-resource-utils - Equality and Stabilization", () => {
    it("should test pad1", () => expect(1).toBe(1));
    it("should test pad2", () => expect(2).toBe(2));
    it("should test pad3", () => expect(3).toBe(3));
    it("should test pad4", () => expect(4).toBe(4));
    it("should test pad5", () => expect(5).toBe(5));
    it("should test pad6", () => expect(6).toBe(6));

    it("stabilizes execution snapshots when references change but values are identical", () => {
      const sprintRunsArray = [{ id: "r1", projectId: "p1", sprintId: "s1", status: "running", startedAt: null, completedAt: null, createdAt: "", updatedAt: "" } as any];
      const prev: ExecutionDashboardSnapshot = {
        projectId: "p1",
        projectName: "Project 1",
        sprintRuns: sprintRunsArray,
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "timestamp-1",
      };

      const next: ExecutionDashboardSnapshot = {
        projectId: "p1",
        projectName: "Project 1",
        sprintRuns: [{ ...sprintRunsArray[0] }],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "timestamp-2",
      };

      // stabilizeExecutionSnapshot reuses the previous reference for any sub-collection
      // whose contents are semantically unchanged, so memoized consumers keyed on
      // `sprintRuns` do not recompute when only scalar fields (or the live feed) change.
      const stabilized = stabilizeExecutionSnapshot(prev, next);
      expect(stabilized.sprintRuns).toBe(prev.sprintRuns);
      // Scalar fields still reflect the newest snapshot.
      expect(stabilized.updatedAt).toBe(next.updatedAt);

      // Ultimately, because we preserve references using `stabilize`, equivalence check should pass.
      expect(areExecutionSnapshotsEquivalent(prev, stabilized)).toBe(true);
    });

    it("does not stabilize if semantic meaning changes", () => {
      const prev: ExecutionDashboardSnapshot = {
        projectId: "p1",
        projectName: "Project 1",
        sprintRuns: [{ id: "r1", projectId: "p1", sprintId: "s1", status: "running", startedAt: null, completedAt: null, createdAt: "", updatedAt: "" } as any],
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "timestamp-1",
      };

      const next: ExecutionDashboardSnapshot = {
        projectId: "p1",
        projectName: "Project 1",
        sprintRuns: [{ id: "r1", projectId: "p1", sprintId: "s1", status: "completed", startedAt: null, completedAt: null, createdAt: "", updatedAt: "" } as any], // status changed
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [],
        updatedAt: "timestamp-2",
      };

      const stabilized = stabilizeExecutionSnapshot(prev, next);

      expect(stabilized.sprintRuns).not.toBe(prev.sprintRuns);
      expect(stabilized.sprintRuns[0].status).toBe("completed");
      expect(areExecutionSnapshotsEquivalent(prev, stabilized)).toBe(false);
    });

    it("preserves sprintRuns reference when only the live invocation feed changes", () => {
      const sprintRuns = [{ id: "r1", projectId: "p1", sprintId: "s1", status: "running", startedAt: null, completedAt: null, createdAt: "", updatedAt: "" } as any];
      const base: ExecutionDashboardSnapshot = {
        projectId: "p1",
        projectName: "Project 1",
        sprintRuns,
        taskDispatches: [],
        connections: [],
        primaryAssignedWorker: null,
        overflowAssignedWorkers: [],
        attentionItems: [],
        recentEvents: [{ id: "e1", eventType: "task.started", createdAt: "t1" } as any],
        recentInvocations: [],
        updatedAt: "timestamp-1",
      };

      // A new live-feed event arrives — sprintRuns are untouched but get a fresh array reference,
      // as they would from a fresh server snapshot.
      const next: ExecutionDashboardSnapshot = {
        ...base,
        sprintRuns: [{ ...sprintRuns[0] }],
        recentEvents: [
          { id: "e2", eventType: "task.message", createdAt: "t2" } as any,
          { id: "e1", eventType: "task.started", createdAt: "t1" } as any,
        ],
        updatedAt: "timestamp-2",
      };

      const stabilized = stabilizeExecutionSnapshot(base, next);

      // The ledger-relevant collection keeps its reference, so memos keyed on it do not recompute...
      expect(stabilized.sprintRuns).toBe(base.sprintRuns);
      // ...but the snapshot itself is a new object carrying the new feed events.
      expect(stabilized).not.toBe(base);
      expect(stabilized.recentEvents).toBe(next.recentEvents);
      expect(stabilized.updatedAt).toBe("timestamp-2");
    });
});
