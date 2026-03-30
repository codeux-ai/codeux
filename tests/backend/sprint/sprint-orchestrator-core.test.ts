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

  it("keeps the watch loop alive past output interval boundaries", async () => {
    const nowSpy = vi.spyOn(Date, "now");
    try {
      const nowValues = [0, 61_000, 62_000, 63_000];
      nowSpy.mockImplementation(() => nowValues.shift() ?? 63_000);
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
          watchLoopIntervalSeconds: 0.01,
          watchLoopOutputIntervalSeconds: 60,
        },
      });
      deps.renderInstruction = vi.fn(async (templateId: string) => {
        if (templateId === "watchHeader") return "### Sprint Header";
        if (templateId === "cleanupAllMerged") return "CLEANUP_MERGED";
        return "";
      });

      const orchestrator = new SprintOrchestrator(deps as any);
      const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-watch-"));
      const subtasksDir = path.join(tmpRoot, ".sprint-os", "sprints", "sprint1-subtasks");
      await fs.mkdir(subtasksDir, { recursive: true });
      await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

      subtaskRepository.loadSubtasks
        .mockResolvedValueOnce([
          {
            id: "01-task",
            title: "Test task",
            prompt: "Do it",
            depends_on: [],
            is_independent: false,
            status: "RUNNING",
          },
        ])
        .mockResolvedValueOnce([
          {
            id: "01-task",
            title: "Test task",
            prompt: "Do it",
            depends_on: [],
            is_independent: false,
            status: "COMPLETED",
            is_merged: true,
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
      expect(text).toContain("Sprint Execution Finished");
      expect(text).toContain("CLEANUP_MERGED");

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
    const subtasksDir = path.join(tmpRoot, ".sprint-os", "sprints", "sprint1-subtasks");
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

  it("releases stale sprint leases before acquiring a fresh orchestration lease", async () => {
    const { deps, subtaskRepository } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: {
        ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
        branchPreflight: false,
        planningPreflight: false,
        watchLoop: false,
      },
    });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-stale-lease-"));
    const subtasksDir = path.join(tmpRoot, ".sprint-os", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt: x\n", "utf-8");

    subtaskRepository.loadSubtasks.mockResolvedValue([]);

    await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "orchestrate",
      wait: false,
    });

    expect(deps.executionRepository.releaseStaleSprintLease).toHaveBeenCalledWith("project-1", "sprint-1");
    expect(deps.executionRepository.acquireLease).toHaveBeenCalled();

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("marks the sprint run failed when orchestration throws unexpectedly", async () => {
    const { deps } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: {
        ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
        branchPreflight: false,
        planningPreflight: false,
        watchLoop: false,
      },
    });
    const orchestrator = new SprintOrchestrator(deps as any);
    vi.spyOn((orchestrator as any).actionRunner as SprintActionRunner, "runOrchestrate")
      .mockRejectedValue(new Error("watch loop exploded"));

    await expect(orchestrator.execute({
      sprint_number: 1,
      repo_path: "/tmp/repo",
      source_id: "sources/123",
      action: "orchestrate",
      wait: false,
    })).rejects.toThrow("watch loop exploded");

    expect(deps.executionRepository.updateSprintRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({
        status: "failed",
        finishedAt: expect.any(String),
        lastHeartbeatAt: expect.any(String),
      }),
    );
    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(
      "run-1",
      "sprint_failed",
      "system",
      expect.objectContaining({
        reason: "orchestrator_exception",
        errorMessage: "watch loop exploded",
      }),
      expect.any(Object),
    );
  });

  it("recovers an existing sprint run without creating a new run", async () => {
    const { deps } = buildDeps();
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: {
        ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
        branchPreflight: false,
        planningPreflight: false,
      },
    });
    deps.executionRepository.getSprintRun = vi.fn().mockReturnValue({
      id: "run-existing",
      projectId: "project-1",
      sprintId: "sprint-1",
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
    });
    const orchestrator = new SprintOrchestrator(deps as any);
    const runOrchestrateSpy = vi.spyOn((orchestrator as any).actionRunner as SprintActionRunner, "runOrchestrate")
      .mockResolvedValue({ content: [] });

    await orchestrator.recoverSprintRun("run-existing");

    expect(deps.executionRepository.createSprintRun).not.toHaveBeenCalled();
    expect(deps.executionRepository.appendSprintRunEvent).toHaveBeenCalledWith(
      "run-existing",
      "sprint_recovery_started",
      "system",
      expect.objectContaining({
        previousStatus: "running",
      }),
      expect.objectContaining({
        sourceEventKey: "startup-recovery:sprint-run:run-existing",
      }),
    );
    expect(runOrchestrateSpy).toHaveBeenCalledWith(expect.objectContaining({
      sprintRunId: "run-existing",
      shouldWait: true,
      watchLoopEnabled: true,
    }));
  });
});
