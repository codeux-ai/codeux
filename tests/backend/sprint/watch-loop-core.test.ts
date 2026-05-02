import { describe, it, expect, vi } from "vitest";
import { WatchLoopRunner } from "../../../src/domain/sprint/orchestrator/watch-loop-runner.js";
import { evaluateSprintRunState } from "../../../src/domain/sprint/orchestrator/sprint-state-evaluator.js";
import { decideMainMergeWaitOrPause, decideTerminalCompletion } from "../../../src/domain/sprint/orchestrator/watch-loop-policies.js";
import { buildMockSettings } from "../../builders/settings-builder.js";
import { buildMockSubtask } from "../../builders/subtask-builder.js";

const buildDeps = () => ({
  renderInstruction: vi.fn().mockResolvedValue("instruction"),
  sleep: vi.fn().mockResolvedValue(undefined),
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
    listTaskDispatches: vi.fn().mockReturnValue([]),
    getTaskRunByDispatchId: vi.fn().mockReturnValue(null),
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

  it("cleans up terminal sprint CLI workspaces on completion", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const resolveResumeWorktreePath = vi.spyOn(
      (await import("../../../src/infrastructure/providers/cli/workspace-manager.js")).WorkspaceManager.prototype,
      "resolveResumeWorktreePath",
    ).mockResolvedValue("/tmp/repo/.worktrees/session-1");
    const removeWorktree = vi.spyOn(
      (await import("../../../src/infrastructure/providers/cli/workspace-manager.js")).WorkspaceManager.prototype,
      "removeWorktree",
    ).mockResolvedValue(undefined);

    deps.executionRepository.listTaskDispatches.mockReturnValue([
      { id: "dispatch-1", executorType: "docker_cli" },
    ]);
    deps.executionRepository.getTaskRunByDispatchId.mockReturnValue({
      sessionId: "session-1",
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

    await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      executionContext: {
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: 1,
        repoPath: "/tmp/repo",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      repoPath: "/tmp/repo",
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

    expect(resolveResumeWorktreePath).toHaveBeenCalledWith("/tmp/repo", "session-1", expect.anything());
    expect(removeWorktree).toHaveBeenCalledWith("/tmp/repo", "/tmp/repo/.worktrees/session-1");
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

  it("keeps the sprint active while main auto-merge is still pending", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowValues = [0, 1_000, 2_000, 61_000];
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowValues.shift() ?? 61_000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      return "";
    });
    deps.executionRepository.getSprintRun = vi
      .fn()
      .mockReturnValueOnce({ status: "running" })
      .mockReturnValueOnce({ status: "running" })
      .mockReturnValueOnce({ status: "running" });

    cycleRunner.run
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true, worker_branch: "worker/task-1" })],
        reportText: "REPORT_1",
        statusTable: "TABLE_1",
        instructions: "",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true, worker_branch: "worker/task-1" })],
        reportText: "REPORT_2",
        statusTable: "TABLE_2",
        instructions: "",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    const renderMergeFeedbackMock = vi
      .fn()
      .mockResolvedValueOnce({
        text: "MAIN_WAITING",
        state: "pending_checks",
        prNumber: 268,
        prUrl: "https://github.com/example/repo/pull/268",
        hasMergeConflict: false,
        mergeStateStatus: null,
        hasFailedChecks: false,
        hasPendingChecks: true,
        hasReviewBlockers: false,
        failedChecks: [],
      })
      .mockResolvedValueOnce({
        text: "MAIN_MERGED",
        state: "merged",
        prNumber: 268,
        prUrl: "https://github.com/example/repo/pull/268",
        hasMergeConflict: false,
        mergeStateStatus: null,
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
      featureBranchPrefix: "feature/",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: { mainBranchAutoMergeMode: "WHEN_GREEN" } as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(cycleRunner.run).toHaveBeenCalledTimes(2);
    expect(result).toContain("Sprint Still Active");
    expect(result).toContain("Sprint Execution Finished");
    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(
      "run-1",
      "sprint_completed",
      "system",
      expect.objectContaining({ taskCount: 1 }),
      expect.any(Object),
    );
    nowSpy.mockRestore();
  });

  it("pauses instead of completing when main auto-merge is blocked by failed checks", async () => {
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
      text: "MERGE_FAILED_CHECKS",
      state: "failed_checks",
      prNumber: 268,
      prUrl: "https://github.com/example/repo/pull/268",
      hasMergeConflict: false,
      mergeStateStatus: null,
      hasFailedChecks: true,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: ["build"],
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
      featureBranchPrefix: "feature/",
      githubMode: "REMOTE",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: { mainBranchAutoMergeMode: "WHEN_GREEN", resolveMainMergeConflicts: true } as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
      sprintRunId: "run-1",
    });

    expect(result).toContain("Sprint Paused");
    expect(result).not.toContain("Sprint Execution Finished");
    expect(deps.executionRepository.appendSprintRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "sprint_completed",
      expect.anything(),
      expect.anything(),
      expect.anything(),
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

  it("holds sprint completion open when sprint QA requests follow-up fixes", async () => {
    const deps = buildDeps();
    deps.qualityAssuranceService = {
      reviewSprintCompletion: vi.fn().mockResolvedValue({
        reviewed: true,
        blockedCompletion: true,
        reportText: "\nSprint QA requested follow-up work.\n",
      }),
    } as any;

    const runner = new WatchLoopRunner(
      deps as any,
      buildCycleRunner() as any,
      vi.fn().mockResolvedValue({
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
      }),
    );

    const result = await (runner as any).finalizeSprintRun({
      scopedExecutionContext: {
        project: { id: "project-1", name: "Project 1" },
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Ship safely" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      sprintRunId: "run-1",
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      githubMode: "REMOTE",
      ciIntelligence: { mainBranchAutoMergeMode: "OFF", resolveMainMergeConflicts: false } as any,
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true, id: "T1" })],
      runningTasks: [],
      readyTasks: [],
      manualMergeTasks: [],
      needsManualMerge: false,
      allTerminal: true,
      noMoreActionPossible: false,
      activeMainMergeAttentionItems: [],
    });

    expect(deps.qualityAssuranceService.reviewSprintCompletion).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sprintId: "sprint-1",
      sprintRunId: "run-1",
      repoPath: "/tmp",
    }));
    expect(result.status).toBe("wait");
    expect(result.report).toContain("Sprint QA requested follow-up work");
    expect(deps.completedSprints.size).toBe(0);
  });

  it("runs sprint QA before main merge evaluation and blocks merge while QA is pending", async () => {
    const deps = buildDeps();
    deps.qualityAssuranceService = {
      reviewSprintCompletion: vi.fn().mockResolvedValue({
        reviewed: false,
        blockedCompletion: true,
        mergeBlocked: true,
        reportText: "\nSprint QA is still running.\n",
      }),
    } as any;

    const renderMainMergeFeedback = vi.fn().mockResolvedValue({
      text: "MERGE_FEEDBACK",
      state: "ready_for_merge",
      prNumber: 42,
      prUrl: "https://example.com/pr/42",
      hasMergeConflict: false,
      mergeStateStatus: null,
      hasFailedChecks: false,
      hasPendingChecks: false,
      hasReviewBlockers: false,
      failedChecks: [],
    });

    const runner = new WatchLoopRunner(
      deps as any,
      buildCycleRunner() as any,
      renderMainMergeFeedback,
    );

    const result = await (runner as any).finalizeSprintRun({
      scopedExecutionContext: {
        project: { id: "project-1", name: "Project 1" },
        sprint: { id: "sprint-1", name: "Sprint 1", goal: "Ship safely" },
        sprintNumber: 1,
        repoPath: "/tmp",
        featureBranch: "feat",
        defaultBranch: "main",
      },
      sprintRunId: "run-1",
      repoPath: "/tmp",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      githubMode: "REMOTE",
      ciIntelligence: { mainBranchAutoMergeMode: "WHEN_GREEN", resolveMainMergeConflicts: false } as any,
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true, id: "T1" })],
      runningTasks: [],
      readyTasks: [],
      manualMergeTasks: [],
      needsManualMerge: false,
      allTerminal: true,
      noMoreActionPossible: false,
      activeMainMergeAttentionItems: [],
    });

    expect(deps.qualityAssuranceService.reviewSprintCompletion).toHaveBeenCalled();
    expect(renderMainMergeFeedback).not.toHaveBeenCalled();
    expect(result.status).toBe("wait");
    expect(result.report).toContain("Sprint QA is still running");
  });
});

