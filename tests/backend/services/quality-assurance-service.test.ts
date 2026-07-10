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
import { WorkspaceManager } from "../../../src/infrastructure/providers/cli/workspace-manager.js";
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
  vi.spyOn(WorkspaceManager.prototype, "createSnapshotWorkspace").mockResolvedValue("docker-volume://qa-snapshot");
  vi.spyOn(WorkspaceManager.prototype, "removeWorktree").mockResolvedValue(undefined);
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

  it("runs HOST-mode QA against a detached review-branch snapshot", async () => {
    const settings = structuredClone(DEFAULT_DASHBOARD_SETTINGS);
    settings.cliWorkflow.executionMode = "HOST";
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
      structuredAgentRequestService: { executeRequest } as any,
      getDashboardSettings: () => settings,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    const createHostSnapshotWorkspace = vi.spyOn((service as any).workspaceManager, "createHostSnapshotWorkspace")
      .mockResolvedValue("/repo/project/.worktrees/qa-review-snapshot");
    const removeWorktree = vi.spyOn((service as any).workspaceManager, "removeWorktree")
      .mockResolvedValue(undefined);

    await (service as any).runReview({
      triggerType: "task_completion",
      scope: { projectId: "project-1", sprintId: "sprint-1" },
      projectName: "QA Project",
      sprintGoal: "Ship safely",
      repoPath: "/repo/project",
      agentInstructions: "Review carefully.",
      subtasks: [],
      currentTask: { id: "task-1", title: "Task", prompt: "Prompt", depends_on: [], status: "COMPLETED", is_independent: true },
      taskRun: { id: "run-1", taskId: "task-1" },
      sprintRunId: null,
      agentPresetId: null,
      reviewBranch: "task/feature-task-1",
      baseBranch: "feature/sprint-1",
    });

    expect(createHostSnapshotWorkspace).toHaveBeenCalledWith(
      "/repo/project",
      expect.stringMatching(/^qa-review-codex-/),
      expect.objectContaining({ branch: "task/feature-task-1", fallbackBranch: "feature/sprint-1" }),
    );
    expect(executeRequest).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/repo/project/.worktrees/qa-review-snapshot",
    }));
    expect(removeWorktree).toHaveBeenCalledWith("/repo/project", "/repo/project/.worktrees/qa-review-snapshot");
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

  it("does not continue an already merged task during sprint completion QA", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-merged-sprint-followup-"));
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
      title: "Merged task",
      promptMarkdown: "Implement the merged task.",
      status: "completed",
      isIndependent: true,
      isMerged: true,
      mergeIndicator: "MERGED",
      provider: "opencode",
      sessionId: "session-1",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-merged-followup",
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
            taskCompletion: { enabled: true, agentPresetId: qaPreset.id },
            completedTaskWithoutPr: { enabled: true, agentPresetId: qaPreset.id },
            sprintCompletion: { enabled: true, agentPresetId: qaPreset.id },
            maxTaskReviewRuns: 3,
            maxSprintReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn(service as any, "runReview").mockResolvedValue({
      verdict: "changes_requested",
      summary: "The merged task needs a repair.",
      findings: ["Merged task output is incomplete."],
      fixInstructions: "Repair the merged task output.",
      targetTaskKey: "T1",
      shouldHavePr: null,
      followUpTasks: [],
      raw: { verdict: "changes_requested" },
    });
    const requestFixesForTask = vi.spyOn(service as any, "requestFixesForTask")
      .mockResolvedValue({ applied: true, mode: "cli" });

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
          title: "Merged task",
          prompt: "Implement the merged task.",
          depends_on: [],
          is_independent: true,
          status: "COMPLETED",
          provider: "opencode",
          session_id: "session-1",
          is_merged: true,
          merge_indicator: "MERGED",
        },
      ] as any,
    });

    expect(outcome.reviewed).toBe(true);
    expect(outcome.blockedCompletion).toBe(true);
    expect(outcome.mergeBlocked).toBe(true);
    expect(requestFixesForTask).not.toHaveBeenCalled();

    const tasks = projectRepository.listTasks(project.id, sprint.id);
    expect(tasks).toHaveLength(2);
    expect(tasks[0]?.status).toBe("completed");
    expect(tasks[0]?.isMerged).toBe(true);
    expect(tasks[0]?.mergeIndicator).toBe("MERGED");
    expect(tasks[1]?.taskKey).toBe("T02");
    expect(tasks[1]?.title).toBe("QA follow-up for T1");
    expect(tasks[1]?.promptMarkdown).toBe("Repair the merged task output.");

    const latestRun = qaReviewRepository.getLatestSprintRun(sprint.id);
    expect(latestRun?.outcome).toBe("changes_requested");
    expect(latestRun?.payload).toMatchObject({
      continued: false,
      continuationMode: "none",
      continuationSkippedReason: "target_task_already_merged",
      createdFollowUpTaskKeys: ["T02"],
    });
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
    const qaA = agentPresetRepository.createAgentPreset(project.id, { name: "QA A", presetId: "qa-a", instructionMarkdown: "Review as A." });
    const qaB = agentPresetRepository.createAgentPreset(project.id, { name: "QA B", presetId: "qa-b", instructionMarkdown: "Review as B." });
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
      blockedCompletion: true,
      mergeBlocked: true,
      reportText: expect.stringContaining("Sprint QA is still waiting on follow-up work"),
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

    expect(gate.reason).toBe("pending_review");
    expect(gate.latestRun?.status).toBe("cancelled");
    expect(gate.latestRun?.summaryMarkdown).toContain("Recovered stale QA review run");
    expect(qaReviewRepository.getRun(staleRun.id)?.status).toBe("cancelled");
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
    const qaA = agentPresetRepository.createAgentPreset(project.id, { name: "QA A", presetId: "qa-a", instructionMarkdown: "Review as A." });
    const qaB = agentPresetRepository.createAgentPreset(project.id, { name: "QA B", presetId: "qa-b", instructionMarkdown: "Review as B." });
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

  it("records a changes-requested QA verdict before awaiting follow-up coding", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-verdict-before-followup-"));
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
      provider: "opencode",
      sessionId: "session-1",
      startedAt: "2026-06-13T20:40:00.000Z",
      finishedAt: "2026-06-13T20:41:00.000Z",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-verdict-before-followup",
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
            taskCompletion: { enabled: true, agentPresetId: qaPreset.id },
            completedTaskWithoutPr: { enabled: true, agentPresetId: qaPreset.id },
            maxTaskReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockResolvedValue({
      verdict: "changes_requested",
      summary: "The task needs one follow-up fix.",
      findings: [],
      fixInstructions: "Fix the ledger line.",
      targetTaskKey: "T1",
      shouldHavePr: true,
      followUpTasks: [],
      raw: { verdict: "changes_requested", summary: "The task needs one follow-up fix." },
    });
    vi.spyOn(service as any, "requestFixesForTask").mockImplementation(async () => {
      const latestRun = qaReviewRepository.getLatestTaskRun(task.id);
      expect(latestRun?.status).toBe("completed");
      expect(latestRun?.outcome).toBe("changes_requested");
      expect(latestRun?.finishedAt).toBeTruthy();
      return { applied: true, mode: "cli" };
    });

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
        provider: "opencode",
        session_id: "session-1",
        pr_url: "https://example.com/pr/1",
      },
      subtasks: [],
    });

    expect(outcome.reopenedTask).toBe(true);
    expect(qaReviewRepository.getLatestTaskRun(task.id)?.payload?.continued).toBe(true);
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
    expect(gate.reason).toBe("pending_review");
    expect(gate.runsUsed).toBe(0);
    expect(gate.maxRuns).toBe(1);
    expect(recoveredRun?.status).toBe("cancelled");
    expect(recoveredRun?.summaryMarkdown).toContain("without provider runtime linkage");
    expect(recoveredInvocation?.status).toBe("cancelled");
    expect(recoveredInvocation?.errorMessage).toBeNull();
    expect(recoveredInvocation?.finishedAt).toBeTruthy();
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
    expect(recoveredRun?.status).toBe("cancelled");
    expect(recoveredRun?.summaryMarkdown).toContain("Docker container disappeared");
    expect(recoveredInvocation?.status).toBe("cancelled");
    expect(recoveredProviderInvocation?.status).toBe("cancelled");
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
    expect(qaReviewRepository.getRun(staleRun.id)?.status).toBe("cancelled");
    expect(qaReviewRepository.getLatestSprintRun(sprint.id)?.outcome).toBe("pass");
  });

  it("ignores failed sprint QA from an older sprint run when finalizing a new run", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-old-sprint-run-"));
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
    const previousSprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "cancelled",
    });
    const currentSprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-current-sprint-run",
      instructionMarkdown: "QA Agent",
    });
    const taskSnapshot = JSON.stringify([{
      id: "T1",
      title: "Initial task",
      prompt: "Implement the initial feature.",
      status: "COMPLETED",
      dependsOn: [],
      isMerged: true,
      mergeIndicator: "MERGED",
    }]);
    const oldRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: previousSprintRun.id,
      triggerType: "sprint_completion",
      runIndex: 1,
      agentPresetId: qaPreset.id,
      agentName: qaPreset.name,
      payload: {
        sprintRunId: previousSprintRun.id,
        taskSnapshot,
      },
      startedAt: "2026-04-11T09:20:00.000Z",
    });
    qaReviewRepository.updateRun(oldRun.id, {
      status: "failed",
      summaryMarkdown: "Virtual QA worker returned empty output.",
      finishedAt: "2026-04-11T09:21:00.000Z",
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
            sprintCompletion: { enabled: true, agentPresetIds: [qaPreset.id], agentPresetId: qaPreset.id },
            maxSprintReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockResolvedValue({
      verdict: "pass",
      summary: "Sprint QA passed for the current run.",
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
      sprintRunId: currentSprintRun.id,
      repoPath: dir,
      subtasks: [{
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: true,
        merge_indicator: "MERGED",
      }] as any,
    });

    expect(outcome).toMatchObject({
      reviewed: true,
      blockedCompletion: false,
      mergeBlocked: false,
    });
    expect((service as any).runReview).toHaveBeenCalledTimes(1);
    const latestRun = qaReviewRepository.getLatestSprintRun(sprint.id);
    expect(latestRun).toMatchObject({
      sprintRunId: currentSprintRun.id,
      runIndex: 2,
      status: "completed",
      outcome: "pass",
    });
  });

  it("blocks task merge and records a visible reason when task QA fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-task-failure-blocks-"));
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
      provider: "opencode",
      sessionId: "session-1",
      startedAt: "2026-06-13T20:40:00.000Z",
      finishedAt: "2026-06-13T20:41:00.000Z",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-task-failure",
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
            taskCompletion: { enabled: true, agentPresetId: qaPreset.id },
            completedTaskWithoutPr: { enabled: true, agentPresetId: qaPreset.id },
            maxTaskReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockRejectedValue(new Error("QA provider timeout."));

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
        provider: "opencode",
        session_id: "session-1",
        pr_url: "https://example.com/pr/1",
      },
      subtasks: [],
    });

    expect(outcome).toMatchObject({
      reviewed: false,
      reopenedTask: false,
      mergeBlocked: true,
    });
    expect(outcome.reportText).toContain("QA review failed for `T1` and must retry before merge");
    expect(outcome.reportText).toContain("QA provider timeout.");

    const latestRun = qaReviewRepository.getLatestTaskRun(task.id);
    expect(latestRun).toMatchObject({
      status: "failed",
      summaryMarkdown: "QA provider timeout.",
    });
    expect(latestRun?.payload).toMatchObject({ error_code: "API_TIMEOUT" });
  });

  it("blocks sprint completion and records a visible reason when sprint QA fails", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-sprint-failure-blocks-"));
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
      isMerged: true,
      mergeIndicator: "MERGED",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-sprint-failure",
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
            sprintCompletion: { enabled: true, agentPresetIds: [qaPreset.id], agentPresetId: qaPreset.id },
            maxSprintReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockRejectedValue(new Error("Sprint QA provider timed out."));

    const outcome = await service.reviewSprintCompletion({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      repoPath: dir,
      subtasks: [{
        record_id: task.id,
        project_id: project.id,
        sprint_id: sprint.id,
        id: "T1",
        title: "Initial task",
        prompt: "Implement the initial feature.",
        depends_on: [],
        is_independent: true,
        status: "COMPLETED",
        is_merged: true,
        merge_indicator: "MERGED",
      }] as any,
    });

    expect(outcome).toMatchObject({
      reviewed: false,
      blockedCompletion: true,
      mergeBlocked: true,
    });
    expect(outcome.reportText).toContain("Sprint QA failed and blocked merge");
    expect(outcome.reportText).toContain("Sprint QA provider timed out.");

    const latestRun = qaReviewRepository.getLatestSprintRun(sprint.id);
    expect(latestRun).toMatchObject({
      status: "failed",
      summaryMarkdown: "Sprint QA provider timed out.",
    });
    expect(latestRun?.payload).toMatchObject({ error_code: "UNKNOWN" });
  });

  it("marks a shutdown-interrupted task QA review as cancelled instead of failed", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-shutdown-cancelled-"));
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
      provider: "opencode",
      sessionId: "session-1",
      startedAt: "2026-07-03T10:00:00.000Z",
      finishedAt: "2026-07-03T10:05:00.000Z",
    });
    const qaPreset = agentPresetRepository.createAgentPreset(project.id, {
      name: "QA",
      presetId: "QA-shutdown",
      instructionMarkdown: "QA Agent",
    });
    const updateTaskSpy = vi.spyOn(projectRepository, "updateTask");

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
            taskCompletion: { enabled: true, agentPresetId: qaPreset.id },
            completedTaskWithoutPr: { enabled: true, agentPresetId: qaPreset.id },
            maxTaskReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockRejectedValue(
      new Error("Command spawner host exited (code=null, signal=SIGINT)"),
    );

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
        provider: "opencode",
        session_id: "session-1",
        pr_url: "https://example.com/pr/1",
      },
      subtasks: [],
    });

    const latestRun = qaReviewRepository.getLatestTaskRun(task.id);
    expect(outcome).toMatchObject({
      reviewed: false,
      reopenedTask: false,
      mergeBlocked: true,
      reportText: "",
    });
    expect(latestRun?.status).toBe("cancelled");
    expect(latestRun?.payload?.error_code).toBe("CANCELLED");
    expect(updateTaskSpy).toHaveBeenCalledWith(task.id, { mergeIndicator: null });
    expect(executionRepository.listTaskRunEvents(taskRun.id).map((event) => event.eventType)).toContain("qa_review_cancelled");
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
      prUrl: null,
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

    expect(prepareWorktreeSpy).toHaveBeenCalledWith(
      "/repo",
      "docker-volume://session-1",
      "task/feature-sprint-1-T1-gemini-recovered",
      "feature/sprint-1",
      undefined,
      expect.any(Object),
      { remoteOnly: true },
    );
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
      prUrl: null,
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

    expect(prepareWorktreeSpy).toHaveBeenCalledWith(
      "/repo",
      "docker-volume://session-1",
      "task/feature-sprint-1-T1-gemini-pr-recovered",
      "feature/sprint-1",
      undefined,
      expect.any(Object),
      { remoteOnly: true },
    );
    expect(updateTaskRunMock).toHaveBeenCalledWith("task-run-123", { workerBranch: "task/feature-sprint-1-T1-gemini-pr-recovered" });
    expect(updateTaskRunMock).toHaveBeenLastCalledWith("task-run-123", {
      workerBranch: "task/feature-sprint-1-T1-gemini-pr-recovered",
      prUrl: "https://github.com/org/repo/pull/1",
    });
    expect(taskShape.worker_branch).toBe("task/feature-sprint-1-T1-gemini-pr-recovered");
    expect(taskRunShape.workerBranch).toBe("task/feature-sprint-1-T1-gemini-pr-recovered");
    expect(taskRunShape.prUrl).toBe("https://github.com/org/repo/pull/1");
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

  it("resets stale merged state when a CLI QA follow-up opens a new PR", async () => {
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
    const updateTask = vi.fn();
    const updateTaskRun = vi.fn();
    const service = new QualityAssuranceService({
      projectManagementRepository: {
        updateTask,
        getSprint: vi.fn().mockReturnValue({
          id: "sprint-40",
          number: 40,
          slug: "title-formatting",
          name: "Title formatting",
          goal: "Keep PR titles consistent",
          linkedIssues: [{ issueKey: "CODUX-40" }],
        }),
      } as any,
      executionRepository: {
        getLatestProviderInvocationUsageBySession: vi.fn().mockReturnValue(null),
        createExecutionInvocation: vi.fn().mockReturnValue({ id: "exec-followup" }),
        appendExecutionInvocationMessage: vi.fn(),
        updateExecutionInvocation: vi.fn(),
        createProviderInvocationUsage: vi.fn().mockReturnValue({ id: "usage-followup" }),
        updateProviderInvocationUsage: vi.fn(),
        updateTaskRun,
        appendTaskRunEvent: vi.fn(),
        getTaskUsageGroups: vi.fn().mockReturnValue([]),
        listProviderInvocationsForTask: vi.fn().mockReturnValue([]),
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
          autoCreatePr: true,
          githubMode: "REMOTE",
          taskPrTitleScheme: "({sprint_tag}) {task_key}: {task_title}",
        },
        memory: {
          ...DEFAULT_DASHBOARD_SETTINGS.memory,
          enabled: false,
        },
      }),
      getGithubToken: () => "gh-token",
      sendSessionMessage: async () => ({}),
    });

    vi.spyOn((service as any).workspaceManager, "resolveResumeWorktreePath").mockResolvedValue("/worktree");
    vi.spyOn((service as any).workspaceManager, "buildWorktreePath").mockReturnValue("/worktree");
    vi.spyOn((service as any).workspaceManager, "resolveCurrentBranch").mockResolvedValue("task/feature-sprint-1-t1-codex");
    vi.spyOn((service as any).workspaceManager, "fastForwardResumedWorkspace").mockResolvedValue(true);
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    vi.spyOn(service as any, "runWorkspaceCommand").mockResolvedValue({ stdout: "base-head\n", stderr: "" });
    vi.spyOn((service as any).workspaceArtifactService, "exportBinaryPatch").mockResolvedValue("binary patch");
    vi.spyOn((service as any).workspaceArtifactService, "applyPatchToBranch").mockResolvedValue({ hasChanges: true });
    vi.spyOn((service as any).prService, "resolveOrCreateFeaturePr")
      .mockResolvedValue("https://github.com/org/repo/pull/1911");

    const taskShape = {
      id: "Task 1",
      record_id: "task-record-1",
      project_id: "project-1",
      sprint_id: "sprint-1",
      title: "Fix thing",
      prompt: "Implement the fix",
      depends_on: [],
      is_independent: true,
      status: "COMPLETED",
      is_merged: true,
      merge_indicator: "MERGED",
      worker_branch: "task/feature-sprint-1-t1-codex",
      pr_url: "https://github.com/org/repo/pull/1901",
    };
    const taskRunShape = {
      id: "task-run-1",
      taskId: "task-record-1",
      sprintRunId: "sprint-run-1",
      dispatchId: "dispatch-1",
      workerBranch: "task/feature-sprint-1-t1-codex",
      prUrl: "https://github.com/org/repo/pull/1901",
    };

    await (service as any).continueCliTaskSession({
      provider: "codex",
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

    expect((service as any).prService.resolveOrCreateFeaturePr).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "Task 1",
        title: "(CODUX-40) Task 1: Fix thing",
        featureBranch: "feature/sprint-1",
        workerBranch: "task/feature-sprint-1-t1-codex",
      }),
      "/repo",
      "gh-token",
    );
    expect(updateTaskRun).toHaveBeenCalledWith("task-run-1", {
      workerBranch: "task/feature-sprint-1-t1-codex",
      prUrl: "https://github.com/org/repo/pull/1911",
    });
    expect(updateTask).toHaveBeenCalledWith("task-record-1", {
      status: "coding_completed",
      isMerged: false,
      mergeIndicator: null,
    });
    expect(taskShape.status).toBe("CODING_COMPLETED");
    expect(taskShape.is_merged).toBe(false);
    expect(taskShape.merge_indicator).toBeUndefined();
    expect(taskShape.pr_url).toBe("https://github.com/org/repo/pull/1911");
    expect(taskRunShape.prUrl).toBe("https://github.com/org/repo/pull/1911");
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

  it("keeps the sprint run heartbeat alive without extending the sprint lease during long sprint QA reviews", async () => {
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
        sprintRunLifecycleService: {
          updateRun: (sprintRunId: string, input: Parameters<typeof executionRepository.updateSprintRun>[1]) =>
            executionRepository.updateSprintRun(sprintRunId, input),
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
      expect(executionRepository.getLease("sprint", sprint.id)?.expiresAt).toBe("2026-04-10T12:05:00.000Z");
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

  it("runs every configured task reviewer and blocks when one requests changes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-multi-task-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const project = projectRepository.createProject({ name: "QA Project", sourceType: "local", sourceRef: dir });
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
    const qaA = agentPresetRepository.createAgentPreset(project.id, { name: "QA A", presetId: "qa-a", instructionMarkdown: "Review as A." });
    const qaB = agentPresetRepository.createAgentPreset(project.id, { name: "QA B", presetId: "qa-b", instructionMarkdown: "Review as B." });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      state: "COMPLETED",
      provider: "codex",
      sessionId: "session-1",
      startedAt: "2026-06-13T20:40:00.000Z",
    });
    const resolveAgent = vi.fn(async (_projectId: string, agentPresetId: string | null) => ({
      id: agentPresetId || qaA.id,
      name: agentPresetId === qaA.id ? "QA A" : "QA B",
      instructionMarkdown: `Review as ${agentPresetId || "default"}.`,
    }));
    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: { resolveTargetedQualityAssuranceAgent: resolveAgent } as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetIds: [qaA.id, qaB.id], agentPresetId: qaA.id },
            completedTaskWithoutPr: { enabled: true, agentPresetIds: [], agentPresetId: null },
            maxTaskReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview")
      .mockResolvedValueOnce({ verdict: "pass", summary: "A passed.", findings: [], fixInstructions: null, targetTaskKey: null, shouldHavePr: true, followUpTasks: [], raw: { reviewer: "a" } })
      .mockResolvedValueOnce({ verdict: "changes_requested", summary: "B found a bug.", findings: ["Bug"], fixInstructions: null, targetTaskKey: "T1", shouldHavePr: true, followUpTasks: [], raw: { reviewer: "b" } });
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
        provider: "codex",
        session_id: "session-1",
        pr_url: "https://example.test/pull/1",
      } as any,
      subtasks: [],
    });

    expect(outcome.reviewed).toBe(true);
    expect(outcome.reopenedTask).toBe(true);
    expect(outcome.mergeBlocked).toBe(true);
    expect(resolveAgent).toHaveBeenCalledTimes(2);
    const runs = qaReviewRepository.listRunsForTask(task.id).sort((left, right) => left.agentPresetId!.localeCompare(right.agentPresetId!));
    expect(runs).toHaveLength(2);
    expect(runs.map((run) => run.runIndex)).toEqual([1, 1]);
    expect(runs.map((run) => run.outcome)).toEqual(["pass", "changes_requested"]);
    expect(runs.map((run) => run.payload)).toEqual([
      expect.objectContaining({ agentPresetId: qaA.id, agentName: "QA A", reviewer: "a" }),
      expect.objectContaining({ agentPresetId: qaB.id, agentName: "QA B", reviewer: "b" }),
    ]);
  });

  it("runs every configured sprint reviewer and allows completion when all pass", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-multi-sprint-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const project = projectRepository.createProject({ name: "QA Project", sourceType: "local", sourceRef: dir });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship safely",
      status: "running",
      featureBranch: "feature/sprint-1",
    });
    const qaA = agentPresetRepository.createAgentPreset(project.id, { name: "QA A", presetId: "qa-a", instructionMarkdown: "Review as A." });
    const qaB = agentPresetRepository.createAgentPreset(project.id, { name: "QA B", presetId: "qa-b", instructionMarkdown: "Review as B." });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    const resolveAgent = vi.fn(async (_projectId: string, agentPresetId: string | null) => ({
      id: agentPresetId || qaA.id,
      name: agentPresetId === qaA.id ? "QA A" : "QA B",
      instructionMarkdown: `Review as ${agentPresetId || "default"}.`,
    }));
    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: { resolveTargetedQualityAssuranceAgent: resolveAgent } as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            sprintCompletion: { enabled: true, agentPresetIds: [qaA.id, qaB.id], agentPresetId: qaA.id },
            maxSprintReviewRuns: 3,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview")
      .mockResolvedValueOnce({ verdict: "pass", summary: "A passed.", findings: [], fixInstructions: null, targetTaskKey: null, shouldHavePr: null, followUpTasks: [], raw: { reviewer: "a" } })
      .mockResolvedValueOnce({ verdict: "pass", summary: "B passed.", findings: [], fixInstructions: null, targetTaskKey: null, shouldHavePr: null, followUpTasks: [], raw: { reviewer: "b" } });

    const outcome = await service.reviewSprintCompletion({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      repoPath: dir,
      subtasks: [],
    });

    expect(outcome.reviewed).toBe(true);
    expect(outcome.blockedCompletion).toBe(false);
    expect(outcome.reportText).toContain("A passed.");
    expect(outcome.reportText).toContain("B passed.");
    const runs = qaReviewRepository.listLatestSprintCycleRuns(sprint.id);
    expect(runs).toHaveLength(2);
    expect(runs.every((run) => run.runIndex === 1 && run.outcome === "pass")).toBe(true);
  });

  it("resolves one default QA reviewer when no trigger agent IDs are configured", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-default-reviewer-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const project = projectRepository.createProject({ name: "QA Project", sourceType: "local", sourceRef: dir });
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
    const defaultQa = agentPresetRepository.createAgentPreset(project.id, { name: "Default QA", presetId: "default-qa", instructionMarkdown: "Review as default." });
    const resolveAgent = vi.fn(async (_projectId: string, agentPresetId: string | null) => ({
      id: agentPresetId || defaultQa.id,
      name: "Default QA",
      instructionMarkdown: "Review as default.",
    }));
    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: { resolveTargetedQualityAssuranceAgent: resolveAgent } as any,
      providerRunner: {} as any,
      getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockResolvedValue({ verdict: "pass", summary: "Default passed.", findings: [], fixInstructions: null, targetTaskKey: null, shouldHavePr: true, followUpTasks: [], raw: {} });
    vi.spyOn(service as any, "cleanupCliWorkspaceIfNeeded").mockResolvedValue(undefined);

    await service.reviewCompletedTask({
      projectId: project.id,
      sprintId: sprint.id,
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
        pr_url: "https://example.test/pull/1",
      } as any,
      subtasks: [],
    });

    expect(resolveAgent).toHaveBeenCalledTimes(1);
    expect(resolveAgent).toHaveBeenCalledWith(project.id, null);
    expect(qaReviewRepository.listRunsForTask(task.id)).toHaveLength(1);
  });

  it("does not double-count reviewers in one task QA budget cycle", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-service-budget-cycle-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const projectRepository = new ProjectManagementRepository(storage);
    const executionRepository = new ExecutionRepository(storage);
    const qaReviewRepository = new QaReviewRepository(storage);
    const agentPresetRepository = new AgentPresetRepository(storage);
    const project = projectRepository.createProject({ name: "QA Project", sourceType: "local", sourceRef: dir });
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
    const qaA = agentPresetRepository.createAgentPreset(project.id, { name: "QA A", presetId: "qa-a", instructionMarkdown: "Review as A." });
    const qaB = agentPresetRepository.createAgentPreset(project.id, { name: "QA B", presetId: "qa-b", instructionMarkdown: "Review as B." });
    for (const agentPresetId of [qaA.id, qaB.id]) {
      const priorRun = qaReviewRepository.createRun({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        triggerType: "task_completion",
        runIndex: 1,
        agentPresetId,
      });
      qaReviewRepository.updateRun(priorRun.id, {
        status: "completed",
        outcome: "changes_requested",
        summaryMarkdown: "Needs fixes.",
        finishedAt: new Date().toISOString(),
      });
    }
    const resolveAgent = vi.fn(async (_projectId: string, agentPresetId: string | null) => ({
      id: agentPresetId || qaA.id,
      name: agentPresetId || "Default QA",
      instructionMarkdown: "Review.",
    }));
    const service = new QualityAssuranceService({
      projectManagementRepository: projectRepository,
      executionRepository,
      guardrailService: qaGuardrailStub(),
      sessionTracking: {} as any,
      qaReviewRepository,
      taskService: {} as any,
      agentPresetSyncService: { resolveTargetedQualityAssuranceAgent: resolveAgent } as any,
      providerRunner: {} as any,
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        agents: {
          ...DEFAULT_DASHBOARD_SETTINGS.agents,
          qualityAssurance: {
            ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance,
            enabled: true,
            taskCompletion: { enabled: true, agentPresetIds: [qaA.id, qaB.id], agentPresetId: qaA.id },
            maxTaskReviewRuns: 2,
          },
        },
      }),
      getGithubToken: () => undefined,
      sendSessionMessage: async () => ({}),
    });
    vi.spyOn(service as any, "runReview").mockResolvedValue({ verdict: "pass", summary: "Verified.", findings: [], fixInstructions: null, targetTaskKey: null, shouldHavePr: true, followUpTasks: [], raw: {} });
    vi.spyOn(service as any, "cleanupCliWorkspaceIfNeeded").mockResolvedValue(undefined);

    const outcome = await service.reviewCompletedTask({
      projectId: project.id,
      sprintId: sprint.id,
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
        pr_url: "https://example.test/pull/1",
      } as any,
      subtasks: [],
    });

    expect(outcome.reviewed).toBe(true);
    expect(qaReviewRepository.countTaskRuns(task.id)).toBe(2);
    expect(qaReviewRepository.listLatestTaskCycleRuns(task.id).map((run) => run.runIndex)).toEqual([2, 2]);
  });
});
