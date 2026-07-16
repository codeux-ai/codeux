import { describe, expect, it, vi, beforeEach } from "vitest";
import { CliWorkflowService } from "../../../src/services/cli-workflow-service.js";
import { executePrepareStage } from "../../../src/services/cli-workflow/pipeline/prepare-stage.js";
import { executeProviderStage } from "../../../src/services/cli-workflow/pipeline/execute-provider-stage.js";
import { executeGitFinalizeStage } from "../../../src/services/cli-workflow/pipeline/git-finalize-stage.js";
import { executePrFinalizeStage } from "../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js";
import { executeCleanupStage } from "../../../src/services/cli-workflow/pipeline/cleanup-stage.js";
import { ActiveDispatchRegistry, SERVER_SHUTDOWN_STOP_REASON } from "../../../src/services/active-dispatch-registry.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

vi.mock("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/execute-provider-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

const buildProviderStageResult = (transcriptText = "") => ({
  ok: true,
  stdout: "",
  stderr: "",
  exitCode: 0,
  nativeSessionId: "native-session-1",
  usageTelemetry: {
    transcriptText,
    conversation: transcriptText ? [{ kind: "assistant", text: transcriptText }] : [],
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0,
    totalTokens: 0,
    toolCallCount: 0,
    usageSource: "estimated",
    rawUsageJson: null,
  },
}) as any;


const buildService = (): any => {
  return new CliWorkflowService({
    sessionTracking: {} as any,
    executionRepository: undefined,
    getDashboardSettings: () => { throw new Error("not used"); },
    agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: async () => null } as any,
    getGithubToken: () => undefined,
  }) as any;
};

const runWorkflowForAgentRootMode = async (input: {
  globalContainerRunAsRoot: boolean;
  agentContainerRunAsRoot?: boolean | null;
}): Promise<void> => {
  const deps = {
    sessionTracking: {
      findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
      createSession: vi.fn().mockImplementation((sessionInput) => ({ ...sessionInput, name: `sessions/${sessionInput.id}`, outputs: [] })),
      appendActivity: vi.fn(),
      updateSession: vi.fn(),
    },
    getDashboardSettings: vi.fn().mockReturnValue({
      cliWorkflow: {
        containerImage: "node:24-bookworm",
        executionMode: "DOCKER",
        containerRunAsRoot: input.globalContainerRunAsRoot,
      },
      agents: {
        routing: {
          taskCoding: {
            mode: "DEFAULT",
            agentPresetId: null,
          },
        },
      },
    }),
    agentPresetSyncService: {
      resolveTargetedCodingAgent: vi.fn().mockResolvedValue({
        id: "agent-worker",
        instructionMarkdown: "guide",
        containerRunAsRoot: input.agentContainerRunAsRoot,
      }),
      getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(null),
    },
    getGithubToken: vi.fn().mockReturnValue("token"),
    logger: { error: vi.fn(), warn: vi.fn() },
  };
  const service = new CliWorkflowService(deps as any);

  vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" });
  vi.mocked(executeProviderStage).mockResolvedValue(buildProviderStageResult());
  vi.mocked(executeGitFinalizeStage).mockResolvedValue({ hasChanges: false, committedChanges: false });
  vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: true });

  await (service as any).runTaskWorkflow({
    provider: "gemini",
    task: { id: "T1", prompt: "prompt", title: "title" },
    repoPath: "/repo",
    featureBranch: "main",
    sprintNumber: 1,
    settingsScope: { projectId: "project-1" },
    agentPresetId: "agent-worker",
    sessionId: "sess-1",
    workerBranch: "worker-1",
    title: "Title",
  });
};

