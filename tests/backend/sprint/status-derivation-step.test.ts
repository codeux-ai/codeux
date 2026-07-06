import { describe, expect, it } from "vitest";
import type { Subtask } from "../../../src/contracts/app-types.js";
import { runStatusDerivationStep } from "../../../src/sprint/steps/status-derivation-step.js";

describe("runStatusDerivationStep", () => {
  const isActionRequiredState = () => false;

  it("unblocks dependent tasks when dependencies are completed and merged", () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Task 1",
        prompt: "",
        depends_on: [],
        is_independent: true,
        is_merged: true,
        status: "COMPLETED",
      },
      {
        id: "task-2",
        title: "Task 2",
        prompt: "",
        depends_on: ["task-1"],
        is_independent: false,
        is_merged: false,
        status: "BLOCKED",
      },
    ];

    const result = runStatusDerivationStep(subtasks, {
      retryFailed: true,
      isActionRequiredState,
    });

    expect(result[1].status).toBe("PENDING");
  });

  it("resets explicit failed-session retries without restarting QA-parked tasks", () => {
    const subtasks: Subtask[] = [
      {
        id: "task-1",
        title: "Retry coding task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "FAILED",
        session_state: "FAILED",
        session_id: "failed-session",
        session_name: "sessions/failed-session",
        provider: "codex",
        worker_branch: "worker/task-1",
        pr_url: "https://example.com/pr/1",
        is_merged: true,
        merge_indicator: "MERGED",
      },
      {
        id: "task-2",
        title: "QA parked task",
        prompt: "",
        depends_on: [],
        is_independent: true,
        status: "QA_REVIEW_FAILED",
        session_state: "COMPLETED",
        session_id: "completed-session",
        session_name: "sessions/completed-session",
        provider: "codex",
      },
    ];

    const result = runStatusDerivationStep(subtasks, {
      retryFailed: true,
      isActionRequiredState,
    });

    expect(result[0]).toMatchObject({
      status: "PENDING",
      session_id: undefined,
      session_name: undefined,
      session_state: undefined,
      provider: "codex",
      worker_branch: undefined,
      pr_url: undefined,
      is_merged: false,
      merge_indicator: undefined,
    });
    expect(result[1]).toMatchObject({
      status: "QA_REVIEW_FAILED",
      session_id: "completed-session",
      session_state: "COMPLETED",
    });
  });
});
