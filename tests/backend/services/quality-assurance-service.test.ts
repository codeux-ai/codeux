import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { QaReviewRepository } from "../../../src/repositories/qa-review-repository.js";
import { AgentPresetRepository } from "../../../src/repositories/agent-preset-repository.js";
import { QualityAssuranceService } from "../../../src/services/quality-assurance-service.js";
import { StructuredProviderResponseService } from "../../../src/services/structured-provider-response-service.js";
import { StructuredAgentRequestService } from "../../../src/services/structured-agent-request-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

/** Permissive guardrail stub: QA review runs are always allowed unless a test overrides it. */
const qaGuardrailStub = () => ({
  evaluate: vi.fn().mockReturnValue({ allowed: true, count: 0, cap: 0, action: "WARN_ONLY" }),
  evaluateQa: vi.fn().mockReturnValue({ allowed: true, count: 0, cap: 0, action: "WARN_ONLY" }),
  record: vi.fn(),
  getCounts: vi.fn(),
  reset: vi.fn(),
}) as any;

vi.mock("../../../src/services/git-branch-sync-service.js", () => ({
  fetchOriginIfAvailable: vi.fn(),
  syncRemoteBranchIfAvailable: vi.fn(),
}));

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "" }),
}));

vi.mock("../../../src/shared/subprocess/command-runner.js", () => ({
  commandRunner: {
    run: vi.fn().mockResolvedValue({ ok: true, stdout: "", stderr: "" }),
  },
}));

vi.mock("../../../src/infrastructure/git/local-merge.js", () => ({
  findRecoverableWorkerBranch: vi.fn(),
}));

import { syncRemoteBranchIfAvailable } from "../../../src/services/git-branch-sync-service.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";
import { commandRunner } from "../../../src/shared/subprocess/command-runner.js";
import { findRecoverableWorkerBranch } from "../../../src/infrastructure/git/local-merge.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(syncRemoteBranchIfAvailable).mockResolvedValue(true);
});

describe("QualityAssuranceService.resolveReviewBranch", () => {
  const makeService = (updateTaskRun = vi.fn()) =>
    new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: { updateTaskRun } as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

  it("prefers the recorded worker branch on the task without recovering", async () => {
    const service = makeService();
    const branch = await (service as any).resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: "task/feature-x-t01-claude-code-abc" },
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" },
      repoPath: "/repo",
      featureBranch: "feature/x",
      githubMode: "LOCAL",
    });
    expect(branch).toBe("task/feature-x-t01-claude-code-abc");
    expect(findRecoverableWorkerBranch).not.toHaveBeenCalled();
  });

  it("falls back to the latest run's worker branch when the task has none", async () => {
    const service = makeService();
    const branch = await (service as any).resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined },
      taskRun: { id: "run-1", workerBranch: "task/feature-x-t01-claude-code-def", provider: "claude-code" },
      repoPath: "/repo",
      featureBranch: "feature/x",
      githubMode: "LOCAL",
    });
    expect(branch).toBe("task/feature-x-t01-claude-code-def");
    expect(findRecoverableWorkerBranch).not.toHaveBeenCalled();
  });

  it("recovers the worker branch from local refs in LOCAL mode when metadata was lost", async () => {
    vi.mocked(findRecoverableWorkerBranch).mockResolvedValue("task/feature-x-t01-claude-code-ghi");
    const updateTaskRun = vi.fn();
    const service = makeService(updateTaskRun);
    const task: any = { id: "T01", provider: "claude-code", worker_branch: undefined };
    const taskRun: any = { id: "run-1", workerBranch: null, provider: "claude-code" };

    const branch = await (service as any).resolveReviewBranch({
      task,
      taskRun,
      repoPath: "/repo",
      featureBranch: "feature/x",
      githubMode: "LOCAL",
    });

    expect(branch).toBe("task/feature-x-t01-claude-code-ghi");
    expect(findRecoverableWorkerBranch).toHaveBeenCalledWith(
      expect.objectContaining({ repoPath: "/repo", featureBranch: "feature/x" }),
    );
    // Backfilled onto the task and the run so the fix path / merge gate agree.
    expect(task.worker_branch).toBe("task/feature-x-t01-claude-code-ghi");
    expect(taskRun.workerBranch).toBe("task/feature-x-t01-claude-code-ghi");
    expect(updateTaskRun).toHaveBeenCalledWith("run-1", { workerBranch: "task/feature-x-t01-claude-code-ghi" });
  });

  it("falls back to the feature branch when no worker branch with real work exists", async () => {
    vi.mocked(findRecoverableWorkerBranch).mockResolvedValue(null);
    const service = makeService();
    const branch = await (service as any).resolveReviewBranch({
      task: { id: "T04", provider: "qwen-code", worker_branch: undefined },
      taskRun: { id: "run-4", workerBranch: null, provider: "qwen-code" },
      repoPath: "/repo",
      featureBranch: "feature/x",
      githubMode: "LOCAL",
    });
    expect(branch).toBe("feature/x");
    expect(findRecoverableWorkerBranch).toHaveBeenCalled();
  });

  it("does not attempt local-ref recovery in REMOTE mode", async () => {
    const service = makeService();
    const branch = await (service as any).resolveReviewBranch({
      task: { id: "T01", provider: "claude-code", worker_branch: undefined },
      taskRun: { id: "run-1", workerBranch: null, provider: "claude-code" },
      repoPath: "/repo",
      featureBranch: "feature/x",
      githubMode: "REMOTE",
    });
    expect(branch).toBe("feature/x");
    expect(findRecoverableWorkerBranch).not.toHaveBeenCalled();
  });
});

