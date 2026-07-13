import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { DashboardSettings } from "../../../src/contracts/app-types.js";
import type { ExecutionInvocationRecord } from "../../../src/contracts/invocation-types.js";
import type {
  IProviderRunner,
  ProviderRunInput,
  ProviderRunResult,
} from "../../../src/infrastructure/providers/cli/provider-runner.js";
import type { ProviderUsageTelemetry } from "../../../src/infrastructure/providers/cli/provider-usage.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { ActiveDispatchRegistry } from "../../../src/services/active-dispatch-registry.js";
import { CliWorkflowService } from "../../../src/services/cli-workflow-service.js";
import { executeCleanupStage } from "../../../src/services/cli-workflow/pipeline/cleanup-stage.js";
import { executeGitFinalizeStage } from "../../../src/services/cli-workflow/pipeline/git-finalize-stage.js";
import { executePrFinalizeStage } from "../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js";
import { executePrepareStage } from "../../../src/services/cli-workflow/pipeline/prepare-stage.js";

vi.mock("../../../src/services/cli-workflow/pipeline/cleanup-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/git-finalize-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/pr-finalize-stage.js");
vi.mock("../../../src/services/cli-workflow/pipeline/prepare-stage.js");

const PROVIDER_PROMPT = "Implement the deterministic lifecycle fixture.";
const PROVIDER_TRANSCRIPT = [
  "Lifecycle fixture completed without external provider access.",
  "CODE_UX_TASK_OUTCOME: completed",
].join("\n");
const PROVIDER_MODEL = "mockup-lifecycle-model";
const PROVIDER_NATIVE_SESSION_ID = "native-lifecycle-session";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

interface WorkflowArgs {
  provider: "mockup-cli";
  providerSettingsOverride: {
    model: string;
    thinkingMode: "MEDIUM";
    apiKey: string;
    maxConcurrentTasks: number;
  };
  task: {
    id: string;
    record_id: string;
    prompt: string;
    title: string;
  };
  repoPath: string;
  featureBranch: string;
  sprintNumber: number;
  settingsScope: { projectId: string; sprintId: string };
  sessionId: string;
  dispatchId: string;
  taskRunId: string;
  workerBranch: string;
  title: string;
  resumeFromFailedSessionId?: string;
}

interface LifecycleHarness {
  storage: AppDbStorage;
  sessionTracking: SessionTrackingRepository;
  executionRepository: ExecutionRepository;
  projectManagementRepository: ProjectManagementRepository;
  activeDispatchRegistry: ActiveDispatchRegistry;
  service: CliWorkflowService;
  runProvider: ReturnType<typeof vi.fn<IProviderRunner["runProvider"]>>;
  logError: ReturnType<typeof vi.fn>;
  projectId: string;
  sprintId: string;
  sprintRunId: string;
  taskId: string;
  taskKey: string;
  taskTitle: string;
  dispatchId: string;
  taskRunId: string;
  repoPath: string;
  tempDir: string;
}

const harnesses: LifecycleHarness[] = [];

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function buildTelemetry(prompt = PROVIDER_PROMPT): ProviderUsageTelemetry {
  return {
    inputTokens: 17,
    cachedInputTokens: 3,
    outputTokens: 11,
    reasoningOutputTokens: 2,
    totalTokens: 31,
    usageSource: "reported",
    rawUsageJson: { fixture: "cli-invocation-lifecycle" },
    transcriptText: PROVIDER_TRANSCRIPT,
    nativeSessionId: PROVIDER_NATIVE_SESSION_ID,
    conversation: [
      { kind: "user", text: prompt },
      { kind: "assistant", text: PROVIDER_TRANSCRIPT },
    ],
  };
}

function buildProviderResult(prompt = PROVIDER_PROMPT): ProviderRunResult {
  return {
    ok: true,
    code: 0,
    stdout: PROVIDER_TRANSCRIPT,
    stderr: "",
    nativeSessionId: PROVIDER_NATIVE_SESSION_ID,
    usageTelemetry: buildTelemetry(prompt),
  };
}

