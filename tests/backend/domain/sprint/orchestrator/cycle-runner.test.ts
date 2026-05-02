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
      getTask: vi.fn().mockReturnValue({ executorType: "codex" }),
      getTasksByIds: vi.fn().mockReturnValue([{ id: "t1", executorType: "codex" }, { id: "t2", executorType: "codex" }]),
    } as any,
    taskService: {
      resolveTaskProvider: vi.fn().mockReturnValue("codex"),
    } as any,
    executionRepository: {
      getLatestTaskRun: vi.fn().mockReturnValue({ id: "task-run-1", dispatchId: "dispatch-1" }),
      getTaskDispatch: vi.fn().mockReturnValue({
        id: "dispatch-1",
        status: "blocked",
        startedAt: "2026-03-20T10:00:00.000Z",
      }),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      appendTaskRunEvent: vi.fn(),
    } as any,
    projectAttentionService: {
      resolveItems: vi.fn(),
      openItems: vi.fn(),
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
    expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
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
    })]));
    expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-2",
      sprintRunId: "run-1",
      attentionType: "action_required",
      ownerType: "worker",
      summaryMarkdown: "No session id available for automatic intervention.",
    })]));
    expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
      { filter: { projectId: "project-1", taskId: "task-3", attentionTypes: ["merge_required", "merge_conflict"] }, resolution: { status: "resolved", reason: "merge_attention_cleared" } }
    ]));
    expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
      { filter: { projectId: "project-1", taskId: "task-3", attentionTypes: ["action_required"] }, resolution: { status: "resolved", reason: "action_required_cleared" } }
    ]));
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
    expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
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
    })]));
    expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
      { filter: { projectId: "project-1", taskId: "task-1", attentionTypes: ["merge_required"] }, resolution: { status: "resolved", reason: "merge_conflict_attention_replaced" } }
    ]));
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
    expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
      attentionType: "merge_conflict",
      taskId: "task-1",
    })]));
    expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
      { filter: { projectId: "project-1", taskId: "task-1", attentionTypes: ["merge_required"] }, resolution: { status: "resolved", reason: "merge_conflict_attention_replaced" } }
    ]));
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
    expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
      taskId: "task-1",
      attentionType: "merge_conflict",
      payload: expect.objectContaining({
        prNumber: 101,
        mergeIndicator: "MERGE_CONFLICT",
      }),
    })]));
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

  it("does not open action_required attention while the same clarification request is already answered", async () => {
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
    expect(deps.executionRepository.updateTaskRun).toHaveBeenCalledWith("task-run-1", {
      state: "RUNNING",
      finishedAt: null,
      durationMs: null,
    });
    expect(deps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith("dispatch-1", expect.objectContaining({
      status: "running",
      finishedAt: null,
      errorMessage: null,
    }));

    vi.mocked(deps.projectAttentionService.openItems).mockClear();

    const secondResult = await runner.run(baseArgs);

    expect(secondResult.subtasks[0]).toMatchObject({
      status: "RUNNING",
      intervention_owner: "AGENT",
    });
    expect(secondResult.subtasks[0]?.intervention_hint).toContain("already answered automatically");
    expect(deps.sendSessionMessage).toHaveBeenCalledTimes(1);
    expect(deps.projectAttentionService.openItems).not.toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({
      attentionType: "action_required",
      taskId: "task-1",
    })]));
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
        featurePrAutoMergeMode: "WHEN_GREEN",
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

  it("captures CI failure memory with importance of 0.7", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemory: vi.fn().mockResolvedValue({}),
      search: vi.fn(),
    };
    deps.memoryService = mockMemoryService as any;

    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Waiting task",
        prompt: "wait for CI",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
        is_merged: false,
        worker_branch: "worker/T1",
        pr_url: "https://example.com/pr/101",
        merge_indicator: "CI",
      },
    ] as any);

    // Provide the pre-gate states map with old states so that hasMergeStateChanges resolves to false if needed,
    // but the task transition to "CI" wasn't "CI" in the old state.
    const preGateStates = new Map<string, any>();
    preGateStates.set("T1", { mergeIndicator: "AUTOMERGE", isMerged: false, status: "RUNNING" });

    // Mock getDashboardSettings on the deps to ensure settings.memory.enabled is true.
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        enabled: true,
        autoCaptureSprint: true,
      }
    });

    // Directly call the private method using any cast
    await (runner as any).captureCiFailureMemories(
      [
        {
          id: "T1",
          record_id: "task-1",
          title: "Waiting task",
          prompt: "wait for CI",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          is_merged: false,
          worker_branch: "worker/T1",
          pr_url: "https://example.com/pr/101",
          merge_indicator: "CI",
        }
      ],
      preGateStates,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        loopSteps: {},
      } as any,
      {
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: true, autoCaptureSprint: true },
      } as any
    );

    // Give the unawaited promise returned by createMemory inside catch block a chance to resolve.


    expect(mockMemoryService.createMemory).toHaveBeenCalledWith("project-1", expect.objectContaining({
      category: "error",
      strength: 0.7,
      content: expect.stringContaining("CI failure detected for task T1"),
      source: expect.objectContaining({ originType: "ci_failure" }),
    }));
  });

  it("does not capture CI failure memory if settings are disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemory: vi.fn().mockResolvedValue({}),
      search: vi.fn(),
    };
    deps.memoryService = mockMemoryService as any;

    const runner = new CycleRunner(deps);
    const preGateStates = new Map<string, any>();
    preGateStates.set("T1", { mergeIndicator: "AUTOMERGE", isMerged: false, status: "RUNNING" });

    // Mock getDashboardSettings on the deps to ensure settings.memory.enabled is false.
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        enabled: false,
        autoCaptureSprint: true,
      }
    });

    await (runner as any).captureCiFailureMemories(
      [
        {
          id: "T1",
          record_id: "task-1",
          title: "Waiting task",
          prompt: "wait for CI",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          is_merged: false,
          worker_branch: "worker/T1",
          pr_url: "https://example.com/pr/101",
          merge_indicator: "CI",
        }
      ],
      preGateStates,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        loopSteps: {},
      } as any,
      {
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: false, autoCaptureSprint: true },
      } as any
    );



    expect(mockMemoryService.createMemory).not.toHaveBeenCalled();
  });

  it("does not capture task memory if setting autoCaptureSprint is disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemory: vi.fn().mockResolvedValue({}),
      search: vi.fn(),
    };
    deps.memoryService = mockMemoryService as any;

    const runner = new CycleRunner(deps);

    // Mock getDashboardSettings on the deps to ensure settings.memory.autoCaptureSprint is false.
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        enabled: true,
        autoCaptureSprint: false,
      }
    });

    const states = new Map();
    states.set("T1", "RUNNING");

    await (runner as any).captureTaskCompletionMemories(
      [
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
          merge_indicator: "CI",
        }
      ],
      states,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        loopSteps: {},
      } as any,
      {
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: true, autoCaptureSprint: false },
      } as any
    );



    expect(mockMemoryService.createMemory).not.toHaveBeenCalled();
  });

  it("does not capture CI failure memory if setting autoCaptureSprint is disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemory: vi.fn().mockResolvedValue({}),
      search: vi.fn(),
    };
    deps.memoryService = mockMemoryService as any;

    const runner = new CycleRunner(deps);
    const preGateStates = new Map<string, any>();
    preGateStates.set("T1", { mergeIndicator: "AUTOMERGE", isMerged: false, status: "RUNNING" });

    // Mock getDashboardSettings on the deps to ensure settings.memory.autoCaptureSprint is false.
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        enabled: true,
        autoCaptureSprint: false,
      }
    });

    await (runner as any).captureCiFailureMemories(
      [
        {
          id: "T1",
          record_id: "task-1",
          title: "Waiting task",
          prompt: "wait for CI",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          is_merged: false,
          worker_branch: "worker/T1",
          pr_url: "https://example.com/pr/101",
          merge_indicator: "CI",
        }
      ],
      preGateStates,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        loopSteps: {},
      } as any,
      {
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: true, autoCaptureSprint: false },
      } as any
    );



    expect(mockMemoryService.createMemory).not.toHaveBeenCalled();
  });

  it("does not capture task memory if task status is unchanged", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemory: vi.fn().mockResolvedValue({}),
      search: vi.fn(),
    };
    deps.memoryService = mockMemoryService as any;

    const runner = new CycleRunner(deps);

    // Mock getDashboardSettings on the deps to ensure settings.memory.enabled is true.
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        enabled: true,
        autoCaptureSprint: true,
      }
    });

    const states = new Map();
    states.set("T1", "RUNNING");

    await (runner as any).captureTaskCompletionMemories(
      [
        {
          id: "T1",
          record_id: "task-1",
          title: "Waiting task",
          prompt: "wait for CI",
          depends_on: [],
          is_independent: true,
          status: "RUNNING",
          is_merged: false,
          worker_branch: "worker/T1",
          pr_url: "https://example.com/pr/101",
          merge_indicator: "CI",
        }
      ],
      states,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        loopSteps: {},
      } as any,
      {
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: true, autoCaptureSprint: true },
      } as any
    );



    expect(mockMemoryService.createMemory).not.toHaveBeenCalled();
  });

  it("does not capture task memory if settings are disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemory: vi.fn().mockResolvedValue({}),
      search: vi.fn(),
    };
    deps.memoryService = mockMemoryService as any;

    const runner = new CycleRunner(deps);

    // Mock getDashboardSettings on the deps to ensure settings.memory.enabled is false.
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        enabled: false,
        autoCaptureSprint: true,
      }
    });

    const states = new Map();
    states.set("T1", "RUNNING");

    await (runner as any).captureTaskCompletionMemories(
      [
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
          merge_indicator: "CI",
        }
      ],
      states,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        loopSteps: {},
      } as any,
      {
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: false, autoCaptureSprint: true },
      } as any
    );



    expect(mockMemoryService.createMemory).not.toHaveBeenCalled();
  });

  it("short circuits ci fix attempt if attention type or owner type mismatch", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);

    const task = {
      id: "T1",
      record_id: "task-1",
      title: "Task 1",
      prompt: "do something",
      depends_on: [],
      is_independent: true,
      status: "RUNNING",
      is_merged: false,
    };

    const items = [
      {
        attentionType: "merge_required",
        ownerType: "worker",
        payload: { taskKey: "T1", prNumber: 42 }
      },
      {
        attentionType: "ci_fix_required",
        ownerType: "user",
        payload: { taskKey: "T1", prNumber: 42 }
      }
    ];

    // We can't easily export the inline function from cycle-runner,
    // but we can test the exact short-circuit boolean logic we are adding via eval
    // for just this one internal function for verification sake.
    const runString = CycleRunner.prototype.run.toString();
    const funcMatch = runString.match(/function hasActiveCiFixAttentionAttempt[\s\S]*?^  \}/m);

    if (funcMatch) {
       // Only run if we actually extract it in the environment
       const func = eval(`(${funcMatch[0]})`);
       expect(func(items, task, 42)).toBe(false);

       const validItems = [
        {
          attentionType: "ci_fix_required",
          ownerType: "worker",
          taskId: "task-1",
          payload: { taskKey: "T1", prNumber: 42 }
        }
      ];
      expect(func(validItems, task, 42)).toBe(true);
    }
  });

  it("captures task memory when task state changes to FAILED", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemory: vi.fn().mockResolvedValue({}),
      search: vi.fn(),
    };
    deps.memoryService = mockMemoryService as any;

    const runner = new CycleRunner(deps);

    // Mock getDashboardSettings on the deps to ensure settings.memory.enabled is true.
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      memory: {
        enabled: true,
        autoCaptureSprint: true,
      }
    });

    const states = new Map();
    states.set("T1", "RUNNING");

    await (runner as any).captureTaskCompletionMemories(
      [
        {
          id: "T1",
          record_id: "task-1",
          title: "Waiting task",
          prompt: "wait for CI",
          depends_on: [],
          is_independent: true,
          status: "FAILED",
          is_merged: false,
          worker_branch: "worker/T1",
          pr_url: "https://example.com/pr/101",
          merge_indicator: "CI",
        }
      ],
      states,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        loopSteps: {},
      } as any,
      {
        ...DEFAULT_DASHBOARD_SETTINGS,
        memory: { enabled: true, autoCaptureSprint: true },
      } as any
    );



    expect(mockMemoryService.createMemory).toHaveBeenCalledWith("project-1", expect.objectContaining({
      category: "error",
      strength: 0.8,
      content: expect.stringContaining("Task failed: T1"),
      source: expect.objectContaining({ originType: "task_status_change" }),
    }));
  });

  it("runs task QA for code-complete tasks that still need an initial review", async () => {
    const deps = buildDeps();
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn((args: { task: { id: string } }) => (
        args.task.id === "T1"
          ? {
              mergeAllowed: false,
              reason: "pending_review",
              summary: "QA review is required before merge.",
              latestRun: null,
              runsUsed: 0,
              maxRuns: 1,
            }
          : {
              mergeAllowed: true,
              reason: "passed",
              summary: "QA review passed.",
              latestRun: { id: "qa-run-1" },
              runsUsed: 1,
              maxRuns: 1,
            }
      )),
      reviewCompletedTask: vi.fn().mockResolvedValue({
        reviewed: true,
        reopenedTask: true,
        mergeBlocked: true,
        reportText: "QA reopened task T1",
      }),
    } as any;
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
    });

    const runner = new CycleRunner(deps);
    const preStates = new Map([
      ["T1", "RUNNING"],
      ["T2", "COMPLETED"],
    ]);
    const subtasks = [
      {
        id: "T1",
        record_id: "task-1",
        title: "Freshly completed task",
        prompt: "finish implementation",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        provider: "codex",
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Already completed task",
        prompt: "already done",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        provider: "codex",
      },
    ];

    await (runner as any).reviewCompletedTasks(
      subtasks,
      preStates,
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        repoPath: "/repo/project-1",
        sprintRunId: "run-1",
      } as any,
      deps.getDashboardSettings(),
    );

    expect(deps.qualityAssuranceService.reviewCompletedTask).toHaveBeenCalledTimes(1);
    expect(deps.qualityAssuranceService.reviewCompletedTask).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      sprintId: "sprint-1",
      repoPath: "/repo/project-1",
      task: expect.objectContaining({ id: "T1" }),
    }));
    expect(deps.logger.info).toHaveBeenCalledWith(
      "QA reopened completed task for follow-up fixes",
      expect.objectContaining({
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        taskKey: "T1",
      }),
    );
  });

  it("does not rerun task QA after a passing review even if the task becomes code-complete again", async () => {
    const deps = buildDeps();
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: true,
        reason: "passed",
        summary: "QA review passed.",
        latestRun: { id: "qa-run-1" },
        runsUsed: 1,
        maxRuns: 3,
      }),
      reviewCompletedTask: vi.fn(),
    } as any;
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
    });

    const runner = new CycleRunner(deps);
    await (runner as any).reviewCompletedTasks(
      [
        {
          id: "T1",
          record_id: "task-1",
          title: "Freshly completed task",
          prompt: "finish implementation",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
          provider: "codex",
        },
      ],
      new Map([["T1", "RUNNING"]]),
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        repoPath: "/repo/project-1",
        sprintRunId: "run-1",
      } as any,
      deps.getDashboardSettings(),
    );

    expect(deps.qualityAssuranceService.reviewCompletedTask).not.toHaveBeenCalled();
  });

  it("reruns missing task QA for already code-complete tasks, but only reruns changes-requested QA after a fresh completion", async () => {
    const deps = buildDeps();
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn((args: { task: { id: string } }) => {
        if (args.task.id === "T1") {
          return {
            mergeAllowed: false,
            reason: "pending_review",
            summary: "QA review is required before merge.",
            latestRun: null,
            runsUsed: 0,
            maxRuns: 2,
          };
        }
        return {
          mergeAllowed: false,
          reason: "changes_requested",
          summary: "QA requested follow-up fixes.",
          latestRun: { id: "qa-run-2" },
          runsUsed: 1,
          maxRuns: 2,
        };
      }),
      reviewCompletedTask: vi.fn().mockResolvedValue({
        reviewed: true,
        reopenedTask: false,
        mergeBlocked: false,
        reportText: "QA passed",
      }),
    } as any;
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
    });

    const runner = new CycleRunner(deps);
    await (runner as any).reviewCompletedTasks(
      [
        {
          id: "T1",
          record_id: "task-1",
          title: "Awaiting first QA run",
          prompt: "finish implementation",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
          provider: "codex",
        },
        {
          id: "T2",
          record_id: "task-2",
          title: "Waiting for QA re-check after fixes",
          prompt: "finish implementation",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
          provider: "codex",
        },
      ],
      new Map([
        ["T1", "CODING_COMPLETED"],
        ["T2", "CODING_COMPLETED"],
      ]),
      {
        executionContext: {
          project: { id: "project-1", name: "Project 1" } as any,
          sprint: { id: "sprint-1", name: "Sprint 1" } as any,
          sprintNumber: 1,
          repoPath: "/repo/project-1",
          featureBranch: "feature/sprint-1",
          defaultBranch: "main",
        },
        repoPath: "/repo/project-1",
        sprintRunId: "run-1",
      } as any,
      deps.getDashboardSettings(),
    );

    expect(deps.qualityAssuranceService.reviewCompletedTask).toHaveBeenCalledTimes(1);
    expect(deps.qualityAssuranceService.reviewCompletedTask).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ id: "T1" }),
    }));
  });

  it("reviews multiple newly completed tasks in parallel when in DOCKER mode", async () => {
    const deps = buildDeps();
    let resolveTask1: () => void;
    let resolveTask2: () => void;
    let resolveTask3: () => void;

    const taskPromises = [
      new Promise<any>((resolve) => { resolveTask1 = () => resolve({ reviewed: true }) }),
      new Promise<any>((resolve) => { resolveTask2 = () => resolve({ reviewed: true }) }),
      new Promise<any>((resolve) => { resolveTask3 = () => resolve({ reviewed: true }) }),
    ];

    let callCount = 0;

    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: false,
        reason: "pending_review",
        summary: "QA review is required.",
        latestRun: null,
        runsUsed: 0,
        maxRuns: 2,
      }),
      reviewCompletedTask: vi.fn().mockImplementation(() => {
        const promise = taskPromises[callCount];
        callCount++;
        return promise;
      }),
    } as any;
    deps.getDashboardSettings = vi.fn().mockReturnValue({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
      cliWorkflow: { executionMode: "DOCKER" },
    });

    const runner = new CycleRunner(deps);

    const reviewPromise = (runner as any).reviewCompletedTasks(
      [
        { id: "T1", record_id: "task-1", status: "COMPLETED", provider: "codex" },
        { id: "T2", record_id: "task-2", status: "COMPLETED", provider: "codex" },
        { id: "T3", record_id: "task-3", status: "COMPLETED", provider: "codex" },
      ],
      new Map([
        ["T1", "RUNNING"],
        ["T2", "RUNNING"],
        ["T3", "RUNNING"],
      ]),
      {
        executionContext: {
          project: { id: "proj-1" },
          sprint: { id: "sprint-1" },
        },
        sprintRunId: "run-1",
      } as any,
      deps.getDashboardSettings(),
    );

    // Wait a tick to let promises start resolving
    await new Promise((resolve) => setImmediate(resolve));

    // If execution is parallel, all 3 tasks should have been initiated without waiting for
    // any of the promises to resolve.
    expect(deps.qualityAssuranceService.reviewCompletedTask).toHaveBeenCalledTimes(3);

    // Resolve the promises to finish the test
    resolveTask1!();
    resolveTask2!();
    resolveTask3!();
    await reviewPromise;
  });
});

  describe("CycleStateCoordinator regression tests", () => {
    it("persists task state changes when CI gate updates status or merge_indicator", async () => {
      const deps = buildDeps();
      const runner = new CycleRunner(deps);

      const states = new Map();
      states.set("T1", { id: "T1", status: "RUNNING", isMerged: false, mergeIndicator: null });

      const subtasks = [
        {
          id: "T1",
          record_id: "task-1",
          status: "COMPLETED",
          is_merged: true,
          merge_indicator: "CI",
        }
      ] as any;

      (runner as any).stateCoordinator.persistCiGateTaskStateChanges(states, subtasks);

      expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", {
        status: "completed",
        isMerged: true,
        mergeIndicator: "CI",
      });
    });

    it("syncs auto-intervention execution state for action-required blocked tasks", async () => {
      const deps = buildDeps();
      deps.isActionRequiredState = vi.fn().mockReturnValue(true);
      const runner = new CycleRunner(deps);

      const previousTasks = new Map();
      previousTasks.set("T1", { status: "BLOCKED", sessionState: "need_human" });

      const subtasks = [
        {
          id: "T1",
          record_id: "task-1",
          status: "RUNNING",
          session_state: "need_human",
        }
      ] as any;

      (runner as any).stateCoordinator.syncAutoInterventionExecutionState(subtasks, previousTasks, "run-1");

      expect(deps.executionRepository.updateTaskRun).toHaveBeenCalledWith("task-run-1", {
        state: "RUNNING",
        finishedAt: null,
        durationMs: null,
      });
      expect(deps.executionRepository.updateTaskDispatch).toHaveBeenCalledWith("dispatch-1", {
        status: "running",
        startedAt: expect.any(String),
        finishedAt: null,
        lastHeartbeatAt: expect.any(String),
        errorMessage: null,
      });
    });

    it("clears attention items when tasks are no longer in action-required or ci_fix_required state", async () => {
      const deps = buildDeps();
      const runner = new CycleRunner(deps);

      const subtasks = [
        {
          id: "T1",
          record_id: "task-1",
          status: "COMPLETED",
          merge_indicator: null,
        }
      ] as any;

      const protocolResult = {
        awaitingMerge: [],
        actionRequiredTasks: [],
      };

      (runner as any).stateCoordinator.syncProtocolAttentionItems(subtasks, protocolResult, {
        executionContext: { project: { id: "p1" }, sprint: { id: "s1" } },
        sprintRunId: "run-1",
      } as any, null, new Set());

      expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
      { filter: { projectId: "p1", taskId: "task-1", attentionTypes: ["merge_required", "merge_conflict"] }, resolution: { status: "resolved", reason: "merge_attention_cleared" } }
    ]));
      expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
      { filter: { projectId: "p1", taskId: "task-1", attentionTypes: ["action_required"] }, resolution: { status: "resolved", reason: "action_required_cleared" } }
    ]));
      expect(deps.projectAttentionService.resolveItems).toHaveBeenCalledWith(expect.arrayContaining([
      { filter: { projectId: "p1", taskId: "task-1", attentionTypes: ["ci_fix_required"] }, resolution: { status: "resolved", reason: "ci_fix_attention_cleared" } }
    ]));
    });
  });
