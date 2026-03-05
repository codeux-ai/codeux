import { describe, it, expect, vi } from "vitest";
import { WatchLoopRunner } from "../../../src/domain/sprint/orchestrator/watch-loop-runner.js";
import { buildMockSettings } from "../../builders/settings-builder.js";
import { buildMockSubtask } from "../../builders/subtask-builder.js";

const buildDeps = () => ({
  renderInstruction: vi.fn().mockResolvedValue("instruction"),
  updateLastStatus: vi.fn(),
  getDashboardSettings: () => buildMockSettings(),
  getGuideContent: vi.fn().mockResolvedValue("guide"),
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
  it("returns intermediate report when CHECKPOINT transition is triggered (output interval reached)", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");
    
    // 1. Initial start time
    // 2. elapsedMs calculation (must be >= 60000 for default min)
    nowSpy.mockReturnValueOnce(0).mockReturnValue(61000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      if (id === "watchContinue") return "WATCH_CONTINUE";
      return "";
    });

    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "RUNNING" }), buildMockSubtask({ status: "PENDING", is_independent: false })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "INST",
      awaitingMerge: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());
    
    const result = await runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      repoPath: "/tmp",
      subtasksDir: "/tmp/subtasks",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
    });

    expect(result).toContain("WATCH_CONTINUE");
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
    const renderMergeFeedbackMock = vi.fn().mockResolvedValue("MERGE_FEEDBACK");

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
      repoPath: "/tmp",
      subtasksDir: "/tmp/subtasks",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 1 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
    });

    expect(result).toContain("Sprint Execution Finished");
    nowSpy.mockRestore();
  });

  it("handles RUNNING transition properly by waiting and continuing the loop", async () => {
    const deps = buildDeps();
    const cycleRunner = buildCycleRunner();
    const nowSpy = vi.spyOn(Date, "now");

    // First loop iteration: elapsedMs < 60000, not finished -> RUNNING state.
    // Second loop iteration: elapsedMs >= 60000 -> CHECKPOINT state.
    nowSpy.mockReturnValueOnce(0).mockReturnValueOnce(1000).mockReturnValueOnce(61000);

    deps.renderInstruction.mockImplementation(async (id) => {
      if (id === "watchHeader") return "HEADER";
      if (id === "watchContinue") return "WATCH_CONTINUE";
      return "";
    });

    cycleRunner.run.mockResolvedValue({
      subtasks: [buildMockSubtask({ status: "RUNNING" })],
      reportText: "REPORT",
      statusTable: "TABLE",
      instructions: "INST",
      awaitingMerge: [],
    });

    const runner = new WatchLoopRunner(deps as any, cycleRunner as any, vi.fn());

    const runPromise = runner.run({
      args: { sprint_number: 1, action: "orchestrate" } as any,
      repoPath: "/tmp",
      subtasksDir: "/tmp/subtasks",
      defaultFeatureBranch: "feat",
      defaultBranch: "main",
      githubMode: "LOCAL",
      retryFailed: false,
      loopSteps: { watchLoopOutputIntervalSeconds: 60, watchLoopIntervalSeconds: 0.01 } as any,
      ciIntelligence: {} as any,
      automationLevel: "SEMI_AUTO",
      automationInterventions: {} as any,
      dashboardPort: 4444,
    });

    const result = await runPromise;
    expect(cycleRunner.run).toHaveBeenCalledTimes(2);
    expect(result).toContain("WATCH_CONTINUE");

    nowSpy.mockRestore();
  });
});
