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

import { syncRemoteBranchIfAvailable } from "../../../src/services/git-branch-sync-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(syncRemoteBranchIfAvailable).mockResolvedValue(true);
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
            maxTaskReviewRuns: 2,
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

  it("does not rerun sprint QA after fixes when maxTaskReviewRuns is 1", async () => {
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
            maxTaskReviewRuns: 1,
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
            maxTaskReviewRuns: 2,
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

  it("resets an existing CLI QA follow-up workspace to the latest worker branch before running the fix", async () => {
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
    const prepareWorktree = vi.spyOn((service as any).workspaceManager, "prepareWorktree").mockResolvedValue(undefined);
    vi.spyOn((service as any).workspaceManager, "buildWorkspaceGuidance").mockResolvedValue("");
    vi.spyOn(service as any, "workspacePathExists").mockResolvedValue(true);
    const runWorkspaceCommand = vi.spyOn(service as any, "runWorkspaceCommand").mockImplementation(
      async (_worktreePath: string, _command: string, commandArgs: string[]) => {
        if (commandArgs[0] === "rev-parse") {
          return { stdout: "remote-worker-head\n", stderr: "" };
        }
        return { stdout: "", stderr: "" };
      },
    );
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
    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "/worktree",
      "git",
      ["fetch", "origin", "+refs/heads/feature/task-1:refs/remotes/origin/feature/task-1"],
      expect.anything(),
    );
    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "/worktree",
      "git",
      ["checkout", "-B", "feature/task-1", "origin/feature/task-1"],
    );
    expect(runWorkspaceCommand).toHaveBeenCalledWith(
      "/worktree",
      "git",
      ["reset", "--hard", "origin/feature/task-1"],
    );
    expect(runProvider).toHaveBeenCalledWith(expect.objectContaining({
      cwd: "/worktree",
    }));
    expect((service as any).workspaceArtifactService.exportBinaryPatch).toHaveBeenCalledWith("/worktree", "remote-worker-head");
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
    vi.spyOn(service as any, "workspacePathExists").mockResolvedValue(true);
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
});
