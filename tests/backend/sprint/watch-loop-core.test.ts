import { describe, it, expect, vi } from "vitest";
import { WatchLoopRunner } from "../../../src/domain/sprint/orchestrator/watch-loop-runner.js";
import { buildMockSettings } from "../../builders/settings-builder.js";
import { buildMockSubtask } from "../../builders/subtask-builder.js";

const buildDeps = () => ({
  renderInstruction: vi.fn().mockResolvedValue("instruction"),
  updateLastStatus: vi.fn(),
  getDashboardSettings: () => buildMockSettings(),
  getGuideContent: vi.fn().mockResolvedValue("guide"),
  completedSprints: new Set<string>(),
  projectAttentionService: {
    openItem: vi.fn(),
    resolveItemsForSprintRun: vi.fn(),
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
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
        reportText: "REPORT_2",
        statusTable: "TABLE_2",
        instructions: "INST_2",
        awaitingMerge: [],
      });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn().mockResolvedValue({
      text: "",
      state: "ready_for_merge",
      prNumber: null,
      prUrl: null,
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
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
        reportText: "REPORT_DONE",
        statusTable: "TABLE_DONE",
        instructions: "INST_DONE",
        awaitingMerge: [],
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
      })
      .mockResolvedValueOnce({
        subtasks: [buildMockSubtask({ status: "COMPLETED", is_merged: true })],
        reportText: "REPORT_DONE",
        statusTable: "TABLE_DONE",
        instructions: "INST_DONE",
        awaitingMerge: [],
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