function buildSettings(): DashboardSettings {
  const mockupCli = DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["mockup-cli"];
  const taskCodingRoute = DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting.task_coding;
  return {
    ...DEFAULT_DASHBOARD_SETTINGS,
    git: {
      ...DEFAULT_DASHBOARD_SETTINGS.git,
      githubMode: "LOCAL",
    },
    cliWorkflow: {
      ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
      executionMode: "HOST",
      gitMode: "local",
      cleanupWorktreeOnSuccess: false,
      cleanupWorktreeOnFailure: false,
    },
    aiProvider: {
      ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
      provider: "mockup-cli",
      strategy: "MANUAL",
      providers: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
        "mockup-cli": {
          ...mockupCli,
          enabled: true,
          model: PROVIDER_MODEL,
          maxConcurrentTasks: 1,
        },
      },
      invocationRouting: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting,
        task_coding: {
          ...taskCodingRoute,
          strategy: "MANUAL",
          provider: "mockup-cli",
          allowedProviders: ["mockup-cli"],
          providers: {
            "mockup-cli": {
              enabled: true,
              model: PROVIDER_MODEL,
              weight: 100,
            },
          },
        },
      },
    },
  };
}

async function createHarness(): Promise<LifecycleHarness> {
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-cli-invocation-lifecycle-"));
  const repoPath = path.join(tempDir, "repo");
  await fs.mkdir(repoPath, { recursive: true });

  const storage = new AppDbStorage(path.join(tempDir, "app.db"));
  const sessionTracking = new SessionTrackingRepository(path.join(tempDir, "session-tracking.db"));
  const executionRepository = new ExecutionRepository(storage);
  const projectManagementRepository = new ProjectManagementRepository(storage);
  const activeDispatchRegistry = new ActiveDispatchRegistry();
  const project = projectManagementRepository.createProject({
    name: "CLI invocation lifecycle fixture",
    sourceType: "local",
    sourceRef: repoPath,
    defaultBranch: "main",
  });
  const sprint = projectManagementRepository.createSprint(project.id, {
    name: "Invocation lifecycle sprint",
    goal: "Prove the persisted CLI invocation lifecycle.",
    featureBranch: "feature/invocation-lifecycle",
  });
  const task = projectManagementRepository.createTask(project.id, {
    sprintId: sprint.id,
    taskKey: "T01",
    title: "Exercise the CLI lifecycle",
    promptMarkdown: PROVIDER_PROMPT,
    status: "in_progress",
  });
  const sprintRun = executionRepository.createSprintRun({
    projectId: project.id,
    sprintId: sprint.id,
    executorMode: "docker_cli",
    status: "running",
  });
  const dispatch = executionRepository.createTaskDispatch({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task.id,
    sprintRunId: sprintRun.id,
    executorType: "docker_cli",
    status: "running",
  });
  const taskRun = executionRepository.createTaskRun({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task.id,
    sprintRunId: sprintRun.id,
    dispatchId: dispatch.id,
    provider: "mockup-cli",
    mode: "docker_cli",
    sessionId: "session-current",
    sessionName: "sessions/session-current",
    state: "RUNNING",
    workerBranch: "task/invocation-lifecycle",
    startedAt: new Date().toISOString(),
  });

  const runProvider = vi.fn<IProviderRunner["runProvider"]>(async (input: ProviderRunInput) => {
    const result = buildProviderResult(input.prompt);
    input.onTelemetry?.(result.usageTelemetry);
    return result;
  });
  const providerRunner: IProviderRunner = {
    runProvider,
    runProviderForText: vi.fn(async (input: ProviderRunInput) => ({
      ...buildProviderResult(input.prompt),
      text: PROVIDER_TRANSCRIPT,
    })),
  };
  const logError = vi.fn();
  const service = new CliWorkflowService({
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
    getDashboardSettings: () => buildSettings(),
    agentPresetSyncService: {
      resolveTargetedCodingAgent: vi.fn().mockResolvedValue(null),
      getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(null),
    },
    getGithubToken: () => undefined,
    sprintRunLifecycleService: {
      finalizeCancellationIfIdle: vi.fn(),
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: logError,
      child: vi.fn(),
    },
  });
  (service as unknown as { providerRunner: IProviderRunner }).providerRunner = providerRunner;

  const harness: LifecycleHarness = {
    storage,
    sessionTracking,
    executionRepository,
    projectManagementRepository,
    activeDispatchRegistry,
    service,
    runProvider,
    logError,
    projectId: project.id,
    sprintId: sprint.id,
    sprintRunId: sprintRun.id,
    taskId: task.id,
    taskKey: task.taskKey,
    taskTitle: task.title,
    dispatchId: dispatch.id,
    taskRunId: taskRun.id,
    repoPath,
    tempDir,
  };
  harnesses.push(harness);
  return harness;
}

