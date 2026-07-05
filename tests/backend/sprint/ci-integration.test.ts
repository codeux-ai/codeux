import { describe, it, expect, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import { buildMockSettings } from "../../builders/settings-builder.js";
import { buildMockSubtask } from "../../builders/subtask-builder.js";
import { buildMockSession } from "../../builders/session-builder.js";
import { buildTaskRunTag } from "../../../src/services/task-run-key.js";

const makeStatefulGuardrail = (cap = 3) => {
  const counts = new Map<string, number>();
  const key = (taskId: string, purpose: string) => `${taskId}:${purpose}`;
  return {
    counts,
    evaluate: (_scope: any, taskId: string, purpose: string) => {
      const count = counts.get(key(taskId, purpose)) ?? 0;
      return { allowed: cap === 0 || count < cap, count, cap, action: "BLOCK_AND_ESCALATE" as const };
    },
    evaluateQa: () => ({ allowed: true, count: 0, cap: 0, action: "WARN_ONLY" as const }),
    record: (_scope: any, taskId: string, purpose: string) => {
      const k = key(taskId, purpose);
      const next = (counts.get(k) ?? 0) + 1;
      counts.set(k, next);
      return next;
    },
    getCounts: () => ({}),
    reset: () => {},
  };
};

const buildDeps = () => {
  const subtaskRepository = {
    loadSubtasks: vi.fn(),
    setMerged: vi.fn().mockResolvedValue(undefined),
  };
  const guardrailService = makeStatefulGuardrail(3);

  return {
    settings: { maxFailures: 5 },
    guardrailService,
    getConsecutiveFailures: vi.fn().mockReturnValue(0),
    setConsecutiveFailures: vi.fn(),
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
    projectAttentionService: {
      openItems: vi.fn(),
      resolveItems: vi.fn(),
      resolveItemsForTask: vi.fn(),
      resolveItemsForSprintRun: vi.fn(),
      listActiveProjectItems: vi.fn().mockReturnValue([]),
    },
    executionRepository: {
      appendSprintRunEvent: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      acquireLease: vi.fn(),
      createSprintRun: vi.fn().mockReturnValue({ id: "run-1", status: "running" }),
      finalizeSprintRunCancellationIfIdle: vi.fn().mockReturnValue(null),
      findActiveSprintRun: vi.fn().mockReturnValue(null),
      getLatestTaskRun: vi.fn().mockReturnValue({ id: "task-run-1", state: "COMPLETED" }),
      getLatestTaskRunBySessionId: vi.fn().mockReturnValue(null),
      getSprintRun: vi.fn().mockReturnValue({ id: "run-1", status: "running" }),
      getTaskRunByDispatchId: vi.fn().mockReturnValue(null),
      listExecutionInvocations: vi.fn().mockReturnValue([]),
      listTaskDispatches: vi.fn().mockReturnValue([]),
      listTaskRunEvents: vi.fn().mockReturnValue([]),
      releaseLease: vi.fn(),
      releaseStaleSprintLease: vi.fn(),
      renewLease: vi.fn(),
      updateSprintRun: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskRunsBatch: vi.fn(),
      updateTaskDispatch: vi.fn(),
      updateTaskDispatchesBatch: vi.fn(),
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
    heartbeatService: {
      startHeartbeat: vi.fn(),
      stopHeartbeat: vi.fn(),
      stopAll: vi.fn(),
    },
    workspaceManager: {
      resolveResumeWorktreePath: vi.fn(),
      removeWorktree: vi.fn(),
    },
    providerConcurrencyService: {
      getGlobalRunningCounts: vi.fn().mockReturnValue({}),
      waitForSlot: vi.fn().mockResolvedValue(undefined),
    },
    startTask: vi.fn(),
    sleep: vi.fn().mockResolvedValue(undefined),
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
    const subtasksDir = path.join(tmpRoot, ".code-ux", "sprints", "sprint1-subtasks");
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
    // Drive the task to the ci_fix guardrail cap so the next failure escalates.
    deps.guardrailService.counts.set("rec-01-task:ci_fix", 3);
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
    const subtasksDir = path.join(tmpRoot, ".code-ux", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([buildMockSubtask({ id: "01-task", record_id: "rec-01-task", project_id: "proj-1", sprint_id: "sprint-1" })]);
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

    expect(result.content[0].text).toContain("CI autofix guardrail reached");
    expect(result.content[0].text).toContain("Escalation (AGENT)");

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });

  it("does not duplicate dispatch, QA, CI autofix, or attention across repeated watch cycles of the same state", async () => {
    const deps = buildDeps();
    deps.getDashboardSettings = () => buildMockSettings({
      automationLevel: "FULL",
      sprintLoopSteps: {
        branchPreflight: false,
        planningPreflight: false,
        loadSubtasks: true,
        sessionSync: false,
        statusDerivation: true,
        startReadyTasks: true,
        mergeProtocol: true,
        actionRequiredProtocol: true,
        statusTable: true,
        watchLoop: true,
        watchLoopIntervalSeconds: 0.01,
        watchLoopOutputIntervalSeconds: 60,
      },
      agents: {
        qualityAssurance: {
          enabled: true,
        },
      },
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
      },
    } as any);

    deps.getCiStatusForScope.mockImplementation(async (args: any) => {
      if (args.scope === "MAIN_MERGE_PR_CI") {
        return {
          mode: "REMOTE",
          available: true,
          openPullRequests: [],
          mergedPullRequests: [],
          ciRuns: [],
          tracking: { scope: "MAIN_MERGE_PR_CI" },
        };
      }
      return {
        mode: "REMOTE",
        available: true,
        openPullRequests: [
          {
            number: 77,
            url: "https://example.com/pr/77",
            headRefName: "worker/task-01",
            baseRefName: "feature/sprint1-implementation",
            checks: [{ name: "ci", status: "completed", conclusion: "failure" }],
            comments: 0,
            reviewDecision: "APPROVED",
          },
        ],
        ciRuns: [
          {
            id: 9077,
            name: "ci",
            status: "completed",
            conclusion: "failure",
            headBranch: "worker/task-01",
            url: "https://example.com/run/9077",
            failedJobs: [{ name: "test", conclusion: "failure", failedSteps: ["unit"], logExcerpt: "unit failed" }],
          },
        ],
        tracking: { scope: "FEATURE_PR_CI" },
      };
    });

    const activeAttentionItems: any[] = [];
    deps.projectAttentionService.openItems.mockImplementation((items: any[]) => {
      activeAttentionItems.push(...items.map((item) => ({ ...item, status: "open" })));
    });
    deps.projectAttentionService.listActiveProjectItems.mockImplementation(() => activeAttentionItems);
    deps.executionRepository.getSprintRun = vi.fn()
      .mockReturnValueOnce({ id: "run-1", status: "running" })
      .mockReturnValueOnce({ id: "run-1", status: "running" })
      .mockReturnValueOnce({ id: "run-1", status: "paused" });

    const reviewCompletedTask = vi.fn();
    deps.qualityAssuranceService = {
      reconcileRunningTaskQaReviews: vi.fn().mockResolvedValue(undefined),
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: true,
        reason: "review_running",
        summary: "QA review is already running.",
        latestRun: { id: "qa-run-1" },
        runsUsed: 1,
        maxRuns: 2,
      }),
      reviewCompletedTask,
    } as any;

    const orchestrator = new SprintOrchestrator(deps as any);
    const tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-orch-watch-idem-"));
    const subtasksDir = path.join(tmpRoot, ".code-ux", "sprints", "sprint1-subtasks");
    await fs.mkdir(subtasksDir, { recursive: true });
    await fs.writeFile(path.join(subtasksDir, "01-task.md"), "title: test\nprompt:\nDo it\n", "utf-8");

    deps.subtaskRepository.loadSubtasks.mockResolvedValue([
      buildMockSubtask({
        id: "01-task",
        record_id: "rec-01-task",
        project_id: "project-1",
        sprint_id: "sprint-1",
        status: "COMPLETED",
        worker_branch: "worker/task-01",
        pr_url: "https://example.com/pr/77",
        provider: "codex" as any,
      }),
    ]);

    const result = await orchestrator.execute({
      sprint_number: 1,
      repo_path: tmpRoot,
      source_id: "sources/123",
      action: "orchestrate",
      wait: true,
    });

    expect(result.content[0].text).toContain("Sprint Paused");
    expect(deps.startTask).not.toHaveBeenCalled();
    expect(reviewCompletedTask).not.toHaveBeenCalled();
    expect(deps.sendSessionMessage).not.toHaveBeenCalled();
    expect(deps.projectAttentionService.openItems).toHaveBeenCalledTimes(1);
    expect(activeAttentionItems).toHaveLength(1);
    expect(activeAttentionItems[0]).toEqual(expect.objectContaining({
      attentionType: "ci_fix_required",
      taskId: "rec-01-task",
    }));

    await fs.rm(tmpRoot, { recursive: true, force: true });
  });
});
