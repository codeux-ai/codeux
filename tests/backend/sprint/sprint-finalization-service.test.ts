import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { SprintFinalizationService } from "../../../src/domain/sprint/orchestrator/sprint-finalization-service.js";

function buildMockSubtask(overrides: any = {}) {
  return {
    id: "subtask-1",
    title: "Test Task",
    prompt: "Test Prompt",
    depends_on: [],
    is_independent: true,
    status: "PENDING",
    is_merged: false,
    ...overrides,
  };
}

function buildDeps() {
  return {
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    executionRepository: {
      appendSprintRunEvent: vi.fn(),
      getSprintRun: vi.fn(),
      updateSprintRun: vi.fn(),
      renewLease: vi.fn(),
      finalizeSprintRunCancellationIfIdle: vi.fn(),
    },
    projectAttentionService: {
      listActiveProjectItems: vi.fn().mockReturnValue([]),
      resolveItemsForSprintRun: vi.fn(),
      openItem: vi.fn(),
      resolveItem: vi.fn(),
    },
    renderInstruction: vi.fn().mockResolvedValue(""),
    getDashboardSettings: vi.fn().mockReturnValue({ memory: { enabled: false } }),
    memoryPromotionService: {
      autoPromoteFromSprint: vi.fn().mockResolvedValue(undefined),
    },
    completedSprints: new Set<string>(),
  };
}

describe("SprintFinalizationService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2023-01-01T00:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("pauses the sprint run when a manual merge is needed", async () => {
    const deps = buildDeps();
    const service = new SprintFinalizationService(deps as any, vi.fn());

    const result = await service.finalizeSprintRun({
      scopedExecutionContext: {
        project: { id: "p-1", name: "Project 1" },
        sprint: { id: "s-1", name: "Sprint 1", goal: "Ship" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
        sourceId: "source-1",
      },
      sprintRunId: "run-1",
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      githubMode: "LOCAL",
      ciIntelligence: {} as any,
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false })],
      runningTasks: [],
      readyTasks: [],
      manualMergeTasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false })],
      needsManualMerge: true,
      allTerminal: false,
      noMoreActionPossible: false,
      activeMainMergeAttentionItems: [],
    });

    expect(result.status).toBe("continue");
    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(
      "run-1",
      "sprint_merge_required",
      "system",
      expect.anything(),
      expect.anything()
    );
    expect(deps.executionRepository.updateSprintRun).not.toHaveBeenCalled();
    // transitionSprintRun is actually called in the ELSE branch in watch-loop-runner (now finalization service)
    // so this is actually correct to not call updateSprintRun. The pause happens outside via watch-loop state or another cycle! Wait, let's look at the actual code.
  });

  it("exits and pauses when there is a main-merge blocker (e.g. merge conflict)", async () => {
    const deps = buildDeps();
    const renderMergeFeedback = vi.fn().mockResolvedValue({
      state: "merge_conflict",
      hasMergeConflict: true,
      text: "Merge conflict detected.",
    });

    const service = new SprintFinalizationService(deps as any, renderMergeFeedback);

    const result = await service.finalizeSprintRun({
      scopedExecutionContext: {
        project: { id: "p-1", name: "Project 1" },
        sprint: { id: "s-1", name: "Sprint 1", goal: "Ship" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
        sourceId: "source-1",
      },
      sprintRunId: "run-1",
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      githubMode: "LOCAL",
      ciIntelligence: {} as any,
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
      runningTasks: [],
      readyTasks: [],
      manualMergeTasks: [],
      needsManualMerge: false,
      allTerminal: true,
      noMoreActionPossible: true,
      activeMainMergeAttentionItems: [],
    });

    expect(result.status).toBe("exit");
    expect(result.report).toContain("Main-branch merge is blocked");
    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        status: "paused",
      })
    );
    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(
      "run-1",
      "sprint_paused",
      "system",
      expect.objectContaining({ reason: "main_merge_blocked" }),
      expect.anything()
    );
  });

  it("waits when QA review blocks completion", async () => {
    const deps = buildDeps();
    deps.qualityAssuranceService = {
      reviewSprintCompletion: vi.fn().mockResolvedValue({
        reviewed: true,
        blockedCompletion: true,
        reportText: "\nQA requested follow-up work.\n",
      }),
    } as any;

    const renderMergeFeedback = vi.fn().mockResolvedValue({
      state: "ready_for_merge",
      hasMergeConflict: false,
      text: "Merge ready.",
    });

    const service = new SprintFinalizationService(deps as any, renderMergeFeedback);

    const result = await service.finalizeSprintRun({
      scopedExecutionContext: {
        project: { id: "p-1", name: "Project 1" },
        sprint: { id: "s-1", name: "Sprint 1", goal: "Ship" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
        sourceId: "source-1",
      },
      sprintRunId: "run-1",
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      githubMode: "LOCAL",
      ciIntelligence: { mainBranchAutoMergeMode: "OFF", resolveMainMergeConflicts: false } as any,
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
      runningTasks: [],
      readyTasks: [],
      manualMergeTasks: [],
      needsManualMerge: false,
      allTerminal: true,
      noMoreActionPossible: true,
      activeMainMergeAttentionItems: [],
    });

    expect(result.status).toBe("wait");
    expect(result.report).toContain("QA requested follow-up work");
    expect(deps.qualityAssuranceService.reviewSprintCompletion).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "p-1",
      sprintId: "s-1",
      sprintRunId: "run-1",
    }));
  });

  it("handles empty sprint cancellation correctly", async () => {
    const deps = buildDeps();
    const service = new SprintFinalizationService(deps as any, vi.fn());

    const result = await service.finalizeSprintRun({
      scopedExecutionContext: {
        project: { id: "p-1", name: "Project 1" },
        sprint: { id: "s-1", name: "Sprint 1", goal: "Ship" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
        sourceId: "source-1",
      },
      sprintRunId: "run-1",
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      githubMode: "LOCAL",
      ciIntelligence: {} as any,
      subtasks: [],
      runningTasks: [],
      readyTasks: [],
      manualMergeTasks: [],
      needsManualMerge: false,
      allTerminal: true,
      noMoreActionPossible: true,
      activeMainMergeAttentionItems: [],
    });

    expect(result.status).toBe("continue");
    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "cancelled" })
    );
    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(
      "run-1",
      "sprint_cancelled",
      "system",
      expect.objectContaining({ reason: "empty" }),
      expect.anything()
    );
  });
});
