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
  return {
    settings: { maxFailures: 5 },
    getDashboardSettings: () => buildMockSettings(),
    renderInstruction: vi.fn().mockResolvedValue(""),
    isJulesApiConfigured: () => true,
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL" || state === "AWAITING_USER_FEEDBACK" || state === "PAUSED",
    loadSubtasks: vi.fn(),
    listSessions: vi.fn(),
    updateLastStatus: vi.fn(),
    getCiStatusForScope: vi.fn(),
    autoMergeFeaturePr: vi.fn().mockResolvedValue({ ok: true }),
    resolveSessionName: (s: any) => s.name,
    extractSessionId: (s: any) => s.id,
    completedSprints: new Set<number>(),
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
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: true,
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

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-automerge-"));
    const subtasksDir = path.join(tmpRoot, ".jules-subagents", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\ndepends_on: []\nis_independent: true\nmerged: false\nprompt:\nDo it\n", "utf-8");

    deps.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task" })]);
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

    const persisted = await fs.readFile(path.join(subtasksDir, "01-task.md"), "utf-8");
    expect(persisted).toContain("merged: true");
    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
