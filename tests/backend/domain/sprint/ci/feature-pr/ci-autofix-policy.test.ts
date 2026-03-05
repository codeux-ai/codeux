import { describe, it, expect, vi } from "vitest";
import { handleCiAutofixEscalation } from "../../../../../../src/domain/sprint/ci/feature-pr/ci-autofix-policy.js";
import type { Subtask } from "../../../../../../src/contracts/app-types.js";

describe("handleCiAutofixEscalation", () => {
  it("should trigger escalation if max retries are reached", async () => {
    const task: Subtask = { id: "T1", status: "RUNNING" } as Subtask;
    const retryCounts = new Map([["T1:100", 3]]);
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      task,
      prNumber: 100,
      prUrl: "url",
      branchName: "branch",
      failedChecks: ["test"],
      failedRuns: [],
      failedJobLabels: [],
      automationLevel: "FULL",
      maxRetries: 3,
      ciAutofixRetryCounts: retryCounts,
      isJulesApiConfigured: () => true,
      sendSessionMessage,
    });

    expect(task.status).toBe("BLOCKED");
    expect(task.intervention_owner).toBe("AGENT");
    expect(result.reportTextAddition).toContain("CI autofix retries exhausted");
    expect(sendSessionMessage).not.toHaveBeenCalled();
  });

  it("should send notification and increment retry count if max retries not reached", async () => {
    const task: Subtask = { id: "T1", status: "RUNNING", session_id: "s1" } as Subtask;
    const retryCounts = new Map([["s1:100", 1]]);
    const sendSessionMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handleCiAutofixEscalation({
      task,
      prNumber: 100,
      prUrl: "url",
      branchName: "branch",
      failedChecks: ["test"],
      failedRuns: [],
      failedJobLabels: [],
      automationLevel: "FULL",
      maxRetries: 3,
      ciAutofixRetryCounts: retryCounts,
      isJulesApiConfigured: () => true,
      sendSessionMessage,
    });

    expect(task.status).toBe("RUNNING");
    expect(retryCounts.get("s1:100")).toBe(2);
    expect(sendSessionMessage).toHaveBeenCalled();
    expect(result.reportTextAddition).toContain("Jules session notified to fix CI");
  });

  it("should skip notification if Jules API is not configured", async () => {
    const task: Subtask = { id: "T1", status: "RUNNING", session_id: "s1" } as Subtask;
    const retryCounts = new Map();
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      task,
      prNumber: 100,
      prUrl: "url",
      branchName: "branch",
      failedChecks: ["test"],
      failedRuns: [],
      failedJobLabels: [],
      automationLevel: "FULL",
      maxRetries: 3,
      ciAutofixRetryCounts: retryCounts,
      isJulesApiConfigured: () => false,
      sendSessionMessage,
    });

    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(result.reportTextAddition).toContain("CI autofix notify skipped: Jules API key is not configured");
  });
});
