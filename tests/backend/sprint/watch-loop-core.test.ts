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
  it("returns intermediate report when output interval is reached", async () => {
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
});
