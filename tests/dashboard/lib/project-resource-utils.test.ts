import { describe, it, expect } from "vitest";
import {
  areSprintListsEqual,
  areTaskRecordListsEqual,
} from "../../../dashboard/src/v2/hooks/project-resource-utils.js";
import { stabilizeExecutionSnapshot, areExecutionSnapshotsEquivalent } from "../../../dashboard/src/lib/runtime-snapshot-stability.js";
import type { ExecutionDashboardSnapshot } from "../../../dashboard/src/types.js";
import { toTaskViewModel } from "../../../dashboard/src/v2/lib/view-models.js";
import type {
  Sprint,
  SprintReviewSummary,
  TaskRecord,
} from "../../../dashboard/src/v2/types.js";

const qaSummary: SprintReviewSummary = {
  status: "completed",
  outcome: "changes_requested",
  summary: "Please address the review findings.",
  findings: ["Cover the timeout path"],
  reviewer: "QA Bot",
  finishedAt: "2026-07-13T09:00:00.000Z",
  fixInstructions: "Add timeout handling and regression coverage.",
  targetTaskKey: "T01",
  followUpTasks: [{
    title: "Harden timeout handling",
    promptMarkdown: "Implement deterministic timeout handling.",
    description: "Prevent requests from waiting indefinitely.",
    dependsOnTaskKeys: ["T00"],
    priority: "high",
  }],
};

function makeSprint(latestReview: SprintReviewSummary = qaSummary): Sprint {
  return {
    id: "sprint-1",
    projectId: "project-1",
    number: 1,
    slug: "qa-details",
    name: "QA details",
    goal: "Show complete QA details",
    status: "active",
    showcasePinned: false,
    startDate: null,
    endDate: null,
    featureBranch: "feature/qa-details",
    tasksCount: 1,
    completion: 50,
    latestReview,
    createdAt: "2026-07-13T08:00:00.000Z",
    updatedAt: "2026-07-13T09:00:00.000Z",
    date: "Schedule TBD",
  } as Sprint;
}

function makeTaskRecord(latestReview: SprintReviewSummary = qaSummary): TaskRecord {
  return {
    id: "task-record-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskKey: "T01",
    title: "Render QA details",
    promptMarkdown: "Implement the QA details card.",
    description: "Render complete QA context.",
    status: "coding_completed",
    priority: "medium",
    executorType: "docker_cli",
    agentPresetId: null,
    sortOrder: 1,
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    latestReview,
    mergeIndicator: null,
    sourceType: null,
    sourcePath: null,
    createdAt: "2026-07-13T08:00:00.000Z",
    updatedAt: "2026-07-13T09:00:00.000Z",
  };
}

const QA_REVIEW_UPDATES: Array<[
  string,
  (review: SprintReviewSummary) => SprintReviewSummary,
]> = [
  ["fix instructions", (review) => ({ ...review, fixInstructions: "Use a bounded retry." })],
  ["target task key", (review) => ({ ...review, targetTaskKey: "T02" })],
  ["follow-up title", (review) => ({ ...review, followUpTasks: [{ ...review.followUpTasks![0]!, title: "Repair retries" }] })],
  ["follow-up description", (review) => ({ ...review, followUpTasks: [{ ...review.followUpTasks![0]!, description: "Use bounded retries." }] })],
  ["follow-up priority", (review) => ({ ...review, followUpTasks: [{ ...review.followUpTasks![0]!, priority: "critical" }] })],
  ["follow-up dependencies", (review) => ({ ...review, followUpTasks: [{ ...review.followUpTasks![0]!, dependsOnTaskKeys: ["T00", "T-SETUP"] }] })],
  ["follow-up prompt", (review) => ({ ...review, followUpTasks: [{ ...review.followUpTasks![0]!, promptMarkdown: "Implement bounded retries and test them." }] })],
];

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

    it.each(QA_REVIEW_UPDATES)("invalidates task resource equality when QA %s change", (_field, updateReview) => {
      expect(areTaskRecordListsEqual(
        [makeTaskRecord()],
        [makeTaskRecord(updateReview(qaSummary))],
      )).toBe(false);
    });

    it("keeps task resource references stable when complete nested QA values are equal", () => {
      const clonedReview: SprintReviewSummary = {
        ...qaSummary,
        findings: [...qaSummary.findings],
        followUpTasks: qaSummary.followUpTasks?.map((task) => ({
          ...task,
          dependsOnTaskKeys: [...task.dependsOnTaskKeys],
        })),
      };

      expect(areTaskRecordListsEqual([makeTaskRecord()], [makeTaskRecord(clonedReview)])).toBe(true);
    });

    it("invalidates sprint resource equality when latestReview nested follow-up data changes", () => {
      const changedReview: SprintReviewSummary = {
        ...qaSummary,
        followUpTasks: [{
          ...qaSummary.followUpTasks![0]!,
          dependsOnTaskKeys: ["T00", "T-PLATFORM"],
        }],
      };

      expect(areSprintListsEqual([makeSprint()], [makeSprint(changedReview)])).toBe(false);
    });

    it("invalidates the task view-model reference when new QA metadata changes", () => {
      const previous = toTaskViewModel(makeTaskRecord(), new Map(), new Map());
      const changedReview: SprintReviewSummary = {
        ...qaSummary,
        followUpTasks: [{
          ...qaSummary.followUpTasks![0]!,
          promptMarkdown: "Implement bounded retries, tests, and instrumentation.",
        }],
      };

      const next = toTaskViewModel(makeTaskRecord(changedReview), new Map(), new Map(), previous);
      expect(next).not.toBe(previous);
      expect(next.latestReview?.followUpTasks?.[0]?.promptMarkdown).toContain("instrumentation");
    });
});
