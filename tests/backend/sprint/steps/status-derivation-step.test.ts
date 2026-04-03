import { describe, expect, it } from "vitest";
import type { Subtask } from "../../../../src/contracts/app-types.js";
import { runStatusDerivationStep } from "../../../../src/sprint/steps/status-derivation-step.js";

describe("runStatusDerivationStep", () => {
  const isActionRequiredState = (state?: string) => state === "ACTION_REQUIRED";

  it("unblocks dependent tasks when dependencies are completed and merged", () => {
    const subtasks: Subtask[] = [
      { id: "task-1", title: "Task 1", prompt: "", depends_on: [], is_independent: true, is_merged: true, status: "COMPLETED" },
      { id: "task-2", title: "Task 2", prompt: "", depends_on: ["task-1"], is_independent: false, is_merged: false, status: "BLOCKED" },
    ];
    const result = runStatusDerivationStep(subtasks, { retryFailed: true, isActionRequiredState });
    expect(result[1].status).toBe("PENDING");
  });

  it("retries failed tasks if retryFailed is true and deps met", () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "",
        depends_on: [],
        is_independent: true,
        is_merged: true,
        status: "FAILED",
        session_state: "FAILED",
        provider: "jules",
        session_id: "failed-session",
        session_name: "sessions/failed-session",
        worker_branch: "worker/task-1",
        pr_url: "https://example.com/pr/1",
        merge_indicator: "MERGED",
      },
    ];
    const result = runStatusDerivationStep(subtasks, { retryFailed: true, isActionRequiredState });
    expect(result[0].status).toBe("PENDING");
    expect(result[0].session_id).toBeUndefined();
    expect(result[0].session_name).toBeUndefined();
    expect(result[0].session_state).toBeUndefined();
    expect(result[0].worker_branch).toBeUndefined();
    expect(result[0].pr_url).toBeUndefined();
    expect(result[0].is_merged).toBe(false);
    expect(result[0].merge_indicator).toBeUndefined();
    expect(result[0].provider).toBe("jules");
  });

  it("blocks failed tasks if retryFailed is true but deps not met", () => {
    const subtasks: Subtask[] = [
      { id: "task-1", title: "Task 1", prompt: "", depends_on: ["missing"], is_independent: false, is_merged: false, status: "FAILED", session_state: "FAILED" },
    ];
    const result = runStatusDerivationStep(subtasks, { retryFailed: true, isActionRequiredState });
    expect(result[0].status).toBe("BLOCKED");
  });

  it("blocks tasks in action required state", () => {
    const subtasks: Subtask[] = [
      { id: "task-1", title: "Task 1", prompt: "", depends_on: [], is_independent: true, is_merged: false, status: "PENDING", session_state: "ACTION_REQUIRED" },
    ];
    const result = runStatusDerivationStep(subtasks, { retryFailed: true, isActionRequiredState });
    expect(result[0].status).toBe("BLOCKED");
  });

  it("ignores running or completed or failed tasks if not retrying", () => {
    const subtasks: Subtask[] = [
      { id: "task-1", title: "Task 1", prompt: "", depends_on: [], is_independent: true, is_merged: false, status: "RUNNING" },
      { id: "task-2", title: "Task 2", prompt: "", depends_on: [], is_independent: true, is_merged: false, status: "COMPLETED" },
      { id: "task-3", title: "Task 3", prompt: "", depends_on: [], is_independent: true, is_merged: false, status: "FAILED" },
    ];
    const result = runStatusDerivationStep(subtasks, { retryFailed: false, isActionRequiredState });
    expect(result[0].status).toBe("RUNNING");
    expect(result[1].status).toBe("COMPLETED");
    expect(result[2].status).toBe("FAILED");
  });

  it("blocks dependent tasks if dependencies not met", () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "",
        depends_on: [],
        is_independent: true,
        is_merged: false,
        status: "COMPLETED",
        worker_branch: "worker/task-1",
      },
      { id: "task-2", title: "Task 2", prompt: "", depends_on: ["task-1"], is_independent: false, is_merged: false, status: "PENDING" },
    ];
    const result = runStatusDerivationStep(subtasks, { retryFailed: true, isActionRequiredState });
    expect(result[1].status).toBe("BLOCKED");
  });

  it("unblocks dependent tasks when a completed dependency produced no merge output", () => {
    const subtasks: Subtask[] = [
      { id: "task-1", title: "Task 1", prompt: "", depends_on: [], is_independent: true, is_merged: false, status: "COMPLETED" },
      { id: "task-2", title: "Task 2", prompt: "", depends_on: ["task-1"], is_independent: false, is_merged: false, status: "BLOCKED" },
    ];

    const result = runStatusDerivationStep(subtasks, { retryFailed: true, isActionRequiredState });
    expect(result[1].status).toBe("PENDING");
  });

  it("blocks non-independent tasks with no dependencies", () => {
    const subtasks: Subtask[] = [
      { id: "task-1", title: "Task 1", prompt: "", depends_on: [], is_independent: false, is_merged: false, status: "PENDING" },
    ];
    const result = runStatusDerivationStep(subtasks, { retryFailed: true, isActionRequiredState });
    expect(result[0].status).toBe("BLOCKED");
  });
});
