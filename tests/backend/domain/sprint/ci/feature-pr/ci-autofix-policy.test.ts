import { describe, it, expect, vi } from "vitest";
import { handleCiAutofixEscalation, buildWorkerCiFixPayload } from "../../../../../../src/domain/sprint/ci/feature-pr/ci-autofix-policy.js";
import type { Subtask } from "../../../../../../src/contracts/app-types.js";
import type { GuardrailEvaluation, GuardrailService } from "../../../../../../src/services/guardrail-service.js";

const makeGuardrail = (evaluation: GuardrailEvaluation) => {
  const record = vi.fn().mockReturnValue(evaluation.count + 1);
  const service = {
    evaluate: vi.fn().mockReturnValue(evaluation),
    evaluateQa: vi.fn(),
    record,
    getCounts: vi.fn(),
    reset: vi.fn(),
  } as unknown as GuardrailService;
  return { service, record };
};

const allow = (count: number, cap: number): GuardrailEvaluation => ({
  allowed: true,
  count,
  cap,
  action: "BLOCK_AND_ESCALATE",
});

const block = (count: number, cap: number): GuardrailEvaluation => ({
  allowed: false,
  count,
  cap,
  action: "BLOCK_AND_ESCALATE",
  reason: `Reached max ci_fix invocations for this task (${count}/${cap}).`,
});

const baseArgs = {
  prNumber: 100,
  prUrl: "url",
  branchName: "branch",
  failedChecks: ["test"],
  failedRuns: [],
  failedJobLabels: [],
  automationLevel: "FULL" as const,
  isJulesApiConfigured: () => true,
  sendSessionMessage: vi.fn(),
  repoPath: "/repo",
  featureBranch: "feature/sprint1",
  defaultBranch: "main",
};

const makeTask = (overrides: Partial<Subtask> = {}): Subtask => ({
  id: "T1",
  title: "Task 1",
  prompt: "Do stuff",
  status: "RUNNING",
  record_id: "rec-T1",
  project_id: "proj-1",
  sprint_id: "sprint-1",
  ...overrides,
} as Subtask);

describe("handleCiAutofixEscalation", () => {
  it("blocks and escalates when the guardrail cap is reached", async () => {
    const task = makeTask();
    const { service, record } = makeGuardrail(block(3, 3));
    const sendSessionMessage = vi.fn();
    const onGuardrailExhausted = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      guardrailService: service,
      sendSessionMessage,
      onGuardrailExhausted,
    });

    expect(task.status).toBe("BLOCKED");
    expect(task.intervention_owner).toBe("HUMAN");
    expect(result.reportTextAddition).toContain("CI autofix guardrail reached");
    expect(result.workerCiFixRequired).toBe(false);
    expect(onGuardrailExhausted).toHaveBeenCalledWith(expect.objectContaining({
      task,
      attempts: 3,
      cap: 3,
      payload: expect.objectContaining({
        taskKey: "T1",
        prNumber: 100,
        failedChecks: ["test"],
      }),
    }));
    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(record).not.toHaveBeenCalled();
  });

  it("notifies Jules and records the ci_fix invocation when under the cap", async () => {
    const task = makeTask({ session_id: "s1" });
    const { service, record } = makeGuardrail(allow(1, 3));
    const sendSessionMessage = vi.fn().mockResolvedValue(undefined);

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      guardrailService: service,
      sendSessionMessage,
    });

    expect(task.status).toBe("RUNNING");
    expect(record).toHaveBeenCalledWith({ projectId: "proj-1", sprintId: "sprint-1" }, "rec-T1", "ci_fix");
    expect(sendSessionMessage).toHaveBeenCalled();
    expect(result.reportTextAddition).toContain("Jules session notified to fix CI");
    expect(result.workerCiFixRequired).toBe(false);
  });

  it("dispatches to a worker (without recording) when Jules API is not configured", async () => {
    const task = makeTask({ session_id: "s1" });
    const { service, record } = makeGuardrail(allow(0, 3));
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      guardrailService: service,
      isJulesApiConfigured: () => false,
      sendSessionMessage,
    });

    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(result.workerCiFixRequired).toBe(true);
    expect(result.workerCiFixPayload).toBeTruthy();
    expect(result.workerCiFixPayload!.prNumber).toBe(100);
    expect(result.workerCiFixPayload!.taskKey).toBe("T1");
    expect(result.reportTextAddition).toContain("Worker CI fix dispatched");
    // The virtual worker records the ci_fix when it resolves the dispatched attention item.
    expect(record).not.toHaveBeenCalled();
  });

  it("dispatches to a worker without notifying Jules when the Jules notification path is disabled", async () => {
    const task = makeTask({ session_id: "s1" });
    const { service, record } = makeGuardrail(allow(0, 3));
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      guardrailService: service,
      sendSessionMessage,
      allowJulesSessionNotification: false,
    });

    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(result.workerCiFixRequired).toBe(true);
    expect(result.workerCiFixPayload).toBeTruthy();
    expect(result.reportTextAddition).toContain("Worker CI fix dispatched");
    expect(record).not.toHaveBeenCalled();
  });

  it("dispatches to a worker for non-Jules-managed tasks without recording", async () => {
    const task = makeTask({ provider: "gemini" });
    const { service, record } = makeGuardrail(allow(0, 3));
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      guardrailService: service,
      sendSessionMessage,
    });

    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(result.workerCiFixRequired).toBe(true);
    expect(result.workerCiFixPayload).toBeTruthy();
    expect(result.reportTextAddition).toContain("Worker CI fix dispatched");
    expect(record).not.toHaveBeenCalled();
  });

  it("waits for an active worker CI fix attempt without recording", async () => {
    const task = makeTask();
    const { service, record } = makeGuardrail(allow(1, 3));
    const sendSessionMessage = vi.fn();

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      guardrailService: service,
      sendSessionMessage,
      hasActiveWorkerCiFixAttempt: () => true,
    });

    expect(task.status).toBe("RUNNING");
    expect(record).not.toHaveBeenCalled();
    expect(sendSessionMessage).not.toHaveBeenCalled();
    expect(result.workerCiFixRequired).toBe(false);
    expect(result.reportTextAddition).toContain("Worker CI fix already running");
  });

  it("does not block while the active worker CI fix attempt is still running at the cap", async () => {
    const task = makeTask();
    const { service } = makeGuardrail(block(3, 3));

    const result = await handleCiAutofixEscalation({
      ...baseArgs,
      task,
      guardrailService: service,
      hasActiveWorkerCiFixAttempt: () => true,
    });

    expect(task.status).toBe("RUNNING");
    expect(task.intervention_owner).toBeUndefined();
    expect(result.workerCiFixRequired).toBe(false);
    expect(result.reportTextAddition).toContain("Worker CI fix already running");
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