describe("QualityAssuranceService", () => {
  it("runs QA reviews against a snapshot workspace and cleans it up afterwards", async () => {
    const executeRequest = vi.fn().mockResolvedValue({
      parsed: {
        verdict: "pass",
        summary: "Looks good.",
        findings: [],
        fixInstructions: null,
        targetTaskKey: null,
        shouldHavePr: true,
        followUpTasks: [],
        raw: {},
      },
      sessionId: "qa-session-1",
      invocationId: "inv-1",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {
        resolveInvocationProvider: () => ({
          provider: "codex",
          providerConfigId: "codex",
          providers: { codex: { model: "gpt-5.3-codex", apiKey: "key", thinkingMode: "HIGH" } },
        }),
      } as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      structuredAgentRequestService: {
        executeRequest,
      } as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const createSnapshotWorkspace = vi.spyOn((service as any).workspaceManager, "createSnapshotWorkspace")
      .mockResolvedValue("docker-volume://qa-snapshot");
    const removeWorktree = vi.spyOn((service as any).workspaceManager, "removeWorktree")
      .mockResolvedValue(undefined);

    const result = await (service as any).runReview({
      triggerType: "sprint_completion",
      scope: { projectId: "project-1", sprintId: "sprint-1" },
      projectName: "QA Project",
      sprintGoal: "Ship safely",
      repoPath: "/repo/project",
      agentInstructions: "Review carefully.",
      subtasks: [],
      currentTask: null,
      taskRun: null,
      sprintRunId: null,
      agentPresetId: null,
    });

    expect(result.verdict).toBe("pass");
    expect(createSnapshotWorkspace).toHaveBeenCalled();
    expect(executeRequest).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "docker-volume://qa-snapshot",
    }));
    expect(removeWorktree).toHaveBeenCalledWith("/repo/project", "docker-volume://qa-snapshot");
  });

  it("builds sprint review prompts with the full task instructions", async () => {
    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const prompt = (service as any).buildReviewPrompt({
      triggerType: "sprint_completion",
      projectName: "QA Project",
      sprintGoal: "Ship safely",
      agentInstructions: "Review the full sprint.",
      subtasks: [
        {
          id: "T1",
          title: "First task",
          prompt: "Implement the API contract end to end.",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
          activities: [],
        },
        {
          id: "T2",
          title: "Second task",
          prompt: "Wire the dashboard to the new backend endpoint.",
          depends_on: ["T1"],
          is_independent: false,
          status: "COMPLETED",
          activities: [],
        },
      ],
      currentTask: null,
    });

    expect(prompt).toContain("## FULL TASK INSTRUCTIONS");
    expect(prompt).toContain("Implement the API contract end to end.");
    expect(prompt).toContain("Wire the dashboard to the new backend endpoint.");
    expect(prompt).toContain('"followUpTasks"');
  });

  it("builds task review prompts that scope QA to only the current task branch", async () => {
    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const currentTask = {
      id: "T01",
      title: "Update alpha.md",
      prompt: "Write exactly one line to alpha.md.",
      depends_on: [],
      is_independent: true,
      status: "CODING_COMPLETED",
      provider: "qwen-code",
      worker_branch: "task/update-alpha",
      pr_url: "https://example.test/pull/1",
      activities: [],
    };
    const prompt = (service as any).buildReviewPrompt({
      triggerType: "task_completion",
      projectName: "Smoke Sprint",
      sprintGoal: "Update five markdown files.",
      agentInstructions: "Review critically.",
      subtasks: [
        currentTask,
        {
          id: "T02",
          title: "Update beta.md",
          prompt: "Write exactly one line to beta.md.",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
          provider: "qwen-code",
          worker_branch: "task/update-beta",
          pr_url: "https://example.test/pull/2",
          activities: [],
        },
      ],
      currentTask,
    });

    expect(prompt).toContain("## REVIEW SCOPE");
    expect(prompt).toContain("This is a single-task QA review. The only task under review is T01.");
    expect(prompt).toContain("## FULL TASK INSTRUCTIONS (SPRINT CONTEXT; ONLY CURRENT TASK IS UNDER REVIEW)");
    expect(prompt).toContain("## CURRENT TASK UNDER REVIEW");
    expect(prompt).toContain("Assume the current workspace/branch contains only the current task's changes on top of its base branch.");
    expect(prompt).toContain("A task-level review must pass when the current task satisfies its own prompt");
    expect(prompt).toContain("Do not request changes because files, commits, PRs, or behavior from other completed sibling tasks are missing from this branch.");
    expect(prompt).toContain("Do not tell the coding session to implement, restore, or modify another task's scope.");
    expect(prompt).toContain("For task-level reviews, review only the current task and return `targetTaskKey` as the current task key when changes are required.");
    expect(prompt).toContain("Write exactly one line to beta.md.");
  });

  it("creates sprint follow-up tasks from QA output", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "completed",
      isIndependent: true,
    });
    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository: new ExecutionRepository(storage),
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const createdTasks = (service as any).createSprintFollowUpTasks({
      projectId: project.id,
      sprintId: sprint.id,
      targetTask: null,
      fixInstructions: null,
      review: {
        verdict: "changes_requested",
        summary: "Need one more hardening pass.",
        findings: ["Missing rollback coverage."],
        fixInstructions: null,
        targetTaskKey: null,
        shouldHavePr: null,
        followUpTasks: [
          {
            title: "Add rollback coverage",
            promptMarkdown: "Add integration coverage for the rollback path and verify cleanup semantics.",
            description: "Cover the regression that QA found.",
            dependsOnTaskKeys: ["T1"],
            priority: "high",
          },
        ],
        raw: {},
      },
      existingSubtasks: [
        {
          record_id: task.id,
          project_id: project.id,
          sprint_id: sprint.id,
          id: "T1",
          title: "Initial task",
          prompt: "Implement the initial feature.",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
        },
      ],
      sourceRunId: "qa-run-1",
    });

    const tasks = projectRepository.listTasks(project.id, sprint.id);
    expect(createdTasks).toHaveLength(1);
    expect(tasks).toHaveLength(2);
    expect(tasks[1]?.title).toBe("Add rollback coverage");
    expect(tasks[1]?.promptMarkdown).toContain("rollback path");
    expect(tasks[1]?.dependsOnTaskIds).toEqual([task.id]);
  });

  it("does not rerun sprint QA after a passing result with no meaningful sprint changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-pass-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const providerRunner = {
      runProviderForText: vi.fn(),
      runProvider: vi.fn(),
    };

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: providerRunner as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 1,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const subtasks = [
      {
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
      },
    ];
    const snapshot = JSON.stringify([
      {
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        status: "COMPLETED",
        dependsOn: [],
        isMerged: false,
        mergeIndicator: "",
      },
    ]);
    const run = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      triggerType: "sprint_completion",
      runIndex: 1,
    });
    qaReviewRepository.updateRun(run.id, {
      status: "completed",
      outcome: "pass",
      summaryMarkdown: "Looks good.",
      payload: { taskSnapshot: snapshot },
      finishedAt: new Date().toISOString(),
    });

    const outcome = await service.reviewSprintCompletion({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      repoPath: dir,
      subtasks: subtasks as any,
    });

    expect(outcome).toEqual({
      reviewed: false,
      blockedCompletion: false,
      mergeBlocked: false,
      reportText: "",
    });
    expect(providerRunner.runProviderForText).not.toHaveBeenCalled();
  });

  it("does not rerun sprint QA after fixes when maxSprintReviewRuns is 1", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-max-runs-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const providerRunner = {
      runProviderForText: vi.fn(),
      runProvider: vi.fn(),
    };

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: providerRunner as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 1,
            maxSprintReviewRuns: 1,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const initialSubtasks = [
      {
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
      },
    ];
    const initialSnapshot = JSON.stringify([
      {
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        status: "COMPLETED",
        dependsOn: [],
        isMerged: false,
        mergeIndicator: "",
      },
    ]);
    const run = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      triggerType: "sprint_completion",
      runIndex: 1,
    });
    qaReviewRepository.updateRun(run.id, {
      status: "completed",
      outcome: "changes_requested",
      summaryMarkdown: "Needs a follow-up fix.",
      payload: { taskSnapshot: initialSnapshot },
      finishedAt: new Date().toISOString(),
    });

    projectRepository.updateTask(task.id, {
      promptMarkdown: "Implement the initial feature with the QA fix applied.",
    });

    const outcome = await service.reviewSprintCompletion({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      repoPath: dir,
      subtasks: [
        {
          record_id: task.id,
          project_id: project.id,
          sprint_id: sprint.id,
          id: "T1",
          title: "Initial task",
          prompt: "Implement the initial feature with the QA fix applied.",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
        },
      ] as any,
    });

    expect(outcome).toEqual({
      reviewed: false,
      blockedCompletion: false,
      mergeBlocked: false,
      reportText: "",
    });
    expect(providerRunner.runProviderForText).not.toHaveBeenCalled();
  });

  it("recovers stale running task QA rows when the backing invocation already finished", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-stale-task-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      state: "COMPLETED",
      provider: "jules",
      sessionId: "session-1",
      startedAt: "2026-04-11T09:00:00.000Z",
      finishedAt: "2026-04-11T09:10:00.000Z",
    });

    const staleRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      triggerType: "task_completion",
      runIndex: 1,
      startedAt: "2026-04-11T09:11:00.000Z",
    });
    executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      type: "qa_review",
      status: "completed",
      provider: "gemini",
      model: "auto",
      startedAt: "2026-04-11T09:11:01.000Z",
      finishedAt: "2026-04-11T09:16:00.000Z",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 1,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const gate = service.getTaskMergeGateStatus({
      projectId: project.id,
      sprintId: sprint.id,
      task: {
        record_id: task.id,
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        pr_url: "https://example.com/pr/1",
      },
    });

    expect(gate.reason).toBe("review_failed");
    expect(gate.latestRun?.status).toBe("failed");
    expect(gate.latestRun?.summaryMarkdown).toContain("Recovered stale QA review run");
    expect(qaReviewRepository.getRun(staleRun.id)?.status).toBe("failed");
  });

  it("keeps merge blocked when latest QA requested changes at the retry cap", () => {
    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {
        getLatestTaskRun: vi.fn().mockReturnValue({
          id: "qa-run-1",
          taskId: "task-1",
          status: "completed",
          outcome: "changes_requested",
          summaryMarkdown: "Still needs fixes.",
          runIndex: 3,
        }),
        countTaskRuns: vi.fn().mockReturnValue(3),
        countDecisiveTaskRuns: vi.fn().mockReturnValue(3),
      } as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const gate = service.getTaskMergeGateStatus({
      projectId: "project-1",
      sprintId: "sprint-1",
      task: {
        record_id: "task-1",
        id: "T1",
        title: "Task",
        prompt: "Implement task.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        pr_url: "https://example.com/pr/1",
      },
    });

    expect(gate.mergeAllowed).toBe(false);
    // At the retry cap with changes still outstanding the gate now reports
    // exhaustion (not changes_requested) so the orchestrator applies the
    // exhaustion policy instead of looping forever.
    expect(gate.reason).toBe("retries_exhausted");
    expect(gate.runsUsed).toBe(3);
    expect(gate.maxRuns).toBe(3);
  });

  const buildGateService = (qaReviewRepository: any, maxTaskReviewRuns = 1) =>
    new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    } as any);

  const noPrCompletedTask = {
    record_id: "task-1",
    id: "T1",
    title: "Task",
    prompt: "Implement task.",
    depends_on: [],
    is_independent: true,
    status: "COMPLETED" as const,
  };

  it("fails closed (no merge) when the verdict budget is exhausted without a pass", () => {
    // A single decisive QA verdict that did not pass, at the cap of 1. This is
    // the exact hole that used to silently complete no-PR tasks.
    const service = buildGateService({
      getLatestTaskRun: vi.fn().mockReturnValue({
        id: "qa-run-1",
        taskId: "task-1",
        status: "completed",
        outcome: "changes_requested",
        summaryMarkdown: "Work still missing.",
        runIndex: 1,
      }),
      countTaskRuns: vi.fn().mockReturnValue(1),
      countDecisiveTaskRuns: vi.fn().mockReturnValue(1),
    });

    const gate = service.getTaskMergeGateStatus({
      projectId: "project-1",
      sprintId: "sprint-1",
      task: noPrCompletedTask,
    });

    // changes_requested already blocks; the key invariant is mergeAllowed=false.
    expect(gate.mergeAllowed).toBe(false);
  });

  it("does not let a reviewer infra crash exhaust the budget — it retries", () => {
    // Latest run FAILED for infra reasons (no verdict). Decisive count is 0, so
    // the budget is not spent and the gate asks for another review.
    const service = buildGateService({
      getLatestTaskRun: vi.fn().mockReturnValue({
        id: "qa-run-1",
        taskId: "task-1",
        status: "failed",
        outcome: null,
        summaryMarkdown: "Virtual QA worker failed: missing auth.",
        runIndex: 1,
      }),
      countTaskRuns: vi.fn().mockReturnValue(1),
      countDecisiveTaskRuns: vi.fn().mockReturnValue(0),
    });

    const gate = service.getTaskMergeGateStatus({
      projectId: "project-1",
      sprintId: "sprint-1",
      task: noPrCompletedTask,
    });

    expect(gate.mergeAllowed).toBe(false);
    expect(gate.reason).toBe("review_failed");
  });

  it("fails closed once persistent reviewer infra failures hit the ceiling", () => {
    // maxRuns=1, ceiling = 1 + 3 = 4. With 4 total infra failures and no
    // verdict, the gate stops retrying and holds the merge for a human.
    const service = buildGateService({
      getLatestTaskRun: vi.fn().mockReturnValue({
        id: "qa-run-4",
        taskId: "task-1",
        status: "failed",
        outcome: null,
        summaryMarkdown: "Virtual QA worker failed: missing auth.",
        runIndex: 4,
      }),
      countTaskRuns: vi.fn().mockReturnValue(4),
      countDecisiveTaskRuns: vi.fn().mockReturnValue(0),
    });

    const gate = service.getTaskMergeGateStatus({
      projectId: "project-1",
      sprintId: "sprint-1",
      task: noPrCompletedTask,
    });

    expect(gate.mergeAllowed).toBe(false);
    expect(gate.reason).toBe("retries_exhausted");
  });

  it("does not trigger no-PR QA on an already-merged task with task-completion QA disabled", () => {
    // Reproduces the Code UX Fork setup: "Review every completed task"
    // (taskCompletion) is OFF, but completedTaskWithoutPr is ON. A merged task
    // whose runtime pr_url is not reconstructed must NOT be treated as
    // "completed without a PR" — its is_merged flag is the source of truth.
    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {
        getLatestTaskRun: vi.fn().mockReturnValue(null),
        countTaskRuns: vi.fn().mockReturnValue(0),
        countDecisiveTaskRuns: vi.fn().mockReturnValue(0),
      } as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            taskCompletion: { enabled: false, agentPresetId: null },
            completedTaskWithoutPr: { enabled: true, agentPresetId: null },
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    } as any);

    const mergedTask = {
      record_id: "task-merged",
      id: "T1",
      title: "Task",
      prompt: "Implement task.",
      depends_on: [],
      is_independent: true,
      status: "COMPLETED" as const,
      is_merged: true,
      // pr_url intentionally absent (not reconstructed after reload).
    };

    const gate = service.getTaskMergeGateStatus({
      projectId: "project-1",
      sprintId: "sprint-1",
      task: mergedTask,
    });

    expect(gate.reason).toBe("not_required");
    expect(gate.mergeAllowed).toBe(true);

    // A genuinely no-evidence completed task still triggers the no-PR review.
    const noEvidenceGate = service.getTaskMergeGateStatus({
      projectId: "project-1",
      sprintId: "sprint-1",
      task: { ...mergedTask, record_id: "task-noevidence", is_merged: false },
    });
    expect(noEvidenceGate.reason).not.toBe("not_required");
  });

  it("allows verification after an automatically continued QA fix reaches maxTaskReviewRuns", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-continued-cap-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "coding_completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      state: "COMPLETED",
      provider: "qwen-code",
      sessionId: "session-1",
      startedAt: "2026-06-13T20:40:00.000Z",
      finishedAt: "2026-06-13T20:41:00.000Z",
    });
    const previousRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      triggerType: "task_completion",
      runIndex: 1,
      startedAt: "2026-06-13T20:42:00.000Z",
    });
    qaReviewRepository.updateRun(previousRun.id, {
      status: "completed",
      outcome: "changes_requested",
      summaryMarkdown: "QA requested a fix.",
      payload: {
        continued: true,
        continuationMode: "cli",
      },
      finishedAt: "2026-06-13T20:43:00.000Z",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-continued-cap",
      instructionMarkdown: "QA Agent",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {
        resolveTargetedQualityAssuranceAgent: async () => ({
          id: qaPreset.id,
          name: qaPreset.name,
          instructionMarkdown: qaPreset.instructionMarkdown,
        }),
      } as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 1,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockResolvedValue({
      verdict: "pass",
      summary: "Follow-up fix verified.",
      findings: [],
      fixInstructions: null,
      targetTaskKey: null,
      shouldHavePr: true,
      followUpTasks: [],
      raw: {},
    });
    vi.spyOn(service as any, "cleanupCliWorkspaceIfNeeded").mockResolvedValue(undefined);

    const outcome = await service.reviewCompletedTask({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      repoPath: dir,
      task: {
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "qwen-code",
        session_id: "session-1",
        pr_url: "https://example.com/pr/1",
      },
      subtasks: [],
    });

    expect(outcome.reviewed).toBe(true);
    expect(outcome.reportText).toContain("Follow-up fix verified");
    expect(qaReviewRepository.listRunsForTask(task.id)).toHaveLength(2);
  });

  it("does not force-pass a completed_task_without_pr when the verdict is changes_requested even if shouldHavePr is false", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-no-pr-changes-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "coding_completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      state: "COMPLETED",
      provider: "qwen-code",
      sessionId: "session-1",
      startedAt: "2026-06-13T20:40:00.000Z",
      finishedAt: "2026-06-13T20:41:00.000Z",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-no-pr-changes",
      instructionMarkdown: "QA Agent",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {
        resolveTargetedQualityAssuranceAgent: async () => ({
          id: qaPreset.id,
          name: qaPreset.name,
          instructionMarkdown: qaPreset.instructionMarkdown,
        }),
      } as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    // Reviewer says the work is wrong (changes_requested) yet also reports that no
    // PR was needed. The changes_requested verdict must win — the task must reopen
    // and stay merge-blocked, not be force-passed by `shouldHavePr === false`.
    vi.spyOn(service as any, "runReview").mockResolvedValue({
      verdict: "changes_requested",
      summary: "The content of alpha.md does not match the required status line.",
      findings: [],
      fixInstructions: null,
      targetTaskKey: "T1",
      shouldHavePr: false,
      followUpTasks: [],
      raw: {},
    });
    vi.spyOn(service as any, "cleanupCliWorkspaceIfNeeded").mockResolvedValue(undefined);

    const outcome = await service.reviewCompletedTask({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      repoPath: dir,
      task: {
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        provider: "qwen-code",
        session_id: "session-1",
        // No pr_url / worker_branch → resolves to the completed_task_without_pr trigger.
      },
      subtasks: [],
    });

    expect(outcome.reviewed).toBe(true);
    expect(outcome.reopenedTask).toBe(true);
    expect(outcome.mergeBlocked).toBe(true);
    const latestRun = qaReviewRepository.getLatestTaskRun(task.id);
    expect(latestRun?.triggerType).toBe("completed_task_without_pr");
    expect(latestRun?.outcome).toBe("changes_requested");
  });

  it("recovers a running task QA review when the execution invocation never linked provider runtime", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-unlinked-runtime-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T7",
      title: "Update test.md",
      promptMarkdown: "Update test.md.",
      status: "coding_completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      state: "COMPLETED",
      provider: "claude-code",
      sessionId: "cli-claude-code-stale",
      startedAt: "2000-01-01T00:00:00.000Z",
      finishedAt: "2000-01-01T00:03:00.000Z",
    });
    const qaRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      triggerType: "task_completion",
      runIndex: 1,
      targetSessionId: "cli-claude-code-stale",
      targetProvider: "claude-code",
      payload: { taskKey: "T7", runIndex: 1 },
      startedAt: "2000-01-01T00:04:00.000Z",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      taskRunId: taskRun.id,
      type: "qa_review",
      status: "running",
      provider: "qwen-code",
      startedAt: "2000-01-01T00:04:05.000Z",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 1,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const gate = service.getTaskMergeGateStatus({
      projectId: project.id,
      sprintId: sprint.id,
      task: {
        record_id: task.id,
        id: "T7",
        title: "Update test.md",
        prompt: "Update test.md.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
        pr_url: "https://example.com/pr/831",
      },
    });

    const recoveredRun = qaReviewRepository.getRun(qaRun.id);
    const recoveredInvocation = executionRepository.getExecutionInvocation(invocation.id);
    expect(gate.reason).toBe("review_failed");
    expect(gate.runsUsed).toBe(1);
    expect(gate.maxRuns).toBe(1);
    expect(recoveredRun?.status).toBe("failed");
    expect(recoveredRun?.summaryMarkdown).toContain("without provider runtime linkage");
    expect(recoveredInvocation?.status).toBe("failed");
    expect(recoveredInvocation?.errorMessage).toContain("without provider runtime linkage");
  });

  it("recovers a running Docker task QA review when its provider container is missing", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-missing-container-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T7",
      title: "Update test.md",
      promptMarkdown: "Update test.md.",
      status: "coding_completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      state: "COMPLETED",
      provider: "claude-code",
      sessionId: "cli-claude-code-done",
      startedAt: "2026-06-14T17:10:00.000Z",
      finishedAt: "2026-06-14T17:13:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      taskRunId: taskRun.id,
      sessionId: "qa-review-qwen-code-stale",
      provider: "qwen-code",
      purpose: "qa_review",
      model: "qwen",
      executionMode: "DOCKER",
      startedAt: "2026-06-14T17:14:00.000Z",
      promptChars: 100,
    });
    const qaRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      triggerType: "task_completion",
      runIndex: 1,
      targetSessionId: "cli-claude-code-done",
      targetProvider: "claude-code",
      payload: { taskKey: "T7", runIndex: 1 },
      startedAt: "2026-06-14T17:14:00.000Z",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      taskRunId: taskRun.id,
      providerInvocationId: providerInvocation.id,
      type: "qa_review",
      status: "running",
      provider: "qwen-code",
      startedAt: "2026-06-14T17:14:05.000Z",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      dockerService: {
        listContainers: vi.fn().mockResolvedValue([]),
      },
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 2,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    await service.reconcileRunningTaskQaReviews({
      projectId: project.id,
      sprintId: sprint.id,
      tasks: [{
        record_id: task.id,
        id: "T7",
        title: "Update test.md",
        prompt: "Update test.md.",
        depends_on: [],
        is_independent: true,
        status: "CODING_COMPLETED",
      }],
    });

    const recoveredRun = qaReviewRepository.getRun(qaRun.id);
    const recoveredInvocation = executionRepository.getExecutionInvocation(invocation.id);
    const recoveredProviderInvocation = executionRepository.getProviderInvocationUsage(providerInvocation.id);
    expect(recoveredRun?.status).toBe("failed");
    expect(recoveredRun?.summaryMarkdown).toContain("Docker container disappeared");
    expect(recoveredInvocation?.status).toBe("failed");
    expect(recoveredProviderInvocation?.status).toBe("failed");
  });

  it("reruns sprint QA after recovering a stale running review row", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-stale-sprint-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "completed",
      isIndependent: true,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-stale-sprint",
      instructionMarkdown: "QA Agent",
    });

    const staleRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      triggerType: "sprint_completion",
      runIndex: 1,
      startedAt: "2026-04-11T09:20:00.000Z",
    });
    executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      type: "qa_review",
      status: "completed",
      provider: "gemini",
      model: "auto",
      startedAt: "2026-04-11T09:20:01.000Z",
      finishedAt: "2026-04-11T09:25:00.000Z",
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: {
        resolveTargetedQualityAssuranceAgent: async () => ({
          id: qaPreset.id,
          name: qaPreset.name,
          instructionMarkdown: qaPreset.instructionMarkdown,
        }),
      } as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 2,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn(service as any, "runReview").mockResolvedValue({
      verdict: "pass",
      summary: "Sprint QA recovered and passed.",
      findings: [],
      fixInstructions: null,
      targetTaskKey: null,
      shouldHavePr: null,
      followUpTasks: [],
      raw: {},
    });

    const outcome = await service.reviewSprintCompletion({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      repoPath: dir,
      subtasks: [
        {
          record_id: task.id,
          project_id: project.id,
          sprint_id: sprint.id,
          id: "T1",
          title: "Initial task",
          prompt: "Implement the initial feature.",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
        },
      ] as any,
    });

    expect(outcome).toMatchObject({
      reviewed: true,
      blockedCompletion: false,
      mergeBlocked: false,
    });
    expect(qaReviewRepository.getRun(staleRun.id)?.status).toBe("failed");
    expect(qaReviewRepository.getLatestSprintRun(sprint.id)?.outcome).toBe("pass");
  });

  it("retries when the provider returns malformed JSON", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-malformed-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "completed",
      isIndependent: true,
    });
    const updateTaskSpy = vi.spyOn(projectRepository, "updateTask");

    const mockProviderRunner = {
      runProviderForText: vi.fn(),
      runProvider: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: "Here is my review: this is not json",
          nativeSessionId: "native-1",
        })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"verdict": "pass", "summary": "Looks good now", "findings": [], "fixInstructions": null, "targetTaskKey": null, "shouldHavePr": true, "followUpTasks": []}',
          nativeSessionId: "native-1",
        }),
    };

    const structuredResponseService = new StructuredProviderResponseService({
      providerExecutionService: {
        executeProvider: mockProviderRunner.runProvider,
      } as any,
      executionRepository,
      guardrailService: qaGuardrailStub(),
    });

    const structuredAgentRequestService = new StructuredAgentRequestService({
      executionRepository,
      guardrailService: qaGuardrailStub(),
      structuredProviderResponseService: structuredResponseService,
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: new QaReviewRepository(storage),
      taskService: {
        resolveInvocationProvider: () => ({
          provider: "claude-code",
          providers: { "claude-code": { model: "claude-3-5-sonnet", thinkingMode: false } },
        }),
      } as any,
      agentPresetSyncService: {
        resolveTargetedQualityAssuranceAgent: async () => {
          const preset = agentPresetRepository.createAgentPreset(project.id, {
            name: "QA",
            presetId: "QA-1",
            instructionMarkdown: "QA Agent",
          });
          return { id: preset.id, name: "QA", instructionMarkdown: "QA Agent" };
        },
      } as any,
      providerRunner: mockProviderRunner as any,
      structuredAgentRequestService,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 3,
            completedTaskWithoutPr: { enabled: true, agentPresetId: "QA-1" },
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    const outcome = await service.reviewCompletedTask({
      projectId: project.id,
      sprintId: sprint.id,
      repoPath: dir,
      task: {
        ...task,
        record_id: task.id,
        id: "T1",
        depends_on: [],
        session_id: "s1",
      } as any,
      subtasks: [],
    });

    expect(outcome.reviewed).toBe(true);
    expect(outcome.reportText).toContain("Looks good now");
    expect(mockProviderRunner.runProvider).toHaveBeenCalledTimes(2);
    // The task is flagged QA_PENDING while the review runs (so the live tag /
    // boat race / stats show QA) and cleared once QA passes.
    expect(updateTaskSpy).toHaveBeenCalledWith(task.id, { mergeIndicator: "QA_PENDING" });
    expect(updateTaskSpy).toHaveBeenCalledWith(task.id, { mergeIndicator: null });
  });

  it("retries when the provider returns JSON missing required fields", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-missing-fields-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Initial task",
      promptMarkdown: "Implement the initial feature.",
      status: "completed",
      isIndependent: true,
    });

    const mockProviderRunner = {
      runProviderForText: vi.fn(),
      runProvider: vi.fn()
        .mockResolvedValueOnce({
          ok: true,
          text: '{"summary": "missing verdict field"}',
          nativeSessionId: "native-1",
        })
        .mockResolvedValueOnce({
          ok: true,
          text: '{"verdict": "changes_requested", "summary": "Fix it", "findings": [], "fixInstructions": "Please fix", "targetTaskKey": null, "shouldHavePr": true, "followUpTasks": []}',
          nativeSessionId: "native-1",
        }),
    };

    const structuredResponseService = new StructuredProviderResponseService({
      providerExecutionService: {
        executeProvider: mockProviderRunner.runProvider,
      } as any,
      executionRepository,
      guardrailService: qaGuardrailStub(),
    });

    const structuredAgentRequestService = new StructuredAgentRequestService({
      executionRepository,
      guardrailService: qaGuardrailStub(),
      structuredProviderResponseService: structuredResponseService,
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: new QaReviewRepository(storage),
      taskService: {
        resolveInvocationProvider: () => ({
          provider: "claude-code",
          providers: { "claude-code": { model: "claude-3-5-sonnet", thinkingMode: false } },
        }),
      } as any,
      agentPresetSyncService: {
        resolveTargetedQualityAssuranceAgent: async () => {
          const preset = agentPresetRepository.createAgentPreset(project.id, {
            name: "QA",
            presetId: "QA-1",
            instructionMarkdown: "QA Agent",
          });
          return { id: preset.id, name: "QA", instructionMarkdown: "QA Agent" };
        },
        getOptionalWorkerAgentForRepoPath: async () => undefined,
      } as any,
      providerRunner: mockProviderRunner as any,
      structuredAgentRequestService,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            maxTaskReviewRuns: 3,
            completedTaskWithoutPr: { enabled: true, agentPresetId: "QA-1" },
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    // Mock continueCliTaskSession to avoid actual filesystem work
    vi.spyOn(service as any, "continueCliTaskSession").mockResolvedValue(undefined);

    const outcome = await service.reviewCompletedTask({
      projectId: project.id,
      sprintId: sprint.id,
      repoPath: dir,
      task: {
        ...task,
        record_id: task.id,
        id: "T1",
        depends_on: [],
        session_id: "s1",
      } as any,
      subtasks: [],
    });

    expect(outcome.reviewed).toBe(true);
    expect(outcome.reportText).toContain("Fix it");
    expect(mockProviderRunner.runProvider).toHaveBeenCalledTimes(2);
  });

  it("refreshes origin before running QA review in REMOTE git mode", async () => {
    vi.mocked(syncRemoteBranchIfAvailable).mockRejectedValueOnce(new Error("fetch failed"));

    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      structuredAgentRequestService: {
        executeRequest: vi.fn(),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubMode: "REMOTE",
          defaultBranch: "dev",
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    await expect((service as any).runReview({
      triggerType: "task_completion",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      projectName: "QA Project",
      sprintGoal: "Ship safely",
      repoPath: "/repo",
      agentInstructions: "QA Agent",
      subtasks: [],
      currentTask: {
        id: "T1",
        title: "Fix thing",
        prompt: "Implement the fix",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        worker_branch: "feature/task-1",
      },
      taskRun: null,
      sprintRunId: null,
      agentPresetId: null,
      reviewBranch: "feature/task-1",
      baseBranch: "dev",
    })).rejects.toThrow("Failed to refresh origin before running QA review on feature/task-1: fetch failed");

    expect(syncRemoteBranchIfAvailable).toHaveBeenCalledWith("/repo", "feature/task-1", {
      githubToken: "",
      gitlabToken: "",
    });
  });

  it("refreshes origin before continuing QA follow-up in REMOTE git mode", async () => {
    vi.mocked(syncRemoteBranchIfAvailable).mockRejectedValueOnce(new Error("fetch failed"));

    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          githubMode: "REMOTE",
          defaultBranch: "dev",
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    await expect((service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: {
        id: "T1",
        title: "Fix thing",
        prompt: "Implement the fix",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        worker_branch: "feature/task-1",
      },
      taskRun: null,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    })).rejects.toThrow("Failed to refresh origin before continuing QA follow-up on feature/task-1: fetch failed");

    expect(syncRemoteBranchIfAvailable).toHaveBeenCalledWith("/repo", "feature/task-1", {
      githubToken: "",
      gitlabToken: "",
    });
  });

  it("recovers worker branch from the resume workspace when task metadata is missing", async () => {
    const runProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      text: "done",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });

    const service = new QualityAssuranceService({
      projectManagementRepository: {
        updateTask: vi.fn(),
        getSprint: vi.fn().mockReturnValue(null),
      } as any,
      executionRepository: {
        getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-followup" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-followup" }),
        updateProviderInvocationUsage: vi.fn(),
      } as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {
        updateSession: vi.fn(),
        appendActivity: vi.fn(),
      } as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(undefined),
      } as any,
      providerRunner: {
        runProvider,
        runProviderForText: vi.fn(),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCreatePr: false,
        },
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          enabled: false,
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue("docker-volume://session-1");
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("docker-volume://session-1");
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue("feature/recovered-branch");
    // Without this, the resumed docker-volume workspace triggers a real
    // `git fetch` inside a docker container (~25s hang/timeout) since the ref is
    // a fake `docker-volume://` path. The call is best-effort (.catch), so
    // stubbing it keeps the test hermetic and fast.
    vi.spyOn((service as any).workspaceManager, "fastForwardResumedWorkspace").mockResolvedValue(true);
    vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    vi.spyOn(service as any, "runWorkspaceCommand").mockResolvedValue({ stdout: "abc123\n", stderr: "" });
    vi.spyOn((service as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((service as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((service as any).prService, "hasUnpushedCommits").mockResolvedValue(false);
    vi.spyOn((service as any).prService, "hasWorkerBranchCommitsAgainstFeature").mockResolvedValue(false);

    await (service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: {
        id: "T1",
        record_id: "task-record-1",
        title: "Fix thing",
        prompt: "Implement the fix",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
      },
      taskRun: null,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    });

    expect(syncRemoteBranchIfAvailable).toHaveBeenCalledWith("/repo", "feature/recovered-branch", {
      githubToken: "",
      gitlabToken: "",
    });
    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "docker-volume://session-1",
    }));
  });

  it("returns an actionable error when branch metadata and resume workspace are unavailable", async () => {
    const service = new QualityAssuranceService({
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {} as any,
      providerRunner: {} as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("/repo/.worktrees/session-1");
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue(null);

    await expect((service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: {
        id: "T1",
        title: "Fix thing",
        prompt: "Implement the fix",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
      },
      taskRun: null,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    })).rejects.toThrow(
      "Cannot continue CLI QA fixes for T1: worker branch metadata is missing and resume workspace is missing for session session-1.",
    );
  });

  it("recovers worker branch from git branch listing and persists it when task metadata and resume workspace are missing", async () => {
    const runProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      text: "done",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });

    const updateTaskMock = vi.fn();
    const updateTaskRunMock = vi.fn();

    const service = new QualityAssuranceService({
      projectManagementRepository: {
        updateTask: updateTaskMock,
        getSprint: vi.fn().mockReturnValue(null),
      } as any,
      executionRepository: {
        getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-followup" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-followup" }),
        updateProviderInvocationUsage: vi.fn(),
        updateTaskRun: updateTaskRunMock,
        appendTaskRunEvent: vi.fn(),
      } as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {
        updateSession: vi.fn(),
        appendActivity: vi.fn(),
      } as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(undefined),
      } as any,
      providerRunner: {
        runProvider,
        runProviderForText: vi.fn(),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCreatePr: false,
        },
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          enabled: false,
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("docker-volume://session-1");
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue(null);
    vi.spyOn((service as any).workspaceManager, "fastForwardResumedWorkspace").mockResolvedValue(true);
    const prepareWorktreeSpy = vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue({ worktreePath: "docker-volume://session-1", resumed: false });
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    vi.spyOn(service as any, "runWorkspaceCommand").mockResolvedValue({ stdout: "abc123\n", stderr: "" });
    vi.spyOn((service as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((service as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((service as any).prService, "hasUnpushedCommits").mockResolvedValue(false);
    vi.spyOn((service as any).prService, "hasWorkerBranchCommitsAgainstFeature").mockResolvedValue(false);

    vi.mocked(runCommandStrict).mockImplementation(async (cmd, args, cwd) => {
      if (cmd === "git" && args.includes("branch")) {
        return { ok: true, stdout: "  task/feature-sprint-1-T1-gemini-recovered\n", stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    });

    const taskShape = {
      id: "T1",
      record_id: "task-record-1",
      title: "Fix thing",
      prompt: "Implement the fix",
      depends_on: [],
      is_independent: true,
      status: "COMPLETED",
    };

    const taskRunShape = {
      id: "task-run-123",
      workerBranch: null,
    };

    await (service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: taskShape,
      taskRun: taskRunShape,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    });

    expect(prepareWorktreeSpy).toHaveBeenCalledWith("/repo", "docker-volume://session-1", "task/feature-sprint-1-T1-gemini-recovered", "feature/sprint-1", undefined, expect.any(Object));
    expect(updateTaskRunMock).toHaveBeenCalledWith("task-run-123", { workerBranch: "task/feature-sprint-1-T1-gemini-recovered" });
    expect(taskShape.worker_branch).toBe("task/feature-sprint-1-T1-gemini-recovered");
    expect(taskRunShape.workerBranch).toBe("task/feature-sprint-1-T1-gemini-recovered");
  });

  it("recovers worker branch from PR metadata and persists it when task metadata and resume workspace are missing", async () => {
    const runProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      text: "done",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });

    const updateTaskMock = vi.fn();
    const updateTaskRunMock = vi.fn();

    const service = new QualityAssuranceService({
      projectManagementRepository: {
        updateTask: updateTaskMock,
        getSprint: vi.fn().mockReturnValue(null),
      } as any,
      executionRepository: {
        getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-followup" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-followup" }),
        updateProviderInvocationUsage: vi.fn(),
        updateTaskRun: updateTaskRunMock,
        appendTaskRunEvent: vi.fn(),
      } as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {
        updateSession: vi.fn(),
        appendActivity: vi.fn(),
      } as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(undefined),
      } as any,
      providerRunner: {
        runProvider,
        runProviderForText: vi.fn(),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCreatePr: false,
        },
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          enabled: false,
        },
      }),
      getGithubToken: () => "gh-token",
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("docker-volume://session-1");
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue(null);
    vi.spyOn((service as any).workspaceManager, "fastForwardResumedWorkspace").mockResolvedValue(true);
    const prepareWorktreeSpy = vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue({ worktreePath: "docker-volume://session-1", resumed: false });
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    vi.spyOn(service as any, "runWorkspaceCommand").mockResolvedValue({ stdout: "abc123\n", stderr: "" });
    vi.spyOn((service as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((service as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((service as any).prService, "hasUnpushedCommits").mockResolvedValue(false);
    vi.spyOn((service as any).prService, "hasWorkerBranchCommitsAgainstFeature").mockResolvedValue(false);

    vi.mocked(commandRunner.run).mockImplementation(async (cmd, args, options) => {
      if (cmd === "git" && args.includes("remote") && args.includes("get-url")) {
        return { ok: true, stdout: "https://github.com/org/repo.git\n", stderr: "" };
      }
      if (cmd === "gh" && args.includes("pr") && args.includes("list")) {
        const prList = [
          {
            number: 1,
            url: "https://github.com/org/repo/pull/1",
            state: "OPEN",
            headRefName: "task/feature-sprint-1-T1-gemini-pr-recovered",
          }
        ];
        return { ok: true, stdout: JSON.stringify(prList), stderr: "" };
      }
      return { ok: true, stdout: "", stderr: "" };
    });

    const taskShape = {
      id: "T1",
      record_id: "task-record-1",
      title: "Fix thing",
      prompt: "Implement the fix",
      depends_on: [],
      is_independent: true,
      status: "COMPLETED",
      pr_url: "https://github.com/org/repo/pull/1",
    };

    const taskRunShape = {
      id: "task-run-123",
      workerBranch: null,
    };

    await (service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: taskShape,
      taskRun: taskRunShape,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    });

    expect(prepareWorktreeSpy).toHaveBeenCalledWith("/repo", "docker-volume://session-1", "task/feature-sprint-1-T1-gemini-pr-recovered", "feature/sprint-1", undefined, expect.any(Object));
    expect(updateTaskRunMock).toHaveBeenCalledWith("task-run-123", { workerBranch: "task/feature-sprint-1-T1-gemini-pr-recovered" });
  });

  it("reuses an existing CLI QA follow-up workspace and syncs it with worker branch before running the fix", async () => {
    const runProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      text: "done",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });
    const service = new QualityAssuranceService({
      projectManagementRepository: {
        updateTask: vi.fn(),
        getSprint: vi.fn().mockReturnValue(null),
      } as any,
      executionRepository: {
        getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-followup" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-followup" }),
        updateProviderInvocationUsage: vi.fn(),
      } as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {
        updateSession: vi.fn(),
        appendActivity: vi.fn(),
      } as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(undefined),
      } as any,
      providerRunner: {
        runProvider,
        runProviderForText: vi.fn(),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCreatePr: false,
        },
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          enabled: false,
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue("/worktree");
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("/worktree");
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue("feature/task-1");
    const prepareWorktree = vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    const runWorkspaceCommand = vi.spyOn(service as any, "runWorkspaceCommand").mockImplementation(
      async (_worktreePath: string, _command: string, commandArgs: string[]) => {
        if (commandArgs[0] === "rev-parse") {
          return { stdout: "pushed-worker-tip\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
    );
    // The resumed workspace is parked on a stale base ref; the follow-up must fast-forward
    // it onto the already-pushed worker-branch tip so the new commit descends from origin
    // and the push is not rejected as non-fast-forward.
    const fastForwardResumedWorkspace = vi.spyOn((service as any).workspaceManager, "fastForwardResumedWorkspace")
      .mockResolvedValue(true);
    vi.spyOn((service as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((service as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((service as any).prService, "hasUnpushedCommits").mockResolvedValue(false);
    vi.spyOn((service as any).prService, "hasWorkerBranchCommitsAgainstFeature").mockResolvedValue(false);

    await (service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: {
        id: "T1",
        record_id: "task-record-1",
        title: "Fix thing",
        prompt: "Implement the fix",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        worker_branch: "feature/task-1",
      },
      taskRun: null,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    });

    expect(prepareWorktree).not.toHaveBeenCalled();
    // The stale resumed workspace is fast-forwarded onto the pushed worker-branch tip.
    expect(fastForwardResumedWorkspace).toHaveBeenCalledWith(
      "/worktree",
      "feature/task-1",
      "/repo",
      expect.objectContaining({}),
    );
    // It must NOT use the old silent ff-only merge that left the base ref stale.
    expect(runWorkspaceCommand).not.toHaveBeenCalledWith(
      "/worktree",
      "git",
      ["merge", "--ff-only", "origin/feature/task-1"],
    );
    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/worktree",
    }));
    // initialHead (and thus the patch base) is the fast-forwarded tip.
    expect((service as any).workspaceArtifactService.exportBinaryPatch).toHaveBeenCalledWith("/worktree", "pushed-worker-tip");
  });

  it("continues QA follow-up on an existing docker workspace when branch metadata is only recoverable from workspace state", async () => {
    const runProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      text: "done",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });
    const service = new QualityAssuranceService({
      projectManagementRepository: {
        updateTask: vi.fn(),
        getSprint: vi.fn().mockReturnValue(null),
      } as any,
      executionRepository: {
        getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-followup" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-followup" }),
        updateProviderInvocationUsage: vi.fn(),
      } as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {
        updateSession: vi.fn(),
        appendActivity: vi.fn(),
      } as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(undefined),
      } as any,
      providerRunner: {
        runProvider,
        runProviderForText: vi.fn(),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        cliWorkflow: {
          ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
          executionMode: "DOCKER",
        },
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCreatePr: false,
        },
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          enabled: false,
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue("docker-volume://session-1");
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("docker-volume://session-1");
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue("worker/recovered");
    // Stub the best-effort fast-forward so the resumed docker-volume workspace
    // doesn't shell out to a real `git fetch` in a container (~25s hang).
    vi.spyOn((service as any).workspaceManager, "fastForwardResumedWorkspace").mockResolvedValue(true);
    const prepareWorktree = vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    vi.spyOn(service as any, "runWorkspaceCommand").mockResolvedValue({ stdout: "abc123\n", stderr: "" });
    vi.spyOn((service as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    const applyPatchToBranch = vi.spyOn((service as any).workspaceArtifactService, "applyPatchToBranch")
      .mockResolvedValue({ hasChanges: false });
    vi.spyOn((service as any).prService, "hasUnpushedCommits").mockResolvedValue(false);
    vi.spyOn((service as any).prService, "hasWorkerBranchCommitsAgainstFeature").mockResolvedValue(false);

    await (service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: {
        id: "T1",
        record_id: "task-record-1",
        title: "Fix thing",
        prompt: "Implement the fix",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
      },
      taskRun: null,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    });

    expect(prepareWorktree).not.toHaveBeenCalled();
    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "docker-volume://session-1",
      sessionId: "session-1",
    }));
    expect(applyPatchToBranch).toHaveBeenCalledWith(expect.objectContaining({
      workerBranch: "worker/recovered",
      repoPath: "/repo",
    }));
  });

  it("passes provider auth mount settings into QA follow-up provider runs", async () => {
    const runProvider = vi.fn().mockResolvedValue({
      ok: true,
      stdout: "",
      stderr: "",
      text: "done",
      nativeSessionId: "native-followup",
      usageTelemetry: {
        transcriptText: "",
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        reasoningOutputTokens: 0,
        totalTokens: 0,
        usageSource: "reported",
        rawUsageJson: null,
      },
    });
    const executionRepository = {
      getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
      createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-followup" }),
      appendExecutionInvocationMessage: vi.fn(),
      updateExecutionInvocation: vi.fn(),
      createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-followup" }),
      updateProviderInvocationUsage: vi.fn(),
    };
    const sessionTracking = {
      updateSession: vi.fn(),
      appendActivity: vi.fn(),
    };
    const projectManagementRepository = {
      updateTask: vi.fn(),
      getSprint: vi.fn().mockReturnValue(null),
    };

    const service = new QualityAssuranceService({
      projectManagementRepository: projectManagementRepository as any,
      executionRepository: executionRepository as any,
      guardrailService: qaGuardrailStub(),
      sessionTracking: sessionTracking as any,
      qaReviewRepository: {} as any,
      taskService: {} as any,
      agentPresetSyncService: {
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue(undefined),
      } as any,
      providerRunner: {
        runProvider,
        runProviderForText: vi.fn(),
      } as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        aiProvider: {
          ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
          providers: {
            ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
            gemini: {
              ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini,
              model: "gemini-2.5-pro",
              apiKey: "",
              mountAuth: true,
              authPath: "~/.gemini",
            },
          },
        },
        cliWorkflow: {
          ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
          executionMode: "DOCKER",
        },
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          enabled: false,
        },
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          autoCreatePr: false,
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue("/worktree");
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("/worktree");
    vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    vi.spyOn(service as any, "runWorkspaceCommand").mockResolvedValue({ stdout: "abc123\n", stderr: "" });
    vi.spyOn((service as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("");
    vi.spyOn((service as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: false });
    vi.spyOn((service as any).prService, "hasUnpushedCommits").mockResolvedValue(false);
    vi.spyOn((service as any).prService, "hasWorkerBranchCommitsAgainstFeature").mockResolvedValue(false);

    await (service as any).continueCliTaskSession({
      provider: "gemini",
      sessionId: "session-1",
      task: {
        id: "T1",
        record_id: "task-record-1",
        title: "Fix thing",
        prompt: "Implement the fix",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        worker_branch: "feature/task-1",
      },
      taskRun: null,
      repoPath: "/repo",
      featureBranch: "feature/sprint-1",
      scope: {
        projectId: "project-1",
        sprintId: "sprint-1",
      },
      followUpPrompt: "Address QA findings",
    });

    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({
      provider: "gemini",
      providerMountAuth: true,
      providerAuthPath: "~/.gemini",
    }));
  });

  it("keeps the sprint heartbeat and lease alive during long sprint QA reviews", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-04-10T12:00:00.000Z"));

    try {
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-keepalive-"));
      tempDirs.push(dir);
      const storage = new AppDbStorage(path.join(dir, "app.db"));
      const projectRepository = new ProjectManagementRepository(storage);
      const executionRepository = new ExecutionRepository(storage);
      const qaReviewRepository = new QaReviewRepository(storage);
      const agentPresetRepository = new AgentPresetRepository(storage);

      const project = projectRepository.createProject({
        name: "QA Keepalive Project",
        sourceType: "local",
        sourceRef: dir,
      });
      const sprint = projectRepository.createSprint(project.id, {
        name: "Sprint 1",
        goal: "Ship safely",
        status: "running",
        featureBranch: "feature/sprint-1",
      });
      const task = projectRepository.createTask(project.id, {
        sprintId: sprint.id,
        taskKey: "T1",
        title: "Initial task",
        promptMarkdown: "Implement the initial feature.",
        status: "completed",
        isIndependent: true,
      });
      const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        status: "running",
      });
      executionRepository.updateSprintRun(sprintRun.id, {
        status: "running",
        startedAt: "2026-04-10T12:00:00.000Z",
        lastHeartbeatAt: "2026-04-10T12:00:00.000Z",
      });
      executionRepository.acquireLease({
        scopeType: "sprint",
        scopeId: sprint.id,
        ownerKey: "test-orchestrator",
        leaseToken: "lease-1",
        expiresAt: "2026-04-10T12:05:00.000Z",
      });

      const structuredAgentRequestService = {
        executeRequest: vi.fn(async () => {
          await new Promise((resolve) => setTimeout(resolve, 65_000));
          return {
            parsed: {
              verdict: "pass",
              summary: "Looks good.",
              findings: [],
              fixInstructions: null,
              targetTaskKey: null,
              shouldHavePr: true,
              followUpTasks: [],
              raw: {},
            },
            sessionId: "qa-session-1",
            invocationId: "xi_1",
            nativeSessionId: "native-1",
            bodyMarkdown: "{\"verdict\":\"pass\"}",
          };
        }),
      };

      const service = new QualityAssuranceService({
        projectManagementRepository: projectRepository,
        executionRepository,
        sessionTracking: {} as any,
        qaReviewRepository,
        taskService: {
          resolveInvocationProvider: () => ({
            provider: "claude-code",
            providers: { "claude-code": { model: "claude-3-5-sonnet", thinkingMode: false, apiKey: "test-key" } },
          }),
        } as any,
        agentPresetSyncService: {
          resolveTargetedQualityAssuranceAgent: async () => {
            const preset = agentPresetRepository.createAgentPreset(project.id, {
              name: "QA",
              presetId: "QA-keepalive",
              instructionMarkdown: "QA Agent",
            });
            return { id: preset.id, name: "QA", instructionMarkdown: "QA Agent" };
          },
        } as any,
        providerRunner: {} as any,
        structuredAgentRequestService: structuredAgentRequestService as any,
        getDashboardSettings: () => ({
          ...DEFAULT_DASHBOARD_SETTINGS,
          agents: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents,
            qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            },
          },
        }),
        getGithubToken: () => undefined,
        sendSessionMessage: async () => ({}),
      });
      vi.spyOn((service as any).workspaceManager, "createSnapshotWorkspace").mockResolvedValue("docker-volume://qa-snapshot");
      vi.spyOn((service as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);

      const reviewPromise = service.reviewSprintCompletion({
        projectId: project.id,
        sprintId: sprint.id,
        sprintRunId: sprintRun.id,
        repoPath: dir,
        subtasks: [
          {
            record_id: task.id,
            project_id: project.id,
            sprint_id: sprint.id,
            id: "T1",
            title: "Initial task",
            prompt: "Implement the initial feature.",
            depends_on: [],
            is_independent: true,
            status: "COMPLETED",
          },
        ] as any,
      });

      await vi.advanceTimersByTimeAsync(65_000);
      const outcome = await reviewPromise;

      expect(outcome).toMatchObject({
        reviewed: true,
        blockedCompletion: false,
        mergeBlocked: false,
      });
      expect(structuredAgentRequestService.executeRequest).toHaveBeenCalledTimes(1);
      expect(executionRepository.getSprintRun(sprintRun.id)?.lastHeartbeatAt).toBe("2026-04-10T12:01:05.000Z");
      expect(executionRepository.getLease("sprint", sprint.id)?.expiresAt).toBe("2026-04-10T12:06:05.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("resolves the correct provider settings and computed feature branch prefix for QA follow-up runs", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-followup-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);

    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 42",
      number: 42,
      goal: "Implement qwen support",
      status: "running",
      featureBranch: null, // Test dynamically resolved branch name
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Coding task",
      promptMarkdown: "Implement task.",
      status: "completed",
      isIndependent: true,
    });

    const subtask: Subtask = {
      record_id: task.id,
      project_id: project.id,
      sprint_id: sprint.id,
      id: "T1",
      title: "Coding task",
      prompt: "Implement task.",
      depends_on: [],
      is_independent: true,
      status: "COMPLETED",
      provider: "qwen",
      session_id: "session-123",
      worker_branch: "worker-branch-t1",
    };

    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      provider: "qwen",
      mode: "docker_cli",
      state: "RUNNING",
      sessionId: "session-123",
    });

    const structuredAgentRequestService = {
      executeRequest: vi.fn(async () => {
        return {
          parsed: {
            verdict: "changes_requested",
            summary: "Needs fixes.",
            findings: ["Issue A"],
            fixInstructions: "Add error handling.",
            targetTaskKey: "T1",
            shouldHavePr: true,
            followUpTasks: [],
            raw: {},
          },
          sessionId: "qa-session-123",
          invocationId: "xi_123",
          nativeSessionId: "native-123",
          bodyMarkdown: JSON.stringify({
            verdict: "changes_requested",
            summary: "Needs fixes.",
            fixInstructions: "Add error handling.",
          }),
        };
      }),
    };

    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {
        updateSession: vi.fn(),
        appendActivity: vi.fn(),
      } as any,
      qaReviewRepository,
      taskService: {
        resolveInvocationProvider: () => ({
          provider: "qwen",
          providerConfigId: "qwen-local",
          providers: {
            "qwen-local": { provider: "qwen", model: "qwen-local-model", apiKey: "local-key", thinkingMode: "MEDIUM" },
            "qwen-primary": { provider: "qwen", model: "qwen-primary-model", apiKey: "primary-key", thinkingMode: "HIGH" },
          },
          enabledProviders: ["qwen-local", "qwen-primary"],
        }),
        resolveProviderConfigIdForProvider: (route: any, provider: any) => {
          return "qwen-local";
        },
      } as any,
      agentPresetSyncService: {
        resolveTargetedQualityAssuranceAgent: async () => {
          const preset = agentPresetRepository.createAgentPreset(project.id, {
            name: "QA Agent",
            presetId: "QA-1",
            instructionMarkdown: "Review this.",
          });
          return { id: preset.id, name: preset.name, instructionMarkdown: preset.instructionMarkdown };
        },
        resolveTargetedCodingAgent: async () => null,
        getOptionalWorkerAgentForRepoPath: async () => undefined,
      } as any,
      providerRunner: {} as any,
      structuredAgentRequestService: structuredAgentRequestService as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        git: {
          ...DEFAULT_DASHBOARD_SETTINGS.git,
          featureBranchPrefix: "feature/",
          defaultBranch: "main",
        },
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
            completedTaskWithoutPr: { enabled: true, agentPresetId: typeof qaPreset !== "undefined" ? qaPreset.id : "qa-preset" },
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "createSnapshotWorkspace").mockResolvedValue("docker-volume://qa-snapshot");
    vi.spyOn((service as any).workspaceManager, "removeWorktree").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue(null);
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue("worker-branch-t1");
    vi.spyOn((service as any), "syncRemoteBranchesIfNeeded").mockResolvedValue(undefined);
    vi.spyOn((service as any), "syncExistingCliFollowUpWorkspace").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("Guidance");
    vi.spyOn((service as any), "runWorkspaceCommand").mockResolvedValue({ stdout: "abc123\n", stderr: "" });
    vi.spyOn((service as any).workspaceManager, "runWorkspaceCommand").mockResolvedValue({ stdout: "", stderr: "" });
    const prepareWorktreeSpy = vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue(undefined);

    const executeProviderSpy = vi.spyOn((service as any).providerExecutionService, "executeProvider").mockResolvedValue({
      ok: true,
      stdout: "Done",
      stderr: "",
    });

    const outcome = await service.reviewCompletedTask({
      projectId: project.id,
      sprintId: sprint.id,
      repoPath: dir,
      task: subtask,
      subtasks: [subtask],
    });

    expect(outcome.reviewed).toBe(true);
    expect(prepareWorktreeSpy).toHaveBeenCalled();
    const prepareArgs = prepareWorktreeSpy.mock.calls[0];
    expect(prepareArgs[3]).toBe("feature/sprint-42");

    expect(executeProviderSpy).toHaveBeenCalled();
    const callArgs = executeProviderSpy.mock.calls[0][0];

    // Assert correct provider settings resolution (qwen-local instead of falling back to qwen primary)
    expect(callArgs.model).toBe("qwen-local-model");
    expect(callArgs.apiKey).toBe("local-key");
  });
});