describe("Watch Loop Policies", () => {
  describe("decideMainMergeWaitOrPause", () => {
    it("returns pause exit decision if main merge is blocked", () => {
      const decision = decideMainMergeWaitOrPause({
        mergeFeedback: {
          text: "Conflict",
          state: "merge_conflict",
          prNumber: 1,
          prUrl: "url",
          hasMergeConflict: true,
          mergeStateStatus: "DIRTY",
          hasFailedChecks: false,
          hasPendingChecks: false,
          hasReviewBlockers: false,
          failedChecks: [],
        },
        attentionItems: [],
        mainMergeMode: "WHEN_GREEN",
        sprintNumber: 5,
      });

      expect(decision).toEqual({
        status: "exit",
        reportModifier: expect.stringContaining("Sprint Paused"),
        terminalState: "paused",
        pauseReason: "main_merge_blocked",
        pausePayload: {
          sprintNumber: 5,
          mainMergeState: "merge_conflict",
          prNumber: 1,
          prUrl: "url",
          hasMergeConflict: true,
          attentionItemIds: [],
          attentionTypes: [],
        },
      });
    });

    it("returns wait decision if main merge mode is WHEN_GREEN and state is pending_checks", () => {
      const decision = decideMainMergeWaitOrPause({
        mergeFeedback: {
          text: "",
          state: "pending_checks",
          prNumber: 1,
          prUrl: "url",
          hasMergeConflict: false,
          mergeStateStatus: "CLEAN",
          hasFailedChecks: false,
          hasPendingChecks: true,
          hasReviewBlockers: false,
          failedChecks: [],
        },
        attentionItems: [],
        mainMergeMode: "WHEN_GREEN",
        sprintNumber: 5,
      });

      expect(decision).toEqual({
        status: "wait",
        reportModifier: expect.stringContaining("Sprint Still Active"),
      });
    });

    it("returns null if not blocked and mainMergeMode is OFF", () => {
      const decision = decideMainMergeWaitOrPause({
        mergeFeedback: {
          text: "",
          state: "ready_for_merge",
          prNumber: 1,
          prUrl: "url",
          hasMergeConflict: false,
          mergeStateStatus: "CLEAN",
          hasFailedChecks: false,
          hasPendingChecks: false,
          hasReviewBlockers: false,
          failedChecks: [],
        },
        attentionItems: [],
        mainMergeMode: "OFF",
        sprintNumber: 5,
      });

      expect(decision).toBeNull();
    });
  });

  describe("decideTerminalCompletion", () => {
    it("returns failed decision if there are failed tasks", () => {
      const decision = decideTerminalCompletion({
        subtasks: [buildMockSubtask({ status: "FAILED" })],
        manualMergeTasks: [],
      });

      expect(decision).toEqual({
        status: "continue",
        terminalState: "failed",
        failedTaskCount: 1,
      });
    });

    it("returns paused decision if there are manual merge tasks", () => {
      const decision = decideTerminalCompletion({
        subtasks: [buildMockSubtask({ status: "COMPLETED" })],
        manualMergeTasks: [buildMockSubtask({ status: "COMPLETED" })],
      });

      expect(decision).toEqual({
        status: "continue",
        terminalState: "paused",
        pauseReason: "awaiting_merge",
        pausePayload: {
          awaitingMergeCount: 1,
        },
      });
    });

    it("returns cancelled decision if subtasks list is empty", () => {
      const decision = decideTerminalCompletion({
        subtasks: [],
        manualMergeTasks: [],
      });

      expect(decision).toEqual({
        status: "continue",
        terminalState: "cancelled",
        pauseReason: "empty",
      });
    });

    it("returns manual attention pause if no other state applies", () => {
      const subtask = buildMockSubtask({ status: "RUNNING" });
      const decision = decideTerminalCompletion({
        subtasks: [subtask],
        manualMergeTasks: [],
      });

      expect(decision).toEqual({
        status: "continue",
        terminalState: "paused",
        pauseReason: "manual_attention",
        pausePayload: {
          runningTaskIds: [subtask.id],
          readyTaskIds: [],
          blockedTaskIds: [],
        },
      });
    });
  });
});

