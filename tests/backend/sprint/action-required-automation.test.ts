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
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
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
    const onTaskEvent = vi.fn();
    const task = createTask({ session_state: "AWAITING_PLAN_APPROVAL" });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
      isJulesApiConfigured: () => true,
      approveSessionPlan: approve,
      sendSessionMessage: vi.fn(),
      onTaskEvent,
    });

    expect(approve).toHaveBeenCalledWith("abc123");
    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.reportText).toContain("Auto-Approved Plan");
    expect(onTaskEvent).toHaveBeenCalledWith(expect.objectContaining({
      eventType: "action_required_auto_approved",
      sourceEventKey: "action-required:T1:auto-approved:abc123",
    }));
  });


  it("does not intervene if not an action required state", async () => {
    const task = createTask({ session_state: "RUNNING" });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => false,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBeUndefined();
  });

  it("marks for human intervention if JULES API is not configured", async () => {
    const task = createTask();
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => false,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBe("HUMAN");
    expect(result.subtasks[0].intervention_hint).toContain("Jules API key is not configured");
  });

  it("marks for human intervention if automationLevel is ALWAYS_ASK", async () => {
    const task = createTask();
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "ALWAYS_ASK",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBe("HUMAN");
    expect(result.subtasks[0].intervention_hint).toBe("Automation level is ALWAYS_ASK.");
  });

  it("marks for human intervention if SEMI_AUTO autoApprovePlan is false", async () => {
    const task = createTask({ session_state: "AWAITING_PLAN_APPROVAL" });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "SEMI_AUTO",
      settings: {
        autoApprovePlan: false,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBe("HUMAN");
    expect(result.subtasks[0].intervention_hint).toBe("SEMI_AUTO policy disabled auto-approval for session plans.");
  });

  it("marks for human intervention if SEMI_AUTO autoAnswerClarification is false", async () => {
    const task = createTask({ session_state: "AWAITING_USER_FEEDBACK" });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "SEMI_AUTO",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: false,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBe("HUMAN");
    expect(result.subtasks[0].intervention_hint).toBe("SEMI_AUTO policy disabled auto-answer for clarification requests.");
  });

  it("marks for human intervention if SEMI_AUTO autoResumePaused is false", async () => {
    const task = createTask({ session_state: "PAUSED" });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "SEMI_AUTO",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: false,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBe("HUMAN");
    expect(result.subtasks[0].intervention_hint).toBe("SEMI_AUTO policy disabled auto-resume for paused sessions.");
  });

  it("auto-answers clarification when allowed", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const task = createTask({
      session_state: "AWAITING_USER_FEEDBACK",
      activities: [
        {
          agentMessaged: { agentMessage: "What should I do?" },
        }
      ]
    });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "Here is your answer",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledWith("abc123", expect.stringContaining("Here is your answer"));
    expect(sendMessage.mock.calls[0][1]).toContain("What should I do?");
    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.reportText).toContain("Auto-Answered Clarification");
  });

  it("auto-answers clarification fallback to description", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const task = createTask({
      session_state: "AWAITING_USER_FEEDBACK",
      activities: [
        {
          description: "Agent needs help",
        }
      ]
    });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "Here is your answer",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledWith("abc123", expect.stringContaining("Agent needs help"));
    expect(result.subtasks[0].status).toBe("RUNNING");
  });

  it("auto-resumes paused sessions when allowed", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const task = createTask({ session_state: "PAUSED" });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
    });

    expect(sendMessage).toHaveBeenCalledWith("abc123", expect.stringContaining("Continue execution"));
    expect(result.subtasks[0].status).toBe("RUNNING");
    expect(result.reportText).toContain("Auto-Resumed Session");
  });

  it("handles errors during auto-intervention", async () => {
    const approve = vi.fn().mockRejectedValue(new Error("API Error"));
    const task = createTask({ session_state: "AWAITING_PLAN_APPROVAL" });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: approve,
      sendSessionMessage: vi.fn(),
    });

    expect(result.subtasks[0].intervention_owner).toBe("AGENT");
    expect(result.subtasks[0].intervention_hint).toContain("API Error");
    expect(result.reportText).toContain("Auto-Intervention Failed");
  });

  it("auto-answers clarification using worker when mode is WORKER", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const generateWorkerReply = vi.fn().mockResolvedValue("Worker generated answer");
    const task = createTask({
      session_state: "AWAITING_USER_FEEDBACK",
    });
    const result = await applyActionRequiredAutomation([task], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "WORKER",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
      generateWorkerClarificationReply: generateWorkerReply,
    });

    expect(generateWorkerReply).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p1",
      sprintGoal: "test goal",
      task,
    }));
    expect(sendMessage).toHaveBeenCalledWith("abc123", "Worker generated answer");
    expect(result.subtasks[0].status).toBe("RUNNING");
  });

  it("skips auto-reply when the latest clarification request was already answered", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const lastAutomatedInterventionKeys = new Map<string, string>();
    const task = createTask({
      session_state: "AWAITING_USER_FEEDBACK",
      activities: [{ agentMessaged: { agentMessage: "Should I use Prisma or raw SQL?" } }],
    });

    const commonArgs = {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL" as const,
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE" as const,
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
      lastAutomatedInterventionKeys,
    };

    const result1 = await applyActionRequiredAutomation([{ ...task }], commonArgs);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result1.subtasks[0].status).toBe("RUNNING");

    const result2 = await applyActionRequiredAutomation([{ ...task }], commonArgs);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result2.subtasks[0].status).toBe("RUNNING");
    expect(result2.subtasks[0].intervention_owner).toBe("AGENT");
    expect(result2.subtasks[0].intervention_hint).toContain("already answered automatically");
  });

  it("sends auto-reply again when the latest clarification request changes", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const lastAutomatedInterventionKeys = new Map<string, string>();
    const firstTask = createTask({
      session_state: "AWAITING_USER_FEEDBACK",
      activities: [{ agentMessaged: { agentMessage: "Should I use Prisma or raw SQL?" } }],
    });
    const secondTask = createTask({
      session_state: "AWAITING_USER_FEEDBACK",
      activities: [{ agentMessaged: { agentMessage: "Which schema file should I update?" } }],
    });

    await applyActionRequiredAutomation([firstTask], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
      lastAutomatedInterventionKeys,
    });

    const result = await applyActionRequiredAutomation([secondTask], {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL",
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE",
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
      lastAutomatedInterventionKeys,
    });

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(result.subtasks[0].status).toBe("RUNNING");
  });

  it("skips duplicate paused-session resume nudges for the same paused state", async () => {
    const sendMessage = vi.fn().mockResolvedValue({});
    const lastAutomatedInterventionKeys = new Map<string, string>();
    const task = createTask({ session_state: "PAUSED" });

    const commonArgs = {
      projectId: "p1",
      sprintGoal: "test goal",
      automationLevel: "FULL" as const,
      settings: {
        autoApprovePlan: true,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE" as const,
        autoResumePaused: true,
        clarificationAnswerTemplate: "template",
        clarificationCooldownSeconds: 300,
      },
      isActionRequiredState: () => true,
      isJulesApiConfigured: () => true,
      approveSessionPlan: vi.fn(),
      sendSessionMessage: sendMessage,
      lastAutomatedInterventionKeys,
    };

    await applyActionRequiredAutomation([{ ...task }], commonArgs);
    expect(sendMessage).toHaveBeenCalledTimes(1);

    const result2 = await applyActionRequiredAutomation([{ ...task }], commonArgs);
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(result2.subtasks[0].status).toBe("RUNNING");
    expect(result2.subtasks[0].intervention_hint).toContain("Resume instruction already sent");
  });
});
