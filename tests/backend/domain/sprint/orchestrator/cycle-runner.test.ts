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
      listActiveProjectItems: vi.fn().mockReturnValue([]),
    } as any,
    sprintExecutionStateService: {
      loadSubtasks: vi.fn().mockResolvedValue([]),
    } as any,
    startTask: vi.fn(),
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
      severity: "high",
      ownerType: "worker",
      payload: expect.objectContaining({
        repoPath: "/repo/project-1",
        featureBranch: "feature/sprint-1",
        workingDirectoryHint: "cd /repo/project-1",
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
      ["merge_required", "merge_conflict"],
      "merge_attention_cleared",
    );
    expect(deps.projectAttentionService.resolveItemsForTask).toHaveBeenCalledWith(
      "project-1",
      "task-3",
      ["action_required"],
      "action_required_cleared",
    );
  });

  it("opens a dedicated merge_conflict attention item with worker context when the PR is DIRTY", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Conflict task",
        prompt: "Resolve the API handler changes safely.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        worker_branch: "worker/T1",
        pr_url: "https://example.com/pr/101",
      },
      {
        id: "T0",
        record_id: "task-0",
        title: "Earlier merged task",
        prompt: "Refactor the same API surface.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: true,
        worker_branch: "worker/T0",
        pr_url: "https://example.com/pr/100",
      },
    ] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [
        {
          number: 101,
          title: "Conflict PR",
          url: "https://example.com/pr/101",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/T1",
          baseRefName: "feature/sprint-1",
          mergeStateStatus: "DIRTY",
          reviewDecision: null,
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "completed", conclusion: "success" }],
        },
      ],
      ciRuns: [],
    });

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
        watchLoopIntervalSeconds: 2,
      } as any,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        enabled: true,
        resolveMergeConflicts: true,
      },
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.manualMergeTasks).toEqual([]);
    expect(result.workerEscalatedMergeConflictTasks).toHaveLength(1);
    expect(deps.projectAttentionService.openItem).toHaveBeenCalledWith(expect.objectContaining({
      attentionType: "merge_conflict",
      title: "Merge conflict for T1",
      payload: expect.objectContaining({
        repoPath: "/repo/project-1",
        workingDirectoryHint: "cd /repo/project-1",
        prNumber: 101,
        mergeStateStatus: "DIRTY",
        currentTask: expect.objectContaining({
          taskKey: "T1",
          taskPrompt: "Resolve the API handler changes safely.",
        }),
        featureBranchTaskContexts: [
          expect.objectContaining({
            taskKey: "T0",
            taskPrompt: "Refactor the same API surface.",
          }),
        ],
      }),
      summaryMarkdown: expect.stringContaining("Merged task prompts already on the feature branch"),
    }));
    expect(deps.projectAttentionService.resolveItemsForTask).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      ["merge_required"],
      "merge_conflict_attention_replaced",
    );
  });

  it("keeps an existing worker-owned merge_conflict sticky when a later PR snapshot is incomplete", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Conflict task",
        prompt: "Resolve the API handler changes safely.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        worker_branch: "worker/T1",
        pr_url: "https://example.com/pr/101",
      },
    ] as any);
    vi.mocked(deps.projectAttentionService.listActiveProjectItems).mockReturnValue([
      {
        id: "attention-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "run-1",
        dispatchId: null,
        attentionType: "merge_conflict",
        severity: "high",
        ownerType: "worker",
        status: "claimed",
        assignedWorkerEndpointId: "worker-endpoint-1",
        title: "Merge conflict for T1",
        summaryMarkdown: "Conflict needs worker resolution.",
        payload: null,
        openedAt: "2026-03-15T08:00:00.000Z",
        claimedAt: "2026-03-15T08:01:00.000Z",
        resolvedAt: null,
        updatedAt: "2026-03-15T08:01:00.000Z",
      },
    ]);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [
        {
          number: 101,
          title: "Conflict PR",
          url: "https://example.com/pr/101",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/T1",
          baseRefName: "feature/sprint-1",
          mergeStateStatus: null,
          reviewDecision: "APPROVED",
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "completed", conclusion: "success" }],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
    });

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
        watchLoopIntervalSeconds: 2,
      } as any,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        enabled: true,
        resolveMergeConflicts: true,
      },
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.manualMergeTasks).toEqual([]);
    expect(result.workerEscalatedMergeConflictTasks).toHaveLength(1);
    expect(deps.projectAttentionService.openItem).toHaveBeenCalledWith(expect.objectContaining({
      attentionType: "merge_conflict",
      taskId: "task-1",
    }));
    expect(deps.projectAttentionService.resolveItemsForTask).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      ["merge_required"],
      "merge_conflict_attention_replaced",
    );
  });

  it("escalates auto-merge conflict failures to worker-owned merge_conflict attention", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Conflict task",
        prompt: "Resolve the overlapping changes.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        worker_branch: "worker/T1",
        session_id: "session-1",
      },
    ] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [
        {
          number: 101,
          title: "Conflict PR",
          url: "https://example.com/pr/101",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/T1",
          baseRefName: "feature/sprint-1",
          mergeStateStatus: null,
          reviewDecision: "APPROVED",
          updatedAt: null,
          comments: 0,
          checks: [{ name: "ci", status: "completed", conclusion: "success" }],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
    });
    deps.autoMergeFeaturePr = vi.fn().mockResolvedValue({
      ok: false,
      mergeConflict: true,
      message: "Merge conflict detected while merging PR.",
    });

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
        watchLoopIntervalSeconds: 2,
      } as any,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        enabled: true,
        resolveMergeConflicts: true,
        featurePrAutoMergeMode: "WHEN_GREEN",
      },
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.manualMergeTasks).toEqual([]);
    expect(result.workerEscalatedMergeConflictTasks).toHaveLength(1);
    expect(deps.projectAttentionService.openItem).toHaveBeenCalledWith(expect.objectContaining({
      taskId: "task-1",
      attentionType: "merge_conflict",
      payload: expect.objectContaining({
        prNumber: 101,
        mergeIndicator: "MERGE_CONFLICT",
      }),
    }));
    expect(deps.executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "task-run-1",
      "ci_gate_status",
      "system",
      expect.objectContaining({ state: "automerge_conflict", prNumber: 101 }),
      expect.any(Object),
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

  it("does not open action_required attention while clarification cooldown is active", async () => {
    const deps = buildDeps();
    deps.isActionRequiredState = (state?: string) => state === "AWAITING_USER_FEEDBACK";
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockImplementation(async () => ([
      {
        id: "T1",
        record_id: "task-1",
        title: "Clarification task",
        prompt: "Wait for Jules to continue after the clarification reply.",
        depends_on: [],
        is_independent: true,
        status: "BLOCKED",
        session_id: "sessions/abc123",
        session_state: "AWAITING_USER_FEEDBACK",
        provider: "jules",
      },
    ] as any));

    const baseArgs = {
      action: "status" as const,
      automationLevel: "FULL" as const,
      automationInterventions: {
        ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
        autoAnswerClarification: true,
        autoAnswerClarificationMode: "TEMPLATE" as const,
        clarificationCooldownSeconds: 300,
      },
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
      githubMode: "REMOTE" as const,
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    };

    const firstResult = await runner.run(baseArgs);
    expect(firstResult.subtasks[0]).toMatchObject({ status: "RUNNING" });
    expect(deps.sendSessionMessage).toHaveBeenCalledTimes(1);

    vi.mocked(deps.projectAttentionService.openItem).mockClear();

    const secondResult = await runner.run(baseArgs);

    expect(secondResult.subtasks[0]).toMatchObject({
      status: "RUNNING",
      intervention_owner: "AGENT",
    });
    expect(secondResult.subtasks[0]?.intervention_hint).toContain("Clarification cooldown active");
    expect(deps.sendSessionMessage).toHaveBeenCalledTimes(1);
    expect(deps.projectAttentionService.openItem).not.toHaveBeenCalledWith(expect.objectContaining({
      attentionType: "action_required",
      taskId: "task-1",
    }));
  });

  it("persists CI wait status back to task records while checks are still pending", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Waiting task",
        prompt: "wait for CI",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        worker_branch: "worker/T1",
        pr_url: "https://example.com/pr/101",
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
          checks: [{ name: "ci", status: "in_progress", conclusion: null }],
          comments: 0,
          reviewDecision: "APPROVED",
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
    });

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
        watchLoopIntervalSeconds: 2,
      } as any,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        enabled: true,
        waitForCiBeforeFeatureMerge: true,
      },
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.subtasks[0]).toMatchObject({
      status: "RUNNING",
      merge_indicator: "CI",
      is_merged: false,
    });
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", {
      status: "in_progress",
      isMerged: false,
      mergeIndicator: "CI",
    });
  });
});
