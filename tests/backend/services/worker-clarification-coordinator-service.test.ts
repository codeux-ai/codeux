import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkerClarificationRecord } from "../../../src/contracts/worker-clarification-types.js";
import { WorkerClarificationCoordinatorService } from "../../../src/services/worker-clarification-coordinator-service.js";

describe("WorkerClarificationCoordinatorService", () => {
  let clarification: WorkerClarificationRecord;
  let createdListener: ((record: WorkerClarificationRecord) => void) | null;
  let deps: any;

  beforeEach(() => {
    createdListener = null;
    clarification = {
      id: "clarification-1",
      projectId: "project-1",
      taskId: "task-1",
      sprintId: "sprint-1",
      sprintRunId: "sprint-run-1",
      dispatchId: "dispatch-1",
      taskRunId: "task-run-1",
      sessionId: "cli-codex-source",
      executionInvocationId: "xi_source",
      requesterAgentId: "worker-1",
      deduplicationKey: "question-1",
      status: "pending",
      questionMarkdown: "How should this task proceed?",
      answerMarkdown: null,
      requestedAt: "2026-07-18T10:00:00.000Z",
      repliedAt: null,
      expiredAt: null,
      cancelledAt: null,
      resolvedAt: null,
      updatedAt: "2026-07-18T10:00:00.000Z",
      repliedByAgentId: null,
      resolvedByAgentId: null,
      resolutionReason: null,
    };
    const task = {
      id: "task-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskKey: "T01",
      title: "Implement task",
      promptMarkdown: "Implement it",
      description: "",
      status: "pending",
      priority: "medium",
      executorType: "auto",
      agentPresetId: null,
      model: null,
      sortOrder: 0,
      dependsOnTaskIds: [],
      isIndependent: true,
      isMerged: false,
      mergeIndicator: null,
      sourceType: null,
      sourcePath: null,
      createdAt: clarification.requestedAt,
      updatedAt: clarification.updatedAt,
    };
    deps = {
      clarificationService: {
        onCreated: vi.fn((listener) => {
          createdListener = listener;
          return vi.fn();
        }),
        get: vi.fn(() => clarification),
        list: vi.fn(() => [clarification]),
        resolve: vi.fn(),
      },
      continuationService: {
        continueReply: vi.fn().mockResolvedValue({ deliveryMode: "cli_workspace" }),
      },
      workerInboxReplyService: {
        generateWorkerClarificationReply: vi.fn().mockResolvedValue({
          answerMarkdown: "Read the file first, then create or update it.",
          agentPresetId: "manager-1",
          executionInvocationId: "xi_manager",
        }),
      },
      executionRepository: {
        getTaskRun: vi.fn(() => ({ id: "task-run-1", state: "BLOCKED" })),
        getSprintRun: vi.fn(() => ({
          id: "sprint-run-1",
          projectId: "project-1",
          sprintId: "sprint-1",
          status: "running",
        })),
        appendTaskRunEvent: vi.fn(),
      },
      projectManagementRepository: {
        listProjects: vi.fn(() => ({ projects: [{ id: "project-1" }] })),
        getTask: vi.fn(() => task),
        getSprint: vi.fn(() => ({ id: "sprint-1", goal: "Ship the task" })),
        listTasks: vi.fn(() => [task]),
      },
      projectAttentionRepository: {
        getAttentionItem: vi.fn(() => ({ id: clarification.id, payload: {} })),
        patchAttentionItemPayload: vi.fn(),
      },
      guardrailService: {
        evaluate: vi.fn(() => ({ allowed: true, count: 0, cap: 3, action: "ESCALATE" })),
        recordOnce: vi.fn(),
      },
      logger: { error: vi.fn() },
      now: () => "2026-07-18T10:01:00.000Z",
    };
  });

  it("routes a blocked coding turn through the project manager and continues it", async () => {
    const service = new WorkerClarificationCoordinatorService(deps);
    service.start();
    createdListener?.(clarification);

    await vi.waitFor(() => {
      expect(deps.continuationService.continueReply).toHaveBeenCalledWith({
        projectId: "project-1",
        clarificationId: "clarification-1",
        answerMarkdown: "Read the file first, then create or update it.",
        repliedByAgentId: "manager-1",
      });
    });
    expect(deps.guardrailService.recordOnce).toHaveBeenCalledWith(
      { projectId: "project-1", sprintId: "sprint-1" },
      "task-1",
      "clarification_reply",
      "worker-clarification:clarification-1:project-manager",
      expect.any(String),
    );
    expect(deps.guardrailService.evaluate).toHaveBeenCalledWith(
      { projectId: "project-1", sprintId: "sprint-1" },
      "task-1",
      "task_coding",
    );
    expect(deps.projectAttentionRepository.patchAttentionItemPayload).toHaveBeenLastCalledWith(
      "clarification-1",
      expect.objectContaining({ automationStatus: "continued" }),
    );
  });

  it("keeps the human attention open when the clarification guardrail is reached", async () => {
    deps.guardrailService.evaluate.mockReturnValue({
      allowed: false,
      count: 3,
      cap: 3,
      action: "ESCALATE",
      reason: "Clarification reply limit reached.",
    });
    const service = new WorkerClarificationCoordinatorService(deps);
    service.schedule(clarification);

    await vi.waitFor(() => {
      expect(deps.projectAttentionRepository.patchAttentionItemPayload).toHaveBeenCalledWith(
        "clarification-1",
        expect.objectContaining({
          automationStatus: "human_required",
          automationFailureReason: "Clarification reply limit reached.",
        }),
      );
    });
    expect(deps.workerInboxReplyService.generateWorkerClarificationReply).not.toHaveBeenCalled();
    expect(deps.clarificationService.resolve).not.toHaveBeenCalled();
  });

  it("keeps the human attention open when manager generation fails", async () => {
    deps.workerInboxReplyService.generateWorkerClarificationReply.mockRejectedValue(
      new Error("Project-manager provider unavailable"),
    );
    const service = new WorkerClarificationCoordinatorService(deps);
    service.schedule(clarification);

    await vi.waitFor(() => {
      expect(deps.projectAttentionRepository.patchAttentionItemPayload).toHaveBeenCalledWith(
        "clarification-1",
        expect.objectContaining({
          automationStatus: "human_required",
          automationFailureReason: "Project-manager provider unavailable",
        }),
      );
    });
    expect(deps.continuationService.continueReply).not.toHaveBeenCalled();
    expect(deps.clarificationService.resolve).not.toHaveBeenCalled();
  });

  it("does not generate or deliver an automatic answer while the sprint run is paused", async () => {
    deps.executionRepository.getSprintRun.mockReturnValue({
      id: "sprint-run-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "paused",
    });
    const service = new WorkerClarificationCoordinatorService(deps);
    service.schedule(clarification);

    await vi.waitFor(() => {
      expect(deps.projectAttentionRepository.patchAttentionItemPayload).toHaveBeenCalledWith(
        "clarification-1",
        expect.objectContaining({
          automationStatus: "human_required",
          automationFailureReason: expect.stringMatching(/suspended.*paused/i),
        }),
      );
    });
    expect(deps.guardrailService.evaluate).not.toHaveBeenCalled();
    expect(deps.workerInboxReplyService.generateWorkerClarificationReply).not.toHaveBeenCalled();
    expect(deps.continuationService.continueReply).not.toHaveBeenCalled();
  });

  it("keeps the human attention open when the coding continuation guardrail is reached", async () => {
    deps.guardrailService.evaluate.mockImplementation(
      (_scope: unknown, _taskId: string, purpose: string) => purpose === "task_coding"
        ? {
            allowed: false,
            count: 5,
            cap: 5,
            action: "BLOCK_AND_ESCALATE",
            reason: "Coding attempt limit reached.",
          }
        : { allowed: true, count: 0, cap: 3, action: "ESCALATE" },
    );
    const service = new WorkerClarificationCoordinatorService(deps);
    service.schedule(clarification);

    await vi.waitFor(() => {
      expect(deps.projectAttentionRepository.patchAttentionItemPayload).toHaveBeenCalledWith(
        "clarification-1",
        expect.objectContaining({
          automationStatus: "human_required",
          automationFailureReason: "Coding attempt limit reached.",
          codingGuardrailAttempts: 5,
          codingGuardrailCap: 5,
        }),
      );
    });
    expect(deps.workerInboxReplyService.generateWorkerClarificationReply).not.toHaveBeenCalled();
    expect(deps.continuationService.continueReply).not.toHaveBeenCalled();
  });

  it("cancels a stale request when its source task completed before delivery", async () => {
    deps.executionRepository.getTaskRun.mockReturnValue({ id: "task-run-1", state: "COMPLETED" });
    const service = new WorkerClarificationCoordinatorService(deps);
    service.schedule(clarification);

    await vi.waitFor(() => {
      expect(deps.clarificationService.resolve).toHaveBeenCalledWith(
        "project-1",
        "clarification-1",
        expect.objectContaining({
          status: "cancelled",
          reason: "source_task_completed_before_clarification_delivery",
        }),
      );
    });
    expect(deps.workerInboxReplyService.generateWorkerClarificationReply).not.toHaveBeenCalled();
  });

  it("recovers pending clarification attention after restart", async () => {
    const service = new WorkerClarificationCoordinatorService(deps);
    service.start();

    await vi.waitFor(() => {
      expect(deps.clarificationService.list).toHaveBeenCalledWith(
        "project-1",
        { statuses: ["pending"], limit: 200 },
      );
      expect(deps.continuationService.continueReply).toHaveBeenCalled();
    });
  });
});
