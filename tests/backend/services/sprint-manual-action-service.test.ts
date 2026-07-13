import { describe, expect, it, vi } from "vitest";
import { SprintManualActionService } from "../../../src/services/sprint-manual-action-service.js";

const sprint = {
  id: "sprint-1",
  projectId: "project-1",
  status: "running",
};

function createService(options: { activeRun?: boolean } = {}) {
  const projectManagementRepository = {
    getSprint: vi.fn(() => sprint),
    updateSprint: vi.fn((_sprintId, input) => ({ ...sprint, ...input })),
  };
  const executionRepository = {
    findActiveSprintRun: vi.fn(() => options.activeRun ? { id: "run-1" } : null),
  };
  const executionControlService = {
    forceCancelSprintRun: vi.fn().mockResolvedValue({ id: "run-1", status: "cancelled" }),
  };
  const qaReviewRepository = {
    recordManualSprintPass: vi.fn(() => ({ id: "qa-run-1" })),
  };
  const qaHandoff = {
    id: "attention-1",
    projectId: sprint.projectId,
    sprintId: sprint.id,
    taskId: null,
    attentionType: "human_escalation_required",
    payload: { sourceAttentionType: "qa_review", qaScope: "sprint" },
  };
  const projectAttentionRepository = {
    listProjectAttentionItems: vi.fn(() => [qaHandoff]),
    resolveAttentionItem: vi.fn(),
  };
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn(),
  };
  const service = new SprintManualActionService({
    projectManagementRepository,
    executionRepository,
    executionControlService,
    qaReviewRepository,
    projectAttentionRepository,
    logger,
  } as any);
  return {
    service,
    projectManagementRepository,
    executionControlService,
    qaReviewRepository,
    projectAttentionRepository,
  };
}

describe("SprintManualActionService", () => {
  it("stops an active runtime before persisting manual completion", async () => {
    const harness = createService({ activeRun: true });

    const result = await harness.service.markCompleted(sprint.id);

    expect(harness.executionControlService.forceCancelSprintRun).toHaveBeenCalledWith("run-1");
    expect(harness.projectManagementRepository.updateSprint).toHaveBeenCalledWith(sprint.id, { status: "completed" });
    expect(result.status).toBe("completed");
  });

  it("does not mark the sprint completed when active runtime cleanup fails", async () => {
    const harness = createService({ activeRun: true });
    harness.executionControlService.forceCancelSprintRun.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(harness.service.markCompleted(sprint.id)).rejects.toThrow("cleanup failed");

    expect(harness.projectManagementRepository.updateSprint).not.toHaveBeenCalled();
  });

  it("records a manual QA verdict and resolves only the sprint QA handoff", () => {
    const harness = createService({ activeRun: true });

    harness.service.markQaPassed(sprint.id);

    expect(harness.qaReviewRepository.recordManualSprintPass).toHaveBeenCalledWith({
      projectId: sprint.projectId,
      sprintId: sprint.id,
      sprintRunId: "run-1",
    });
    expect(harness.projectAttentionRepository.resolveAttentionItem).toHaveBeenCalledWith(
      "attention-1",
      expect.objectContaining({ reason: "manual_qa_pass" }),
    );
  });
});