function startWorkflow(
  harness: LifecycleHarness,
  options: { sessionId?: string; resumeFromFailedSessionId?: string } = {},
): Promise<void> {
  const sessionId = options.sessionId ?? "session-current";
  harness.sessionTracking.createSession({
    id: sessionId,
    provider: "mockup-cli",
    taskId: harness.taskKey,
    title: harness.taskTitle,
    prompt: PROVIDER_PROMPT,
    state: "RUNNING",
    featureBranch: "feature/invocation-lifecycle",
    workerBranch: "task/invocation-lifecycle",
    repoPath: harness.repoPath,
  });
  const args: WorkflowArgs = {
    provider: "mockup-cli",
    providerSettingsOverride: {
      model: PROVIDER_MODEL,
      thinkingMode: "MEDIUM",
      apiKey: "",
      maxConcurrentTasks: 1,
    },
    task: {
      id: harness.taskKey,
      record_id: harness.taskId,
      prompt: PROVIDER_PROMPT,
      title: harness.taskTitle,
    },
    repoPath: harness.repoPath,
    featureBranch: "feature/invocation-lifecycle",
    sprintNumber: 1,
    settingsScope: { projectId: harness.projectId, sprintId: harness.sprintId },
    sessionId,
    dispatchId: harness.dispatchId,
    taskRunId: harness.taskRunId,
    workerBranch: "task/invocation-lifecycle",
    title: harness.taskTitle,
    resumeFromFailedSessionId: options.resumeFromFailedSessionId,
  };

  return (harness.service as unknown as {
    runTaskWorkflow: (input: WorkflowArgs) => Promise<void>;
  }).runTaskWorkflow(args);
}

function queryTaskInvocations(harness: LifecycleHarness): ExecutionInvocationRecord[] {
  return harness.executionRepository.queryProjectInvocations({
    projectId: harness.projectId,
    limit: 50,
    sortKey: "startedAt",
    sortDir: "desc",
  }).items.filter((invocation) => invocation.taskId === harness.taskId);
}

async function waitForPreparationStart(
  harness: LifecycleHarness,
  preparationStarted: Promise<void>,
  workflow: Promise<void>,
): Promise<void> {
  await Promise.race([
    preparationStarted,
    workflow.then(() => {
      throw new Error(`Workflow settled before preparation started: ${JSON.stringify(harness.logError.mock.calls)}`);
    }),
  ]);
}

