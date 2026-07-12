import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerClarificationRecord } from "../../../src/contracts/worker-clarification-types.js";
import { WorkerClarificationContinuationService } from "../../../src/services/worker-clarification-continuation-service.js";

describe("WorkerClarificationContinuationService", () => {
  const sendJulesSessionMessage = vi.fn();
  const continueTaskFromClarification = vi.fn();
  const getTaskRun = vi.fn();
  const getLatestTaskWorkspaceResumeTarget = vi.fn();
  const getLatestProviderInvocationUsageBySession = vi.fn();
  const updateTaskRun = vi.fn();
  const updateTaskDispatch = vi.fn();
  const appendTaskRunEvent = vi.fn();
  const getTask = vi.fn();
  const updateTask = vi.fn();
  const isAuthorizedProjectManager = vi.fn();
  const prepareReply = vi.fn();
  const completeReply = vi.fn();
  const getSettledReplyResult = vi.fn();
  let clarification: WorkerClarificationRecord;
  let service: WorkerClarificationContinuationService;

  beforeEach(() => {
    vi.clearAllMocks();
    getSettledReplyResult.mockReturnValue(null);
    clarification = {
      id: "clarification-1",
      projectId: "project-1",
      taskId: "task-1",
      sprintId: "sprint-1",
      sprintRunId: "sprint-run-1",
      dispatchId: "dispatch-1",
      taskRunId: "task-run-1",
      sessionId: "session-1",
      requesterAgentId: "worker-1",
      deduplicationKey: "question-1",
      status: "pending",
      questionMarkdown: "Should legacy rows be preserved?",
      answerMarkdown: null,
      requestedAt: "2026-07-11T09:00:00.000Z",
      repliedAt: null,
      expiredAt: null,
      cancelledAt: null,
      resolvedAt: null,
      updatedAt: "2026-07-11T09:00:00.000Z",
      repliedByAgentId: null,
      resolvedByAgentId: null,
      resolutionReason: null,
    };
    const clarificationService = {
      get: vi.fn(() => clarification),
      getSettledReplyResult,
      prepareReply,
      completeReply,
    };
    prepareReply.mockImplementation((_projectId, _clarificationId, input) => ({
      kind: "worker_clarification_reply",
      clarificationId: clarification.id,
      projectId: clarification.projectId,
      taskId: clarification.taskId,
      sprintId: clarification.sprintId,
      sprintRunId: clarification.sprintRunId,
      dispatchId: clarification.dispatchId,
      taskRunId: clarification.taskRunId,
      sessionId: clarification.sessionId,
      requesterAgentId: clarification.requesterAgentId,
      repliedByAgentId: input.repliedByAgentId,
      answerMarkdown: input.answerMarkdown,
    }));
    completeReply.mockImplementation((continuation) => {
      clarification = {
        ...clarification,
        status: "replied",
        answerMarkdown: continuation.answerMarkdown,
        repliedByAgentId: continuation.repliedByAgentId,
      };
      return { clarification, continuation };
    });
    isAuthorizedProjectManager.mockReturnValue(true);
    getTaskRun.mockReturnValue({
      id: "task-run-1",
      projectId: "project-1",
      taskId: "task-1",
      provider: "jules",
      sessionId: "session-1",
      workerBranch: null,
    });
    getTask.mockReturnValue({
      id: "task-1",
      projectId: "project-1",
      agentPresetId: "worker-agent-1",
      model: "gpt-5.1-codex",
    });
    service = new WorkerClarificationContinuationService({
      clarificationService: clarificationService as any,
      taskRerunService: { continueTaskFromClarification } as any,
      executionRepository: {
        getTaskRun,
        getLatestTaskWorkspaceResumeTarget,
        getLatestProviderInvocationUsageBySession,
        updateTaskRun,
        updateTaskDispatch,
        appendTaskRunEvent,
      } as any,
      projectManagementRepository: { getTask, updateTask } as any,
      sendJulesSessionMessage,
      isAuthorizedProjectManager,
      resolveProviderConfigId: () => "provider-config-1",
      now: () => "2026-07-11T10:00:00.000Z",
    });
  });

  const reply = () => service.continueReply({
    projectId: "project-1",
    clarificationId: "clarification-1",
    answerMarkdown: "Yes, preserve them.",
    repliedByAgentId: "manager-1",
  });

  it("delivers a Jules answer before restoring runtime state and settling the clarification", async () => {
    const result = await reply();

    expect(sendJulesSessionMessage).toHaveBeenCalledWith("session-1", "Yes, preserve them.");
    expect(sendJulesSessionMessage.mock.invocationCallOrder[0]).toBeLessThan(completeReply.mock.invocationCallOrder[0]);
    expect(updateTaskRun).toHaveBeenCalledWith("task-run-1", expect.objectContaining({ state: "RUNNING" }));
    expect(updateTaskDispatch).toHaveBeenCalledWith("dispatch-1", expect.objectContaining({ status: "running" }));
    expect(updateTask).toHaveBeenCalledWith("task-1", { status: "in_progress" });
    expect(appendTaskRunEvent).toHaveBeenCalledWith(
      "task-run-1",
      "worker_clarification_continued",
      "manager-1",
      expect.objectContaining({ deliveryMode: "jules_message", clarificationId: "clarification-1" }),
      { sourceEventKey: "worker-clarification:clarification-1:continued" },
    );
    expect(result).toMatchObject({ deliveryMode: "jules_message", alreadySettled: false });
  });

  it("continues a local CLI provider in its preserved workspace and native session lineage", async () => {
    getTaskRun.mockReturnValue({
      id: "task-run-1",
      projectId: "project-1",
      taskId: "task-1",
      provider: "codex",
      sessionId: "session-1",
      workerBranch: "worker/task-1",
    });
    getLatestTaskWorkspaceResumeTarget.mockReturnValue({
      provider: "codex",
      sessionId: "workspace-session-1",
      workerBranch: "worker/task-1",
    });
    getLatestProviderInvocationUsageBySession.mockReturnValue({ model: "gpt-5.1-codex" });
    continueTaskFromClarification.mockResolvedValue({ session_id: "next-session" });

    const result = await reply();

    expect(continueTaskFromClarification).toHaveBeenCalledWith("task-1", {
      answerMarkdown: "Yes, preserve them.",
      provider: "codex",
      model: "gpt-5.1-codex",
      providerConfigId: "provider-config-1",
      resumeWorkspaceSessionId: "workspace-session-1",
      resumeWorkerBranch: "worker/task-1",
    });
    expect(completeReply).toHaveBeenCalledTimes(1);
    expect(result.deliveryMode).toBe("cli_workspace");
  });

  it("leaves the clarification pending when a task-backed provider session is missing", async () => {
    getTaskRun.mockReturnValue({
      id: "task-run-1",
      projectId: "project-1",
      taskId: "task-1",
      provider: "jules",
      sessionId: null,
    });
    clarification = { ...clarification, sessionId: null };

    await expect(reply()).rejects.toThrow(/no provider session/i);
    expect(sendJulesSessionMessage).not.toHaveBeenCalled();
    expect(completeReply).not.toHaveBeenCalled();
    expect(clarification.status).toBe("pending");
  });

  it("returns an already-settled reply without delivering or dispatching twice", async () => {
    clarification = {
      ...clarification,
      status: "replied",
      answerMarkdown: "Yes, preserve them.",
      repliedByAgentId: "manager-1",
    };
    const continuation = prepareReply("project-1", "clarification-1", {
      answerMarkdown: "Yes, preserve them.",
      repliedByAgentId: "manager-1",
    });
    getSettledReplyResult.mockReturnValue({ clarification, continuation });

    const result = await reply();

    expect(result).toMatchObject({ alreadySettled: true, deliveryMode: "jules_message" });
    expect(sendJulesSessionMessage).not.toHaveBeenCalled();
    expect(continueTaskFromClarification).not.toHaveBeenCalled();
    expect(completeReply).not.toHaveBeenCalled();
  });

  it("records taskless manager answers without creating a coding dispatch", async () => {
    clarification = {
      ...clarification,
      taskId: null,
      sprintId: null,
      sprintRunId: null,
      dispatchId: null,
      taskRunId: null,
      sessionId: null,
    };

    const result = await reply();

    expect(result.deliveryMode).toBe("recorded_answer");
    expect(sendJulesSessionMessage).not.toHaveBeenCalled();
    expect(continueTaskFromClarification).not.toHaveBeenCalled();
    expect(completeReply).toHaveBeenCalledTimes(1);
  });

  it("rejects an agent that is not the authorized manager for the clarification project", async () => {
    isAuthorizedProjectManager.mockReturnValue(false);

    await expect(reply()).rejects.toThrow(/not authorized to reply for project project-1/i);
    expect(prepareReply).not.toHaveBeenCalled();
    expect(sendJulesSessionMessage).not.toHaveBeenCalled();
    expect(completeReply).not.toHaveBeenCalled();
  });
});
