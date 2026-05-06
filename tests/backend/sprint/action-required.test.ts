import { describe, it, expect, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { buildMockSettings } from "../../builders/settings-builder.js";
import { buildMockSubtask } from "../../builders/subtask-builder.js";
import { buildMockSession } from "../../builders/session-builder.js";
import { buildTaskRunTag } from "../../../src/services/task-run-key.js";

const buildDeps = () => {
  const subtaskRepository = {
    loadSubtasks: vi.fn(),
    setMerged: vi.fn().mockResolvedValue(undefined),
  };

  return {
    settings: { maxFailures: 5 },
    getDashboardSettings: () => buildMockSettings(),
    renderInstruction: vi.fn(async (id, vars) => {
        if (id === "actionRequiredHumanHeader") return "### HUMAN INTERVENTION NEEDED\n";
        if (id === "actionRequiredAgentHeader") return "### AGENT INTERVENTION NEEDED\n";
        return "";
    }),
    isJulesApiConfigured: () => true,
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
    subtaskRepository,
    listSessions: vi.fn(),
    sendSessionMessage: vi.fn().mockResolvedValue({}),
    updateLastStatus: vi.fn(),
    resolveSessionName: (s: any) => s.name,
    extractSessionId: (s: any) => s.id,
    fetchRecentActivities: vi.fn().mockResolvedValue([]),
    getCiStatusForScope: vi.fn().mockResolvedValue(null),
    completedSprints: new Set<string>(),
    projectManagementRepository: { updateTask: vi.fn(), getTasksByIds: vi.fn().mockReturnValue([]) },
    executionRepository: { updateSprintRun: vi.fn() },
    sprintExecutionStateService: {
      resolveContext: vi.fn((args: any) => ({
        project: { id: "project-1", name: "Test Project" },
        sprint: { id: "sprint-1", name: "Sprint 1" },
        sprintNumber: args.sprint_number ?? 1,
        repoPath: args.repo_path,
        featureBranch: args.feature_branch || "feature/sprint1-implementation",
        defaultBranch: "main",
        sourceId: args.source_id,
      })),
      hasPlannedTasks: vi.fn().mockReturnValue(true),
      loadSubtasks: vi.fn(async () => subtaskRepository.loadSubtasks()),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    },
  };
};

describe("SprintOrchestrator - Action Required Protocol", () => {
  it("marks actionable session states as blocked and emits instructions", async () => {
    const deps = buildDeps();
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-action-req-"));
    const subtasksDir = path.join(tmpRoot, ".code-ux", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task" })]);
    deps.listSessions.mockResolvedValue({
      sessions: [
        buildMockSession({
          id: "abc123",
          title: `Sprint 1: ${buildTaskRunTag(tmpRoot, 1, "01-task")} [01-task] Test task`,
          state: "AWAITING_USER_FEEDBACK",
        }),
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("HUMAN INTERVENTION NEEDED");
    expect(text).toContain("`BLOCKED`");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("auto-answers clarification in FULL automation mode", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({ automationLevel: "FULL" });
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-auto-answer-"));
    const subtasksDir = path.join(tmpRoot, ".code-ux", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task" })]);
    deps.listSessions.mockResolvedValue({
      sessions: [
        buildMockSession({
          id: "abc123",
          title: `Sprint 1: ${buildTaskRunTag(tmpRoot, 1, "01-task")} [01-task] Test task`,
          state: "AWAITING_USER_FEEDBACK",
        }),
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    expect(result.content[0].text).toContain("Auto-Answered Clarification");
    expect(deps.sendSessionMessage).toHaveBeenCalledWith(
      "abc123",
      expect.stringContaining("Proceed with the safest implementation path")
    );

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("routes blocked tasks to agent intervention when auto-intervention fails", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({ automationLevel: "FULL" });
    deps.sendSessionMessage = vi.fn().mockRejectedValue(new Error("temporary Jules API error"));
    const orchestrator = new SprintOrchestrator(deps as any);

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-agent-fail-"));
    const subtasksDir = path.join(tmpRoot, ".code-ux", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task" })]);
    deps.listSessions.mockResolvedValue({
      sessions: [
        buildMockSession({
          id: "abc123",
          title: `Sprint 1: ${buildTaskRunTag(tmpRoot, 1, "01-task")} [01-task] Test task`,
          state: "AWAITING_USER_FEEDBACK",
        }),
      ],
    });

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    const text = result.content[0].text as string;
    expect(text).toContain("AGENT INTERVENTION NEEDED");
    expect(text).toContain("Auto-Intervention Failed");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
