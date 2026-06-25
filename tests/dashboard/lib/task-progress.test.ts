import { describe, expect, it } from "vitest";
import {
  getLiveTaskProgressPhase,
  getTaskProgressPhase,
} from "../../../dashboard/src/lib/task-progress.js";

describe("task progress phase", () => {
  it("keeps merge-backed tasks in coding completed until merge settles", () => {
    expect(
      getTaskProgressPhase({
        id: "1",
        title: "Task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        worker_branch: "worker/task-1",
        merge_indicator: "CI",
      }),
    ).toBe("CODING_COMPLETED");
  });

  it("keeps CI-gated running tasks at coding completed for live display", () => {
    expect(
      getTaskProgressPhase({
        id: "1b",
        title: "Task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
        worker_branch: "worker/task-1b",
        merge_indicator: "CI",
      }),
    ).toBe("CODING_COMPLETED");
  });

  it("keeps automerge-running tasks in coding completed instead of reverting to running", () => {
    expect(
      getTaskProgressPhase({
        id: "1c",
        title: "Task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
        worker_branch: "worker/task-1c",
        merge_indicator: "AUTOMERGE",
      }),
    ).toBe("CODING_COMPLETED");
  });

  it("promotes no-output tasks straight to completed", () => {
    expect(
      getTaskProgressPhase({
        id: "2",
        title: "Task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
      }),
    ).toBe("COMPLETED");
  });

  it("promotes merged tasks to completed", () => {
    expect(
      getTaskProgressPhase({
        id: "3",
        title: "Task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        worker_branch: "worker/task-3",
        merge_indicator: "MERGED",
        is_merged: true,
      }),
    ).toBe("COMPLETED");
  });

  it("treats automerged tasks as completed even if is_merged has not caught up yet", () => {
    expect(
      getTaskProgressPhase({
        id: "3a",
        title: "Task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        worker_branch: "worker/task-3a",
        merge_indicator: "AUTOMERGE",
        is_merged: false,
      }),
    ).toBe("COMPLETED");
  });

  it("keeps shared task phase unchanged while live phase honors terminal dispatch completion", () => {
    const task = {
      id: "4",
      title: "Terminal dispatch",
      prompt: "",
      depends_on: [],
      is_independent: true,
      status: "RUNNING" as const,
    };

    expect(getTaskProgressPhase(task)).toBe("RUNNING");
    expect(getLiveTaskProgressPhase({
      task,
      dispatch: {
        status: "completed",
        taskRunState: "COMPLETED",
        finishedAt: "2026-03-19T10:05:00.000Z",
        workerBranch: null,
        prUrl: null,
      },
    })).toBe("COMPLETED");
  });

  it("keeps merge-backed live completion at coding completed until merge settles", () => {
    const task = {
      id: "5",
      title: "Merge-backed completion",
      prompt: "",
      depends_on: [],
      is_independent: true,
      status: "RUNNING" as const,
    };

    expect(getLiveTaskProgressPhase({
      task,
      dispatch: {
        status: "completed",
        taskRunState: "COMPLETED",
        finishedAt: "2026-03-19T10:05:00.000Z",
        workerBranch: "worker/task-5",
        prUrl: "https://example.com/pr/5",
      },
    })).toBe("CODING_COMPLETED");
  });

  it("promotes live merge-backed completion once runtime merge settlement is observed", () => {
    expect(getLiveTaskProgressPhase({
      task: {
        id: "6",
        title: "Merge settled",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
      },
      dispatch: {
        status: "completed",
        taskRunState: "COMPLETED",
        finishedAt: "2026-03-19T10:05:00.000Z",
        workerBranch: "worker/task-6",
        prUrl: "https://example.com/pr/6",
      },
      runtimeTerminalPhase: "COMPLETED",
      runtimeMergeSettled: true,
    })).toBe("COMPLETED");
  });

  it("keeps live CI-fix dispatches at coding completed when the task store remains in running", () => {
    expect(getLiveTaskProgressPhase({
      task: {
        id: "7",
        title: "CI autofix",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
        worker_branch: "worker/task-7",
        merge_indicator: "CI",
      },
      dispatch: {
        status: "running",
        taskRunState: "RUNNING",
        finishedAt: null,
        workerBranch: "worker/task-7",
        prUrl: "https://example.com/pr/7",
      },
    })).toBe("CODING_COMPLETED");
  });

  it("resolves active provider cap wait in getLiveTaskProgressPhase", () => {
    const task = {
      id: "8",
      title: "Capped task",
      prompt: "",
      depends_on: [],
      is_independent: true,
      status: "PENDING" as const,
    };
    const events = [
      {
        id: "evt-1",
        scopeType: "task_run" as const,
        projectId: "p1",
        sprintId: "s1",
        taskId: "8",
        taskKey: "8",
        taskTitle: "Capped task",
        eventType: "provider_concurrency_wait",
        createdAt: "2026-03-27T10:05:00.000Z",
        payload: {
          provider: "codex",
          currentCount: 2,
          limit: 2,
        },
      } as any,
    ];

    expect(getLiveTaskProgressPhase({
      task,
      dispatch: { status: "queued", taskRunState: "PENDING", finishedAt: null, workerBranch: null, prUrl: null },
      events,
    })).toBe("PENDING_cap_2_2");
  });

  it("reverts PENDING_cap prefix back to PENDING in getTaskProgressPhase for lane filtering compatibility", () => {
    expect(
      getTaskProgressPhase({
        id: "9",
        title: "Capped task status",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "PENDING_cap_2_2" as any,
      }),
    ).toBe("PENDING");
  });
});
