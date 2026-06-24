import { describe, expect, it, vi } from "vitest";
import { runStartReadyTasksStep } from "../../../../src/sprint/steps/start-ready-tasks-step.js";
import { Subtask } from "../../../../src/contracts/app-types.js";
import { ProviderCapReachedError } from "../../../../src/services/sprint-task-dispatch-service.js";

describe("start-ready-tasks-step", () => {
  it("does not start tasks if action is not orchestrate", async () => {
    const subtasks: Subtask[] = [{ id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "PENDING" }];
    const res = await runStartReadyTasksStep(subtasks, { action: "status" } as any);
    expect(res.reportText).toBe("");
    expect(res.subtasks[0].status).toBe("PENDING");
  });

  it("throws if max failures reached", async () => {
    await expect(runStartReadyTasksStep([], {
      action: "orchestrate",
      getConsecutiveFailures: () => 3,
      maxFailures: 3,
    } as any)).rejects.toThrow("CRITICAL: Emergency stop active.");
  });

  it("starts pending tasks successfully", async () => {
    const subtasks: Subtask[] = [{ id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "PENDING" }];
    let fails = 0;
    const startTask = vi.fn().mockResolvedValue({ id: "sess1", provider: "codex" });
    const setConsecutiveFailures = vi.fn(val => fails = val);

    const res = await runStartReadyTasksStep(subtasks, {
      action: "orchestrate",
      getConsecutiveFailures: () => fails,
      setConsecutiveFailures,
      maxFailures: 3,
      startTask,
      resolveSessionName: (s: any) => `sessions/${s.id}`,
      extractSessionId: (s: any) => s.id,
      logger: { error: vi.fn() } as any,
      getProviderForTask: () => null,
      getProviderSettings: () => ({}),
      getRunningCounts: () => ({}),
    });

    expect(startTask).toHaveBeenCalled();
    expect(res.subtasks[0].status).toBe("RUNNING");
    expect(res.subtasks[0].session_name).toBe("sessions/sess1");
    expect(res.reportText).toContain("Started CODEX Session");
    expect(setConsecutiveFailures).toHaveBeenCalledWith(0);
  });

  it("starts pending tasks successfully without provider", async () => {
    const subtasks: Subtask[] = [{ id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "PENDING" }];
    let fails = 0;
    const startTask = vi.fn().mockResolvedValue({ id: "sess1" });
    const setConsecutiveFailures = vi.fn(val => fails = val);

    const res = await runStartReadyTasksStep(subtasks, {
      action: "orchestrate",
      getConsecutiveFailures: () => fails,
      setConsecutiveFailures,
      maxFailures: 3,
      startTask,
      resolveSessionName: (s: any) => `sessions/${s.id}`,
      extractSessionId: (s: any) => s.id,
      logger: { error: vi.fn() } as any,
      getProviderForTask: () => null,
      getProviderSettings: () => ({}),
      getRunningCounts: () => ({}),
    });

    expect(res.reportText).toContain("Started JULES Session");
  });

  it("handles startTask error and triggers emergency stop", async () => {
    const subtasks: Subtask[] = [{ id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "PENDING" }];
    let fails = 2;
    const startTask = vi.fn().mockRejectedValue(new Error("fail"));
    const setConsecutiveFailures = vi.fn(val => fails = val);
    const errorSpy = vi.fn();

    await expect(runStartReadyTasksStep(subtasks, {
      action: "orchestrate",
      getConsecutiveFailures: () => fails,
      setConsecutiveFailures,
      maxFailures: 3,
      startTask,
      resolveSessionName: (s: any) => `sessions/${s.id}`,
      extractSessionId: (s: any) => s.id,
      logger: { error: errorSpy } as any,
      getProviderForTask: () => null,
      getProviderSettings: () => ({}),
      getRunningCounts: () => ({}),
    })).rejects.toThrow("CRITICAL: Emergency stop triggered after 3 consecutive task creation failures.");

    expect(errorSpy).toHaveBeenCalled();
    expect(fails).toBe(3);
  });

  it("handles startTask error with string", async () => {
    const subtasks: Subtask[] = [{ id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "PENDING" }];
    let fails = 0;
    const startTask = vi.fn().mockRejectedValue("string fail");
    const setConsecutiveFailures = vi.fn(val => fails = val);
    const errorSpy = vi.fn();

    await runStartReadyTasksStep(subtasks, {
      action: "orchestrate",
      getConsecutiveFailures: () => fails,
      setConsecutiveFailures,
      maxFailures: 3,
      startTask,
      resolveSessionName: (s: any) => `sessions/${s.id}`,
      extractSessionId: (s: any) => s.id,
      logger: { error: errorSpy } as any,
      getProviderForTask: () => null,
      getProviderSettings: () => ({}),
      getRunningCounts: () => ({}),
    });

    expect(errorSpy).toHaveBeenCalledWith("Error starting task", expect.objectContaining({ error: "string fail" }));
    expect(fails).toBe(1);
  });

  it("leaves task status PENDING and does not increment failures on ProviderCapReachedError", async () => {
    const subtasks: Subtask[] = [{ id: "1", title: "t", prompt: "p", depends_on: [], is_independent: false, status: "PENDING" }];
    let fails = 0;
    const startTask = vi.fn().mockRejectedValue(new ProviderCapReachedError("codex", 2, 2));
    const setConsecutiveFailures = vi.fn(val => fails = val);
    const errorSpy = vi.fn();

    const res = await runStartReadyTasksStep(subtasks, {
      action: "orchestrate",
      getConsecutiveFailures: () => fails,
      setConsecutiveFailures,
      maxFailures: 3,
      startTask,
      resolveSessionName: (s: any) => `sessions/${s.id}`,
      extractSessionId: (s: any) => s.id,
      logger: { info: vi.fn(), error: errorSpy } as any,
      getProviderForTask: () => "codex",
      getProviderSettings: () => ({ maxConcurrentTasks: 2 }),
      getRunningCounts: () => ({ codex: 2 }),
    });

    expect(startTask).toHaveBeenCalled();
    expect(res.subtasks[0].status).toBe("PENDING");
    expect(fails).toBe(0);
    expect(setConsecutiveFailures).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
