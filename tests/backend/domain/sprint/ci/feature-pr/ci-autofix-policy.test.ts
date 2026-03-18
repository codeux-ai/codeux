import { describe, it, expect, vi } from "vitest";
import { handleCiAutofixEscalation, buildWorkerCiFixPayload } from "../../../../../../src/domain/sprint/ci/feature-pr/ci-autofix-policy.js";
import type { Subtask } from "../../../../../../src/contracts/app-types.js";

const baseArgs = {
  prNumber: 100,
  prUrl: "url",
  branchName: "branch",
  failedChecks: ["test"],
  failedRuns: [],
  failedJobLabels: [],
  automationLevel: "FULL" as const,
  maxRetries: 3,
  isJulesApiConfigured: () => true,
  sendSessionMessage: vi.fn(),
  repoPath: "/repo",
  featureBranch: "feature/sprint1",
  defaultBranch: "main",
};

describe("handleCiAutofixEscalation", () => {
  it("should trigger escalation if max retries are reached", async () => {
    const task: Subtask = { id: "T1", status: "RUNNING" } as Subtask;
    const retryCounts = new Map([["T1:100", 3]]);
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      ciAutofixRetryCounts: retryCounts,
      sendSessionMessage,
    });

    expect(task.status).toBe("BLOCKED");
    expect(task.intervention_owner).toBe("AGENT");
    expect(result.reportTextAddition).toContain("CI autofix retries exhausted");
    expect(result.workerCiFixRequired).toBe(false);
    expect(sendSessionMessage).not.toHaveBeenCalled();
  });

  it("should send notification and increment retry count if max retries not reached", async () => {
    const task: Subtask = { id: "T1", status: "RUNNING", session_id: "s1" } as Subtask;
    const retryCounts = new Map([["s1:100", 1]]);
    const sendSessionMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      ciAutofixRetryCounts: retryCounts,
      sendSessionMessage,
    });

    expect(task.status).toBe("RUNNING");
    expect(retryCounts.get("s1:100")).toBe(2);
    expect(sendSessionMessage).toHaveBeenCalled();
    expect(result.reportTextAddition).toContain("Jules session notified to fix CI");
    expect(result.workerCiFixRequired).toBe(false);
  });

  it("should dispatch to worker when Jules API is not configured", async () => {
    const task: Subtask = { id: "T1", title: "Task 1", prompt: "Do stuff", status: "RUNNING", session_id: "s1" } as Subtask;
    const retryCounts = new Map();
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      ciAutofixRetryCounts: retryCounts,
      isJulesApiConfigured: () => false,
      sendSessionMessage,
    });

    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(result.workerCiFixRequired).toBe(true);
    expect(result.workerCiFixPayload).toBeTruthy();
    expect(result.workerCiFixPayload!.prNumber).toBe(100);
    expect(result.workerCiFixPayload!.taskKey).toBe("T1");
    expect(result.reportTextAddition).toContain("Worker CI fix dispatched");
  });

  it("should dispatch to worker for non-Jules-managed tasks", async () => {
    const task: Subtask = { id: "T1", title: "Task 1", prompt: "Do stuff", status: "RUNNING", provider: "gemini" } as Subtask;
    const retryCounts = new Map();
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      ciAutofixRetryCounts: retryCounts,
      sendSessionMessage,
    });

    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(result.workerCiFixRequired).toBe(true);
    expect(result.workerCiFixPayload).toBeTruthy();
    expect(result.reportTextAddition).toContain("Worker CI fix dispatched");
  });
});

describe("buildWorkerCiFixPayload", () => {
  it("should include all CI failure context", () => {
    const task = {
      id: "T1",
      title: "Fix tests",
      prompt: "Fix the broken tests",
      worker_branch: "feat/T1",
    } as Subtask;

    const payload = buildWorkerCiFixPayload({
      task,
      prNumber: 42,
      prUrl: "https://github.com/repo/pull/42",
      branchName: "feat/T1",
      failedChecks: ["lint", "test"],
      failedRuns: [],
      repoPath: "/repo",
      featureBranch: "feature/sprint1",
      defaultBranch: "main",
    });

    expect(payload.taskKey).toBe("T1");
    expect(payload.taskTitle).toBe("Fix tests");
    expect(payload.taskPrompt).toBe("Fix the broken tests");
    expect(payload.prNumber).toBe(42);
    expect(payload.prUrl).toBe("https://github.com/repo/pull/42");
    expect(payload.branchName).toBe("feat/T1");
    expect(payload.failedChecks).toEqual(["lint", "test"]);
    expect(payload.workerBranch).toBe("feat/T1");
    expect(payload.repoPath).toBe("/repo");
    expect(payload.featureBranch).toBe("feature/sprint1");
    expect(payload.defaultBranch).toBe("main");
  });
});
