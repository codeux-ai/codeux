import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTaskLane } from "../../../../../dashboard/src/v2/lib/task-board-state.js";
import {
  formatTimeAgo,
  getExecutorLabel,
  buildTaskCardViewModel,
} from "../../../../../dashboard/src/v2/lib/tasks/task-card-view-model.js";
import type { Task } from "../../../../../dashboard/src/v2/types.js";
import type { TaskSelfReflectionRating } from "../../../../../src/contracts/task-self-reflection-types.js";

describe("task-card-view-model", () => {
  describe("formatTimeAgo", () => {
    const NOW = new Date("2023-10-01T12:00:00Z").getTime();

    it("handles invalid dates", () => {
      expect(formatTimeAgo("invalid", NOW)).toBe("--");
    });

    it("returns 'just now' for future dates or very recent dates", () => {
      const future = new Date(NOW + 10000).toISOString();
      expect(formatTimeAgo(future, NOW)).toBe("just now");
    });

    it("returns minutes ago", () => {
      const past = new Date(NOW - 15 * 60000).toISOString();
      expect(formatTimeAgo(past, NOW)).toBe("15m ago");
    });

    it("returns hours ago", () => {
      const past = new Date(NOW - 2 * 60 * 60000).toISOString();
      expect(formatTimeAgo(past, NOW)).toBe("2h ago");
    });

    it("returns days ago", () => {
      const past = new Date(NOW - 3 * 24 * 60 * 60000).toISOString();
      expect(formatTimeAgo(past, NOW)).toBe("3d ago");
    });
  });

  describe("getExecutorLabel", () => {
    it("returns correct labels for known types", () => {
      expect(getExecutorLabel("auto")).toBe("Auto");
      expect(getExecutorLabel("docker_cli")).toBe("CLI");
      expect(getExecutorLabel("jules")).toBe("Jules");
    });

    it("returns Unknown for unexpected types", () => {
      expect(getExecutorLabel("foo" as any)).toBe("Unknown");
    });
  });

  describe("buildTaskCardViewModel", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2023-10-01T12:00:00Z"));
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const createMockTask = (overrides: Partial<Task> = {}): Task => ({
      recordId: "rec-1",
      id: "T-1",
      source: "src",
      sprint: "Sprint 1",
      sprintId: "sprint-1",
      title: "Task 1",
      status: "pending",
      priority: "medium",
      executorType: "auto",
      assignee: "Alice",
      time: "10m",
      createdAt: "2023-10-01T11:00:00Z", // 1 hour ago
      updatedAt: "2023-10-01T11:00:00Z",
      promptMarkdown: "",
      description: "",
      dependsOnTaskIds: [],
      isIndependent: false,
      isMerged: false,
      mergeIndicator: null,
      ...overrides,
    });

    const createRating = (overrides: Partial<TaskSelfReflectionRating> = {}): TaskSelfReflectionRating => ({
      id: "rating-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "rec-1",
      sourceTaskRunId: "run-1",
      overallRating: 4.5,
      sections: [
        {
          label: "Implementation",
          normalizedLabel: "implementation",
          rating: 4.5,
          note: "Covered edge cases.",
        },
        {
          label: "Scope control",
          normalizedLabel: "scope_control",
          rating: 4,
          note: "Stayed focused.",
        },
      ],
      capturedAt: "2026-07-07T00:00:00.000Z",
      createdAt: "2026-07-07T00:00:00.000Z",
      updatedAt: "2026-07-07T00:00:00.000Z",
      ...overrides,
    });

    it("builds a basic view model with empty dependencies", () => {
      const task = createMockTask();
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup);

      expect(vm.task).toBe(task);
      expect(vm.humanizedCreatedAt).toBe("1h ago");
      expect(vm.executorLabel).toBe("Auto");
      expect(vm.dependencyIndicators).toEqual([]);
    });

    it("passes self-reflection ratings through the task card view model", () => {
      const rating = createRating();
      const task = createMockTask({ selfReflectionRating: rating });
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup);

      expect(vm.selfReflectionRating).toBe(rating);
      expect(vm.task.selfReflectionRating).toBe(rating);
    });

    it("resolves dependencies from the lookup map", () => {
      const dep1 = createMockTask({ recordId: "rec-dep1", id: "T-2", title: "Dep 1", status: "completed" });
      const dep2 = createMockTask({ recordId: "rec-dep2", id: "T-3", title: "Dep 2", status: "in_progress" });
      const task = createMockTask({ dependsOnTaskIds: ["rec-dep1", "rec-dep2"] });

      const lookup = new Map<string, Task>([
        ["rec-dep1", dep1],
        ["rec-dep2", dep2],
      ]);

      const vm = buildTaskCardViewModel(task, lookup);

      expect(vm.dependencyIndicators).toHaveLength(2);
      expect(vm.dependencyIndicators[0]).toEqual({
        recordId: "rec-dep1",
        id: "T-2",
        title: "Dep 1",
        status: "completed",
        isKnown: true,
        stateLabel: "Resolved",
        stateDescription: "Dependency completed",
        isBlocking: false,
      });
      expect(vm.dependencyIndicators[1]).toEqual({
        recordId: "rec-dep2",
        id: "T-3",
        title: "Dep 2",
        status: "in_progress",
        isKnown: true,
        stateLabel: "In progress",
        stateDescription: "Dependency is currently running",
        isBlocking: true,
      });
    });

    it("provides fallback for missing dependency records", () => {
      const task = createMockTask({ dependsOnTaskIds: ["missing-rec-1"] });
      const lookup = new Map<string, Task>(); // Empty lookup

      const vm = buildTaskCardViewModel(task, lookup);

      expect(vm.dependencyIndicators).toHaveLength(1);
      expect(vm.dependencyIndicators[0]).toEqual({
        recordId: "missing-rec-1",
        id: "missing-rec-1",
        title: "Unknown Task (missing-rec-1)",
        status: "pending",
        isKnown: false,
        stateLabel: "Unknown",
        stateDescription: "Dependency record is missing",
        isBlocking: true,
      });
    });

    it("handles missing start/end timestamps (invalid createdAt) without crashing", () => {
      const task = createMockTask({ createdAt: "invalid-date" });
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup);

      expect(vm.humanizedCreatedAt).toBe("--");
    });

    it("handles no dependsOnTaskIds field gracefully", () => {
      const task = createMockTask({ dependsOnTaskIds: undefined as any });
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup);

      expect(vm.dependencyIndicators).toEqual([]);
    });

    it("formats live execution metadata for readable task card announcements", () => {
      const task = createMockTask();
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup, {
        sessionId: "session-123",
        sessionState: "running",
        prUrl: "https://example.test/pull/1",
        liveStartedAt: "2023-10-01T11:58:00Z",
        liveTotalSeconds: 125,
      });

      expect(vm.sessionId).toBe("session-123");
      expect(vm.sessionState).toBe("running");
      expect(vm.prUrl).toBe("https://example.test/pull/1");
      expect(vm.liveStartedAt).toBe("2023-10-01T11:58:00Z");
      expect(vm.liveRunningTime).toBe("2m 5s");
    });

    it("keeps PR pending action and metadata when task pull requests are enabled without a PR URL", () => {
      const task = createMockTask();
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup, undefined, {
        taskPullRequestsEnabled: true,
      });

      expect(vm.hasPullRequestMetadata).toBe(true);
      expect(vm.prUrl).toBeUndefined();
      expect(vm.actions?.find((action) => action.kind === "pull_request")).toMatchObject({
        label: "PR pending",
        disabledReason: "No pull request is available for task T-1 yet.",
      });
    });

    it("omits PR pending action and metadata when task pull requests are disabled without a PR URL", () => {
      const task = createMockTask();
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup, undefined, {
        taskPullRequestsEnabled: false,
      });

      expect(vm.hasPullRequestMetadata).toBe(false);
      expect(vm.prUrl).toBeUndefined();
      expect(vm.actions?.some((action) => action.kind === "pull_request")).toBe(false);
    });

    it("keeps historical PR action and link when task pull requests are disabled with a PR URL", () => {
      const task = createMockTask();
      const lookup = new Map<string, Task>();

      const vm = buildTaskCardViewModel(task, lookup, {
        prUrl: "https://example.test/pull/42",
      }, {
        taskPullRequestsEnabled: false,
      });

      expect(vm.hasPullRequestMetadata).toBe(true);
      expect(vm.prUrl).toBe("https://example.test/pull/42");
      expect(vm.actions?.find((action) => action.kind === "pull_request")).toMatchObject({
        label: "PR",
        href: "https://example.test/pull/42",
        disabledReason: undefined,
      });
    });

    it("builds accessible labels for dependency, QA, drag, optimistic, and action states", () => {
      const qaFailed = createMockTask({
        recordId: "rec-qa",
        id: "T-QA",
        title: "Fix review",
        status: "QA_REVIEW_FAILED",
      });
      const codingComplete = createMockTask({
        recordId: "rec-code",
        id: "T-CODE",
        title: "Ready dependency",
        status: "coding_completed",
      });
      const task = createMockTask({
        dependsOnTaskIds: ["rec-qa", "rec-code"],
        isOptimistic: true,
        latestReview: {
          status: "completed",
          outcome: "fail",
          summary: "Needs fixes.",
          findings: [],
          reviewer: "QA Bot",
          finishedAt: "2023-10-01T11:30:00Z",
        },
      });

      const vm = buildTaskCardViewModel(task, new Map([
        ["rec-qa", qaFailed],
        ["rec-code", codingComplete],
      ]));

      expect(vm.dependencyActionLabel).toBe("2 dependency blockers");
      expect(vm.dependencyIndicators.map((dep) => dep.stateLabel)).toEqual(["QA failed", "Ready for QA"]);
      expect(vm.qaReviewLabel).toBe("QA failed, fail");
      expect(vm.optimisticSavingLabel).toBe("Saving task changes");
      expect(vm.dragStateLabel).toBe("Pointer drag disabled while task changes are saving; keyboard reordering is not supported");
      expect(vm.actions?.find((action) => action.kind === "preview")).toMatchObject({
        ariaLabel: "Open sprint preview for task T-1: Task 1",
        href: "/browser?sprintId=sprint-1",
      });
      expect(vm.actions?.find((action) => action.kind === "rerun")).toMatchObject({
        ariaLabel: "Rerun task T-1: Task 1",
        disabledReason: "Open Live to rerun task T-1.",
      });
      expect(vm.actions?.find((action) => action.kind === "pull_request")).toMatchObject({
        ariaLabel: "Open pull request for task T-1: Task 1",
        disabledReason: "No pull request is available for task T-1 yet.",
      });
      expect(vm.actions?.find((action) => action.kind === "live_runtime")).toMatchObject({
        ariaLabel: "Open live runtime for task T-1: Task 1",
        disabledReason: "Live runtime has not started for task T-1.",
      });
    });

    it("labels no-review, in-progress review, failed review, preview, PR, and live runtime states", () => {
      const taskWithoutSprint = createMockTask({
        sprintId: "",
        latestReview: undefined,
      });
      const noReviewVm = buildTaskCardViewModel(taskWithoutSprint, new Map());

      expect(noReviewVm.qaReviewLabel).toBe("QA no review");
      expect(noReviewVm.actions?.find((action) => action.kind === "preview")).toMatchObject({
        ariaLabel: "Open sprint preview for task T-1: Task 1",
        disabledReason: "Task T-1 has no sprint preview.",
      });

      const runningReviewVm = buildTaskCardViewModel(createMockTask({
        latestReview: {
          status: "running",
          outcome: null,
          summary: null,
          findings: [],
          reviewer: "QA Bot",
          finishedAt: null,
        },
      }), new Map());
      expect(runningReviewVm.qaReviewLabel).toBe("QA in progress");

      const failedReviewVm = buildTaskCardViewModel(createMockTask({
        latestReview: {
          status: "failed",
          outcome: "rejected",
          summary: "Needs work.",
          findings: [],
          reviewer: "QA Bot",
          finishedAt: "2023-10-01T11:30:00Z",
        },
      }), new Map());
      expect(failedReviewVm.qaReviewLabel).toBe("QA failed, rejected");

      const liveVm = buildTaskCardViewModel(createMockTask(), new Map(), {
        sessionId: "session-123",
        sessionState: "running",
        prUrl: "https://example.test/pull/1",
        liveStartedAt: "2023-10-01T11:58:00Z",
        liveTotalSeconds: 125,
      });
      expect(liveVm.actions?.find((action) => action.kind === "pull_request")).toMatchObject({
        ariaLabel: "Open pull request for task T-1: Task 1",
        href: "https://example.test/pull/1",
      });
      expect(liveVm.actions?.find((action) => action.kind === "live_runtime")).toMatchObject({
        ariaLabel: "Open live runtime for task T-1: Task 1",
        href: "/live",
      });
    });
  });
});

  describe("getTaskLane via view-model context", () => {
    it("maps coding_completed to in_progress lane", () => {
      expect(getTaskLane("coding_completed")).toBe("in_progress");
    });
    it("maps QA_REVIEW_FAILED to in_progress lane", () => {
      expect(getTaskLane("QA_REVIEW_FAILED")).toBe("in_progress");
    });
    it("maps pending, completed, in_progress to themselves", () => {
      expect(getTaskLane("pending")).toBe("pending");
      expect(getTaskLane("completed")).toBe("completed");
      expect(getTaskLane("in_progress")).toBe("in_progress");
    });
  });
