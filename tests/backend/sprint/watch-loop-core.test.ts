import { describe, it, expect, vi } from "vitest";
import { WatchLoopRunner } from "../../../src/domain/sprint/orchestrator/watch-loop-runner.js";
import { buildMockSettings } from "../../builders/settings-builder.js";
import { buildMockSubtask } from "../../builders/subtask-builder.js";

const buildDeps = () => ({
  renderInstruction: vi.fn().mockResolvedValue("instruction"),
  updateLastStatus: vi.fn(),
  getDashboardSettings: () => buildMockSettings(),
  completedSprints: new Set<string>(),
  projectAttentionService: {
    openItem: vi.fn(),
    resolveItemsForSprintRun: vi.fn(),
    resolveItem: vi.fn(),
    listActiveProjectItems: vi.fn().mockReturnValue([]),
  },
  executionRepository: {
    appendSprintRunEvent: vi.fn(),
    finalizeSprintRunCancellationIfIdle: vi.fn().mockReturnValue(null),
    getSprintRun: vi.fn().mockReturnValue({ status: "running" }),
    updateSprintRun: vi.fn(),
    renewLease: vi.fn(),
  },
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  },
});

const buildCycleRunner = () => ({
  run: vi.fn(),
});

describe("WatchLoopRunner", () => {
  it("continues past checkpoint boundaries until a terminal condition is reached", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowValues = [0, 61_000, 62_000, 63_000];
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowValues.shift() ?? 63_000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      if (id === "cleanupAllMerged") return "CLEANUP_MERGED";
      return "";
    });

    cycleRunner.run
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "RUNNING" }), buildMockSubtask({ status: "PENDING", is_independent: false })],
        reportText: "REPORT_1",
        statusTable: "TABLE_1",
        instructions: "INST_1",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
        reportText: "REPORT_2",
        statusTable: "TABLE_2",
        instructions: "INST_2",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn().mockResolvedValue({
      text: "",
      state: "ready_for_merge",
      prNumber: null,
      prUrl: null,
      hasMergeConflict: false,
      mergeStateStatus: null,
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: [],
    }));

    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(cycleRunner.run).toHaveBeenCalledTimes(2);
    expect(result).toContain("Sprint Execution Finished");
    expect(result).toContain("REPORT_2");
    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        status: "running",
        lastHeartbeatAt: expect.any(String),
      }),
    );

    nowSpy.mockRestore();
  });

  it("completes the loop and returns final report when FINISHED transition is triggered (all terminal)", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValueOnce(0).mockReturnValue(1000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      if (id === "cleanupAllMerged") return "CLEANUP_MERGED";
      return "";
    });

    deps.completedSprints = new Set();
    const renderMergeFeedbackMock = vi.fn().mockResolvedValue({
      text: "MERGE_FEEDBACK",
      state: "ready_for_merge",
      prNumber: 101,
      prUrl: "https://github.com/example/repo/pull/101",
      hasMergeConflict: false,
      mergeStateStatus: null,
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: [],
    });

    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "INST",
      awaitingMerge: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, renderMergeFeedbackMock);

    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Execution Finished");
    nowSpy.mockRestore();
  });

  it("handles RUNNING transition properly by waiting and continuing the loop", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    // First loop iteration: elapsedMs < 60000, not finished -> RUNNING state.
    // Second loop iteration: elapsedMs >= 60000 triggers an internal checkpoint rollover.
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1000).mockReturnValueOnce(61000).mockReturnValueOnce(62000);

    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");

    cycleRunner.run
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "RUNNING" })],
        reportText: "REPORT",
        statusTable: "TABLE",
        instructions: "INST",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
        reportText: "REPORT_DONE",
        statusTable: "TABLE_DONE",
        instructions: "INST_DONE",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());

    const runPromise = runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    const result = await runPromise;
    expect(cycleRunner.run).toHaveBeenCalledTimes(2);
    expect(result).toContain("Sprint Execution Finished");

    nowSpy.mockRestore();
  });

  it("does not pause when only dependent pending work remains", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(61000).mockReturnValueOnce(62000);

    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");

    cycleRunner.run
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "PENDING", is_independent: false })],
        reportText: "REPORT",
        statusTable: "TABLE",
        instructions: "INST",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
        reportText: "REPORT_DONE",
        statusTable: "TABLE_DONE",
        instructions: "INST_DONE",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Execution Finished");
    expect(deps.projectAttentionService.openItem).not.toHaveBeenCalledWith(expect.objectContaining({
      attentionType: "manual_attention",
    }));
    nowSpy.mockRestore();
  });

  it("clears stale main-merge human escalation items once the main PR conflict is gone", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValueOnce(0).mockReturnValue(1000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      if (id === "cleanupAllMerged") return "CLEANUP_MERGED";
      return "";
    });
    deps.projectAttentionService.listActiveProjectItems = vi.fn()
      .mockReturnValueOnce([
        {
          id: "attention-main-conflict",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskId: null,
          sprintRunId: "run-1",
          dispatchId: null,
          attentionType: "human_escalation_required",
          severity: "high",
          ownerType: "human",
          status: "open",
          assignedWorkerEndpointId: null,
          title: "Virtual worker escalation: Main merge conflict",
          summaryMarkdown: "Virtual worker escalation",
          payload: {
            sourceAttentionType: "merge_conflict",
            mergeStage: "main",
          },
          openedAt: "2026-03-10T00:00:00.000Z",
          claimedAt: null,
          resolvedAt: null,
          updatedAt: "2026-03-10T00:00:00.000Z",
        },
      ])
      .mockReturnValueOnce([
        {
          id: "attention-main-conflict",
          projectId: "project-1",
          sprintId: "sprint-1",
          taskId: null,
          sprintRunId: "run-1",
          dispatchId: null,
          attentionType: "human_escalation_required",
          severity: "high",
          ownerType: "human",
          status: "open",
          assignedWorkerEndpointId: null,
          title: "Virtual worker escalation: Main merge conflict",
          summaryMarkdown: "Virtual worker escalation",
          payload: {
            sourceAttentionType: "merge_conflict",
            mergeStage: "main",
          },
          openedAt: "2026-03-10T00:00:00.000Z",
          claimedAt: null,
          resolvedAt: null,
          updatedAt: "2026-03-10T00:00:00.000Z",
        },
      ])
      .mockReturnValue([]);

    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true, worker_branch: "worker/task-1" })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "",
      awaitingMerge: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
    });

    const renderMergeFeedbackMock = vi.fn().mockResolvedValue({
      text: "MERGE_FEEDBACK",
      state: "automerge_succeeded",
      prNumber: 101,
      prUrl: "https://github.com/example/repo/pull/101",
      hasMergeConflict: false,
      mergeStateStatus: "CLEAN",
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, renderMergeFeedbackMock);
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: { resolveMainMergeConflicts: true } as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Execution Finished");
    expect(deps.projectAttentionService.resolveItem).toHaveBeenCalledWith(
      "attention-main-conflict",
      expect.objectContaining({
        reason: "main_merge_conflict_cleared",
      }),
    );
    nowSpy.mockRestore();
  });

  it("pauses instead of completing when the main merge gate reports a conflict", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValueOnce(0).mockReturnValue(1000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      return "";
    });

    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true, worker_branch: "worker/task-1" })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "",
      awaitingMerge: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
    });

    const renderMergeFeedbackMock = vi.fn().mockResolvedValue({
      text: "MERGE_FEEDBACK",
      state: "merge_conflict",
      prNumber: 268,
      prUrl: "https://github.com/example/repo/pull/268",
      hasMergeConflict: true,
      mergeStateStatus: "DIRTY",
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, renderMergeFeedbackMock);
    const result = await runner.run({
      args: { sprint_number: 104, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 104" },
        sprintNumber: 104,
        repoPath: "/tmp",
        featureBranch: "feature/sprint104-implementation",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feature/sprint104-implementation",
      defaultBranch: "main",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: { resolveMainMergeConflicts: true } as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Paused");
    expect(result).not.toContain("Sprint Execution Finished");
    expect(deps.projectAttentionService.openItem).toHaveBeenCalledWith(
      expect.objectContaining({
        attentionType: "merge_conflict",
        ownerType: "worker",
      }),
    );
    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "paused" }),
    );
    expect(deps.executionRepository.appendSprintRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "sprint_completed",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    nowSpy.mockRestore();
  });

  it("pauses instead of completing when a main-merge escalation handoff is still open", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValueOnce(0).mockReturnValue(1000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      return "";
    });
    deps.projectAttentionService.listActiveProjectItems = vi.fn().mockReturnValue([
      {
        id: "attention-main-conflict",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: null,
        sprintRunId: "run-1",
        dispatchId: null,
        attentionType: "human_escalation_required",
        severity: "high",
        ownerType: "human",
        status: "open",
        assignedWorkerEndpointId: null,
        title: "Virtual worker escalation: Main merge conflict",
        summaryMarkdown: "Virtual worker escalation",
        payload: {
          sourceAttentionType: "merge_conflict",
          mergeStage: "main",
        },
        openedAt: "2026-03-10T00:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
    ]);

    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true, worker_branch: "worker/task-1" })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "",
      awaitingMerge: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
    });

    const renderMergeFeedbackMock = vi.fn().mockResolvedValue({
      text: "MERGE_FEEDBACK",
      state: "merge_conflict",
      prNumber: 268,
      prUrl: "https://github.com/example/repo/pull/268",
      hasMergeConflict: true,
      mergeStateStatus: "DIRTY",
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, renderMergeFeedbackMock);
    const result = await runner.run({
      args: { sprint_number: 104, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 104" },
        sprintNumber: 104,
        repoPath: "/tmp",
        featureBranch: "feature/sprint104-implementation",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feature/sprint104-implementation",
      defaultBranch: "main",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: { resolveMainMergeConflicts: true } as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Paused");
    expect(result).not.toContain("Sprint Execution Finished");
    expect(deps.projectAttentionService.openItem).not.toHaveBeenCalled();
    expect(deps.executionRepository.appendSprintRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "sprint_completed",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    nowSpy.mockRestore();
  });

  it("completes the sprint when the only completed task produced no merge output", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    nowSpy.mockReturnValueOnce(0).mockReturnValue(1000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      if (id === "cleanupAllMerged") return "CLEANUP_MERGED";
      return "";
    });

    const renderMergeFeedbackMock = vi.fn().mockResolvedValue({
      text: "",
      state: "ready_for_merge",
      prNumber: null,
      prUrl: null,
      hasMergeConflict: false,
      mergeStateStatus: null,
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: [],
    });

    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "",
      awaitingMerge: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, renderMergeFeedbackMock);

    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Execution Finished");
    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "completed" }),
    );
    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(
      "run-1",
      "sprint_completed",
      "system",
      expect.objectContaining({ taskCount: 1 }),
      expect.any(Object),
    );
    nowSpy.mockRestore();
  });

  it("keeps the watch loop running while a worker-owned merge conflict is being supervised", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");
    let sprintRunLookupCount = 0;

    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(2_000).mockReturnValueOnce(61_000);
    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");
    deps.executionRepository.getSprintRun = vi.fn(() => {
      sprintRunLookupCount += 1;
      return { status: sprintRunLookupCount >= 5 ? "paused" : "running" };
    });

    cycleRunner.run
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        reportText: "REPORT_CONFLICT",
        statusTable: "TABLE_CONFLICT",
        instructions: "INST_CONFLICT",
        awaitingMerge: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        reportText: "REPORT_CONFLICT_2",
        statusTable: "TABLE_CONFLICT_2",
        instructions: "INST_CONFLICT_2",
        awaitingMerge: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
      });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(cycleRunner.run).toHaveBeenCalledTimes(2);
    expect(result).toContain("Sprint Paused");
    expect(deps.executionRepository.appendSprintRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "sprint_merge_required",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    nowSpy.mockRestore();
  });

  it("does not fall back to no-more-actions while a worker-owned merge conflict item is still open", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");
    let sprintRunLookupCount = 0;

    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(2_000).mockReturnValueOnce(61_000);
    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");
    deps.projectAttentionService.listActiveProjectItems = vi.fn().mockReturnValue([
      {
        id: "attention-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "run-1",
        dispatchId: null,
        attentionType: "merge_conflict",
        severity: "high",
        ownerType: "worker",
        status: "open",
        assignedWorkerEndpointId: "worker-1",
        title: "Merge conflict for T1",
        summaryMarkdown: "Worker needs to resolve a merge conflict.",
        payload: null,
        openedAt: "2026-03-10T00:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
    ]);
    deps.executionRepository.getSprintRun = vi.fn(() => {
      sprintRunLookupCount += 1;
      return { status: sprintRunLookupCount >= 5 ? "paused" : "running" };
    });

    cycleRunner.run
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        reportText: "REPORT_CONFLICT",
        statusTable: "TABLE_CONFLICT",
        instructions: "INST_CONFLICT",
        awaitingMerge: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        reportText: "REPORT_CONFLICT_2",
        statusTable: "TABLE_CONFLICT_2",
        instructions: "INST_CONFLICT_2",
        awaitingMerge: [buildMockSubtask({ status: "COMPLETED", is_merged: false, worker_branch: "worker/task-1" })],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(cycleRunner.run).toHaveBeenCalled();
    expect(result).toContain("Sprint Paused");
    expect(deps.executionRepository.appendSprintRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "sprint_no_more_actions",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(deps.projectAttentionService.openItem).not.toHaveBeenCalledWith(expect.objectContaining({
      attentionType: "manual_attention",
    }));
    nowSpy.mockRestore();
  });

  it("does not fall back to no-more-actions while another worker-owned supervision item is still open", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");
    let sprintRunLookupCount = 0;

    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1_000).mockReturnValueOnce(2_000).mockReturnValueOnce(61_000);
    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");
    deps.projectAttentionService.listActiveProjectItems = vi.fn().mockReturnValue([
      {
        id: "attention-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "run-1",
        dispatchId: "dispatch-1",
        attentionType: "worker_dispatch_blocked",
        severity: "high",
        ownerType: "worker",
        status: "open",
        assignedWorkerEndpointId: "worker-1",
        title: "Worker blocked on task T1",
        summaryMarkdown: "Worker needs to resolve a blocked dispatch.",
        payload: null,
        openedAt: "2026-03-10T00:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-10T00:00:00.000Z",
      },
    ]);
    deps.executionRepository.getSprintRun = vi.fn(() => {
      sprintRunLookupCount += 1;
      return { status: sprintRunLookupCount >= 5 ? "paused" : "running" };
    });

    cycleRunner.run
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "BLOCKED", is_merged: false })],
        reportText: "REPORT_BLOCKED",
        statusTable: "TABLE_BLOCKED",
        instructions: "INST_BLOCKED",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "BLOCKED", is_merged: false })],
        reportText: "REPORT_BLOCKED_2",
        statusTable: "TABLE_BLOCKED_2",
        instructions: "INST_BLOCKED_2",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(cycleRunner.run).toHaveBeenCalledTimes(2);
    expect(result).toContain("Sprint Paused");
    expect(deps.executionRepository.appendSprintRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "sprint_no_more_actions",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(deps.projectAttentionService.openItem).not.toHaveBeenCalledWith(expect.objectContaining({
      attentionType: "manual_attention",
    }));
    nowSpy.mockRestore();
  });

  it("stops when a dashboard pause is observed on the sprint run", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    let sprintRunLookupCount = 0;
    deps.executionRepository.getSprintRun = vi.fn(() => {
      sprintRunLookupCount += 1;
      return { status: sprintRunLookupCount === 1 ? "running" : "paused" };
    });
    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");
    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "RUNNING" })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "INST",
      awaitingMerge: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Paused");
  });

  it("finalizes cancellation when the sprint run is already idle", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    deps.executionRepository.getSprintRun = vi.fn().mockReturnValue({ status: "cancel_requested" });
    deps.executionRepository.finalizeSprintRunCancellationIfIdle = vi.fn().mockReturnValue({ id: "run-1", status: "cancelled" });
    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(deps.executionRepository.finalizeSprintRunCancellationIfIdle).toHaveBeenCalledWith("run-1");
    expect(result).toContain("Sprint Cancelled");
    expect(cycleRunner.run).not.toHaveBeenCalled();
  });

  it("reports stop pending when active cancellation work is still running", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    deps.executionRepository.getSprintRun = vi.fn().mockReturnValue({ status: "cancel_requested" });
    deps.executionRepository.finalizeSprintRunCancellationIfIdle = vi.fn().mockReturnValue(null);
    deps.renderInstruction.mockImplementation(async (id) => id === "watchHeader" ? "HEADER" : "");

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(deps.executionRepository.finalizeSprintRunCancellationIfIdle).toHaveBeenCalledWith("run-1");
    expect(result).toContain("Active work is still shutting down");
    expect(cycleRunner.run).not.toHaveBeenCalled();
  });
});