describe("Sprint Run Heartbeat", () => {
  it("renews heartbeat and lease in RUNNING branch when state is active", async () => {
    const deps = buildDeps();
    deps.executionRepository.getSprintRun.mockReturnValue({ status: "running" });
    const cycleRunner = buildCycleRunner();
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
        reportText: "REPORT",
        statusTable: "TABLE",
        instructions: "INST",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    const renderMainMergeFeedback = vi.fn().mockResolvedValue({
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

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, renderMainMergeFeedback);
    await runner.run({
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
      leaseToken: "test-token",
    });

    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "running", lastHeartbeatAt: expect.any(String) })
    );
    expect(deps.executionRepository.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: "sprint-1", leaseToken: "test-token" })
    );
  });

  it("renews heartbeat and lease in CHECKPOINT branch when output interval is reached but not all finished", async () => {
    const deps = buildDeps();
    deps.executionRepository.getSprintRun.mockReturnValue({ status: "running" });
    const cycleRunner = buildCycleRunner();
    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "RUNNING" })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "INST",
      awaitingMerge: [],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
    });

    const nowSpy = vi.spyOn(Date, "now");
    // Start at 0, handleCycle transition at 1000, then checkpoint check is true (elapsed >= 60000)
    // so it enters CHECKPOINT, calls sleep, then in sleep it returns so Date.now() happens.
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1000).mockReturnValueOnce(61000).mockReturnValueOnce(62000);

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());

    // We expect it to run and loop, we'll just check if updateSprintRun and renewLease were called
    // But since loop is infinite if it doesn't exit, we need a terminal condition in cycleRunner
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
        reportText: "REPORT",
        statusTable: "TABLE",
        instructions: "INST",
        awaitingMerge: [],
        manualMergeTasks: [],
        workerEscalatedMergeConflictTasks: [],
      });

    await runner.run({
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
      leaseToken: "test-token",
    });

    nowSpy.mockRestore();

    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ status: "running", lastHeartbeatAt: expect.any(String) })
    );
    expect(deps.executionRepository.renewLease).toHaveBeenCalledWith(
      expect.objectContaining({ scopeId: "sprint-1", leaseToken: "test-token" })
    );
  });

  it("skips renewal when run state is terminal", async () => {
    const deps = buildDeps();
    deps.executionRepository.getSprintRun.mockReturnValue({ status: "paused" });
    const cycleRunner = buildCycleRunner();
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
    await runner.run({
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
      leaseToken: "test-token",
    });

    expect(deps.executionRepository.updateSprintRun).not.toHaveBeenCalled();
    expect(deps.executionRepository.renewLease).not.toHaveBeenCalled();
  });
});

