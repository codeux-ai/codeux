import { describe, expect, it, vi } from "vitest";
import { applyActionRequiredAutomation, isJulesManagedTask, resolveTaskSessionId } from "../../../src/sprint/action-required-automation.js";
import type { Subtask } from "../../../src/contracts/app-types.js";

const createTask = (overrides: Partial<Subtask> = {}): Subtask => ({
  id: "T1",
  title: "Task 1",
  prompt: "Do work",
  depends_on: [],
  is_independent: true,
  status: "BLOCKED",
  session_state: "AWAITING_PLAN_APPROVAL",
  session_id: "sessions/abc123",
  ...overrides,
});

describe("action-required-automation", () => {
  it("detects jules-managed task and resolves session id", () => {
    const task = createTask();
    expect(isJulesManagedTask(task)).toBe(true);
    expect(resolveTaskSessionId(task)).toBe("abc123");
  });

  it("marks non-jules tasks for agent intervention", async () => {
    const task = createTask({ provider: "codex" });
    const result = await applyActionRequiredAutomation([task], {
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
      },
      isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBe("AGENT");
    expect(result.subtasks[0].status).toBe("BLOCKED");
  });

  it("auto-approves plan when allowed", async () => {
    const approve = vi.fn().mockResolvedValue({});
    const task = createTask({ session_state: "AWAITING_PLAN_APPROVAL" });
    const result = await applyActionRequiredAutomation([task], {
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
      },
      isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
      isJulesApiConfigured: () => true,
      approveSessionPlan: approve,
      sendSessionMessage: vi.fn(),
    });

    expect(approve).toHaveBeenCalledWith("abc123");
    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.reportText).toContain("Auto-Approved Plan");
  });
});
