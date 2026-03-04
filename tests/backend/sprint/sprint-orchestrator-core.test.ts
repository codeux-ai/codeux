import { describe, it, expect, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { buildDeps } from "./sprint-orchestrator.setup.js";
import { SprintActionRunner } from "../../../src/domain/sprint/orchestrator/sprint-action-runner.js";

describe("SprintOrchestrator core execution", () => {
  it("routes actions via SprintActionRunner correctly", async () => {
    const { deps } = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    // Using any to spy on private instance property
    const actionRunnerSpy = vi.spyOn((orchestrator as any).actionRunner as SprintActionRunner, "runPlan");

    // Bypass preflight failures
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: { branchPreflight: false, planningPreflight: false }
    });

    await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/tmp/repo",
      action: "plan",
    });

    expect(actionRunnerSpy).toHaveBeenCalled();
  });

  it("returns setup guidance when all providers are disabled", async () => {
    const { deps } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      aiProvider: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
        providers: {
          jules: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules, enabled: false },
          gemini: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini, enabled: false },
          codex: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex, enabled: false },
          "claude-code": { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"], enabled: false },
        },
      },
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/tmp/repo",
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    expect(result.content[0].text).toContain("Provider Setup Required");
    expect(result.content[0].text).toContain("No AI providers are enabled");
  });

  it("returns branch configuration blocker for plan when feature branch is missing", async () => {
    const { deps } = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: "/definitely/missing-repo",
      source_id: "sources/123",
      action: "plan",
      wait: false,
    });

    expect(result.content[0].text).toContain("Branch Configuration Missing");
    expect(result.content[0].text).toContain("feature/sprint1-implementation");
  });

  it("returns intermediate watch output when watch loop output interval is reached", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      nowSpy.mockReturnValueOnce(0).mockReturnValue(61_000);
      const { deps, subtaskRepository } = buildDeps();
      deps.getDashboardSettings = () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        sprintLoopSteps: {
          ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
          branchPreflight: false,
          planningPreflight: false,
          sessionSync: false,
          statusDerivation: false,
          startReadyTasks: false,
          watchLoop: true,
          watchLoopIntervalSeconds: 30,
          watchLoopOutputIntervalSeconds: 60,
        },
      });
      deps.renderInstruction = vi.fn(async (templateId: string) => {
        if (templateId === "watchHeader") return "### Sprint Header";
        if (templateId === "watchContinue") return "WATCH_CONTINUE";
        return "";
      });

      const orchestrator = new SprintOrchestrator(deps as any);
      const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-watch-"));
      const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
      await fs.mkdir(subtasksDir, { recursive: true });
      await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

      subtaskRepository.loadSubtasks.mockResolvedValue([
        {
          id: "01-task",
          title: "Test task",
          prompt: "Do it",
          depends_on: [],
          is_independent: false,
          status: "RUNNING",
        },
      ]);

      const executePromise = orchestrator.execute({
        sprint_number: 1,
        repo_path: tmpRoot,
        source_id: "sources/123",
        action: "orchestrate",
        wait: true,
      });

      const result = await executePromise;
      const text = result.content[0].text as string;
      expect(text).toContain("WATCH_CONTINUE");
      expect(text).not.toContain("Sprint Execution Finished");
      expect(deps.renderInstruction).toHaveBeenCalledWith(
        "watchContinue",
        expect.objectContaining({
          action: "orchestrate",
          running_tasks: 1,
        }),
        tmpRoot
      );

      await fs.rm(tmpRoot, { recursive: true, force: true });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("forces single-cycle execution for status even when wait=true", async () => {
    const { deps, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: {
        ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
        sessionSync: false,
        statusDerivation: false,
        startReadyTasks: false,
      },
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-status-core-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt: x\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([
      {
        id: "01-task",
        title: "Test task",
        prompt: "Do it",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
      },
    ]);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: true,
    });

    expect(result.content[0].text).toContain("Status Action is Instant");
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
