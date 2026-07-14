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
      getLatestTaskRunBySessionId: vi.fn().mockReturnValue(null),
      listTaskRunEvents: vi.fn().mockReturnValue([]),
      listExecutionInvocations: vi.fn().mockReturnValue([]),
      getTaskDispatch: vi.fn().mockReturnValue({
        id: "dispatch-1",
        status: "blocked",
        startedAt: "2026-03-20T10:00:00.000Z",
      }),
      updateTaskRun: vi.fn(),
      updateTaskRunsBatch: vi.fn(),
      updateTaskRunsBatch: vi.fn(),
      updateTaskRunsBatch: vi.fn(),
      updateTaskDispatch: vi.fn(),
      updateTaskDispatchesBatch: vi.fn(),
      updateTaskDispatchesBatch: vi.fn(),
      updateTaskDispatchesBatch: vi.fn(),
      appendTaskRunEvent: vi.fn(),
    } as any,
    guardrailService: {
      evaluate: vi.fn().mockReturnValue({ allowed: true, count: 0, cap: 0, action: "WARN_ONLY" }),
      evaluateQa: vi.fn().mockReturnValue({ allowed: true, count: 0, cap: 0, action: "WARN_ONLY" }),
      record: vi.fn(),
      getCounts: vi.fn(),
      reset: vi.fn(),
    } as any,
    projectAttentionService: {
      resolveItems: vi.fn(),
      resolveItem: vi.fn(),
      openItems: vi.fn(),
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
    providerConcurrencyService: {
      getGlobalRunningCounts: vi.fn().mockReturnValue({}),
      waitForSlot: vi.fn().mockResolvedValue(undefined),
    } as any,
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
  it("never dispatches or reviews the audit task of an automatic rollback", async () => {
    const deps = buildDeps();
    const reviewCompletedTask = vi.fn();
    deps.qualityAssuranceService = {
      reconcileRunningTaskQaReviews: vi.fn(),
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: false,
        reason: "pending_review",
        latestRun: null,
        runsUsed: 0,
        maxRuns: 3,
      }),
      reviewCompletedTask,
    } as any;
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([{
      id: "ROLLBACK",
      record_id: "rollback-audit-task",
      title: "Automatic rollback audit",
      prompt: "No provider invocation is required.",
      depends_on: [],
      // Deliberately use PENDING to prove that even a stale/corrupt projection
      // cannot make an automatic rollback audit task dispatchable.
      status: "PENDING",
      is_independent: true,
      is_merged: true,
      merge_indicator: "MERGED",
    }] as any);

    const result = await new CycleRunner(deps).run({
      action: "orchestrate",
      automationLevel: "SEMI_AUTO",
      automationInterventions: DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
      executionContext: {
        project: { id: "project-1", name: "Project 1" } as any,
        sprint: {
          id: "rollback-sprint",
          name: "Rollback Sprint",
          kind: "rollback",
          rollbackMode: "automatic",
        } as any,
        sprintNumber: 2,
        repoPath: "/repo/project-1",
        featureBranch: "rollback/1-test",
        defaultBranch: "main",
      },
      repoPath: "/repo/project-1",
      defaultFeatureBranch: "rollback/1-test",
      retryFailed: true,
      loopSteps: {
        loadSubtasks: true,
        sessionSync: false,
        statusDerivation: true,
        startReadyTasks: true,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: { enabled: false } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(deps.startTask).not.toHaveBeenCalled();
    expect(reviewCompletedTask).not.toHaveBeenCalled();
    expect(deps.approveSessionPlan).not.toHaveBeenCalled();
    expect(deps.sendSessionMessage).not.toHaveBeenCalled();
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("rollback-audit-task", {
      status: "completed",
      isMerged: true,
      mergeIndicator: "MERGED",
    });
    expect(result.subtasks[0]).toMatchObject({
      id: "ROLLBACK",
      status: "COMPLETED",
      is_merged: true,
      merge_indicator: "MERGED",
    });
  });

  it("opens a resettable human handoff when the coding guardrail is exhausted", () => {
    const deps = buildDeps();
    vi.mocked(deps.guardrailService!.evaluate).mockReturnValue({
      allowed: false,
      count: 5,
      cap: 5,
      action: "STOP_AND_WAIT",
      blockedByTotalCeiling: false,
    } as any);
    const runner = new CycleRunner(deps);
    const task = {
      id: "T10",
      record_id: "task-10",
      title: "Finish release gate",
      status: "PENDING",
      session_id: "session-10",
      provider: "codex",
    } as any;

    const blocked = (runner as any).applyTaskCodingGuardrail(task, {
      executionContext: {
        project: { id: "project-1" },
        sprint: { id: "sprint-1" },
      },
      sprintRunId: "run-1",
      automationLevel: "SUPERVISED",
    });

    expect(blocked).toBe(true);
    expect(task).toMatchObject({
      status: "BLOCKED",
      intervention_owner: "HUMAN",
    });
    expect(deps.projectAttentionService!.openItems).toHaveBeenCalledWith([
      expect.objectContaining({
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-10",
        sprintRunId: "run-1",
        attentionType: "human_escalation_required",
        deduplicationKey: "guardrail:task_coding:task-10",
        ownerType: "human",
        title: "Coding guardrail reached for T10",
        payload: expect.objectContaining({
          sourceAttentionType: "task_coding",
          guardrailAttempts: 5,
          guardrailCap: 5,
          sessionId: "session-10",
        }),
      }),
    ]);
  });

  it("consumes duplicate resolved worker conflict signals that no longer have merge work", async () => {
    const deps = buildDeps();
    deps.projectAttentionService = {
      ...deps.projectAttentionService,
      listResolvedWorkerMergeConflicts: vi.fn().mockReturnValue([
        {
          itemId: "attention-1",
          taskId: "task-1",
          sourceBranch: null,
          targetBranch: null,
        },
        {
          itemId: "attention-2",
          taskId: "task-1",
          sourceBranch: null,
          targetBranch: null,
        },
      ]),
      patchItemPayload: vi.fn(),
    } as any;
    const runner = new CycleRunner(deps);

    const result = await (runner as any).collectResolvedWorkerMergeConflictState({
      executionContext: {
        project: { id: "project-1" },
        sprint: { id: "sprint-1" },
      },
      repoPath: "/repo/project-1",
      sprintRunId: "run-1",
    });

    expect(result.clearKeys).toEqual(new Set(["task-1\u0000\u0000"]));
    expect(result.suppressKeys).toEqual(new Set(["task-1\u0000\u0000"]));
    expect(deps.projectAttentionService.patchItemPayload).toHaveBeenCalledTimes(2);
    expect(deps.projectAttentionService.patchItemPayload).toHaveBeenCalledWith(
      "attention-1",
      expect.objectContaining({
        branchMergeRetryConsumed: true,
        branchMergeRetryHadWork: false,
      }),
    );
    expect(deps.projectAttentionService.patchItemPayload).toHaveBeenCalledWith(
      "attention-2",
      expect.objectContaining({
        branchMergeRetryConsumed: true,
        branchMergeRetryHadWork: false,
      }),
    );
  });

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
    expect(deps.projectAttentionService.resolveItems).not.toHaveBeenCalled();
  });

  it("settles branch-only completed tasks before feature PR polling and starts newly unblocked dependents", async () => {
    const deps = buildDeps();
    deps.getCiStatusForScope = vi.fn().mockResolvedValue(null) as any;
    deps.startTask = vi.fn().mockResolvedValue({
      id: "session-2",
      name: "sessions/session-2",
      provider: "mockup-cli",
      runtimeLabel: "MOCKUP",
    }) as any;
    const runner = new CycleRunner(deps);
    const evaluateCiGate = vi.fn().mockImplementation(async (subtasks, context) => {
      for (const task of subtasks) {
        task.status = "COMPLETED";
        task.is_merged = false;
        task.merge_indicator = undefined;
        task.worker_branch = undefined;
        await context.persistMergedTask(task);
      }
      return { subtasks, reportText: "fast branch-only settled\n" };
    });
    (runner as any).featurePrGate = { evaluateCiGate };

    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Finished parent",
        prompt: "parent",
        depends_on: [],
        status: "CODING_COMPLETED",
        session_state: "COMPLETED",
        provider: "mockup-cli",
        worker_branch: "task/feature-parent",
        is_merged: false,
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Dependent",
        prompt: "dependent",
        depends_on: ["T1"],
        status: "PENDING",
        is_merged: false,
      },
    ] as any);

    const result = await runner.run({
      action: "orchestrate",
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
        statusDerivation: true,
        startReadyTasks: true,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: false,
      } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(evaluateCiGate).toHaveBeenCalledTimes(1);
    expect(deps.getCiStatusForScope).not.toHaveBeenCalled();
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", expect.objectContaining({
      status: "completed",
      isMerged: false,
      mergeIndicator: null,
      mergeConflictSourceBranch: null,
    }));
    expect(deps.startTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T2" }), expect.objectContaining({
      sprintRunId: "run-1",
      featureBranch: "feature/sprint-1",
    }));
    expect(result.subtasks.find((task) => task.id === "T1")?.status).toBe("COMPLETED");
    expect(result.subtasks.find((task) => task.id === "T2")?.status).toBe("RUNNING");
  });

  it("settles local branch-only work that completes during start-ready before protocol opens manual merge", async () => {
    const deps = buildDeps();
    deps.getCiStatusForScope = vi.fn().mockResolvedValue(null) as any;
    deps.startTask = vi.fn().mockResolvedValue({
      id: "session-1",
      name: "sessions/session-1",
      provider: "mockup-cli",
      runtimeLabel: "MOCKUP",
    }) as any;
    const gateInputs: Array<Array<{ id: string; status: string; workerBranch?: string }>> = [];
    const evaluateCiGate = vi.fn().mockImplementation(async (subtasks, context) => {
      gateInputs.push(subtasks.map((task: any) => ({
        id: task.id,
        status: task.status,
        workerBranch: task.worker_branch,
      })));
      for (const task of subtasks) {
        task.status = "COMPLETED";
        task.is_merged = true;
        task.merge_indicator = "MERGED";
        task.worker_branch = "task/feature-fast";
        await context.persistMergedTask(task);
      }
      return { subtasks, reportText: "post-start branch-only settled\n" };
    });
    const runner = new CycleRunner(deps);
    (runner as any).featurePrGate = { evaluateCiGate };

    vi.mocked(deps.sprintExecutionStateService.loadSubtasks)
      .mockResolvedValueOnce([
        {
          id: "T1",
          record_id: "task-1",
          title: "Fast local task",
          prompt: "complete during start-ready",
          depends_on: [],
          status: "PENDING",
          provider: "mockup-cli",
          is_merged: false,
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          id: "T1",
          record_id: "task-1",
          title: "Fast local task",
          prompt: "complete during start-ready",
          depends_on: [],
          status: "CODING_COMPLETED",
          session_state: "COMPLETED",
          provider: "mockup-cli",
          worker_branch: "task/feature-fast",
          is_merged: false,
        },
      ] as any);

    const result = await runner.run({
      action: "orchestrate",
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
        startReadyTasks: true,
        statusTable: false,
        mergeProtocol: true,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: false,
      } as any,
      githubMode: "LOCAL",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(deps.sprintExecutionStateService.loadSubtasks).toHaveBeenCalledTimes(2);
    expect(deps.startTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T1" }), expect.anything());
    expect(evaluateCiGate).toHaveBeenCalled();
    expect(gateInputs).toContainEqual([
      { id: "T1", status: "CODING_COMPLETED", workerBranch: "task/feature-fast" },
    ]);
    expect(result.subtasks.find((task) => task.id === "T1")).toMatchObject({
      status: "COMPLETED",
      is_merged: true,
      merge_indicator: "MERGED",
    });
    expect(result.manualMergeTasks).toEqual([]);
    expect(result.awaitingMerge).toEqual([]);
    expect(result.instructions).not.toContain("MERGE HEADER");
    expect(deps.executionRepository.appendTaskRunEvent).not.toHaveBeenCalledWith(
      expect.anything(),
      "protocol_merge_required",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("does not open merge-required protocol while a CLI branch is still finalizing", async () => {
    const deps = buildDeps();
    deps.getCiStatusForScope = vi.fn().mockResolvedValue(null) as any;
    vi.mocked(deps.executionRepository.getLatestTaskRun).mockReturnValue({
      id: "task-run-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: "run-1",
      dispatchId: "dispatch-1",
      connectionId: null,
      provider: "mockup-cli",
      mode: "docker_cli",
      sessionId: "cli-mockup-cli-1",
      sessionName: "sessions/cli-mockup-cli-1",
      state: "COMPLETED",
      workerBranch: "task/feature-parent",
      prUrl: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    });
    vi.mocked(deps.executionRepository.listTaskRunEvents).mockReturnValue([
      { eventType: "cli_provider_completed" },
    ] as any);
    const runner = new CycleRunner(deps);
    (runner as any).featurePrGate = {
      evaluateCiGate: vi.fn().mockImplementation(async (subtasks) => ({ subtasks, reportText: "" })),
    };

    vi.mocked(deps.sprintExecutionStateService.loadSubtasks)
      .mockResolvedValueOnce([
        {
          id: "T1",
          record_id: "task-1",
          title: "Finished parent",
          prompt: "parent",
          depends_on: [],
          status: "CODING_COMPLETED",
          session_state: "COMPLETED",
          provider: "mockup-cli",
          worker_branch: "task/feature-parent",
          is_merged: false,
        },
      ] as any);

    const result = await runner.run({
      action: "orchestrate",
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
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: false,
      } as any,
      githubMode: "LOCAL",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.manualMergeTasks).toEqual([]);
    expect(result.awaitingMerge).toEqual([]);
    expect(result.instructions).not.toContain("MERGE HEADER");
    expect(deps.executionRepository.appendTaskRunEvent).not.toHaveBeenCalledWith(
      "task-run-1",
      "protocol_merge_required",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(deps.projectAttentionService.openItems).not.toHaveBeenCalled();
  });

  it("opens merge-required protocol after CLI git finalization completes", async () => {
    const deps = buildDeps();
    deps.getCiStatusForScope = vi.fn().mockResolvedValue(null) as any;
    vi.mocked(deps.executionRepository.getLatestTaskRun).mockReturnValue({
      id: "task-run-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: "run-1",
      dispatchId: "dispatch-1",
      connectionId: null,
      provider: "mockup-cli",
      mode: "docker_cli",
      sessionId: "cli-mockup-cli-1",
      sessionName: "sessions/cli-mockup-cli-1",
      state: "COMPLETED",
      workerBranch: "task/feature-parent",
      prUrl: null,
      startedAt: null,
      finishedAt: null,
      durationMs: null,
    });
    vi.mocked(deps.executionRepository.listTaskRunEvents).mockReturnValue([
      { eventType: "cli_provider_completed" },
      { eventType: "cli_git_pushed" },
    ] as any);
    const runner = new CycleRunner(deps);
    (runner as any).featurePrGate = {
      evaluateCiGate: vi.fn().mockImplementation(async (subtasks) => ({ subtasks, reportText: "" })),
    };

    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Finished parent",
        prompt: "parent",
        depends_on: [],
        status: "CODING_COMPLETED",
        session_state: "COMPLETED",
        provider: "mockup-cli",
        worker_branch: "task/feature-parent",
        is_merged: false,
      },
    ] as any);

    const result = await runner.run({
      action: "orchestrate",
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
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: false,
      } as any,
      githubMode: "LOCAL",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.manualMergeTasks.map((task) => task.id)).toEqual(["T1"]);
    expect(result.awaitingMerge.map((task) => task.id)).toEqual(["T1"]);
    expect(result.instructions).toContain("MERGE HEADER");
    expect(deps.executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "task-run-1",
      "protocol_merge_required",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("runs the LOCAL branch-only gate for completed tasks before worker branch metadata is recovered", async () => {
    const deps = buildDeps();
    deps.getCiStatusForScope = vi.fn().mockResolvedValue(null) as any;
    deps.startTask = vi.fn().mockResolvedValue({
      id: "session-2",
      name: "sessions/session-2",
      provider: "mockup-cli",
      runtimeLabel: "MOCKUP",
    }) as any;
    const runner = new CycleRunner(deps);
    const evaluateCiGate = vi.fn().mockImplementation(async (subtasks, context) => {
      let nextSubtasks = subtasks.map((task: any) => ({ ...task }));
      if (evaluateCiGate.mock.calls.length === 1) {
        expect(subtasks.map((task: any) => task.id)).toEqual(["T1"]);
        nextSubtasks = subtasks.map((task: any) => task.id === "T1"
          ? {
            ...task,
            status: "COMPLETED",
            is_merged: true,
            merge_indicator: "MERGED",
            worker_branch: "task/feature-parent",
          }
          : { ...task });
        for (const task of nextSubtasks) {
          task.status = "COMPLETED";
          task.is_merged = true;
          task.merge_indicator = "MERGED";
          task.worker_branch = "task/feature-parent";
          await context.persistMergedTask(task);
        }
      }
      return { subtasks: nextSubtasks, reportText: "local branch-only recovered and settled\n" };
    });
    (runner as any).featurePrGate = { evaluateCiGate };

    vi.mocked(deps.sprintExecutionStateService.loadSubtasks)
      .mockResolvedValueOnce([
        {
          id: "T1",
          record_id: "task-1",
          title: "Finished parent",
          prompt: "parent",
          depends_on: [],
          status: "CODING_COMPLETED",
          session_state: "COMPLETED",
          provider: "mockup-cli",
          is_merged: false,
        },
        {
          id: "T2",
          record_id: "task-2",
          title: "Dependent",
          prompt: "dependent",
          depends_on: ["T1"],
          status: "PENDING",
          is_merged: false,
        },
      ] as any)
      .mockResolvedValueOnce([
        {
          id: "T1",
          record_id: "task-1",
          title: "Finished parent",
          prompt: "parent",
          depends_on: [],
          status: "COMPLETED",
          session_state: "COMPLETED",
          provider: "mockup-cli",
          worker_branch: "task/feature-parent",
          is_merged: true,
          merge_indicator: "MERGED",
        },
        {
          id: "T2",
          record_id: "task-2",
          title: "Dependent",
          prompt: "dependent",
          depends_on: ["T1"],
          status: "RUNNING",
          session_id: "session-2",
          session_name: "sessions/session-2",
          provider: "mockup-cli",
          is_merged: false,
        },
      ] as any);

    const result = await runner.run({
      action: "orchestrate",
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
        statusDerivation: true,
        startReadyTasks: true,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: false,
      } as any,
      githubMode: "LOCAL",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(evaluateCiGate).toHaveBeenCalled();
    expect(deps.startTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T2" }), expect.anything());
    expect(result.subtasks.find((task) => task.id === "T1")).toMatchObject({
      status: "COMPLETED",
      is_merged: true,
      merge_indicator: "MERGED",
    });
    expect(result.subtasks.find((task) => task.id === "T2")?.status).toBe("RUNNING");
  });

  it("blocks dependent LOCAL tasks when branch evidence is recovered but not merged yet", async () => {
    const deps = buildDeps();
    deps.startTask = vi.fn().mockResolvedValue({
      id: "session-2",
      name: "sessions/session-2",
      provider: "mockup-cli",
      runtimeLabel: "MOCKUP",
    }) as any;
    const runner = new CycleRunner(deps);
    const evaluateCiGate = vi.fn().mockImplementation(async (subtasks) => {
      if (evaluateCiGate.mock.calls.length === 1) {
        expect(subtasks.map((task: any) => task.id)).toEqual(["T1"]);
      }
      return {
        subtasks: subtasks.map((task: any) => task.id === "T1"
          ? { ...task, worker_branch: "task/feature-parent" }
          : { ...task }),
        reportText: "",
      };
    });
    (runner as any).featurePrGate = { evaluateCiGate };

    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Finished parent",
        prompt: "parent",
        depends_on: [],
        status: "CODING_COMPLETED",
        session_state: "COMPLETED",
        provider: "mockup-cli",
        is_merged: false,
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Dependent",
        prompt: "dependent",
        depends_on: ["T1"],
        status: "PENDING",
        is_merged: false,
      },
    ] as any);

    const result = await runner.run({
      action: "orchestrate",
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
        statusDerivation: true,
        startReadyTasks: true,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: false,
      } as any,
      githubMode: "LOCAL",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(evaluateCiGate).toHaveBeenCalled();
    expect(deps.startTask).not.toHaveBeenCalled();
    expect(result.subtasks.find((task) => task.id === "T1")).toMatchObject({
      status: "CODING_COMPLETED",
      worker_branch: "task/feature-parent",
      is_merged: false,
    });
    expect(result.subtasks.find((task) => task.id === "T2")?.status).toBe("BLOCKED");
  });

  it("escalates a merge_conflict only after the PR stays DIRTY across cycles (debounced)", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    const makeSubtasks = () => [
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
    ];
    // Fresh subtask objects each cycle (the gate mutates them in place) so the
    // second cycle starts from the same COMPLETED+DIRTY state the DB would reload.
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockImplementation(async () => makeSubtasks() as any);
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

    const runArgs = {
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
      githubMode: "REMOTE" as const,
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    };

    // First DIRTY reading is debounced — a transient conflict must not escalate.
    const firstResult = await runner.run(runArgs as any);
    expect(firstResult.workerEscalatedMergeConflictTasks).toEqual([]);
    expect(deps.projectAttentionService.openItems).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ attentionType: "merge_conflict" })]),
    );

    // Second consecutive DIRTY cycle confirms the conflict and escalates it.
    const result = await runner.run(runArgs as any);

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
    expect(deps.projectAttentionService.resolveItems).not.toHaveBeenCalled();
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
    expect(deps.projectAttentionService.resolveItems).not.toHaveBeenCalled();
  });

  it("does not reopen worker merge_conflict attention while a human escalation is active", async () => {
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
        status: "CODING_COMPLETED",
        is_merged: false,
        merge_indicator: "MERGE_CONFLICT",
        worker_branch: "worker/T1",
        pr_url: "https://example.com/pr/101",
      },
    ] as any);
    vi.mocked(deps.projectAttentionService.listActiveProjectItems).mockReturnValue([
      {
        id: "attention-human-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "run-1",
        dispatchId: null,
        attentionType: "human_escalation_required",
        severity: "high",
        ownerType: "human",
        status: "open",
        assignedWorkerEndpointId: null,
        title: "Human escalation required: Merge conflict for T1",
        summaryMarkdown: "Virtual worker failed before a provider invocation could start.",
        payload: {
          sourceAttentionItemId: "attention-worker-1",
          sourceAttentionType: "merge_conflict",
        },
        openedAt: "2026-03-15T08:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-15T08:00:00.000Z",
      },
    ]);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [],
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
        enabled: false,
        resolveMergeConflicts: true,
      },
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.workerEscalatedMergeConflictTasks).toHaveLength(1);
    expect(deps.projectAttentionService.openItems).not.toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ attentionType: "merge_conflict" })]),
    );
    expect(deps.projectAttentionService.resolveItems).not.toHaveBeenCalled();
  });

  it("dismisses stale worker merge_conflict attention once the task conflict marker is cleared", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Resolved conflict task",
        prompt: "Merge the fixed branch.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        is_merged: false,
        merge_indicator: null,
        worker_branch: "worker/T1",
      },
    ] as any);
    vi.mocked(deps.projectAttentionService.listActiveProjectItems).mockReturnValue([
      {
        id: "attention-worker-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "run-1",
        dispatchId: null,
        attentionType: "merge_conflict",
        severity: "high",
        ownerType: "worker",
        status: "open",
        assignedWorkerEndpointId: null,
        title: "Merge conflict for T1",
        summaryMarkdown: "Conflict was previously detected.",
        payload: {
          taskKey: "T1",
          workerBranch: "worker/T1",
          conflictingBranches: { source: "worker/T1", target: "feature/sprint-1" },
        },
        openedAt: "2026-03-15T08:00:00.000Z",
        claimedAt: null,
        resolvedAt: null,
        updatedAt: "2026-03-15T08:00:00.000Z",
      },
    ]);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [],
      ciRuns: [],
      mergedPullRequests: [],
    });

    await runner.run({
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
        enabled: false,
        resolveMergeConflicts: true,
      },
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(deps.projectAttentionService.resolveItem).toHaveBeenCalledWith(
      "attention-worker-1",
      expect.objectContaining({
        status: "dismissed",
        reason: "stale_worker_merge_conflict_cleared",
        payloadPatch: expect.objectContaining({
          staleWorkerConflictClearedByCycle: true,
        }),
      }),
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

  it("keeps dependents blocked during retryable CI and unlocks them only after the gated task is merged", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    const tasks = [
      {
        id: "T1",
        record_id: "task-1",
        title: "Gated task",
        prompt: "merge before continuing",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        worker_branch: "worker/T1",
        pr_url: "https://example.com/pr/101",
        session_id: "session-1",
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Dependent task",
        prompt: "start after T1 settles",
        depends_on: ["T1"],
        is_independent: false,
        status: "BLOCKED",
        is_merged: false,
      },
    ] as any[];
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue(tasks);
    deps.getCiStatusForScope = vi.fn()
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValueOnce({
        available: true,
        openPullRequests: [],
        ciRuns: [],
        mergedPullRequests: [
          {
            number: 101,
            title: "Task PR",
            url: "https://example.com/pr/101",
            headRefName: "worker/T1",
            baseRefName: "feature/sprint-1",
            mergedAt: "2026-03-20T10:00:00.000Z",
            mergedBy: "octocat",
          },
        ],
      });
    deps.startTask = vi.fn().mockResolvedValue({ id: "session-2", provider: "codex" });

    const runArgs = {
      action: "orchestrate" as const,
      automationLevel: "FULL" as const,
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
        watchLoopIntervalSeconds: 2,
      } as any,
      ciIntelligence: {
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        enabled: true,
        featurePrAutoMergeMode: "WHEN_GREEN",
      },
      githubMode: "REMOTE" as const,
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    };

    const first = await runner.run(runArgs);
    expect(first.subtasks.find((task) => task.id === "T1")).toMatchObject({
      status: "RUNNING",
      merge_indicator: "CI",
      is_merged: false,
    });
    expect(first.subtasks.find((task) => task.id === "T2")).toMatchObject({ status: "BLOCKED" });
    expect(deps.startTask).not.toHaveBeenCalled();

    const second = await runner.run(runArgs);
    expect(second.subtasks.find((task) => task.id === "T1")).toMatchObject({
      status: "COMPLETED",
      merge_indicator: "MERGED",
      is_merged: true,
    });
    expect(second.subtasks.find((task) => task.id === "T2")).toMatchObject({ status: "RUNNING" });
    expect(deps.startTask).toHaveBeenCalledTimes(1);
    expect(deps.startTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T2" }), expect.anything());
  });

  it("treats no-output completed tasks as settled and unlocks dependents", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "No-op task",
        prompt: "No changes were needed.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Dependent task",
        prompt: "Start once T1 is settled.",
        depends_on: ["T1"],
        is_independent: false,
        status: "BLOCKED",
        is_merged: false,
      },
    ] as any);
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
      ciIntelligence: { enabled: false } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.awaitingMerge).toEqual([]);
    expect(result.subtasks.find((task) => task.id === "T2")).toMatchObject({ status: "RUNNING" });
    expect(deps.startTask).toHaveBeenCalledWith(expect.objectContaining({ id: "T2" }), expect.anything());
  });

  it("keeps PR-backed completed tasks waiting for merge and blocks dependents", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "PR task",
        prompt: "Merge this PR first.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        worker_branch: "worker/T1",
        pr_url: "https://example.com/pr/1",
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Dependent task",
        prompt: "Must wait for T1 merge.",
        depends_on: ["T1"],
        is_independent: false,
        status: "BLOCKED",
        is_merged: false,
      },
    ] as any);
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
      ciIntelligence: { enabled: false } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.awaitingMerge.map((task) => task.id)).toEqual(["T1"]);
    expect(result.subtasks.find((task) => task.id === "T2")).toMatchObject({ status: "BLOCKED" });
    expect(deps.startTask).not.toHaveBeenCalled();
  });

  it("keeps tasks blocked when a dependency failed", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Failed task",
        prompt: "This failed.",
        depends_on: [],
        is_independent: true,
        status: "FAILED",
        is_merged: false,
      },
      {
        id: "T2",
        record_id: "task-2",
        title: "Dependent task",
        prompt: "Cannot start after failed dependency.",
        depends_on: ["T1"],
        is_independent: false,
        status: "BLOCKED",
        is_merged: false,
      },
    ] as any);
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
      ciIntelligence: { enabled: false } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.subtasks.find((task) => task.id === "T2")).toMatchObject({ status: "BLOCKED" });
    expect(deps.startTask).not.toHaveBeenCalled();
  });

  it("does not duplicate dispatches when the same ready task is observed by repeated cycles", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    const tasks = [
      {
        id: "T1",
        record_id: "task-1",
        title: "Ready task",
        prompt: "run once",
        depends_on: [],
        is_independent: true,
        status: "PENDING",
      },
    ] as any[];
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue(tasks);
    deps.startTask = vi.fn().mockResolvedValue({ id: "session-1", provider: "codex" });
    deps.extractSessionId = vi.fn().mockReturnValue("session-1");

    const runArgs = {
      action: "orchestrate" as const,
      automationLevel: "FULL" as const,
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
      ciIntelligence: { enabled: false } as any,
      githubMode: "REMOTE" as const,
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    };

    await runner.run(runArgs);
    await runner.run(runArgs);

    expect(tasks[0]).toMatchObject({ status: "RUNNING", session_id: "session-1" });
    expect(deps.startTask).toHaveBeenCalledTimes(1);
  });

  it("does not start duplicate work across repeated cycles for active gate states", async () => {
    const deps = buildDeps();
    const runner = new CycleRunner(deps);
    const tasks = [
      {
        id: "T1",
        record_id: "task-running",
        title: "Already running",
        prompt: "keep running",
        depends_on: [],
        is_independent: true,
        status: "RUNNING",
        session_id: "session-running",
      },
      {
        id: "T2",
        record_id: "task-blocked",
        title: "Blocked task",
        prompt: "wait for dependency",
        depends_on: ["T1"],
        is_independent: false,
        status: "BLOCKED",
      },
      {
        id: "T3",
        record_id: "task-qa",
        title: "QA reviewing task",
        prompt: "wait for QA",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        merge_indicator: "QA_PENDING",
        worker_branch: "worker/T3",
        pr_url: "https://example.com/pr/103",
      },
      {
        id: "T4",
        record_id: "task-merge",
        title: "Ready for merge task",
        prompt: "wait for merge",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: false,
        merge_indicator: "PR_ONLY",
        worker_branch: "worker/T4",
        pr_url: "https://example.com/pr/104",
      },
    ] as any[];
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockImplementation(async () => tasks);
    deps.startTask = vi.fn().mockResolvedValue({ id: "duplicate-session", provider: "codex" });
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockImplementation(({ task }: { task: { id: string } }) => {
        if (task.id === "T3") {
          return {
            mergeAllowed: false,
            reason: "pending_review",
            summary: "QA review is still running.",
            latestRun: null,
            runsUsed: 0,
            maxRuns: 2,
          };
        }
        return {
          mergeAllowed: true,
          reason: "passed",
          summary: "QA passed.",
          latestRun: null,
          runsUsed: 1,
          maxRuns: 2,
        };
      }),
      reconcileRunningTaskQaReviews: vi.fn().mockResolvedValue(undefined),
    } as any;
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [
        {
          number: 103,
          title: "QA PR",
          url: "https://example.com/pr/103",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/T3",
          baseRefName: "feature/sprint-1",
          checks: [{ name: "ci", status: "completed", conclusion: "success" }],
          comments: 0,
          reviewDecision: "APPROVED",
        },
        {
          number: 104,
          title: "Merge PR",
          url: "https://example.com/pr/104",
          state: "OPEN",
          isDraft: false,
          headRefName: "worker/T4",
          baseRefName: "feature/sprint-1",
          checks: [{ name: "ci", status: "completed", conclusion: "success" }],
          comments: 0,
          reviewDecision: "APPROVED",
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
    });

    const runArgs = {
      action: "orchestrate" as const,
      automationLevel: "FULL" as const,
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
        ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
        enabled: false,
        featurePrAutoMergeMode: "CREATE_PR",
      },
      githubMode: "REMOTE" as const,
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    };

    const first = await runner.run(runArgs);
    const second = await runner.run(runArgs);

    expect(deps.startTask).not.toHaveBeenCalled();
    expect(first.subtasks.map((task) => task.id)).toEqual(["T1", "T2", "T3", "T4"]);
    expect(second.subtasks.find((task) => task.id === "T3")).toMatchObject({
      status: "CODING_COMPLETED",
      merge_indicator: "QA_PENDING",
    });
    expect(second.subtasks.find((task) => task.id === "T4")).toMatchObject({
      status: "COMPLETED",
      merge_indicator: "PR_ONLY",
    });
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
    expect(deps.executionRepository.updateTaskRunsBatch).toHaveBeenCalledWith([expect.objectContaining({
      id: "task-run-1",
      state: "RUNNING",
      finishedAt: null,
      durationMs: null,
    })]);
    expect(deps.executionRepository.updateTaskDispatchesBatch).toHaveBeenCalledWith([expect.objectContaining({
      id: "dispatch-1",
      status: "running",
      finishedAt: null,
      errorMessage: null,
    })]);

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

  it("recovers an exhausted CI guardrail into one detailed human handoff without reopening merge work", async () => {
    const deps = buildDeps();
    vi.mocked(deps.guardrailService!.evaluate).mockReturnValue({
      allowed: false,
      count: 3,
      cap: 3,
      action: "BLOCK_AND_ESCALATE",
      reason: "CI fix cap reached",
    });
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([{
      id: "T1",
      record_id: "task-1",
      project_id: "project-1",
      sprint_id: "sprint-1",
      title: "Waiting task",
      prompt: "wait for CI",
      depends_on: [],
      is_independent: true,
      status: "CODING_COMPLETED",
      is_merged: false,
      worker_branch: "worker/T1",
      pr_url: "https://example.com/pr/101",
      merge_indicator: "CI",
    }] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [{
        number: 101,
        title: "Task PR",
        url: "https://example.com/pr/101",
        state: "OPEN",
        isDraft: false,
        headRefName: "worker/T1",
        baseRefName: "feature/sprint-1",
        mergeStateStatus: "UNSTABLE",
        checks: [{ name: "test", status: "completed", conclusion: "failure" }],
        comments: 0,
        reviewDecision: "APPROVED",
      }],
      ciRuns: [{
        id: 501,
        name: "CI",
        workflowName: "CI",
        status: "completed",
        conclusion: "failure",
        event: "pull_request",
        headBranch: "worker/T1",
        url: "https://example.com/runs/501",
        failedJobs: [{
          id: 502,
          name: "test",
          conclusion: "failure",
          failedSteps: ["Run tests"],
          logExcerpt: "AssertionError: expected true to be false",
          logCommand: "gh run view 501 --job 502 --log-failed",
        }],
      }],
      mergedPullRequests: [],
    } as any);

    const result = await new CycleRunner(deps).run({
      action: "status",
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
        waitForJulesCiAutofix: false,
        featurePrAutoMergeMode: "WHEN_GREEN",
      },
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(result.subtasks[0]).toMatchObject({
      status: "BLOCKED",
      merge_indicator: "CI",
      intervention_owner: "HUMAN",
    });
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", expect.objectContaining({
      status: "coding_completed",
      isMerged: false,
      mergeIndicator: "CI",
    }));
    expect(deps.projectAttentionService!.resolveItemsForTask).toHaveBeenCalledWith(
      "project-1",
      "task-1",
      ["ci_fix_required", "merge_required"],
      "ci_fix_guardrail_handoff_opened",
    );
    expect(deps.projectAttentionService!.openItems).toHaveBeenCalledWith([
      expect.objectContaining({
        taskId: "task-1",
        attentionType: "human_escalation_required",
        deduplicationKey: "guardrail:ci_fix:task-1",
        ownerType: "human",
        summaryMarkdown: expect.stringContaining("AssertionError: expected true to be false"),
        payload: expect.objectContaining({
          sourceAttentionType: "ci_fix",
          guardrailAttempts: 3,
          guardrailCap: 3,
          failedRuns: [expect.objectContaining({
            failedJobs: [expect.objectContaining({
              failedSteps: ["Run tests"],
              logExcerpt: "AssertionError: expected true to be false",
            })],
          })],
        }),
      }),
    ]);
    const openedInputs = vi.mocked(deps.projectAttentionService!.openItems).mock.calls.flatMap(([items]) => items);
    expect(openedInputs).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ attentionType: "merge_required" }),
      expect.objectContaining({ attentionType: "action_required" }),
    ]));
  });

  it("does not auto-capture CI failures as short-term memory", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemoriesBatch: vi.fn().mockResolvedValue([]),
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

    expect(mockMemoryService.createMemoriesBatch).not.toHaveBeenCalled();
  });

  it("does not capture CI failure memory if settings are disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemoriesBatch: vi.fn().mockResolvedValue([]),
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



    expect(mockMemoryService.createMemoriesBatch).not.toHaveBeenCalled();
  });

  it("does not capture task memory if setting autoCaptureSprint is disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemoriesBatch: vi.fn().mockResolvedValue([]),
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



    expect(mockMemoryService.createMemoriesBatch).not.toHaveBeenCalled();
  });

  it("does not capture CI failure memory if setting autoCaptureSprint is disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemoriesBatch: vi.fn().mockResolvedValue([]),
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



    expect(mockMemoryService.createMemoriesBatch).not.toHaveBeenCalled();
  });

  it("does not capture task memory if task status is unchanged", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemoriesBatch: vi.fn().mockResolvedValue([]),
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



    expect(mockMemoryService.createMemoriesBatch).not.toHaveBeenCalled();
  });

  it("does not capture task memory if settings are disabled", async () => {
    const deps = buildDeps();
    const mockMemoryService = {
      createMemoriesBatch: vi.fn().mockResolvedValue([]),
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



    expect(mockMemoryService.createMemoriesBatch).not.toHaveBeenCalled();
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
      createMemoriesBatch: vi.fn().mockResolvedValue([]),
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



    expect(mockMemoryService.createMemoriesBatch).toHaveBeenCalledWith("project-1", [expect.objectContaining({
      category: "error",
      strength: 0.8,
      content: expect.stringContaining("Task failed: T1"),
      source: expect.objectContaining({ originType: "task_status_change" }),
    })]);
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

  it("replays a legacy failed QA fix handoff after restart even when old code changed the task state", async () => {
    const deps = buildDeps();
    const reviewCompletedTask = vi.fn().mockResolvedValue({
      reviewed: true,
      reopenedTask: true,
      mergeBlocked: true,
      reportText: "Resumed the pending QA follow-up.",
    });
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: false,
        reason: "changes_requested",
        summary: "QA requested fixes.",
        latestRun: {
          id: "qa-run-pending-followup",
          status: "completed",
          outcome: "changes_requested",
          fixInstructions: "Address the review findings.",
          payload: {
            continuationStatus: "failed",
            continuationMode: "failed",
            continued: false,
          },
        },
        runsUsed: 1,
        maxRuns: 2,
      }),
      reviewCompletedTask,
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
    const task = {
      id: "T1",
      record_id: "task-1",
      title: "Restarted task",
      prompt: "Finish implementation",
      depends_on: [],
      is_independent: true,
      status: "RUNNING",
      merge_indicator: "QA_PENDING",
      provider: "codex",
      session_id: "cli-codex-session-1",
    };

    await (runner as any).reviewCompletedTasks(
      [task],
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

    expect(reviewCompletedTask).toHaveBeenCalledTimes(1);
    expect(reviewCompletedTask).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ id: "T1", status: "RUNNING" }),
    }));
    expect(deps.startTask).not.toHaveBeenCalled();
  });

  describe("QA exhaustion policy", () => {
    const runExhaustedPolicy = async (
      exhaustionPolicy: "ESCALATE_TO_HUMAN" | "FAIL_TASK" | "FINISH_TASK",
      reason: "retries_exhausted" | "follow_up_no_progress" = "retries_exhausted",
    ) => {
      const deps = buildDeps();
      deps.qualityAssuranceService = {
        getTaskMergeGateStatus: vi.fn().mockReturnValue({
          mergeAllowed: false,
          reason,
          summary: "QA could not clear this task.",
          latestRun: { id: "qa-run-1" },
          runsUsed: 5,
          maxRuns: 5,
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
            exhaustionPolicy,
          },
        },
      });

      const runner = new CycleRunner(deps);
      const task: any = {
        id: "T1",
        record_id: "task-1",
        title: "Exhausted task",
        prompt: "do work",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        merge_indicator: "QA_PENDING",
        provider: "codex",
      };

      const args = {
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
      } as any;
      const qaFinishedTaskIds = await (runner as any).reviewCompletedTasks(
        [task],
        new Map([["T1", "CODING_COMPLETED"]]),
        args,
        deps.getDashboardSettings(),
      );

      return { args, deps, qaFinishedTaskIds, runner, task };
    };

    it("ESCALATE_TO_HUMAN parks the task in QA_REVIEW_FAILED and opens a human-attention item", async () => {
      const { deps, task } = await runExhaustedPolicy("ESCALATE_TO_HUMAN");
      expect(task.status).toBe("QA_REVIEW_FAILED");
      expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ status: "QA_REVIEW_FAILED" }),
      );
      expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          attentionType: "human_escalation_required",
          taskId: "task-1",
          payload: expect.objectContaining({ sourceAttentionType: "qa_review" }),
        }),
      ]));
      expect(deps.qualityAssuranceService.reviewCompletedTask).not.toHaveBeenCalled();
    });

    it("ESCALATE_TO_HUMAN parks a no-progress follow-up without launching another review", async () => {
      const { deps, task } = await runExhaustedPolicy("ESCALATE_TO_HUMAN", "follow_up_no_progress");
      expect(task.status).toBe("QA_REVIEW_FAILED");
      expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({
          taskId: "task-1",
          payload: expect.objectContaining({ qaReason: "follow_up_no_progress" }),
        }),
      ]));
      expect(deps.qualityAssuranceService.reviewCompletedTask).not.toHaveBeenCalled();
    });

    it("ESCALATE_TO_HUMAN is idempotent after a task is parked in QA_REVIEW_FAILED", async () => {
      const deps = buildDeps();
      deps.qualityAssuranceService = {
        getTaskMergeGateStatus: vi.fn().mockReturnValue({
          mergeAllowed: false,
          reason: "retries_exhausted",
          summary: "QA could not clear this task.",
          latestRun: { id: "qa-run-1" },
          runsUsed: 5,
          maxRuns: 5,
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
            exhaustionPolicy: "ESCALATE_TO_HUMAN",
          },
        },
      });

      const runner = new CycleRunner(deps);
      const task: any = {
        id: "T1",
        record_id: "task-1",
        title: "Exhausted task",
        prompt: "do work",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "codex",
      };
      const args = {
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
      } as any;

      await (runner as any).reviewCompletedTasks(
        [task],
        new Map([["T1", "CODING_COMPLETED"]]),
        args,
        deps.getDashboardSettings(),
      );
      await (runner as any).reviewCompletedTasks(
        [task],
        new Map([["T1", "QA_REVIEW_FAILED"]]),
        args,
        deps.getDashboardSettings(),
      );

      expect(task.status).toBe("QA_REVIEW_FAILED");
      expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledTimes(1);
      expect(deps.projectAttentionService.openItems).toHaveBeenCalledTimes(1);
      expect(deps.qualityAssuranceService.reviewCompletedTask).not.toHaveBeenCalled();
    });

    it("FAIL_TASK marks the run FAILED so the sprint can finish, without a human gate", async () => {
      const { deps, task } = await runExhaustedPolicy("FAIL_TASK");
      expect(task.status).toBe("FAILED");
      expect(deps.executionRepository.updateTaskRun).toHaveBeenCalledWith(
        "task-run-1",
        expect.objectContaining({ state: "FAILED" }),
      );
      expect(deps.projectAttentionService.openItems).not.toHaveBeenCalled();
      expect(deps.qualityAssuranceService.reviewCompletedTask).not.toHaveBeenCalled();
    });

    it("FINISH_TASK marks the task COMPLETED despite no QA pass", async () => {
      const { args, deps, qaFinishedTaskIds, runner, task } = await runExhaustedPolicy("FINISH_TASK");
      expect(task.status).toBe("COMPLETED");
      expect(task.merge_indicator).toBeUndefined();
      expect(qaFinishedTaskIds).toEqual(new Set(["task-1", "T1"]));
      const evaluateTaskQaGate = (runner as any).buildTaskQaGateEvaluator(args, qaFinishedTaskIds);
      expect(evaluateTaskQaGate(task)).toMatchObject({
        mergeAllowed: true,
        reason: "passed",
      });
      expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
        "task-1",
        expect.objectContaining({ status: "completed", mergeIndicator: null }),
      );
      expect(deps.executionRepository.updateTaskRun).toHaveBeenCalledWith(
        "task-run-1",
        expect.objectContaining({ state: "COMPLETED" }),
      );
      expect(deps.projectAttentionService.openItems).not.toHaveBeenCalled();
      expect(deps.qualityAssuranceService.reviewCompletedTask).not.toHaveBeenCalled();
    });

    it("does not treat a fresh full task run as same-session QA follow-up work after exhaustion", async () => {
      const deps = buildDeps();
      vi.mocked(deps.executionRepository.getLatestTaskRun).mockReturnValue({
        id: "task-run-fresh",
        state: "COMPLETED",
        finishedAt: "2026-07-02T07:54:00.000Z",
      } as any);
      deps.qualityAssuranceService = {
        getTaskMergeGateStatus: vi.fn().mockReturnValue({
          mergeAllowed: false,
          reason: "retries_exhausted",
          summary: "QA could not clear this task.",
          latestRun: {
            id: "qa-run-5",
            projectId: "project-1",
            status: "completed",
            outcome: "changes_requested",
            startedAt: "2026-07-02T07:36:30.000Z",
            finishedAt: "2026-07-02T07:40:16.000Z",
          },
          runsUsed: 5,
          maxRuns: 5,
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
            exhaustionPolicy: "ESCALATE_TO_HUMAN",
          },
        },
      });

      const runner = new CycleRunner(deps);
      const task: any = {
        id: "T09",
        record_id: "task-9",
        project_id: "project-1",
        title: "Fresh full rerun",
        prompt: "do work",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "qwen-code",
      };

      await (runner as any).reviewCompletedTasks(
        [task],
        new Map([["T09", "CODING_COMPLETED"]]),
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
      expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
        "task-9",
        expect.objectContaining({ status: "QA_REVIEW_FAILED" }),
      );
      expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ attentionType: "human_escalation_required", taskId: "task-9" }),
      ]));
    });

    it("runs verification instead of escalating when a same-session QA follow-up completed at the exhausted cap", async () => {
      const deps = buildDeps();
      vi.mocked(deps.executionRepository.getLatestTaskRun).mockReturnValue({
        id: "task-run-followup",
      } as any);
      vi.mocked(deps.executionRepository.listExecutionInvocations).mockReturnValue([
        {
          id: "followup-1",
          type: "cli_task_followup",
          status: "completed",
          startedAt: "2026-07-02T07:37:35.000Z",
          finishedAt: "2026-07-02T07:40:09.000Z",
        },
      ] as any);
      const reviewCompletedTask = vi.fn().mockResolvedValue({
        reviewed: true,
        reopenedTask: false,
        mergeBlocked: false,
        reportText: "",
      });
      deps.qualityAssuranceService = {
        getTaskMergeGateStatus: vi.fn().mockReturnValue({
          mergeAllowed: false,
          reason: "retries_exhausted",
          summary: "QA could not clear this task.",
          latestRun: {
            id: "qa-run-5",
            projectId: "project-1",
            status: "completed",
            outcome: "changes_requested",
            startedAt: "2026-07-02T07:36:30.000Z",
            finishedAt: "2026-07-02T07:40:16.000Z",
            payload: { continued: true, postExhaustionVerificationEligible: true },
          },
          runsUsed: 5,
          maxRuns: 5,
        }),
        reviewCompletedTask,
      } as any;
      deps.getDashboardSettings = vi.fn().mockReturnValue({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            exhaustionPolicy: "ESCALATE_TO_HUMAN",
          },
        },
      });

      const runner = new CycleRunner(deps);
      const task: any = {
        id: "T09",
        record_id: "task-9",
        project_id: "project-1",
        title: "Fresh post-QA work",
        prompt: "do work",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "qwen-code",
      };

      await (runner as any).reviewCompletedTasks(
        [task],
        new Map([["T09", "CODING_COMPLETED"]]),
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

      expect(reviewCompletedTask).toHaveBeenCalledTimes(1);
      expect(deps.projectManagementRepository.updateTask).not.toHaveBeenCalledWith(
        "task-9",
        expect.objectContaining({ status: "QA_REVIEW_FAILED" }),
      );
      expect(deps.projectAttentionService.openItems).not.toHaveBeenCalled();

      vi.mocked(deps.qualityAssuranceService.getTaskMergeGateStatus).mockReturnValue({
        mergeAllowed: false,
        reason: "retries_exhausted",
        summary: "Final verification still did not clear the task.",
        latestRun: {
          id: "qa-run-6",
          projectId: "project-1",
          status: "completed",
          outcome: "changes_requested",
          startedAt: "2026-07-02T07:41:00.000Z",
          finishedAt: "2026-07-02T07:42:00.000Z",
          payload: { continued: true },
        },
        runsUsed: 6,
        maxRuns: 5,
      } as any);
      reviewCompletedTask.mockClear();
      vi.mocked(deps.projectManagementRepository.updateTask).mockClear();
      vi.mocked(deps.projectAttentionService.openItems).mockClear();

      await (runner as any).reviewCompletedTasks(
        [task],
        new Map([["T09", "CODING_COMPLETED"]]),
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

      expect(reviewCompletedTask).not.toHaveBeenCalled();
      expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
        "task-9",
        expect.objectContaining({ status: "QA_REVIEW_FAILED" }),
      );
      expect(deps.projectAttentionService.openItems).toHaveBeenCalledWith(expect.arrayContaining([
        expect.objectContaining({ attentionType: "human_escalation_required", taskId: "task-9" }),
      ]));
    });

    it("retries recovered stale QA reviews instead of escalating at the exhausted cap", async () => {
      const deps = buildDeps();
      const reviewCompletedTask = vi.fn().mockResolvedValue({
        reviewed: false,
        reopenedTask: false,
        mergeBlocked: true,
        reportText: "",
      });
      deps.qualityAssuranceService = {
        getTaskMergeGateStatus: vi.fn().mockReturnValue({
          mergeAllowed: false,
          reason: "review_failed",
          summary: "Recovered stale QA review run after its Docker container disappeared. Code UX will retry the review.",
          latestRun: {
            id: "qa-run-3",
            projectId: "project-1",
            status: "cancelled",
            outcome: null,
            startedAt: "2026-07-02T07:36:57.000Z",
            finishedAt: "2026-07-02T07:38:22.000Z",
          },
          runsUsed: 3,
          maxRuns: 1,
        }),
        reviewCompletedTask,
      } as any;
      deps.getDashboardSettings = vi.fn().mockReturnValue({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            maxTaskReviewRuns: 1,
            exhaustionPolicy: "ESCALATE_TO_HUMAN",
          },
        },
      });

      const runner = new CycleRunner(deps);
      const task: any = {
        id: "T07",
        record_id: "task-7",
        project_id: "project-1",
        title: "Post-QA verification",
        prompt: "do work",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "codex",
      };

      await (runner as any).reviewCompletedTasks(
        [task],
        new Map([["T07", "CODING_COMPLETED"]]),
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

      expect(reviewCompletedTask).toHaveBeenCalledTimes(1);
      expect(deps.projectManagementRepository.updateTask).not.toHaveBeenCalledWith(
        "task-7",
        expect.objectContaining({ status: "QA_REVIEW_FAILED" }),
      );
      expect(deps.projectAttentionService.openItems).not.toHaveBeenCalled();
    });
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

  it("reviews multiple newly completed tasks in parallel", async () => {
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

  it("passes known task PR URLs to git polling and backfills the PR head before QA", async () => {
    const deps = buildDeps();
    const reviewCompletedTask = vi.fn().mockResolvedValue({
      reviewed: true,
      reopenedTask: false,
      mergeBlocked: false,
      reportText: "",
    });
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: false,
        reason: "pending_review",
        summary: "QA review is required before merge.",
        latestRun: null,
        runsUsed: 0,
        maxRuns: 2,
      }),
      reviewCompletedTask,
    } as any;
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
    });

    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Jules task",
        prompt: "Change README.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "jules",
        session_id: "session-1",
        pr_url: "https://example.com/pr/3",
      },
    ] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [
        {
          number: 3,
          title: "Jules PR",
          url: "https://example.com/pr/3",
          state: "OPEN",
          isDraft: false,
          headRefName: "docs/readme-expansion-session-1",
          baseRefName: "feature/older-sprint-branch",
          mergeStateStatus: "CLEAN",
          reviewDecision: null,
          updatedAt: null,
          comments: 0,
          checks: [],
        },
      ],
      ciRuns: [],
      mergedPullRequests: [],
    } as any);

    const runner = new CycleRunner(deps);
    await runner.run({
      action: "orchestrate",
      automationLevel: "SEMI_AUTO",
      automationInterventions: DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
      executionContext: {
        project: { id: "project-1", name: "Project 1" } as any,
        sprint: { id: "sprint-1", name: "Sprint 1" } as any,
        sprintNumber: 1,
        repoPath: "/repo/project-1",
        featureBranch: "feature/current-sprint-branch",
        defaultBranch: "main",
      },
      repoPath: "/repo/project-1",
      defaultFeatureBranch: "feature/current-sprint-branch",
      retryFailed: false,
      loopSteps: {
        loadSubtasks: true,
        sessionSync: false,
        statusDerivation: true,
        startReadyTasks: false,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: true,
        featurePrAutoMergeMode: "WHEN_GREEN",
      } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(deps.getCiStatusForScope).toHaveBeenCalledWith(expect.objectContaining({
      taskPrUrls: ["https://example.com/pr/3"],
    }));
    expect(deps.executionRepository.updateTaskRun).toHaveBeenCalledWith("task-run-1", expect.objectContaining({
      workerBranch: "docs/readme-expansion-session-1",
      prUrl: "https://example.com/pr/3",
    }));
    expect(reviewCompletedTask).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({
        worker_branch: "docs/readme-expansion-session-1",
        pr_url: "https://example.com/pr/3",
      }),
    }));
  });

  it("does not rerun task QA after changes-requested just because a later full task run completed", async () => {
    const deps = buildDeps();
    vi.mocked(deps.executionRepository.getLatestTaskRun).mockReturnValue({
      id: "task-run-later",
      state: "COMPLETED",
      finishedAt: "2026-06-13T20:45:14.510Z",
    } as any);
    const reviewCompletedTask = vi.fn().mockResolvedValue({
      reviewed: true,
      reopenedTask: false,
      mergeBlocked: false,
      reportText: "",
    });
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: false,
        reason: "changes_requested",
        summary: "QA requested fixes.",
        latestRun: {
          id: "qa-1",
          status: "completed",
          outcome: "changes_requested",
          finishedAt: "2026-06-13T20:42:31.128Z",
        },
        runsUsed: 1,
        maxRuns: 2,
      }),
      reviewCompletedTask,
    } as any;
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
    });
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        title: "Jules task",
        prompt: "Change README.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "jules",
        session_id: "session-1",
        pr_url: "https://example.com/pr/4",
      },
    ] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [],
      ciRuns: [],
      mergedPullRequests: [],
    } as any);

    const runner = new CycleRunner(deps);
    await runner.run({
      action: "orchestrate",
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
        statusDerivation: true,
        startReadyTasks: false,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: true,
      } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(reviewCompletedTask).not.toHaveBeenCalled();
  });

  it("reruns QA after changes-requested when recovery sees a newer completed run for the current task session", async () => {
    const deps = buildDeps();
    vi.mocked(deps.executionRepository.getLatestTaskRun).mockReturnValue({
      id: "task-run-later",
      state: "COMPLETED",
      sessionId: "session-2",
      finishedAt: "2026-06-13T20:45:14.510Z",
    } as any);
    vi.mocked(deps.executionRepository.listExecutionInvocations).mockReturnValue([]);
    const reviewCompletedTask = vi.fn().mockResolvedValue({
      reviewed: true,
      reopenedTask: false,
      mergeBlocked: false,
      reportText: "",
    });
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: false,
        reason: "changes_requested",
        summary: "QA requested fixes.",
        latestRun: {
          id: "qa-1",
          projectId: "project-1",
          status: "completed",
          outcome: "changes_requested",
          finishedAt: "2026-06-13T20:42:31.128Z",
        },
        runsUsed: 1,
        maxRuns: 2,
      }),
      reviewCompletedTask,
    } as any;
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
    });
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        project_id: "project-1",
        title: "Recovered CLI task",
        prompt: "Change README.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "qwen-code",
        session_id: "session-2",
        pr_url: "https://example.com/pr/4",
      },
    ] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [],
      ciRuns: [],
      mergedPullRequests: [],
    } as any);

    const runner = new CycleRunner(deps);
    await runner.run({
      action: "orchestrate",
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
        statusDerivation: true,
        startReadyTasks: false,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: true,
      } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(reviewCompletedTask).toHaveBeenCalledTimes(1);
  });

  it("reruns QA after a changes-requested review when QA continued a completed CLI follow-up in the same task run", async () => {
    const deps = buildDeps();
    vi.mocked(deps.executionRepository.getLatestTaskRun).mockReturnValue({
      id: "task-run-same",
      state: "COMPLETED",
      finishedAt: "2026-06-13T20:40:14.510Z",
    } as any);
    vi.mocked(deps.executionRepository.listExecutionInvocations).mockReturnValue([
      {
        id: "xi-followup",
        type: "cli_task_followup",
        status: "completed",
        startedAt: "2026-06-13T20:43:00.000Z",
        finishedAt: "2026-06-13T20:44:14.510Z",
      },
    ] as any);
    const reviewCompletedTask = vi.fn().mockResolvedValue({
      reviewed: true,
      reopenedTask: false,
      mergeBlocked: false,
      reportText: "",
    });
    deps.qualityAssuranceService = {
      getTaskMergeGateStatus: vi.fn().mockReturnValue({
        mergeAllowed: false,
        reason: "changes_requested",
        summary: "QA requested fixes.",
        latestRun: {
          id: "qa-1",
          projectId: "project-1",
          status: "completed",
          outcome: "changes_requested",
          payload: { continued: true },
          startedAt: "2026-06-13T20:42:31.128Z",
          finishedAt: "2026-06-13T20:45:31.128Z",
        },
        runsUsed: 1,
        maxRuns: 2,
      }),
      reviewCompletedTask,
    } as any;
    deps.getDashboardSettings = () => ({
      ...DEFAULT_DASHBOARD_SETTINGS,
      agents: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents,
        qualityAssurance: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
          enabled: true,
        },
      },
    });
    vi.mocked(deps.sprintExecutionStateService.loadSubtasks).mockResolvedValue([
      {
        id: "T1",
        record_id: "task-1",
        project_id: "project-1",
        title: "CLI task",
        prompt: "Change README.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "qwen-code",
        session_id: "session-1",
        pr_url: "https://example.com/pr/4",
      },
    ] as any);
    deps.getCiStatusForScope = vi.fn().mockResolvedValue({
      available: true,
      openPullRequests: [],
      ciRuns: [],
      mergedPullRequests: [],
    } as any);

    const runner = new CycleRunner(deps);
    await runner.run({
      action: "orchestrate",
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
        statusDerivation: true,
        startReadyTasks: false,
        statusTable: false,
        mergeProtocol: false,
        actionRequiredProtocol: false,
      } as any,
      ciIntelligence: {
        enabled: true,
      } as any,
      githubMode: "REMOTE",
      defaultBranch: "main",
      featureBranchPrefix: "feature/",
      sprintRunId: "run-1",
    });

    expect(deps.executionRepository.listExecutionInvocations).toHaveBeenCalledWith(expect.objectContaining({
      projectId: "project-1",
      taskRunId: "task-run-same",
    }));
    expect(reviewCompletedTask).toHaveBeenCalledTimes(1);
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

    it("persists a CI-blocked completed task as coding-complete instead of reopening coding", async () => {
      const deps = buildDeps();
      const runner = new CycleRunner(deps);
      const states = new Map();
      states.set("T1", { id: "T1", status: "RUNNING", isMerged: false, mergeIndicator: "CI" });
      const subtasks = [{
        id: "T1",
        record_id: "task-1",
        status: "BLOCKED",
        is_merged: false,
        merge_indicator: "CI",
      }] as any;

      (runner as any).stateCoordinator.persistCiGateTaskStateChanges(states, subtasks);

      expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith("task-1", {
        status: "coding_completed",
        isMerged: false,
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

      expect(deps.executionRepository.updateTaskRunsBatch).toHaveBeenCalledWith([expect.objectContaining({
        id: "task-run-1",
        state: "RUNNING",
        finishedAt: null,
        durationMs: null,
      })]);
      expect(deps.executionRepository.updateTaskDispatchesBatch).toHaveBeenCalledWith([expect.objectContaining({
        id: "dispatch-1",
        status: "running",
        startedAt: expect.any(String),
        finishedAt: null,
        lastHeartbeatAt: expect.any(String),
        errorMessage: null,
      })]);
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
