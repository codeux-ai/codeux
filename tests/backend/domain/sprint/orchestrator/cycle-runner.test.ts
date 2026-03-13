import { describe, expect, it, vi } from "vitest";
import { CycleRunner } from "../../../../../src/domain/sprint/orchestrator/cycle-runner.js";
import type { SprintOrchestratorDependencies } from "../../../../../src/sprint/sprint-orchestrator.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../../src/repositories/settings-defaults.js";

function buildDeps(): SprintOrchestratorDependencies {
  return {
    settings: { maxFailures: 5 },
    dashboardPort: 4444,
    completedSprints: new Set<string>(),
    getConsecutiveFailures: () => 0,
    setConsecutiveFailures: vi.fn(),
    isActionRequiredState: (state?: string) => state === "AWAITING_PLAN_APPROVAL",
    resolveSessionName: vi.fn(),
    extractSessionId: vi.fn(),
    fetchRecentActivities: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
    projectManagementRepository: {
      updateTask: vi.fn(),
    } as any,
    executionRepository: {
      getLatestTaskRun: vi.fn().mockReturnValue({ id: "task-run-1" }),
      appendTaskRunEvent: vi.fn(),
    } as any,
    projectAttentionService: {
      openItem: vi.fn(),
      resolveItemsForTask: vi.fn(),
      resolveItemsForSprintRun: vi.fn(),
    } as any,
    sprintExecutionStateService: {
      loadSubtasks: vi.fn().mockResolvedValue([]),
    } as any,
    startTask: vi.fn(),
    getGuideContent: vi.fn().mockResolvedValue(""),
    updateLastStatus: vi.fn(),
    getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    isJulesApiConfigured: () => true,
    approveSessionPlan: vi.fn().mockResolvedValue({}),
    sendSessionMessage: vi.fn().mockResolvedValue({}),
    renderInstruction: vi.fn().mockImplementation(async (templateId: string, variables: Record<string, unknown>) => {
      if (templateId === "mergeHeader") return "MERGE HEADER";
      if (templateId === "mergeTask") return `Merge ${variables.task_id}`;
      if (templateId === "actionRequiredAgentHeader") return "AGENT HEADER";
      if (templateId === "actionRequiredAgentTask") return `Action ${variables.task_id}`;
      if (templateId === "actionRequiredHumanHeader") return "HUMAN HEADER";
      if (templateId === "actionRequiredHumanTask") return `Human ${variables.task_id}`;
      return "";
    }),
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnThis(),
    } as any,
  };
}

describe("CycleRunner attention sync", () => {
  it("opens merge and action attention items and resolves cleared task attention", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    const subtasks = [
      {
        id: "T1",
        record_id: "task-1",
        title: "Merge task",
        prompt: "merge",
        depends_on: [],
        status: "COMPLETED",
        is_merged: false,
        merge_indicator: "MERGE_BLOCKED",
        worker_branch: "feat/T1",
        pr_url: "https://example.com/pr/1",
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Blocked task",
        prompt: "blocked",
        depends_on: [],
        status: "BLOCKED",
        session_state: "AWAITING_PLAN_APPROVAL",
        intervention_owner: "AGENT",
        intervention_hint: "Needs a plan decision.",
        provider: "jules",
      },
      {
        id: "T3",
        record_id: "task-3",
        title: "Healthy task",
        prompt: "healthy",
        depends_on: [],
        status: "RUNNING",
      },
    ];
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue(subtasks as any);

    const result = await runner.run({
      action: "status",
      automationLevel: "SEMI_AUTO",
      automationInterventions: DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
      executionContext: {
        project: { id: "project-1", name: "Project 1" } as any,
        sprint: { id: "sprint-1", name: "Sprint 1" } as any,
        sprintNumber: 1,
        repoPath: "/repo/project-1",
        featureBranch: "feature/sprint-1",
        defaultBranch: "main",
      },
      repoPath: "/repo/project-1",
      defaultFeatureBranch: "feature/sprint-1",
      retryFailed: false,
      loopSteps: {
        loadSubtasks: true,
        sessionSync: false,
        statusDerivation: false,
        startReadyTasks: false,
        statusTable: false,
        mergeProtocol: true,
        actionRequiredProtocol: true,
      } as any,
      ciIntelligence: {
        enabled: false,
      } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.awaitingMerge).toHaveLength(1);
    expect(deps.projectAttentionService.openItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: "run-1",
      attentionType: "merge_required",
      severity: "medium",
      ownerType: "worker",
      payload: expect.objectContaining({
        repoPath: "/repo/project-1",
        featureBranch: "feature/sprint-1",
      }),
    }));
    expect(deps.projectAttentionService.openItem).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-2",
      sprintRunId: "run-1",
      attentionType: "action_required",
      ownerType: "worker",
      summaryMarkdown: "No session id available for automatic intervention.",
    }));
    expect(deps.projectAttentionService.resolveItemsForTask).toHaveBeenCalledWith(
      "project-1",
      "task-3",
      ["merge_required"],
      "merge_attention_cleared",
    );
    expect(deps.projectAttentionService.resolveItemsForTask).toHaveBeenCalledWith(
      "project-1",
      "task-3",
      ["action_required"],
      "action_required_cleared",
    );
  });

  it("re-derives dependent readiness after automerge and starts newly unblocked work", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Merged task",
        prompt: "merge",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        worker_branch: "worker/T1",
        session_id: "session-1",
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Dependent task",
        prompt: "follow up",
        depends_on: ["T1"],
        is_independent: false,
        status: "BLOCKED",
        is_merged: false,
      },
    ] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [
        {
          number: 101,
          title: "Task PR",
          url: "https://example.com/pr/101",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/T1",
          baseRefName: "feature/sprint-1",
          checks: [{ name: "ci", status: "completed", conclusion: "success" }],
          comments: 0,
          reviewDecision: "APPROVED",
        },
      ],
      ciRuns: [],
    });
    deps.autoMergeFeaturePr = vi.fn().mockResolvedValue({ ok: true });
    deps.startTask = vi.fn().mockResolvedValue({ id: "session-2", provider: "codex" });

    const result = await runner.run({
      action: "orchestrate",
      automationLevel: "FULL",
      automationInterventions: DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
      executionContext: {
        project: { id: "project-1", name: "Project 1" } as any,
        sprint: { id: "sprint-1", name: "Sprint 1" } as any,
        sprintNumber: 1,
        repoPath: "/repo/project-1",
        featureBranch: "feature/sprint-1",
        defaultBranch: "main",
      },
      repoPath: "/repo/project-1",
      defaultFeatureBranch: "feature/sprint-1",
      retryFailed: false,
      loopSteps: {
        loadSubtasks: true,
        sessionSync: false,
        statusDerivation: true,
        startReadyTasks: true,
        statusTable: false,
        mergeProtocol: true,
        actionRequiredProtocol: true,
      } as any,
      ciIntelligence: {
        enabled: true,
        enableLivePrMonitoring: true,
        waitForCiBeforeFeatureMerge: true,
        resolveAllCommentsBeforeFeatureMerge: true,
        waitForJulesCiAutofix: true,
        julesCiAutofixMaxRetries: 3,
        featurePrAutoMergeMode: "WHEN_GREEN",
      } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.subtasks.find((task) => task.id === "T1")).toMatchObject({
      is_merged: true,
      merge_indicator: "AUTOMERGE",
      status: "COMPLETED",
    });
    expect(result.subtasks.find((task) => task.id === "T2")).toMatchObject({
      status: "RUNNING",
    });
    expect(deps.startTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T2" }), expect.anything());
  });
});
