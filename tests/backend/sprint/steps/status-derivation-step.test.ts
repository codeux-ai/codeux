import { describe, expect, it } from "vitest";
import { runStatusDerivationStep } from "../../../../src/sprint/steps/status-derivation-step.js";
import type { Subtask } from "../../../../src/contracts/app-types.js";

describe("runStatusDerivationStep", () => {
  it("derives QUOTA state properly", () => {
    const subtasks: Partial<Subtask>[] = [
      { id: "1", session_state: "QUOTA", depends_on: [] },
      { id: "2", status: "QUOTA", depends_on: [] }
    ];
    const result = runStatusDerivationStep(subtasks as Subtask[], { retryFailed: false, isActionRequiredState: () => false });
    expect(result[0].status).toBe("QUOTA");
    expect(result[1].status).toBe("QUOTA");
  });

  it("handles retryFailed configuration correctly", () => {
    const subtasks: Partial<Subtask>[] = [
      { id: "1", session_state: "FAILED", depends_on: [] },
      { id: "2", session_state: "FAILED", depends_on: ["1"] }
    ];
    const resultRetry = runStatusDerivationStep(subtasks as Subtask[], { retryFailed: true, isActionRequiredState: () => false });
    expect(resultRetry[0].status).toBe("PENDING");
    expect(resultRetry[1].status).toBe("BLOCKED");

    const resultNoRetry = runStatusDerivationStep([{ id: "1", session_state: "FAILED", depends_on: [] }] as Subtask[], { retryFailed: false, isActionRequiredState: () => false });
    expect(resultNoRetry[0].status).toBe("BLOCKED"); // Defaults to final fallback
  });

  it("blocks tasks if action is required", () => {
    const subtasks: Partial<Subtask>[] = [
      { id: "1", session_state: "CLARIFICATION_REQUIRED", depends_on: [] }
    ];
    const result = runStatusDerivationStep(subtasks as Subtask[], { retryFailed: false, isActionRequiredState: (s) => s === "CLARIFICATION_REQUIRED" });
    expect(result[0].status).toBe("BLOCKED");
  });

  it("skips running, coding completed, completed, and failed states", () => {
    const statuses = ["RUNNING", "CODING_COMPLETED", "COMPLETED", "FAILED"];
    for (const status of statuses) {
      const subtasks: Partial<Subtask>[] = [
        { id: "1", status: status as Subtask["status"], depends_on: [] }
      ];
      const result = runStatusDerivationStep(subtasks as Subtask[], { retryFailed: false, isActionRequiredState: () => false });
      expect(result[0].status).toBe(status);
    }
  });

  it("blocks tasks without dependencies that are not marked independent", () => {
    const subtasks: Partial<Subtask>[] = [
      { id: "1", is_independent: false, depends_on: [] }
    ];
    const result = runStatusDerivationStep(subtasks as Subtask[], { retryFailed: false, isActionRequiredState: () => false });
    expect(result[0].status).toBe("BLOCKED");
  });

  it("correctly derives PENDING or BLOCKED based on dependent completion", () => {
    const subtasks: Partial<Subtask>[] = [
      { id: "1", status: "COMPLETED", is_merged: true, depends_on: [] },
      { id: "2", depends_on: ["1"] },
      { id: "3", depends_on: ["2"] },
      { id: "4", depends_on: ["999"] } // Missing dep
    ];
    const result = runStatusDerivationStep(subtasks as Subtask[], { retryFailed: false, isActionRequiredState: () => false });
    expect(result[1].status).toBe("PENDING");
    expect(result[2].status).toBe("BLOCKED");
    expect(result[3].status).toBe("BLOCKED");
  });
});