describe("CliWorkflowService unpushed commit detection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(executeProviderStage).mockResolvedValue(buildProviderStageResult());
  });

  it("persists the scoped coding invocation after cancellation registration and before preparation", async () => {
    const callOrder: string[] = [];
    let storedInvocation: Record<string, unknown> | null = null;
    let releasePreparation!: () => void;
    let reportPreparationStarted!: () => void;
    const preparationGate = new Promise<void>((resolve) => {
      releasePreparation = resolve;
    });
    const preparationStarted = new Promise<void>((resolve) => {
      reportPreparationStarted = resolve;
    });
    const taskRun = {
      id: "task-run-1",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: "sprint-run-1",
      dispatchId: "dispatch-1",
      startedAt: "2026-07-13T00:00:00.000Z",
      prUrl: null,
      workerBranch: null,
    };
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue(taskRun),
      getExecutionInvocation: vi.fn().mockImplementation((id: string) => (
        storedInvocation?.id === id ? storedInvocation : null
      )),
      createExecutionInvocation: vi.fn().mockImplementation((input: Record<string, unknown>) => {
        callOrder.push("persist_invocation");
        storedInvocation = { ...input, id: "xi-preparation" };
        return storedInvocation;
      }),
      updateExecutionInvocation: vi.fn().mockImplementation((_id: string, input: Record<string, unknown>) => {
        Object.assign(storedInvocation!, input);
        return storedInvocation;
      }),
      appendExecutionInvocationMessage: vi.fn().mockImplementation(() => {
        callOrder.push("persist_message");
      }),
      createProviderInvocationUsage: vi.fn(),
      appendTaskRunEvent: vi.fn().mockImplementation((_taskRunId: string, eventType: string) => {
        if (eventType === "cli_prepare_started") {
          callOrder.push("prepare_event");
        }
      }),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue({ status: "running" }),
    };
    const activeDispatchRegistry = {
      register: vi.fn().mockImplementation(() => {
        callOrder.push("register_dispatch");
        return vi.fn();
      }),
    };
    const workerAgent = {
      id: "agent-preset-1",
      instructionMarkdown: "Worker guide",
    };
    const deps = {
      sessionTracking: {
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      executionRepository,
      activeDispatchRegistry,
      getDashboardSettings: vi.fn().mockReturnValue(DEFAULT_DASHBOARD_SETTINGS),
      agentPresetSyncService: {
        resolveTargetedCodingAgent: vi.fn().mockResolvedValue(workerAgent),
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(workerAgent),
      },
      getGithubToken: vi.fn().mockReturnValue(undefined),
      sprintRunLifecycleService: { finalizeCancellationIfIdle: vi.fn() },
      logger: { error: vi.fn(), warn: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    vi.mocked(executePrepareStage).mockImplementation(async () => {
      callOrder.push("prepare_stage");
      reportPreparationStarted();
      await preparationGate;
      return { providerPrompt: "mock prompt" } as any;
    });
    vi.mocked(executeProviderStage).mockResolvedValue(buildProviderStageResult(
      "No repository changes were required.\nCODE_UX_TASK_OUTCOME: completed",
    ));
    vi.mocked(executeGitFinalizeStage).mockImplementation(async () => {
      expect(storedInvocation).toMatchObject({ status: "running" });
      return { hasChanges: true, committedChanges: true, pushedBranch: "worker-1" };
    });
    vi.mocked(executePrFinalizeStage).mockImplementation(async () => {
      expect(storedInvocation).toMatchObject({ status: "running" });
      return { prUrl: "https://example.test/pull/1" };
    });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    const workflow = (service as any).runTaskWorkflow({
      provider: "codex",
      providerSettingsOverride: {
        model: "gpt-preparation-test",
        thinkingMode: "medium",
        apiKey: "",
        maxConcurrentTasks: 2,
      },
      task: { id: "T1", record_id: "task-1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      sprintNumber: 1,
      settingsScope: { projectId: "project-1", sprintId: "sprint-1" },
      sessionId: "session-1",
      dispatchId: "dispatch-1",
      taskRunId: "task-run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    await preparationStarted;

    expect(callOrder).toEqual([
      "register_dispatch",
      "persist_invocation",
      "persist_message",
      "prepare_event",
      "prepare_stage",
    ]);
    expect(executionRepository.getExecutionInvocation("xi-preparation")).toMatchObject({
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: "sprint-run-1",
      dispatchId: "dispatch-1",
      taskRunId: "task-run-1",
      type: "cli_task_coding",
      status: "running",
      provider: "codex",
      model: "gpt-preparation-test",
      invocationSource: "internal",
      agentPresetId: "agent-preset-1",
    });
    expect(executionRepository.createExecutionInvocation).toHaveBeenCalledOnce();
    expect(executionRepository.createProviderInvocationUsage).not.toHaveBeenCalled();
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "xi-preparation",
      expect.objectContaining({
        role: "system",
        contentMarkdown: "Preparing the task workspace and codex configuration.",
      }),
    );

    releasePreparation();
    await workflow;

    expect(executeProviderStage).toHaveBeenCalledWith(
      expect.objectContaining({ executionInvocationId: "xi-preparation" }),
      "mock prompt",
    );
    expect(storedInvocation).toMatchObject({ status: "completed" });
  });

  it("runs task workflow pipeline and handles error", async () => {
    let storedInvocation: Record<string, unknown> | null = null;
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: null,
        dispatchId: "dispatch-1",
        startedAt: "2026-03-10T00:00:00.000Z",
        prUrl: null,
        workerBranch: null,
      }),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue(null),
      createExecutionInvocation: vi.fn().mockImplementation((input: Record<string, unknown>) => {
        storedInvocation = { ...input, id: "xi-preparation-failure" };
        return storedInvocation;
      }),
      getExecutionInvocation: vi.fn().mockImplementation((id: string) => (
        storedInvocation?.id === id ? storedInvocation : null
      )),
      updateExecutionInvocation: vi.fn().mockImplementation((_id: string, input: Record<string, unknown>) => {
        Object.assign(storedInvocation!, input);
        return storedInvocation;
      }),
      appendExecutionInvocationMessage: vi.fn(),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue(DEFAULT_DASHBOARD_SETTINGS),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      sprintRunLifecycleService: {
        finalizeCancellationIfIdle: vi.fn(),
      },
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockRejectedValue(new Error("Stage failed"));
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(deps.sessionTracking.updateSession).toHaveBeenCalledWith("sess-1", { state: "FAILED" });
    expect(deps.sessionTracking.appendActivity).toHaveBeenCalledWith("sess-1", {
      originator: "system",
      description: "Workflow failed: Stage failed",
    });
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_workflow_failed",
      "system",
      expect.objectContaining({ errorMessage: "Stage failed", provider: "gemini" }),
      expect.objectContaining({ sourceEventKey: undefined }),
    );
    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "FAILED" }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({ status: "failed", errorMessage: "Stage failed" }),
    );
    expect(storedInvocation).toMatchObject({
      status: "failed",
      finishedAt: expect.any(String),
      errorMessage: "Stage failed",
      lastErrorMessage: "Stage failed",
    });
    expect(executionRepository.appendExecutionInvocationMessage).toHaveBeenCalledWith(
      "xi-preparation-failure",
      expect.objectContaining({
        role: "system",
        contentMarkdown: "CLI workflow failed: Stage failed",
        metadata: expect.objectContaining({ kind: "cli_workflow_finalized", status: "failed" }),
      }),
    );
    expect(deps.logger.error).toHaveBeenCalled();
  });

  it("preserves running task state and workspace when server shutdown aborts workflow", async () => {
    let storedInvocation: Record<string, unknown> | null = null;
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: null,
        dispatchId: "dispatch-1",
        startedAt: "2026-03-10T00:00:00.000Z",
        prUrl: null,
        workerBranch: null,
      }),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue(null),
      createExecutionInvocation: vi.fn().mockImplementation((input: Record<string, unknown>) => {
        storedInvocation = { ...input, id: "xi-shutdown" };
        return storedInvocation;
      }),
      getExecutionInvocation: vi.fn().mockImplementation((id: string) => (
        storedInvocation?.id === id ? storedInvocation : null
      )),
      updateExecutionInvocation: vi.fn(),
      appendExecutionInvocationMessage: vi.fn(),
    };
    const activeDispatchRegistry = new ActiveDispatchRegistry();
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({
        ...DEFAULT_DASHBOARD_SETTINGS,
        cliWorkflow: {
          ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
          containerImage: "node:24-bookworm-slim",
          executionMode: "DOCKER",
          cleanupWorktreeOnFailure: true,
        },
      }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      activeDispatchRegistry,
      sprintRunLifecycleService: { finalizeCancellationIfIdle: vi.fn() },
      logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    vi.mocked(executePrepareStage).mockImplementation(async () => {
      await activeDispatchRegistry.requestStop("dispatch-1", SERVER_SHUTDOWN_STOP_REASON);
      throw new Error("Command aborted");
    });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: true });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      dispatchId: "dispatch-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(deps.sessionTracking.updateSession).not.toHaveBeenCalledWith("sess-1", { state: "CANCELLED" });
    expect(executionRepository.updateTaskRun).not.toHaveBeenCalled();
    expect(executionRepository.updateTaskDispatch).not.toHaveBeenCalled();
    expect(storedInvocation).toMatchObject({
      id: "xi-shutdown",
      status: "running",
    });
    expect(storedInvocation).not.toHaveProperty("finishedAt", expect.any(String));
    expect(executionRepository.updateExecutionInvocation).not.toHaveBeenCalled();
    expect(executeCleanupStage).not.toHaveBeenCalled();
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_workflow_shutdown_interrupted",
      "system",
      expect.objectContaining({ workspaceSessionId: "sess-1" }),
      expect.objectContaining({ sourceEventKey: "cli:shutdown-interrupted:sess-1" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_worktree_preserved",
      "system",
      expect.objectContaining({ worktreePath: expect.any(String) }),
      expect.any(Object),
    );
  });

  it("cancels during preparation once and ignores late workflow finalizers", async () => {
    let storedInvocation: Record<string, unknown> | null = null;
    const taskRun = {
      id: "run-cancel-preparation",
      projectId: "project-1",
      sprintId: "sprint-1",
      taskId: "task-1",
      sprintRunId: null,
      dispatchId: "dispatch-cancel-preparation",
      startedAt: "2026-07-13T00:00:00.000Z",
      prUrl: null,
      workerBranch: null,
    };
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue(taskRun),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue(null),
      createExecutionInvocation: vi.fn().mockImplementation((input: Record<string, unknown>) => {
        storedInvocation = { ...input, id: "xi-cancel-preparation" };
        return storedInvocation;
      }),
      getExecutionInvocation: vi.fn().mockImplementation((id: string) => (
        storedInvocation?.id === id ? storedInvocation : null
      )),
      updateExecutionInvocation: vi.fn().mockImplementation((_id: string, input: Record<string, unknown>) => {
        Object.assign(storedInvocation!, input);
        return storedInvocation;
      }),
      appendExecutionInvocationMessage: vi.fn(),
    };
    const activeDispatchRegistry = new ActiveDispatchRegistry();
    const deps = {
      sessionTracking: {
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      executionRepository,
      activeDispatchRegistry,
      getDashboardSettings: vi.fn().mockReturnValue(DEFAULT_DASHBOARD_SETTINGS),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(null) },
      getGithubToken: vi.fn().mockReturnValue(undefined),
      sprintRunLifecycleService: { finalizeCancellationIfIdle: vi.fn() },
      logger: { error: vi.fn(), warn: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    vi.mocked(executePrepareStage).mockImplementation(async () => {
      await activeDispatchRegistry.requestStop("dispatch-cancel-preparation", "dashboard_cancel");
      throw new Error("Command aborted");
    });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "codex",
      task: { id: "T1", record_id: "task-1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "session-cancel-preparation",
      dispatchId: "dispatch-cancel-preparation",
      taskRunId: "run-cancel-preparation",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(storedInvocation).toMatchObject({
      status: "cancelled",
      finishedAt: expect.any(String),
      errorMessage: "Workflow cancelled by dashboard control.",
      lastErrorMessage: "Workflow cancelled by dashboard control.",
    });
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-cancel-preparation",
      expect.objectContaining({ status: "cancelled" }),
    );
    const finalAuditCalls = executionRepository.appendExecutionInvocationMessage.mock.calls.filter(([, input]) => (
      input.metadata?.kind === "cli_workflow_finalized"
    ));
    expect(finalAuditCalls).toHaveLength(1);

    const invocationUpdateCount = executionRepository.updateExecutionInvocation.mock.calls.length;
    const taskRunUpdateCount = executionRepository.updateTaskRun.mock.calls.length;
    (service as any).finalizeExecutionInvocation(
      "xi-cancel-preparation",
      "completed",
      "2026-07-13T00:05:00.000Z",
    );
    (service as any).updateExecutionState({
      taskRunId: taskRun.id,
      sessionId: "session-cancel-preparation",
      workerBranch: "worker-1",
    }, {
      state: "COMPLETED",
      finishedAt: "2026-07-13T00:05:00.000Z",
      dispatchStatus: "completed",
    }, "xi-cancel-preparation");

    expect(executionRepository.updateExecutionInvocation).toHaveBeenCalledTimes(invocationUpdateCount);
    expect(executionRepository.updateTaskRun).toHaveBeenCalledTimes(taskRunUpdateCount);
    expect(executionRepository.appendExecutionInvocationMessage.mock.calls.filter(([, input]) => (
      input.metadata?.kind === "cli_workflow_finalized"
    ))).toHaveLength(1);
  });

  it("blocks unrecoverable git credential failures instead of leaving the task retryable", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        dispatchId: "dispatch-1",
        startedAt: "2026-03-10T00:00:00.000Z",
        prUrl: null,
        workerBranch: null,
        taskId: "task-1",
      }),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue(null),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue(undefined),
      executionRepository,
      projectManagementRepository: {
        updateTask: vi.fn(),
      },
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockRejectedValue(
      new Error("fatal: could not read Username for 'https://github.com': No such device or address"),
    );
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "BLOCKED" }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({
        status: "blocked",
        errorMessage: "fatal: could not read Username for 'https://github.com': No such device or address",
      }),
    );
    expect(deps.projectManagementRepository.updateTask).toHaveBeenCalledWith(
      "task-1",
      { status: "pending" },
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_workflow_blocked",
      "system",
      expect.objectContaining({
        category: "git_configuration",
        errorMessage: "fatal: could not read Username for 'https://github.com': No such device or address",
      }),
      expect.objectContaining({ sourceEventKey: undefined }),
    );
  });


  it("runs task workflow pipeline successfully", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        dispatchId: "dispatch-1",
        startedAt: "2026-03-10T00:00:00.000Z",
        prUrl: null,
        workerBranch: null,
      }),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue(null),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      sprintRunLifecycleService: {
        finalizeCancellationIfIdle: vi.fn(),
      },
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);
    const releaseWorkspaceReservation = vi.fn();
    const reserveWorkspaceHelper = vi.spyOn((service as any).workspaceManager, "reserveWorkspaceHelper")
      .mockReturnValue(releaseWorkspaceReservation);

    // Mock the external stages
    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeProviderStage } = await import("../../../src/services/cli-workflow/pipeline/execute-provider-stage.js");
    const { executeGitFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
    const { executePrFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" });
    vi.mocked(executeProviderStage).mockResolvedValue(buildProviderStageResult());
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({
      hasChanges: true,
      committedChanges: true,
      pushedBranch: "worker-1",
      stats: { filesChanged: 2, insertions: 10, deletions: 5 },
    });
    vi.mocked(executePrFinalizeStage).mockResolvedValue({ prUrl: "https://example.com/pr/1" });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: true });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executePrepareStage).toHaveBeenCalled();
    expect(executeProviderStage).toHaveBeenCalled();
    expect(executeGitFinalizeStage).toHaveBeenCalled();
    expect(executePrFinalizeStage).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ completionTimestamp: expect.any(String) }),
    );
    expect(executeCleanupStage).toHaveBeenCalled();
    expect(reserveWorkspaceHelper).toHaveBeenCalledWith(expect.stringMatching(/^docker-volume:\/\//));
    expect(releaseWorkspaceReservation).toHaveBeenCalledOnce();
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_prepare_started",
      "system",
      expect.any(Object),
      expect.objectContaining({ sourceEventKey: "cli:prepare:started" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_git_pushed",
      "system",
      expect.objectContaining({
        committedChanges: true,
        pushedBranch: "worker-1",
        filesChanged: 2,
        insertions: 10,
        deletions: 5,
      }),
      expect.objectContaining({ sourceEventKey: "cli:git:pushed:worker-1" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_pr_finalized",
      "system",
      expect.objectContaining({ prUrl: "https://example.com/pr/1", workerBranch: "worker-1" }),
      expect.objectContaining({ sourceEventKey: "cli:pr-finalized:worker-1" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_workflow_completed",
      "system",
      expect.objectContaining({ outcome: "pushed", prUrl: "https://example.com/pr/1" }),
      expect.any(Object),
    );
    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "COMPLETED", prUrl: "https://example.com/pr/1" }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-1",
      expect.objectContaining({ status: "completed" }),
    );
  });

  it.each([
    "terminal_provider_active_dispatch_mismatch",
    "shutdown_interrupted_after_provider_completion",
  ])("resumes Git finalization without invoking the provider twice after a restart crash window marked by %s", async (recoveryReason) => {
    let storedInvocation: Record<string, unknown> | null = null;
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "current-run",
        projectId: "project-1",
        sprintId: "sprint-1",
        taskId: "task-1",
        sprintRunId: "sprint-run-1",
        dispatchId: "current-dispatch",
        startedAt: "2026-07-11T00:25:28.000Z",
        prUrl: null,
        workerBranch: "worker-1",
      }),
      listProviderInvocationsForTask: vi.fn().mockReturnValue([
        {
          id: "completed-provider",
          purpose: "task_coding",
          taskRunId: "interrupted-run",
          status: "completed",
          finishedAt: "2026-07-11T00:25:26.000Z",
          updatedAt: "2026-07-11T00:25:26.000Z",
        },
      ]),
      listTaskRunEvents: vi.fn().mockReturnValue([
        {
          eventType: "cli_workspace_bound",
          payload: {
            worktreePath: "/repo/.worktrees/old-session",
            workspaceSessionId: "old-session",
          },
        },
        {
          eventType: "task_dispatch_reconciled",
          payload: {
            reason: recoveryReason,
            providerStatus: "completed",
          },
        },
      ]),
      getLatestTaskRunBySessionId: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue({ status: "running" }),
      createExecutionInvocation: vi.fn().mockImplementation((input: Record<string, unknown>) => {
        storedInvocation = { ...input, id: "current-recovered-workflow" };
        return storedInvocation;
      }),
      getExecutionInvocation: vi.fn().mockImplementation((id: string) => (
        storedInvocation?.id === id ? storedInvocation : null
      )),
      updateExecutionInvocation: vi.fn().mockImplementation((_id: string, input: Record<string, unknown>) => {
        Object.assign(storedInvocation!, input);
        return storedInvocation;
      }),
      appendExecutionInvocationMessage: vi.fn(),
      createProviderInvocationUsage: vi.fn(),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue(DEFAULT_DASHBOARD_SETTINGS),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      projectManagementRepository: { updateTask: vi.fn() },
      sprintRunLifecycleService: { finalizeCancellationIfIdle: vi.fn() },
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    vi.mocked(executePrepareStage).mockResolvedValue({
      providerPrompt: "unused recovery prompt",
      worktreePath: "/repo/.worktrees/old-session",
      initialHead: "abc123",
      resumed: true,
    });
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({
      hasChanges: true,
      committedChanges: true,
      pushedBranch: "worker-1",
    });
    vi.mocked(executePrFinalizeStage).mockResolvedValue({ prUrl: null });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "recovery-session",
      taskRunId: "current-run",
      workerBranch: "worker-1",
      title: "Title",
      resumeFromFailedSessionId: "old-session",
      resumeWorktreePath: "/repo/.worktrees/old-session",
    });

    expect(executionRepository.listProviderInvocationsForTask).toHaveBeenCalledWith(
      "project-1",
      "task-1",
    );
    expect(executeProviderStage).not.toHaveBeenCalled();
    expect(executionRepository.createProviderInvocationUsage).not.toHaveBeenCalled();
    expect(executeGitFinalizeStage).toHaveBeenCalledOnce();
    expect(storedInvocation).toMatchObject({
      id: "current-recovered-workflow",
      status: "completed",
      finishedAt: expect.any(String),
      errorMessage: null,
    });
    expect(executionRepository.updateTaskRun).toHaveBeenLastCalledWith(
      "current-run",
      expect.objectContaining({ state: "COMPLETED" }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenLastCalledWith(
      "current-dispatch",
      expect.objectContaining({ status: "completed" }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "current-run",
      "cli_provider_completion_recovered",
      "system",
      expect.objectContaining({ recoveredProviderInvocationId: "completed-provider" }),
      expect.objectContaining({ sourceEventKey: "cli:provider:completion-recovered:completed-provider" }),
    );
  });

  it.each([
    {
      name: "inherits a true global Docker root setting when the worker preset has no override",
      globalContainerRunAsRoot: true,
      agentContainerRunAsRoot: null,
      expectedContainerRunAsRoot: true,
    },
    {
      name: "inherits a false global Docker root setting for legacy worker presets",
      globalContainerRunAsRoot: false,
      agentContainerRunAsRoot: undefined,
      expectedContainerRunAsRoot: false,
    },
    {
      name: "forces Docker root mode when the resolved worker preset opts in",
      globalContainerRunAsRoot: false,
      agentContainerRunAsRoot: true,
      expectedContainerRunAsRoot: true,
    },
    {
      name: "forces non-root Docker mode when the resolved worker preset opts out",
      globalContainerRunAsRoot: true,
      agentContainerRunAsRoot: false,
      expectedContainerRunAsRoot: false,
    },
  ])("$name", async ({ globalContainerRunAsRoot, agentContainerRunAsRoot, expectedContainerRunAsRoot }) => {
    await runWorkflowForAgentRootMode({ globalContainerRunAsRoot, agentContainerRunAsRoot });

    expect(executeProviderStage).toHaveBeenCalledWith(
      expect.objectContaining({
        workflowSettings: expect.objectContaining({
          containerRunAsRoot: expectedContainerRunAsRoot,
        }),
      }),
      "mock prompt",
    );
  });

  it("runs task workflow pipeline and stops when no changes", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({ id: "run-1", startedAt: "2024-01-01T00:00:00Z", taskId: "T1", dispatchId: "dispatch-1" }),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue(null),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeGitFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
    const { executePrFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");

    vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" });
    vi.mocked(executeProviderStage).mockResolvedValue(buildProviderStageResult(
      "No repository changes were required.\nCODE_UX_TASK_OUTCOME: completed",
    ));
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({ hasChanges: false, committedChanges: false });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executePrFinalizeStage).not.toHaveBeenCalled();
    expect(executeCleanupStage).toHaveBeenCalled();
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_git_no_changes",
      "system",
      expect.any(Object),
      expect.any(Object)
    );
    // A no-changes run must NOT record a phantom worker branch — otherwise the
    // orchestrator treats it as merge evidence and falsely advances the task.
    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-1",
      expect.objectContaining({ state: "COMPLETED", workerBranch: null }),
    );
    // ensure no stats are emitted
    expect(executionRepository.appendTaskRunEvent).not.toHaveBeenCalledWith(
      "run-1",
      "cli_git_pushed",
      expect.anything(),
      expect.anything(),
      expect.anything()
    );
  });

  it.each([
    {
      name: "the coding agent reports an external blocker",
      transcriptText: [
        "The required release evidence is unavailable.",
        "CODE_UX_TASK_OUTCOME: blocked",
        "CODE_UX_BLOCKER: Required release evidence is missing.",
      ].join("\n"),
      expectedMessage: "Required release evidence is missing.",
      expectedCategory: "agent_reported_blocker",
    },
    {
      name: "the coding agent omits its required outcome",
      transcriptText: "I stopped before implementing the requested work.",
      expectedMessage: "Coding agent produced no repository changes and did not confirm a completed outcome.",
      expectedCategory: "agent_outcome_missing",
    },
  ])("parks a no-change task when $name", async ({ transcriptText, expectedMessage, expectedCategory }) => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-blocked",
        startedAt: "2026-07-11T08:00:00.000Z",
        taskId: "task-blocked",
        dispatchId: "dispatch-blocked",
      }),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      getSprintRun: vi.fn().mockReturnValue(null),
    };
    const deps = {
      sessionTracking: {
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      projectManagementRepository: { updateTask: vi.fn() },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  " } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" } as any);
    vi.mocked(executeProviderStage).mockResolvedValue(buildProviderStageResult(transcriptText));
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({ hasChanges: false, committedChanges: false });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "codex",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "session-blocked",
      taskRunId: "run-blocked",
      workerBranch: "worker-blocked",
      title: "Title",
    });

    expect(executionRepository.updateTaskRun).toHaveBeenCalledWith(
      "run-blocked",
      expect.objectContaining({ state: "BLOCKED", workerBranch: null }),
    );
    expect(executionRepository.updateTaskDispatch).toHaveBeenCalledWith(
      "dispatch-blocked",
      expect.objectContaining({
        status: "blocked",
        errorMessage: expectedMessage,
      }),
    );
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-blocked",
      "cli_workflow_blocked",
      "system",
      expect.objectContaining({ category: expectedCategory }),
      expect.any(Object),
    );
    expect(executionRepository.appendTaskRunEvent).not.toHaveBeenCalledWith(
      "run-blocked",
      "cli_git_no_changes",
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });


  it("resumes failed task in same workspace when configured", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue({ sessionId: "old-session", workerBranch: "worker/old-branch" }),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { resumeFailedTaskInSameWorkspace: true, executionMode: "docker" } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    (service as any).runTaskWorkflow = vi.fn().mockResolvedValue(undefined);

    // Mock the workspace manager
    (service as any).workspaceManager.resolveResumeWorktreePath = vi.fn().mockResolvedValue("/tmp/repo/.worktrees/old-session");

    const input = {
      provider: "gemini" as const,
      task: { id: "T1", prompt: "prompt", title: "title" } as any,
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
    };

    const session = await service.startTask(input);
    expect(deps.sessionTracking.appendActivity).toHaveBeenCalledWith(session.id, { originator: "system", description: "Retry configured to resume workspace from old-session at /tmp/repo/.worktrees/old-session." });
  });

  it("prefers the latest bound workspace over provider session telemetry when retrying", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue({ sessionId: "provider-session", workerBranch: "worker/provider-branch" }),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      executionRepository: {
        getTaskRun: vi.fn().mockReturnValue({ sprintRunId: "sprint-run-1" }),
        getLatestTaskWorkspaceResumeTarget: vi.fn().mockReturnValue({
          taskRunId: "previous-run",
          provider: "opencode",
          sessionId: "workspace-session",
          sessionName: "sessions/workspace-session",
          workerBranch: "worker/bound-branch",
          prUrl: null,
          worktreePath: "docker-volume://code-ux-project-workspace-session",
        }),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { resumeFailedTaskInSameWorkspace: true, executionMode: "docker" } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);
    (service as any).runTaskWorkflow = vi.fn().mockResolvedValue(undefined);
    (service as any).workspaceManager.resolveResumeWorktreePath = vi.fn();

    const session = await service.startTask({
      provider: "opencode",
      task: { id: "T01", record_id: "task-record-1", prompt: "prompt", title: "title" } as any,
      taskRecordId: "task-record-1",
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      taskRunId: "current-run",
    });

    expect(deps.executionRepository.getLatestTaskWorkspaceResumeTarget).toHaveBeenCalledWith("task-record-1", "sprint-run-1");
    expect((service as any).workspaceManager.resolveResumeWorktreePath).not.toHaveBeenCalled();
    expect(deps.sessionTracking.appendActivity).toHaveBeenCalledWith(session.id, {
      originator: "system",
      description: "Retry configured to resume workspace from workspace-session at docker-volume://code-ux-project-workspace-session.",
    });
    expect((service as any).runTaskWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      task: expect.objectContaining({ id: "T01", record_id: "task-record-1" }),
      taskRecordId: "task-record-1",
      workerBranch: "worker/bound-branch",
      resumeFromFailedSessionId: "workspace-session",
      resumeWorktreePath: "docker-volume://code-ux-project-workspace-session",
    }));
  });

  it("starts a task and returns a session", async () => {
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: {} }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);
    
    // We mock the private runTaskWorkflow to avoid side effects in this unit test
    (service as any).runTaskWorkflow = vi.fn().mockResolvedValue(undefined);

    const input = {
      provider: "gemini" as const,
      task: { id: "T1", prompt: "prompt", title: "title" } as any,
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
    };

    const session = await service.startTask(input);

    expect(session.id).toContain("cli-gemini-");
    expect(deps.sessionTracking.createSession).toHaveBeenCalled();
    expect((service as any).runTaskWorkflow).toHaveBeenCalled();
  });

  it("detects unpushed commits when worker branch has no remote ref yet", async () => {
    const service = buildService();
    service.prService.hasUnpushedCommits = vi.fn().mockResolvedValue(true);

    const detected = await service.hasUnpushedWorkerBranchCommits("/tmp/worktree", "worker/task-1", "feature/test");
    expect(detected).toBe(true);
    expect(service.prService.hasUnpushedCommits).toHaveBeenCalledWith(
      "/tmp/worktree",
      "worker/task-1",
      "feature/test",
      expect.any(Function),
    );
  });

  it("returns false when worker branch is already pushed and has no commits ahead", async () => {
    const service = buildService();
    service.prService.hasUnpushedCommits = vi.fn().mockResolvedValue(false);

    const detected = await service.hasUnpushedWorkerBranchCommits("/tmp/worktree", "worker/task-2", "feature/test");
    expect(detected).toBe(false);
  });

  it("detects existing worker-branch commits ahead of feature branch even when nothing is unpushed", async () => {
    const service = buildService();
    service.prService.hasWorkerBranchCommitsAgainstFeature = vi.fn().mockResolvedValue(true);

    const detected = await service.hasWorkerBranchCommitsAgainstFeature("/tmp/worktree", "feature/test", "worker/task-3");
    expect(detected).toBe(true);
    expect(service.prService.hasWorkerBranchCommitsAgainstFeature).toHaveBeenCalledWith(
      "/tmp/worktree",
      "worker/task-3",
      "feature/test",
      expect.any(Function),
    );
  });

  it("preserves successful workspace for active sprint task runs", async () => {
    const executionRepository = {
      getTaskRun: vi.fn().mockReturnValue({
        id: "run-1",
        sprintRunId: "sprint-run-1",
        startedAt: "2024-01-01T00:00:00Z",
        taskId: "T1",
        dispatchId: "dispatch-1",
      }),
      getSprintRun: vi.fn().mockReturnValue({ status: "running" }),
      updateTaskRun: vi.fn(),
      updateTaskDispatch: vi.fn(),
      appendTaskRunEvent: vi.fn(),
      finalizeSprintRunCancellationIfIdle: vi.fn(),
    };
    const deps = {
      sessionTracking: {
        findLatestFailedCliSessionForTask: vi.fn().mockReturnValue(null),
        createSession: vi.fn().mockImplementation((input) => ({ ...input, name: `sessions/${input.id}`, outputs: [] })),
        appendActivity: vi.fn(),
        updateSession: vi.fn(),
      },
      getDashboardSettings: vi.fn().mockReturnValue({ cliWorkflow: { containerImage: "  ", cleanupWorktreeOnSuccess: true } }),
      agentPresetSyncService: { getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }) },
      getGithubToken: vi.fn().mockReturnValue("token"),
      executionRepository,
      sprintRunLifecycleService: {
        finalizeCancellationIfIdle: vi.fn(),
      },
      logger: { error: vi.fn() },
    };
    const service = new CliWorkflowService(deps as any);

    const { executePrepareStage } = await import("../../../src/services/cli-workflow/pipeline/prepare-stage.js");
    const { executeGitFinalizeStage } = await import("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
    const { executeCleanupStage } = await import("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");
    vi.mocked(executePrepareStage).mockResolvedValue({ providerPrompt: "mock prompt" });
    vi.mocked(executeGitFinalizeStage).mockResolvedValue({ hasChanges: false, committedChanges: false });
    vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });

    await (service as any).runTaskWorkflow({
      provider: "gemini",
      task: { id: "T1", prompt: "prompt", title: "title" },
      repoPath: "/repo",
      featureBranch: "main",
      sprintNumber: 1,
      sessionId: "sess-1",
      taskRunId: "run-1",
      workerBranch: "worker-1",
      title: "Title",
    });

    expect(executeCleanupStage).toHaveBeenCalledWith(expect.objectContaining({
      preserveSuccessfulWorktreeForActiveSprint: true,
    }));
    expect(executionRepository.appendTaskRunEvent).toHaveBeenCalledWith(
      "run-1",
      "cli_workspace_bound",
      "system",
      expect.objectContaining({
        worktreePath: expect.any(String),
        workspaceSessionId: "sess-1",
      }),
      expect.any(Object),
    );
  });
});
