import { describe, expect, it, vi } from "vitest";
import type { Subtask } from "../../../src/contracts/app-types.js";
import { runStartReadyTasksStep } from "../../../src/sprint/steps/start-ready-tasks-step.js";

describe("runStartReadyTasksStep", () => {
  it("starts pending tasks even when is_independent is false", async () => {
    const subtasks: Subtask[] = [
      {
        id: "task-2",
        title: "Task 2",
        prompt: "",
        depends_on: ["task-1"],
        is_independent: false,
        status: "PENDING",
      },
    ];

    const result = await runStartReadyTasksStep(subtasks, {
      action: "orchestrate",
      maxFailures: 5,
      getConsecutiveFailures: () => 0,
      setConsecutiveFailures: vi.fn(),
      startTask: vi.fn().mockResolvedValue({ id: "sessions/abc", name: "sessions/abc", provider: "jules" }),
      resolveSessionName: (session) => session.name,
      extractSessionId: (session) => session.id,
      logger: {
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis(),
      } as any,
      getProviderForTask: () => null,
      getProviderSettings: () => ({}),
      getRunningCounts: () => ({}),
    });

    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.subtasks[0].session_id).toBe("sessions/abc");
  });
});
