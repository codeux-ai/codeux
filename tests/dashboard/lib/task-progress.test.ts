import { describe, expect, it } from "vitest";
import { getTaskProgressPhase } from "../../../dashboard/src/lib/task-progress.js";

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
});
