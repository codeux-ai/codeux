import { describe, expect, it } from "vitest";
import {
  deriveActiveSprintIds,
  deriveOverviewTaskCiPresentations,
  deriveOverviewTaskHumanInterventions,
  filterTasksToActiveSprints,
} from "../../../dashboard/src/v2/lib/overview-streams.js";
import type { Sprint, Task } from "../../../dashboard/src/v2/types.js";
import type { ExecutionDashboardSnapshot } from "../../../dashboard/src/types.js";

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

  describe("deriveOverviewTaskCiPresentations", () => {
    it("uses the latest matching task event without leaking another task's CI state", () => {
      const task = {
        id: "TASK-1",
        recordId: "task-record-1",
        sprintId: "sprint-1",
        mergeIndicator: null,
        isMerged: false,
      } as Task;
      const presentations = deriveOverviewTaskCiPresentations([task], {
        taskDispatches: [],
        attentionItems: [],
        recentEvents: [{
          id: "event-task-older",
          eventType: "ci_gate_status",
          sprintId: "sprint-1",
          taskId: "task-record-1",
          taskKey: "TASK-1",
          createdAt: "2026-07-14T10:00:00.000Z",
          payload: {
            state: "pending_checks",
            prNumber: 17,
          },
        }, {
          id: "event-task-current",
          eventType: "ci_gate_status",
          sprintId: "sprint-1",
          taskId: "task-record-1",
          taskKey: "TASK-1",
          createdAt: "2026-07-14T10:01:00.000Z",
          payload: {
            state: "ready_for_merge",
            prNumber: 17,
          },
        }, {
          id: "event-other-task",
          eventType: "ci_gate_status",
          sprintId: "sprint-1",
          taskId: "task-record-2",
          taskKey: "TASK-2",
          createdAt: "2026-07-14T10:02:00.000Z",
          payload: {
            state: "blocked",
            prNumber: 18,
            hasFailedChecks: true,
          },
        }],
      } as ExecutionDashboardSnapshot);

      expect(presentations.get("task-record-1")).toMatchObject({
        state: "pending",
        steps: [
          { id: "pull_request", state: "successful" },
          { id: "checks", state: "successful", statusLabel: "Checks passed" },
          { id: "merge", state: "pending", statusLabel: "Ready to merge" },
        ],
      });
    });

    it("projects active CI attention and task merge-indicator fallback independently", () => {
      const attentionTask = {
        id: "TASK-ATTENTION",
        recordId: "task-record-attention",
        sprintId: "sprint-1",
        mergeIndicator: "CI",
        isMerged: false,
      } as Task;
      const conflictTask = {
        id: "TASK-CONFLICT",
        recordId: "task-record-conflict",
        sprintId: "sprint-1",
        mergeIndicator: "MERGE_CONFLICT",
        isMerged: false,
      } as Task;
      const presentations = deriveOverviewTaskCiPresentations([attentionTask, conflictTask], {
        taskDispatches: [],
        recentEvents: [],
        attentionItems: [{
          id: "attention-ci",
          attentionType: "ci_fix_required",
          status: "open",
          sprintId: "sprint-1",
          taskId: "task-record-attention",
          sprintRunId: null,
          payload: { taskId: "task-record-attention", prNumber: 17 },
        }],
      } as ExecutionDashboardSnapshot);

      expect(presentations.get("task-record-attention")).toMatchObject({
        state: "failed",
        failureKind: "ci_checks",
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "checks", state: "failed", statusLabel: "Checks failed" }),
        ]),
      });
      expect(presentations.get("task-record-conflict")).toMatchObject({
        state: "failed",
        failureKind: "merge_conflict",
        steps: expect.arrayContaining([
          expect.objectContaining({ id: "merge", state: "failed", statusLabel: "Merge conflict" }),
        ]),
      });
    });
  });

  describe("deriveOverviewTaskHumanInterventions", () => {
    it("selects only active human-only attention matched to the task", () => {
      const task = {
        id: "TASK-1",
        recordId: "task-record-1",
        sprintId: "sprint-1",
      } as Task;
      const baseAttention = {
        id: "attention-human",
        attentionType: "human_escalation_required",
        status: "open",
        ownerType: "human",
        assignedWorkerEndpointId: null,
        sprintId: "sprint-1",
        taskId: "task-record-1",
        sprintRunId: "run-1",
        dispatchId: null,
        payload: null,
      };

      const active = deriveOverviewTaskHumanInterventions([task], {
        taskDispatches: [],
        recentEvents: [],
        attentionItems: [
          { ...baseAttention, id: "resolved", status: "resolved" },
          { ...baseAttention, id: "worker", ownerType: "worker" },
          { ...baseAttention, id: "sibling", taskId: "task-record-2" },
          baseAttention,
        ],
      } as ExecutionDashboardSnapshot);
      expect(active.get("task-record-1")?.id).toBe("attention-human");

      const notHumanOnly = deriveOverviewTaskHumanInterventions([task], {
        taskDispatches: [],
        recentEvents: [],
        attentionItems: [{ ...baseAttention, assignedWorkerEndpointId: "worker-endpoint-1" }],
      } as ExecutionDashboardSnapshot);
      expect(notHumanOnly).toEqual(new Map());
    });
  });
});