describe("evaluateSprintRunState", () => {
  it("evaluates mixed terminal and non-terminal task states correctly", () => {
    const result = evaluateSprintRunState({
      subtasks: [
        buildMockSubtask({ status: "COMPLETED", is_merged: true }),
        buildMockSubtask({ status: "PENDING", is_merged: false }),
        buildMockSubtask({ status: "FAILED", is_merged: false }),
      ],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });
    expect(result.allTerminal).toBe(false);
    expect(result.allFinished).toBe(false);
    expect(result.noMoreActionPossible).toBe(false);
  });

  it("identifies QA pending tasks and prevents noMoreActionPossible", () => {
    // A QA_PENDING task is not "settled" if it has merge evidence but is not merged.
    const result = evaluateSprintRunState({
      subtasks: [buildMockSubtask({ status: "CODING_COMPLETED", merge_indicator: "QA_PENDING", worker_branch: "test-branch", pr_url: "https://pr", is_merged: false })],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });
    expect(result.qaPendingTasks.length).toBe(1);
    expect(result.noMoreActionPossible).toBe(false);
    expect(result.allFinished).toBe(false);
  });

  it("identifies QUOTA tasks and prevents noMoreActionPossible", () => {
    const result = evaluateSprintRunState({
      subtasks: [buildMockSubtask({ status: "QUOTA" })],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });
    expect(result.quotaTasks.length).toBe(1);
    expect(result.noMoreActionPossible).toBe(false);
    expect(result.allFinished).toBe(false);
  });

  it("prioritizes waiting on worker attention over manual merge for allFinished", () => {
    const result = evaluateSprintRunState({
      subtasks: [
        buildMockSubtask({ status: "COMPLETED", is_merged: false }),
        buildMockSubtask({ status: "BLOCKED", is_merged: false })
      ],
      manualMergeTasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false })],
      workerEscalatedMergeConflictTasks: [buildMockSubtask({ status: "BLOCKED", is_merged: false })],
      activeProjectAttentionItems: [{ ownerType: "worker", attentionType: "merge_conflict", sprintRunId: "run-1" } as any],
      sprintRunId: "run-1",
    });
    expect(result.needsManualMerge).toBe(true);
    expect(result.waitingOnWorkerAttention).toBe(true);
    expect(result.allFinished).toBe(false); // worker attention prevents finished
  });

  it("identifies when all tasks are terminal", () => {
    const result = evaluateSprintRunState({
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });
    expect(result.allTerminal).toBe(true);
    expect(result.allFinished).toBe(true);
  });

  it("identifies when no more actions are possible without waiting on attention", () => {
    const result = evaluateSprintRunState({
      subtasks: [buildMockSubtask({ status: "BLOCKED", is_merged: false })],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });
    expect(result.noMoreActionPossible).toBe(true);
    expect(result.allFinished).toBe(true);
  });

  it("identifies when manual merge is needed", () => {
    const result = evaluateSprintRunState({
      subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false })],
      manualMergeTasks: [buildMockSubtask({ status: "COMPLETED", is_merged: false })],
      workerEscalatedMergeConflictTasks: [],
      activeProjectAttentionItems: [],
      sprintRunId: "run-1",
    });
    expect(result.needsManualMerge).toBe(true);
    expect(result.allFinished).toBe(true);
  });

  it("identifies when waiting on worker attention prevents finishing", () => {
    const result = evaluateSprintRunState({
      subtasks: [buildMockSubtask({ status: "BLOCKED", is_merged: false })],
      manualMergeTasks: [],
      workerEscalatedMergeConflictTasks: [buildMockSubtask({ status: "BLOCKED", is_merged: false })],
      activeProjectAttentionItems: [{ ownerType: "worker", attentionType: "merge_conflict", sprintRunId: "run-1" } as any],
      sprintRunId: "run-1",
    });
    expect(result.noMoreActionPossible).toBe(true);
    expect(result.waitingOnWorkerAttention).toBe(true);
    expect(result.allFinished).toBe(false);
  });
});
