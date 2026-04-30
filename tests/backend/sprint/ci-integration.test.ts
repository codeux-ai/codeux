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
    renderInstruction: vi.fn().mockResolvedValue(""),
    isJulesApiConfigured: () => true,
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
    subtaskRepository,
    listSessions: vi.fn(),
    sendSessionMessage: vi.fn().mockResolvedValue({}),
    updateLastStatus: vi.fn(),
    getCiStatusForScope: vi.fn(),
    resolveSessionName: (s: any) => s.name,
    extractSessionId: (s: any) => s.id,
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

describe("SprintOrchestrator - CI & Merge Gates", () => {
  it("keeps completed tasks in work state while feature PR CI is failing when autofix wait is enabled", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: true,
        resolveAllCommentsBeforeMainMerge: true,
        resolveMainMergeConflicts: false,
        resolveAllCommentsBeforeFeatureMerge: true,
        resolveMergeConflicts: false,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 3,
        featurePrAutoMergeMode: "WHEN_GREEN",
      }
    });

    deps.getCiStatusForScope.mockResolvedValue({
      mode: "REMOTE",
      available: true,
      openPullRequests: [
        {
          number: 10,
          url: "https://example.com/pr/10",
          headRefName: "worker/task-01",
          checks: [{ name: "ci", status: "completed", conclusion: "failure" }],
        },
      ],
      ciRuns: [
        {
          id: 9001,
          name: "ci",
          status: "completed",
          conclusion: "failure",
          headBranch: "worker/task-01",
          url: "https://example.com/run/9001",
          failedJobs: [{ name: "test", conclusion: "failure", failedSteps: ["unit"], logExcerpt: "unit test failed" }],
        },
      ],
      tracking: { scope: "FEATURE_PR_CI" },
    });

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-ci-wait-"));
    const subtasksDir = path.join(tmpRoot, ".sprint-os", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task" })]);
    deps.listSessions.mockResolvedValue({
      sessions: [
        buildMockSession({
          id: "abc123",
          title: `Sprint 1: ${buildTaskRunTag(tmpRoot, 1, "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          outputs: [{ pullRequest: { url: "https://example.com/pr/10", workerBranch: "worker/task-01" } }],
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
    expect(text).toContain("CI/Review Autofix Wait");
    expect(text).toContain("`01-task`");
    expect(text).toContain("`RUNNING`");
    expect(deps.sendSessionMessage).toHaveBeenCalled();

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("escalates CI autofix after max retries", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({
      automationLevel: "FULL",
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: true,
        resolveAllCommentsBeforeMainMerge: true,
        resolveMainMergeConflicts: false,
        resolveAllCommentsBeforeFeatureMerge: true,
        resolveMergeConflicts: false,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 0,
        featurePrAutoMergeMode: "WHEN_GREEN",
      }
    });

    deps.getCiStatusForScope.mockResolvedValue({
      mode: "REMOTE",
      available: true,
      openPullRequests: [{ number: 42, url: "https://example.com/pr/42", headRefName: "worker/task-01", checks: [{ name: "ci", status: "completed", conclusion: "failure" }] }],
      ciRuns: [
         {
          id: 9042,
          name: "ci",
          status: "completed",
          conclusion: "failure",
          headBranch: "worker/task-01",
          url: "https://example.com/run/9042",
          failedJobs: [{ name: "test", conclusion: "failure", failedSteps: ["unit"], logExcerpt: "unit test failed" }],
        },
      ],
      tracking: { scope: "FEATURE_PR_CI" },
    });

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-ci-esc-"));
    const subtasksDir = path.join(tmpRoot, ".sprint-os", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task" })]);
    deps.listSessions.mockResolvedValue({
      sessions: [
        buildMockSession({
          id: "abc123",
          title: `Sprint 1: ${buildTaskRunTag(tmpRoot, 1, "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          outputs: [{ pullRequest: { url: "https://example.com/pr/42", workerBranch: "worker/task-01" } }],
        }),
      ],
    });

    deps.renderInstruction = vi.fn(async (id) => id === "actionRequiredAgentHeader" ? "### AGENT INTERVENTION NEEDED\n" : "");

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "status",
      wait: false,
    });

    expect(result.content[0].text).toContain("CI autofix retries exhausted");
    expect(result.content[0].text).toContain("AGENT INTERVENTION NEEDED");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
