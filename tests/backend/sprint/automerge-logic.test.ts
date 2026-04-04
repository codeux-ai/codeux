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
    setMerged: vi.fn(async (dir: string, taskId: string, merged: boolean) => {
      const filePath = path.join(dir, `${taskId}.md`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const mergedValue = merged ? "true" : "false";
        let updated = content;
        if (/^\s*merged:\s*(true|false)\s*$/m.test(content)) {
          updated = content.replace(/^\s*merged:\s*(true|false)\s*$/m, `merged: ${mergedValue}`);
        } else if (/^\s*prompt:\s*/m.test(content)) {
          updated = content.replace(/^\s*prompt:\s*/m, `merged: ${mergedValue}\nprompt:`);
        } else {
          updated = `${content.trimEnd()}\nmerged: ${mergedValue}\n`;
        }
        await fs.writeFile(filePath, updated, "utf-8");
      } catch {
        // Mock ignore
      }
    }),
  };

  return {
    settings: { maxFailures: 5 },
    getDashboardSettings: () => buildMockSettings(),
    renderInstruction: vi.fn().mockResolvedValue(""),
    isJulesApiConfigured: () => true,
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
    subtaskRepository,
    listSessions: vi.fn(),
    updateLastStatus: vi.fn(),
    getCiStatusForScope: vi.fn(),
    autoMergeFeaturePr: vi.fn().mockResolvedValue({ ok: true }),
    resolveSessionName: (s: any) => s.name,
    extractSessionId: (s: any) => s.id,
    completedSprints: new Set<string>(),
    projectManagementRepository: { updateTask: vi.fn(), getTasksByIds: vi.fn().mockReturnValue([]) },
    executionRepository: { updateSprintRun: vi.fn() },
    projectAttentionService: {
      openItem: vi.fn(),
      resolveItemsForTask: vi.fn(),
      resolveItemsForSprintRun: vi.fn(),
    },
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

describe("SprintOrchestrator - Automerge Logic", () => {
  it("auto merges feature PR when checks are green and review blockers are clear", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: true,
        waitForCiBeforeMainMerge: true,
        resolveAllCommentsBeforeMainMerge: true,
        resolveMainMergeConflicts: false,
        waitForCiBeforeFeatureMerge: true,
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
      openPullRequests: [{ number: 12, headRefName: "worker/task-01", reviewDecision: "APPROVED", checks: [{ name: "ci", status: "completed", conclusion: "success" }] }],
      ciRuns: [],
      tracking: { scope: "FEATURE_PR_CI" },
    });

    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-automerge-"));
    const subtasksDir = path.join(tmpRoot, ".sprint-os", "sprints", "sprint1-subtasks");
    deps.projectManagementRepository.updateTask = vi.fn(async (_taskId: string, input: any) => {
      if (input.isMerged === true) {
        await deps.subtaskRepository.setMerged(subtasksDir, "01-task", true);
      }
    });
    const orchestrator = new SprintOrchestrator(deps as any);
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\ndepends_on: []\nis_independent: true\nmerged: false\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task", record_id: "task-record-1" })]);
    deps.listSessions.mockResolvedValue({
      sessions: [
        buildMockSession({
          id: "abc123",
          title: `Sprint 1: ${buildTaskRunTag(tmpRoot, 1, "01-task")} [01-task] Test task`,
          state: "COMPLETED",
          outputs: [{ pullRequest: { url: "https://example.com/pr/12", workerBranch: "worker/task-01" } }],
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

    expect(result.content[0].text).toContain("Auto-Merged");
    expect(deps.autoMergeFeaturePr).toHaveBeenCalledWith({ repoPath: tmpRoot, prNumber: 12 });
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
      "task-record-1",
      expect.objectContaining({ isMerged: true, mergeIndicator: "AUTOMERGE" }),
    );
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