function expectTerminalAudit(
  harness: LifecycleHarness,
  invocationId: string,
  status: "completed" | "failed" | "cancelled",
  text: string,
): void {
  const auditMessages = harness.executionRepository
    .listExecutionInvocationMessages(invocationId)
    .filter((message) => message.metadata?.kind === "cli_workflow_finalized");
  expect(auditMessages).toHaveLength(1);
  expect(auditMessages[0]).toMatchObject({
    role: "system",
    contentMarkdown: expect.stringContaining(text),
    metadata: expect.objectContaining({ status }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(executeCleanupStage).mockResolvedValue({ cleanedUp: false });
  vi.mocked(executeGitFinalizeStage).mockResolvedValue({
    hasChanges: true,
    committedChanges: true,
    pushedBranch: "task/invocation-lifecycle",
  });
  vi.mocked(executePrFinalizeStage).mockResolvedValue({
    prUrl: "https://example.test/pull/1",
  });
});

afterEach(async () => {
  for (const harness of harnesses.splice(0)) {
    harness.sessionTracking.getDatabase().close();
    harness.storage.close();
    await fs.rm(harness.tempDir, { recursive: true, force: true });
  }
});

describe("CLI invocation lifecycle integration", () => {
  it("fans in preparation, provider usage, transcript, and workflow finalization into one invocation", async () => {
    const harness = await createHarness();
    const preparationStarted = createDeferred<void>();
    const releasePreparation = createDeferred<void>();
    vi.mocked(executePrepareStage).mockImplementation(async () => {
      preparationStarted.resolve();
      await releasePreparation.promise;
      return { providerPrompt: PROVIDER_PROMPT, resumed: false };
    });

    const workflow = startWorkflow(harness);
    await waitForPreparationStart(harness, preparationStarted.promise, workflow);

    const earlyInvocations = queryTaskInvocations(harness);
    expect(earlyInvocations).toHaveLength(1);
    const [earlyInvocation] = earlyInvocations;
    expect(earlyInvocation).toMatchObject({
      projectId: harness.projectId,
      sprintId: harness.sprintId,
      taskId: harness.taskId,
      sprintRunId: harness.sprintRunId,
      dispatchId: harness.dispatchId,
      taskRunId: harness.taskRunId,
      providerInvocationId: null,
      type: "cli_task_coding",
      status: "running",
      provider: "mockup-cli",
      model: PROVIDER_MODEL,
      invocationSource: "internal",
    });
    expect(earlyInvocation.id).toEqual(expect.any(String));
    expect(earlyInvocation.finishedAt).toBeNull();
    expect(harness.executionRepository.listProviderInvocationsForTask(
      harness.projectId,
      harness.taskId,
    )).toEqual([]);
    expect(harness.executionRepository.listExecutionInvocationMessages(earlyInvocation.id)).toEqual([
      expect.objectContaining({
        role: "system",
        contentMarkdown: "Preparing the task workspace and mockup-cli configuration.",
        metadata: expect.objectContaining({ kind: "preparation_started", model: PROVIDER_MODEL }),
      }),
    ]);

    releasePreparation.resolve();
    await workflow;

    const terminalInvocations = queryTaskInvocations(harness);
    expect(terminalInvocations).toHaveLength(1);
    const [terminalInvocation] = terminalInvocations;
    expect(terminalInvocation.id).toBe(earlyInvocation.id);
    expect(terminalInvocation).toMatchObject({
      status: "completed",
      finishedAt: expect.any(String),
      errorMessage: null,
      lastErrorMessage: null,
      providerInvocationId: expect.any(String),
      executionMode: "HOST",
      inputTokens: 17,
      cachedInputTokens: 3,
      outputTokens: 11,
      totalTokens: 31,
    });
    expect(harness.executionRepository.queryProjectInvocations({
      projectId: harness.projectId,
      purpose: "task_coding",
      limit: 50,
    }).items.map((invocation) => invocation.id)).toEqual([terminalInvocation.id]);

    const providerInvocations = harness.executionRepository.listProviderInvocationsForTask(
      harness.projectId,
      harness.taskId,
    );
    expect(providerInvocations).toHaveLength(1);
    expect(providerInvocations[0]).toMatchObject({
      id: terminalInvocation.providerInvocationId,
      projectId: harness.projectId,
      sprintId: harness.sprintId,
      taskId: harness.taskId,
      sprintRunId: harness.sprintRunId,
      dispatchId: harness.dispatchId,
      taskRunId: harness.taskRunId,
      sessionId: "session-current",
      provider: "mockup-cli",
      purpose: "task_coding",
      status: "completed",
      model: PROVIDER_MODEL,
      executionMode: "HOST",
      nativeSessionId: PROVIDER_NATIVE_SESSION_ID,
      finishedAt: expect.any(String),
      inputTokens: 17,
      cachedInputTokens: 3,
      outputTokens: 11,
      reasoningOutputTokens: 2,
      totalTokens: 31,
    });
    expect(harness.runProvider).toHaveBeenCalledOnce();

    const messages = harness.executionRepository.listExecutionInvocationMessages(terminalInvocation.id);
    expect(messages).toHaveLength(4);
    expect(messages.map(({ role, contentMarkdown }) => ({ role, contentMarkdown }))).toEqual([
      {
        role: "system",
        contentMarkdown: "Preparing the task workspace and mockup-cli configuration.",
      },
      { role: "user", contentMarkdown: PROVIDER_PROMPT },
      { role: "assistant", contentMarkdown: PROVIDER_TRANSCRIPT },
      { role: "system", contentMarkdown: "CLI workflow completed successfully." },
    ]);
    expectTerminalAudit(harness, terminalInvocation.id, "completed", "completed successfully");
    expect(harness.executionRepository.getTaskRun(harness.taskRunId)).toMatchObject({
      state: "COMPLETED",
      finishedAt: expect.any(String),
      prUrl: "https://example.test/pull/1",
    });
    expect(harness.executionRepository.getTaskDispatch(harness.dispatchId)).toMatchObject({
      status: "completed",
      finishedAt: expect.any(String),
    });
  });

  it("settles an early preparation failure with one failed audit row and no provider claim", async () => {
    const harness = await createHarness();
    const preparationStarted = createDeferred<void>();
    const releaseFailure = createDeferred<void>();
    vi.mocked(executePrepareStage).mockImplementation(async () => {
      preparationStarted.resolve();
      await releaseFailure.promise;
      throw new Error("Deterministic preparation failure");
    });

    const workflow = startWorkflow(harness);
    await waitForPreparationStart(harness, preparationStarted.promise, workflow);
    const [earlyInvocation] = queryTaskInvocations(harness);
    expect(earlyInvocation).toMatchObject({ status: "running", providerInvocationId: null });

    releaseFailure.resolve();
    await workflow;

    const invocations = queryTaskInvocations(harness);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      id: earlyInvocation.id,
      status: "failed",
      finishedAt: expect.any(String),
      errorMessage: "Deterministic preparation failure",
      lastErrorMessage: "Deterministic preparation failure",
      providerInvocationId: null,
    });
    expectTerminalAudit(harness, earlyInvocation.id, "failed", "Deterministic preparation failure");
    expect(harness.executionRepository.listProviderInvocationsForTask(
      harness.projectId,
      harness.taskId,
    )).toEqual([]);
    expect(harness.runProvider).not.toHaveBeenCalled();
  });

  it("settles preparation cancellation once and prevents a late provider claim", async () => {
    const harness = await createHarness();
    const preparationStarted = createDeferred<void>();
    const releasePreparation = createDeferred<void>();
    vi.mocked(executePrepareStage).mockImplementation(async (ctx) => {
      preparationStarted.resolve();
      await releasePreparation.promise;
      if (ctx.abortSignal.aborted) {
        throw new Error("Command aborted");
      }
      return { providerPrompt: PROVIDER_PROMPT, resumed: false };
    });

    const workflow = startWorkflow(harness);
    await waitForPreparationStart(harness, preparationStarted.promise, workflow);
    const [earlyInvocation] = queryTaskInvocations(harness);
    expect(earlyInvocation).toMatchObject({ status: "running", providerInvocationId: null });

    await harness.activeDispatchRegistry.requestStop(harness.dispatchId, "dashboard_cancel");
    releasePreparation.resolve();
    await workflow;

    const invocations = queryTaskInvocations(harness);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      id: earlyInvocation.id,
      status: "cancelled",
      finishedAt: expect.any(String),
      errorMessage: "Workflow cancelled by dashboard control.",
      lastErrorMessage: "Workflow cancelled by dashboard control.",
      providerInvocationId: null,
    });
    expectTerminalAudit(harness, earlyInvocation.id, "cancelled", "cancelled");
    expect(harness.executionRepository.listProviderInvocationsForTask(
      harness.projectId,
      harness.taskId,
    )).toEqual([]);
    expect(harness.runProvider).not.toHaveBeenCalled();
    expect(harness.executionRepository.getTaskDispatch(harness.dispatchId)).toMatchObject({
      status: "cancelled",
      finishedAt: expect.any(String),
    });
  });

  it("recovers completed provider work without a second claim or a stale running workflow row", async () => {
    const harness = await createHarness();
    const priorDispatch = harness.executionRepository.createTaskDispatch({
      projectId: harness.projectId,
      sprintId: harness.sprintId,
      taskId: harness.taskId,
      sprintRunId: harness.sprintRunId,
      executorType: "docker_cli",
      status: "failed",
    });
    const priorTaskRun = harness.executionRepository.createTaskRun({
      projectId: harness.projectId,
      sprintId: harness.sprintId,
      taskId: harness.taskId,
      sprintRunId: harness.sprintRunId,
      dispatchId: priorDispatch.id,
      provider: "mockup-cli",
      mode: "docker_cli",
      sessionId: "session-prior",
      sessionName: "sessions/session-prior",
      state: "FAILED",
      workerBranch: "task/invocation-lifecycle",
      startedAt: "2026-07-13T00:00:00.000Z",
      finishedAt: "2026-07-13T00:01:00.000Z",
    });
    const recoveredProvider = harness.executionRepository.createProviderInvocationUsage({
      projectId: harness.projectId,
      sprintId: harness.sprintId,
      taskId: harness.taskId,
      sprintRunId: harness.sprintRunId,
      dispatchId: priorDispatch.id,
      taskRunId: priorTaskRun.id,
      sessionId: "session-prior",
      provider: "mockup-cli",
      purpose: "task_coding",
      status: "running",
      model: PROVIDER_MODEL,
      executionMode: "HOST",
      startedAt: "2026-07-13T00:00:00.000Z",
    });
    harness.executionRepository.updateProviderInvocationUsage(recoveredProvider.id, {
      status: "completed",
      nativeSessionId: "native-recovered-session",
      finishedAt: "2026-07-13T00:00:30.000Z",
      totalTokens: 19,
      usageSource: "reported",
    });
    harness.executionRepository.appendTaskRunEvent(
      priorTaskRun.id,
      "task_dispatch_reconciled",
      "system",
      {
        reason: "terminal_provider_active_dispatch_mismatch",
        providerStatus: "completed",
      },
    );
    harness.executionRepository.appendTaskRunEvent(
      priorTaskRun.id,
      "cli_workspace_bound",
      "system",
      { workspaceSessionId: "session-prior" },
    );
    vi.mocked(executePrepareStage).mockResolvedValue({
      providerPrompt: PROVIDER_PROMPT,
      resumed: true,
    });

    await startWorkflow(harness, {
      sessionId: "session-current",
      resumeFromFailedSessionId: "session-prior",
    });

    const providerInvocations = harness.executionRepository.listProviderInvocationsForTask(
      harness.projectId,
      harness.taskId,
    );
    expect(providerInvocations).toHaveLength(1);
    expect(providerInvocations[0]).toMatchObject({
      id: recoveredProvider.id,
      status: "completed",
      nativeSessionId: "native-recovered-session",
    });
    expect(harness.runProvider).not.toHaveBeenCalled();

    const invocations = queryTaskInvocations(harness);
    expect(invocations).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      type: "cli_task_coding",
      status: "completed",
      finishedAt: expect.any(String),
      providerInvocationId: null,
    });
    expect(invocations.some((invocation) => invocation.status === "running")).toBe(false);
    expectTerminalAudit(harness, invocations[0]!.id, "completed", "completed successfully");
    expect(harness.executionRepository.listTaskRunEvents(harness.taskRunId)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "cli_provider_completion_recovered",
          payload: expect.objectContaining({ recoveredProviderInvocationId: recoveredProvider.id }),
        }),
      ]),
    );
  });
});
