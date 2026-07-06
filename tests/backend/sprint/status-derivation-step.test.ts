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
});
