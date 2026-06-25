import { describe, expect, it, vi } from "vitest";
import type { Subtask } from "../../../../src/contracts/app-types.js";
import { runStartReadyTasksStep } from "../../../../src/sprint/steps/start-ready-tasks-step.js";
import { ProviderCapReachedError } from "../../../../src/services/sprint-task-dispatch-service.js";

describe("runStartReadyTasksStep limits", () => {
  it("skips tasks when provider concurrent limit is reached", async () => {
    const subtasks: Subtask[] = [
      { id: "1", title: "1", prompt: "1", depends_on: [], is_independent: true, status: "PENDING" },
      { id: "2", title: "2", prompt: "2", depends_on: [], is_independent: true, status: "PENDING" },
      { id: "3", title: "3", prompt: "3", depends_on: [], is_independent: true, status: "PENDING" },
    ];
    let fails = 0;

    let startedCount = 0;
    const startTask = vi.fn().mockImplementation(async (task) => {
      // getRunningCounts returns { codex: 1 }, so the first startTask makes it 2 (the limit).
      // Subsequent tasks will hit the cap.
      if (startedCount >= 1) {
        throw new ProviderCapReachedError("codex", 2, startedCount + 1);
      }
      startedCount++;
      return { id: "sess1", provider: "codex" };
    });

    const getProviderSettings = vi.fn().mockImplementation((provider) => {
      if (provider === "codex") return { maxConcurrentTasks: 2 };
      return {};
    });

    const getRunningCounts = vi.fn().mockReturnValue({ codex: 1 });
    const getProviderForTask = vi.fn().mockReturnValue("codex");

    const res = await runStartReadyTasksStep(subtasks, {
      action: "orchestrate",
      getConsecutiveFailures: () => fails,
      setConsecutiveFailures: (val) => fails = val,
      maxFailures: 3,
      startTask,
      resolveSessionName: (s: any) => s.name,
      extractSessionId: (s: any) => s.id,
      logger: { info: vi.fn(), error: vi.fn() } as any,
      getProviderForTask,
      getProviderSettings,
      getRunningCounts,
    });

    expect(startTask).toHaveBeenCalledTimes(3);
    expect(res.subtasks[0].status).toBe("RUNNING");
    expect(res.subtasks[1].status).toBe("PENDING");
    expect(res.subtasks[2].status).toBe("PENDING");
    expect(fails).toBe(0);
  });
});
