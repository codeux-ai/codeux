import { describe, expect, it } from "vitest";
import type { Sprint, TaskRecord } from "../../../dashboard/src/v2/types.js";
import type { ExecutionDashboardSnapshot, ProjectExecutionStatsSnapshot } from "../../../src/contracts/app-types.js";
import {
  areExecutionSnapshotsEqual,
  areProjectStatsSnapshotsEqual,
  areSprintListsEqual,
  areTaskRecordListsEqual,
  shouldUseForegroundLoading,
} from "../../../dashboard/src/v2/hooks/project-resource-utils.js";

function createTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    projectId: "project-1",
    sprintId: "sprint-1",
    taskKey: "T01",
    title: "Implement flow",
    promptMarkdown: "Do the thing",
    description: "desc",
    status: "pending",
    priority: "medium",
    executorType: "auto",
    sortOrder: 0,
    dependsOnTaskIds: [],
    isIndependent: true,
    isMerged: false,
    mergeIndicator: null,
    sourceType: null,
    sourcePath: null,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    ...overrides,
  };
}

function createSprint(overrides: Partial<Sprint> = {}): Sprint {
  return {
    id: "sprint-1",
    projectId: "project-1",
    number: 1,
    slug: "sprint-1",
    name: "Sprint 1",
    goal: "Ship it",
    status: "idle",
    startDate: null,
    endDate: null,
    featureBranch: null,
    tasksCount: 1,
    completion: 0,
    createdAt: "2026-03-10T00:00:00.000Z",
    updatedAt: "2026-03-10T00:00:00.000Z",
    date: "Schedule TBD",
    ...overrides,
  };
}

describe("project-resource-utils", () => {
  it("only uses foreground loading for first non-silent fetches", () => {
    expect(shouldUseForegroundLoading(false, false)).toBe(true);
    expect(shouldUseForegroundLoading(true, false)).toBe(false);
    expect(shouldUseForegroundLoading(false, true)).toBe(false);
  });

  it("treats identical task record payloads as equal", () => {
    const current = [createTaskRecord({ dependsOnTaskIds: ["task-0"] })];
    const next = [createTaskRecord({ dependsOnTaskIds: ["task-0"] })];

    expect(areTaskRecordListsEqual(current, next)).toBe(true);
  });

  it("detects meaningful task record changes", () => {
    const current = [createTaskRecord()];
    const next = [createTaskRecord({ updatedAt: "2026-03-10T00:00:01.000Z" })];

    expect(areTaskRecordListsEqual(current, next)).toBe(false);
  });

  it("treats identical sprint payloads as equal", () => {
    const current = [createSprint()];
    const next = [createSprint()];

    expect(areSprintListsEqual(current, next)).toBe(true);
  });

  it("detects sprint status changes", () => {
    const current = [createSprint({ status: "idle" })];
    const next = [createSprint({ status: "running" })];

    expect(areSprintListsEqual(current, next)).toBe(false);
  });

  describe("areExecutionSnapshotsEqual", () => {
    it("returns true for identical object references", () => {
      const snap = { updatedAt: "2026-03-10T00:00:00.000Z" } as ExecutionDashboardSnapshot;
      expect(areExecutionSnapshotsEqual(snap, snap)).toBe(true);
    });

    it("returns false if one is null", () => {
      const snap = { updatedAt: "2026-03-10T00:00:00.000Z" } as ExecutionDashboardSnapshot;
      expect(areExecutionSnapshotsEqual(snap, null)).toBe(false);
      expect(areExecutionSnapshotsEqual(null, snap)).toBe(false);
    });

    it("returns true for identical values", () => {
      const current = { projectId: "p1", updatedAt: "2026-03-10T00:00:00.000Z" } as ExecutionDashboardSnapshot;
      const next = { projectId: "p1", updatedAt: "2026-03-10T00:00:00.000Z" } as ExecutionDashboardSnapshot;
      expect(areExecutionSnapshotsEqual(current, next)).toBe(true);
    });

    it("returns false for different values", () => {
      const current = { projectId: "p1", updatedAt: "2026-03-10T00:00:00.000Z" } as ExecutionDashboardSnapshot;
      const next = { projectId: "p1", updatedAt: "2026-03-10T00:00:01.000Z" } as ExecutionDashboardSnapshot;
      expect(areExecutionSnapshotsEqual(current, next)).toBe(false);
    });
  });

  describe("areProjectStatsSnapshotsEqual", () => {
    it("returns true for identical object references", () => {
      const stats = { projectId: "p1" } as ProjectExecutionStatsSnapshot;
      expect(areProjectStatsSnapshotsEqual(stats, stats)).toBe(true);
    });

    it("returns false if one is null", () => {
      const stats = { projectId: "p1" } as ProjectExecutionStatsSnapshot;
      expect(areProjectStatsSnapshotsEqual(stats, null)).toBe(false);
      expect(areProjectStatsSnapshotsEqual(null, stats)).toBe(false);
    });

    it("returns true for identical structural values", () => {
      const current = { projectId: "p1", totalRuns: 10 } as unknown as ProjectExecutionStatsSnapshot;
      const next = { projectId: "p1", totalRuns: 10 } as unknown as ProjectExecutionStatsSnapshot;
      expect(areProjectStatsSnapshotsEqual(current, next)).toBe(true);
    });

    it("returns false for different structural values", () => {
      const current = { projectId: "p1", totalRuns: 10 } as unknown as ProjectExecutionStatsSnapshot;
      const next = { projectId: "p1", totalRuns: 11 } as unknown as ProjectExecutionStatsSnapshot;
      expect(areProjectStatsSnapshotsEqual(current, next)).toBe(false);
    });
  });
});
