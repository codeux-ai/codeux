import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { GuardrailRepository } from "../../../src/repositories/guardrail-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { QaReviewRepository } from "../../../src/repositories/qa-review-repository.js";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { RuntimeStartupRecoveryService } from "../../../src/services/runtime-startup-recovery-service.js";
import { SprintRunLifecycleService } from "../../../src/services/sprint-run-lifecycle-service.js";
import { QaReviewRecoveryService } from "../../../src/services/runtime-recovery/qa-review-recovery.js";
import { InvocationRecoveryService } from "../../../src/services/runtime-recovery/invocation-recovery.js";
import { CliWorkflowService } from "../../../src/services/cli-workflow-service.js";
import { buildTaskRunKey } from "../../../src/services/task-run-key.js";
import { GuardrailService } from "../../../src/services/guardrail-service.js";
import type { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import type { Logger } from "../../../src/shared/logging/logger.js";
import type { DashboardSettings } from "../../../src/contracts/app-types.js";

const tempDirs: string[] = [];

async function createFixture(options?: {
  recoverSprintRun?: SprintOrchestrator["recoverSprintRun"];
  logger?: Pick<Logger, "info" | "error">;
  dockerService?: {
    listContainers: () => Promise<Array<{ id?: string; names?: string; labels?: Record<string, string> }>>;
    removeContainers?: (containerIds: string[], options?: { removeVolumes?: boolean }) => Promise<void>;
  };
  isProcessAlive?: (pid: number) => boolean;
  getDashboardSettings?: () => DashboardSettings;
}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-startup-recovery-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const guardrailRepository = new GuardrailRepository(storage);
  const projectAttentionRepository = new ProjectAttentionRepository(storage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
  const projectAttentionService = new ProjectAttentionService(
    projectAttentionRepository,
    projectWorkerAssignmentRepository,
  );
  const guardrailService = new GuardrailService(
    guardrailRepository,
    () => DEFAULT_DASHBOARD_SETTINGS.guardrails,
  );
  const qaReviewRepository = new QaReviewRepository(storage);
  const sessionTracking = new SessionTrackingRepository(path.join(dir, "session-tracking.db"));
  const recoverSprintRun = options?.recoverSprintRun ?? vi.fn().mockResolvedValue(null);
  const sprintRunLifecycleService = new SprintRunLifecycleService({
    executionRepository,
    projectManagementRepository: projectRepository,
  });

  const service = new RuntimeStartupRecoveryService({
    sessionTracking,
    executionRepository,
    sprintRunLifecycleService,
    qaReviewRepository,
    projectManagementRepository: projectRepository,
    projectAttentionService,
    guardrailService,
    sprintOrchestrator: {
      recoverSprintRun,
    } as SprintOrchestrator,
    dockerService: options?.dockerService as any,
    getDashboardSettings: options?.getDashboardSettings ?? (() => DEFAULT_DASHBOARD_SETTINGS),
    isProcessAlive: options?.isProcessAlive,
    logger: options?.logger,
  });

  return {
    projectRepository,
    executionRepository,
    guardrailRepository,
    projectAttentionRepository,
    projectAttentionService,
    guardrailService,
    qaReviewRepository,
    sessionTracking,
    service,
    recoverSprintRun,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RuntimeStartupRecoveryService", () => {
  it("executes recovery submodules in the correct order", async () => {
    const { service } = await createFixture();

    const qaReviewSpy = vi.spyOn(QaReviewRecoveryService.prototype, "reconcileInterruptedQaReviewRuns");
    const terminalProviderSpy = vi.spyOn(InvocationRecoveryService.prototype, "reconcileTerminalProviderLinkedInvocations");
    const structuredSpy = vi.spyOn(InvocationRecoveryService.prototype, "reconcileInterruptedStructuredInvocations");
    const taskCodingSpy = vi.spyOn(InvocationRecoveryService.prototype, "reconcileInterruptedTaskCodingInvocations");
    const orphanedProviderSpy = vi.spyOn(InvocationRecoveryService.prototype, "reconcileOrphanedTaskCodingProviderInvocations");

    await service.recover();

    expect(qaReviewSpy).toHaveBeenCalledTimes(1);
    expect(terminalProviderSpy).toHaveBeenCalledTimes(1);
    expect(structuredSpy).toHaveBeenCalledTimes(1);
    expect(taskCodingSpy).toHaveBeenCalledTimes(1);
    expect(orphanedProviderSpy).toHaveBeenCalledTimes(1);

    const qaOrder = qaReviewSpy.mock.invocationCallOrder[0];
    const terminalProviderOrder = terminalProviderSpy.mock.invocationCallOrder[0];
    const structOrder = structuredSpy.mock.invocationCallOrder[0];
    const taskCodingOrder = taskCodingSpy.mock.invocationCallOrder[0];
    const providerOrder = orphanedProviderSpy.mock.invocationCallOrder[0];

    expect(qaOrder).toBeLessThan(terminalProviderOrder);
    expect(terminalProviderOrder).toBeLessThan(structOrder);
    expect(structOrder).toBeLessThan(taskCodingOrder);
    expect(taskCodingOrder).toBeLessThan(providerOrder);
  });

  it("demotes premature virtual merge-conflict human escalations back to automatic worker attention", async () => {
    const {
      projectRepository,
      executionRepository,
      guardrailRepository,
      projectAttentionRepository,
      projectAttentionService,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Premature Escalation Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/premature-escalation-recovery",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Premature Escalation Recovery Sprint",
      number: 11,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Resolve conflict automatically",
      status: "coding_completed",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "docker_cli",
      status: "running",
    });

    guardrailRepository.record({ projectId: project.id, taskId: task.id, purpose: "merge_conflict" });
    guardrailRepository.record({ projectId: project.id, taskId: task.id, purpose: "merge_conflict" });

    const escalation = projectAttentionService.openItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      attentionType: "human_escalation_required",
      severity: "high",
      ownerType: "human",
      title: "Virtual worker escalation: Merge conflict for T01",
      summaryMarkdown: "Virtual worker failed once, but the merge-conflict cap is not exhausted.",
      payload: {
        sourceAttentionType: "merge_conflict",
        sourceAttentionItemId: "source-attention-1",
        escalatedBy: "virtual_worker",
        repoPath: "/workspace/premature-escalation-recovery",
      },
    });

    const result = await service.recover();

    expect(result.demotedPrematureMergeConflictEscalationIds).toEqual([escalation.id]);
    expect(projectAttentionRepository.getAttentionItem(escalation.id)).toMatchObject({
      status: "dismissed",
    });

    const restoredItems = projectAttentionRepository.listProjectAttentionItems(project.id, {
      statuses: ["open"],
      limit: 10,
    });
    expect(restoredItems).toEqual([
      expect.objectContaining({
        attentionType: "merge_conflict",
        ownerType: "worker",
        taskId: task.id,
        sprintRunId: sprintRun.id,
        payload: expect.objectContaining({
          recoveredFromHumanEscalationItemId: escalation.id,
          recoveryReason: "startup_premature_merge_conflict_escalation_demoted",
          mergeConflictRetryCount: 2,
          mergeConflictRetryCap: 3,
        }),
      }),
    ]);
  });

  it("repairs stale blocked dispatch rows linked to completed task runs", async () => {
    const {
      projectRepository,
      executionRepository,
      sessionTracking,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Terminal Dispatch Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/terminal-dispatch-recovery",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Terminal Dispatch Recovery Sprint",
      number: 7,
      status: "completed",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T07",
      title: "Completed task with stale dispatch",
      status: "completed",
      isMerged: true,
      mergeIndicator: "MERGED",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "jules",
      status: "completed",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      executorType: "jules",
      status: "blocked",
      errorMessage: "Provider session requires attention before dispatch reconciliation.",
      startedAt: "2026-06-27T09:57:59.808Z",
      finishedAt: "2026-06-27T10:50:11.924Z",
    } as any);
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      dispatchId: dispatch.id,
      provider: "jules",
      state: "COMPLETED",
      startedAt: "2026-06-27T09:57:59.808Z",
      finishedAt: "2026-06-27T11:05:10.343Z",
    });

    const result = await service.recover();

    expect(result.reconciledTerminalDispatchIds).toEqual([dispatch.id]);
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      status: "completed",
      errorMessage: null,
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id).map((event) => event.eventType)).toContain("task_dispatch_reconciled");
  });

  it("cancels stale running QA review rows without provider runtime linkage on startup", async () => {
    const {
      projectRepository,
      executionRepository,
      qaReviewRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "QA Startup Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/qa-startup-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "QA Startup Recovery Sprint",
      number: 7,
      status: "running",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "docker_cli",
      status: "running",
    });
    const qaRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      triggerType: "sprint_completion",
      runIndex: 1,
      startedAt: "2026-03-29T10:00:00.000Z",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      type: "qa_review",
      provider: "qwen-code",
      status: "running",
      startedAt: "2026-03-29T10:00:10.000Z",
    });
    executionRepository.appendExecutionInvocationMessage(invocation.id, {
      role: "system",
      contentMarkdown: "QA review started",
      createdAt: "2026-03-29T10:00:10.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledQaReviewRunIds).toEqual(expect.arrayContaining([qaRun.id]));
    expect(qaReviewRepository.getRun(qaRun.id)).toMatchObject({
      status: "cancelled",
      summaryMarkdown: expect.stringContaining("without provider runtime linkage"),
    });
    expect(executionRepository.getExecutionInvocation(invocation.id)).toMatchObject({
      status: "cancelled",
      errorMessage: null,
    });
  });

  it("fails stale running planning invocation audit rows without provider runtime linkage on startup", async () => {
    const {
      projectRepository,
      executionRepository,
      sessionTracking,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Planning Audit Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/planning-audit-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Planning Audit Recovery Sprint",
      number: 8,
      status: "planning",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      type: "planning",
      provider: "qwen-code",
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledStructuredInvocationIds).toEqual(expect.arrayContaining([invocation.id]));
    expect(executionRepository.getExecutionInvocation(invocation.id)).toMatchObject({
      status: "failed",
      errorMessage: expect.stringContaining("without provider runtime linkage"),
    });
  });

  it("reconciles stale task coding invocation audit rows when the provider invocation already finished", async () => {
    const {
      projectRepository,
      executionRepository,
      sessionTracking,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Task Coding Audit Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/task-coding-audit-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Task Coding Audit Recovery Sprint",
      number: 9,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Recover stale coding audit",
      executorType: "jules",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "jules",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      provider: "jules",
      mode: "jules",
      sessionId: "jules-stale-task-coding",
      state: "RUNNING",
      startedAt: "2026-03-29T10:00:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      taskRunId: taskRun.id,
      sessionId: "jules-stale-task-coding",
      provider: "jules",
      purpose: "task_coding",
      status: "completed",
      startedAt: "2026-03-29T10:00:00.000Z",
      finishedAt: "2026-03-29T10:02:00.000Z",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      taskRunId: taskRun.id,
      providerInvocationId: providerInvocation.id,
      type: "task_coding",
      provider: "jules",
      status: "running",
      startedAt: "2026-03-29T10:00:01.000Z",
    });
    sessionTracking.createSession({
      id: "jules-stale-task-coding",
      provider: "jules",
      taskId: "Sprint 9",
      title: "Recover stale coding audit",
      state: "RUNNING",
      featureBranch: "feature/sprint-9",
      workerBranch: "task/feature-sprint-9-t01",
      repoPath: project.baseDir,
    });

    const result = await service.recover();

    expect(result.reconciledTaskCodingInvocationIds).toEqual(expect.arrayContaining([invocation.id]));
    expect(executionRepository.getExecutionInvocation(invocation.id)).toMatchObject({
      status: "completed",
      errorMessage: null,
    });
    expect(sessionTracking.getSession("jules-stale-task-coding")?.state).toBe("COMPLETED");
  });

  it("reconciles stale non-task execution audit rows when the provider invocation already failed", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "CI Fix Audit Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/ci-fix-audit-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "CI Fix Audit Recovery Sprint",
      number: 10,
      status: "running",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "docker_cli",
      status: "running",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      sessionId: "virtual-cifix-codex-stale",
      provider: "codex",
      purpose: "ci_fix",
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
    });
    executionRepository.updateProviderInvocationUsage(providerInvocation.id, {
      status: "failed",
      finishedAt: "2026-03-29T10:00:20.000Z",
      durationMs: 20_000,
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      providerInvocationId: providerInvocation.id,
      type: "ci_fix",
      provider: "codex",
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledTerminalProviderLinkedInvocationIds).toEqual([invocation.id]);
    expect(executionRepository.getExecutionInvocation(invocation.id)).toMatchObject({
      status: "failed",
      finishedAt: "2026-03-29T10:00:20.000Z",
      errorMessage: "Recovered stale ci_fix invocation after the backing provider invocation failed.",
    });
    expect(executionRepository.listExecutionInvocationMessages(invocation.id)).toEqual([
      expect.objectContaining({
        role: "system",
        contentMarkdown: "Recovered stale ci_fix invocation after the backing provider invocation failed.",
        metadata: expect.objectContaining({
          recovery: "startup_terminal_provider_invocation_reconcile",
          providerInvocationId: providerInvocation.id,
          providerStatus: "failed",
        }),
      }),
    ]);
  });

  it("cancels stale non-task execution audit rows without provider runtime linkage", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Chat Compaction Audit Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/chat-compaction-audit-recovery-project",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      type: "chat_compaction",
      provider: "qwen-code",
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledTerminalProviderLinkedInvocationIds).toEqual([invocation.id]);
    expect(executionRepository.getExecutionInvocation(invocation.id)).toMatchObject({
      status: "cancelled",
      errorMessage: null,
      finishedAt: expect.any(String),
    });
    expect(executionRepository.listExecutionInvocationMessages(invocation.id)).toEqual([
      expect.objectContaining({
        role: "system",
        contentMarkdown: "Recovered stale chat_compaction invocation after it stayed running without provider runtime linkage.",
        metadata: expect.objectContaining({
          recovery: "startup_terminal_provider_invocation_reconcile",
          providerInvocationId: null,
        }),
      }),
    ]);
  });

  it("reconciles stale active task runs from terminal project task state on startup", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Task Run Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/task-run-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Task Run Recovery Sprint",
      number: 10,
      status: "completed",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Completed task with stale run",
      executorType: "jules",
      status: "completed",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      provider: "jules",
      mode: "jules",
      sessionId: "jules-terminal-task-run",
      state: "RUNNING",
      startedAt: "2026-03-29T10:00:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledTaskRunIds).toEqual([taskRun.id]);
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      state: "COMPLETED",
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "task_run_reconciled",
          payload: expect.objectContaining({
            previousState: "RUNNING",
          }),
        }),
      ]),
    );
  });

  it("reconciles orphaned running task coding provider invocations from terminal task state", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Provider Orphan Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/provider-orphan-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Provider Orphan Recovery Sprint",
      number: 11,
      status: "completed",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Completed task with orphaned provider",
      executorType: "jules",
      status: "completed",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "jules",
      status: "completed",
      finishedAt: "2026-03-29T10:03:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      sessionId: "jules-orphan-provider",
      provider: "jules",
      purpose: "task_coding",
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
    });
    const result = await service.recover();

    expect(result.reconciledTaskCodingProviderIds).toEqual(expect.arrayContaining([providerInvocation.id]));
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)).toMatchObject({
      status: "completed",
    });
  });

  it("fails orphaned running task coding provider invocations when the linked task run already failed", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Failed Provider Orphan Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/failed-provider-orphan-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Failed Provider Orphan Recovery Sprint",
      number: 12,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Failed task with orphaned provider",
      executorType: "docker_cli",
      status: "pending",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "docker_cli",
      status: "paused",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "failed",
      finishedAt: "2026-03-29T10:03:00.000Z",
    } as any);
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "codex",
      mode: "docker_cli",
      sessionId: "cli-codex-orphaned",
      state: "FAILED",
      startedAt: "2026-03-29T10:00:00.000Z",
      finishedAt: "2026-03-29T10:03:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      sessionId: "cli-codex-orphaned",
      provider: "codex",
      purpose: "task_coding",
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledTaskCodingProviderIds).toEqual(expect.arrayContaining([providerInvocation.id]));
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)).toMatchObject({
      status: "failed",
      finishedAt: expect.any(String),
    });
  });

  it("fails paused sprint runs whose associated sprint reached a terminal state", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Paused Sprint Cleanup Project",
      sourceType: "local",
      sourceRef: "/workspace/paused-sprint-cleanup-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Paused Sprint Cleanup",
      number: 12,
      status: "completed",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "paused",
      startedAt: "2026-03-29T10:00:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledPausedSprintRunIds).toEqual([sprintRun.id]);
    expect(executionRepository.getSprintRun(sprintRun.id)).toMatchObject({
      status: "failed",
      finishedAt: expect.any(String),
    });
  });

  it("fails interrupted local CLI dispatches back to a retryable state and resumes the sprint run", async () => {
    const {
      projectRepository,
      executionRepository,
      sessionTracking,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Startup Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/startup-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Startup Recovery Sprint",
      number: 42,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Recover interrupted CLI task",
      executorType: "docker_cli",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "docker_cli",
      status: "running",
    });
    executionRepository.updateSprintRun(sprintRun.id, {
      status: "running",
      startedAt: "2026-03-29T10:00:00.000Z",
      lastHeartbeatAt: "2026-03-29T10:05:00.000Z",
    });
    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: "sprint_orchestrator",
      leaseToken: "boot-lease-token",
      expiresAt: "2030-03-29T10:10:00.000Z",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "running",
    });
    executionRepository.updateTaskDispatch(dispatch.id, {
      status: "running",
      startedAt: "2026-03-29T10:01:00.000Z",
      lastHeartbeatAt: "2026-03-29T10:04:00.000Z",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "codex",
      mode: "docker_cli",
      sessionId: "cli-codex-running",
      sessionName: "sessions/cli-codex-running",
      state: "RUNNING",
      startedAt: "2026-03-29T10:01:00.000Z",
    });
    sessionTracking.createSession({
      id: "cli-codex-running",
      provider: "codex",
      state: "RUNNING",
      taskId: "Sprint 42 [T01]",
      title: "Sprint 42: [T01] Recover interrupted CLI task",
      repoPath: project.baseDir,
      featureBranch: "feature/sprint-42",
      workerBranch: "task/feature-sprint-42-t01-codex",
    });

    const result = await service.recover();

    expect(result.recoveredCliSessionIds).toEqual(["cli-codex-running"]);
    expect(result.reconciledLocalDispatchIds).toEqual([dispatch.id]);
    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
    expect(executionRepository.getLease("sprint", sprint.id)).toBeNull();

    expect(sessionTracking.getSession("cli-codex-running")?.state).toBe("CANCELLED");
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      id: dispatch.id,
      status: "cancelled",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "FAILED",
    });
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
  });

  it("fails interrupted Jules dispatches that never persisted a provider session back to a retryable state", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Interrupted Jules Project",
      sourceType: "local",
      sourceRef: "/workspace/interrupted-jules-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Interrupted Jules Sprint",
      number: 3,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Start Jules session after restart",
      executorType: "jules",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "jules",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "jules",
      status: "running",
    });
    executionRepository.updateTaskDispatch(dispatch.id, {
      status: "running",
      startedAt: "2026-03-29T10:01:00.000Z",
      lastHeartbeatAt: "2026-03-29T10:01:00.000Z",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      mode: "jules",
      state: "RUNNING",
      startedAt: "2026-03-29T10:01:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledProviderDispatchIds).toEqual([dispatch.id]);
    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      id: dispatch.id,
      status: "failed",
      errorMessage: "Jules dispatch was interrupted before Code UX persisted a provider session. The task was moved back to a retryable state.",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "FAILED",
      sessionId: null,
      sessionName: null,
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "dispatch_failed",
          payload: expect.objectContaining({
            reason: "runtime_restart_interrupted_before_session",
          }),
        }),
      ]),
    );
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
  });

  it("keeps active Jules dispatches with persisted sessions attached for sprint recovery", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Durable Jules Project",
      sourceType: "local",
      sourceRef: "/workspace/durable-jules-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Durable Jules Sprint",
      number: 4,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Keep durable Jules session",
      executorType: "jules",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "jules",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "jules",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "jules",
      mode: "jules",
      sessionId: "jules-session-1",
      sessionName: "sessions/jules-session-1",
      state: "RUNNING",
      startedAt: "2026-03-29T10:01:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledProviderDispatchIds).toEqual([]);
    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      id: dispatch.id,
      status: "running",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "RUNNING",
      sessionId: "jules-session-1",
    });
  });

  it("rehydrates active Jules sessions from terminal sprint runs and resumes one recovered run", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Rehydrate Durable Jules Project",
      sourceType: "local",
      sourceRef: "/workspace/rehydrate-durable-jules-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Rehydrate Durable Jules Sprint",
      number: 5,
      status: "running",
    });
    const olderTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Older durable Jules task",
      executorType: "jules",
      status: "in_progress",
    });
    const newerTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Newer durable Jules task",
      executorType: "jules",
      status: "in_progress",
    });
    const olderRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "jules",
      status: "failed",
    });
    executionRepository.updateSprintRun(olderRun.id, {
      status: "failed",
      startedAt: "2026-03-29T10:00:00.000Z",
      finishedAt: "2026-03-29T10:05:00.000Z",
      lastHeartbeatAt: "2026-03-29T10:05:00.000Z",
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    const newerRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "jules",
      status: "cancelled",
    });
    executionRepository.updateSprintRun(newerRun.id, {
      status: "cancelled",
      startedAt: "2026-03-29T10:10:00.000Z",
      finishedAt: "2026-03-29T10:11:00.000Z",
      lastHeartbeatAt: "2026-03-29T10:11:00.000Z",
    });

    const olderDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: olderTask.id,
      sprintRunId: olderRun.id,
      executorType: "jules",
      status: "failed",
    });
    executionRepository.updateTaskDispatch(olderDispatch.id, {
      status: "failed",
      startedAt: "2026-03-29T10:01:00.000Z",
      finishedAt: "2026-03-29T10:05:00.000Z",
      errorMessage: "Provider session failed before dispatch reconciliation.",
    });
    const olderTaskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: olderTask.id,
      sprintRunId: olderRun.id,
      dispatchId: olderDispatch.id,
      provider: "jules",
      mode: "jules",
      sessionId: "jules-older-survived",
      sessionName: "sessions/jules-older-survived",
      state: "RUNNING",
      startedAt: "2026-03-29T10:01:00.000Z",
    });
    const olderUsage = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: olderTask.id,
      sprintRunId: olderRun.id,
      sessionId: "jules-older-survived",
      provider: "jules",
      purpose: "task_coding",
      status: "failed",
      startedAt: "2026-03-29T10:01:00.000Z",
      invocationSource: "EXTERNAL_API",
    });

    const newerDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: newerTask.id,
      sprintRunId: newerRun.id,
      executorType: "jules",
      status: "running",
    });
    const newerTaskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: newerTask.id,
      sprintRunId: newerRun.id,
      dispatchId: newerDispatch.id,
      provider: "jules",
      mode: "jules",
      sessionId: "jules-newer-survived",
      sessionName: "sessions/jules-newer-survived",
      state: "RUNNING",
      startedAt: "2026-03-29T10:12:00.000Z",
    });

    const result = await service.recover();

    expect(result.rehydratedSprintRunIds).toEqual([newerRun.id]);
    expect(result.resumedSprintRunIds).toEqual([newerRun.id]);
    expect(result.supersededSprintRunIds).toEqual([]);
    expect(recoverSprintRun).toHaveBeenCalledWith(newerRun.id);

    expect(executionRepository.getSprintRun(newerRun.id)).toMatchObject({
      status: "running",
      finishedAt: null,
    });
    expect(executionRepository.getSprintRun(olderRun.id)).toMatchObject({
      status: "failed",
    });
    expect(executionRepository.getTaskRun(olderTaskRun.id)).toMatchObject({
      sprintRunId: newerRun.id,
      state: "RUNNING",
      sessionId: "jules-older-survived",
    });
    expect(executionRepository.getTaskRun(newerTaskRun.id)).toMatchObject({
      sprintRunId: newerRun.id,
      state: "RUNNING",
      sessionId: "jules-newer-survived",
    });
    expect(executionRepository.getTaskDispatch(olderDispatch.id)).toMatchObject({
      sprintRunId: newerRun.id,
      status: "running",
      finishedAt: null,
      errorMessage: null,
    });
    expect(executionRepository.getProviderInvocationUsage(olderUsage.id)).toMatchObject({
      sprintRunId: newerRun.id,
      dispatchId: olderDispatch.id,
      taskRunId: olderTaskRun.id,
      status: "running",
      finishedAt: null,
    });
  });

  it("recovers only the newest active run per sprint and fails older duplicate active runs", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Duplicate Active Run Project",
      sourceType: "local",
      sourceRef: "/workspace/duplicate-active-run-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Duplicate Active Run Sprint",
      number: 7,
      status: "running",
    });
    const olderRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });
    await new Promise((resolve) => setTimeout(resolve, 5));
    const newerRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "queued",
    });

    const result = await service.recover();

    expect(result.resumedSprintRunIds).toEqual([newerRun.id]);
    expect(result.supersededSprintRunIds).toEqual([olderRun.id]);
    expect(recoverSprintRun).toHaveBeenCalledTimes(1);
    expect(recoverSprintRun).toHaveBeenCalledWith(newerRun.id);
    expect(executionRepository.getSprintRun(olderRun.id)).toMatchObject({
      id: olderRun.id,
      status: "failed",
    });
    expect(executionRepository.listSprintRunEvents(olderRun.id)[0]).toMatchObject({
      eventType: "sprint_failed",
      payload: expect.objectContaining({
        reason: "superseded_by_newer_active_run_on_startup",
      }),
    });
  });

  it("skips active local dispatches whose task run is already terminal", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Terminal Task Run Project",
      sourceType: "local",
      sourceRef: "/workspace/terminal-task-run-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Terminal Task Run Sprint",
      number: 13,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Already completed task",
      executorType: "docker_cli",
      status: "done",
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
      provider: "codex",
      mode: "docker_cli",
      state: "COMPLETED",
      startedAt: "2026-03-29T10:01:00.000Z",
      finishedAt: "2026-03-29T10:02:00.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledLocalDispatchIds).toEqual([]);
    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      id: dispatch.id,
      status: "running",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "COMPLETED",
    });
  });

  it("repairs failed dispatch rows that came from cancelled CLI sessions", async () => {
    const {
      projectRepository,
      executionRepository,
      sessionTracking,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Cancelled Dispatch Repair Project",
      sourceType: "local",
      sourceRef: "/workspace/cancelled-dispatch-repair-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Cancelled Dispatch Repair Sprint",
      number: 44,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Repair cancelled dispatch",
      executorType: "docker_cli",
      status: "pending",
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
      status: "failed",
      errorMessage: "Provider session CANCELLED",
      startedAt: "2026-07-03T10:00:00.000Z",
      finishedAt: "2026-07-03T10:02:00.000Z",
    } as any);
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "opencode",
      mode: "docker_cli",
      sessionId: "cli-opencode-cancelled-repair",
      sessionName: "sessions/cli-opencode-cancelled-repair",
      state: "FAILED",
      startedAt: "2026-07-03T10:00:00.000Z",
      finishedAt: "2026-07-03T10:02:00.000Z",
    });
    sessionTracking.createSession({
      id: "cli-opencode-cancelled-repair",
      provider: "opencode",
      state: "CANCELLED",
      taskId: "repair-task",
      title: "Repair cancelled dispatch",
      featureBranch: "feature/repair",
      workerBranch: "task/repair",
      repoPath: project.baseDir,
    });

    const result = await service.recover();

    expect(result.reconciledTerminalDispatchIds).toEqual([dispatch.id]);
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      status: "cancelled",
      errorMessage: null,
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "task_dispatch_reconciled",
          payload: expect.objectContaining({
            reason: "cancelled_session_dispatch_status_mismatch",
            nextDispatchStatus: "cancelled",
          }),
        }),
      ]),
    );
  });

  it("reconciles interrupted local dispatches without resumable sessions and preserves stored duration when no start time exists", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Unrecoverable Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/unrecoverable-dispatch-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Unrecoverable Dispatch Sprint",
      number: 21,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Retry dispatch after restart",
      executorType: "docker_cli",
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
      provider: "codex",
      mode: "docker_cli",
      state: "RUNNING",
      durationMs: 321,
    });

    const result = await service.recover();

    expect(result.recoveredCliSessionIds).toEqual([]);
    expect(result.reconciledLocalDispatchIds).toEqual([dispatch.id]);
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      id: dispatch.id,
      status: "cancelled",
      errorMessage: null,
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "FAILED",
      durationMs: 321,
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)[0]).toMatchObject({
      eventType: "cli_workflow_cancelled",
      payload: expect.objectContaining({
        recoveredSessionId: null,
        reason: "runtime_restart_interrupted",
      }),
    });
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
  });

  it("preserves a shutdown-interrupted Docker CLI workspace as the next retry resume target", async () => {
    const {
      projectRepository,
      executionRepository,
      sessionTracking,
      service,
    } = await createFixture({
      dockerService: {
        listContainers: vi.fn().mockResolvedValue([]),
      },
    });

    const repoPath = "/workspace/resumable-cli-project";
    const featureBranch = "feature/resumable-cli";
    const project = projectRepository.createProject({
      name: "Resumable CLI Project",
      sourceType: "local",
      sourceRef: repoPath,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Resumable CLI Sprint",
      number: 42,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Preserve workspace",
      executorType: "docker_cli",
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
    const oldSessionId = "cli-gemini-shutdown-old";
    const workerBranch = "task/feature-resumable-cli-t01-gemini";
    const taskRunKey = buildTaskRunKey(repoPath, sprint.number, "T01");
    sessionTracking.createSession({
      id: oldSessionId,
      provider: "gemini",
      state: "RUNNING",
      prompt: "Implement T01",
      title: "Sprint 42: [T01] Preserve workspace",
      taskId: taskRunKey,
      featureBranch,
      workerBranch,
      repoPath,
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "gemini",
      mode: "docker_cli",
      state: "RUNNING",
      sessionId: oldSessionId,
      sessionName: `sessions/${oldSessionId}`,
      workerBranch,
      startedAt: "2026-07-03T12:00:00.000Z",
    });
    executionRepository.appendTaskRunEvent(taskRun.id, "cli_workspace_bound", "system", {
      provider: "gemini",
      repoPath,
      worktreePath: `docker-volume://${oldSessionId}`,
      workspaceSessionId: oldSessionId,
      executionMode: "DOCKER",
    }, {
      sourceEventKey: `cli:workspace:bound:${oldSessionId}:docker-volume`,
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      sessionId: oldSessionId,
      provider: "gemini",
      purpose: "task_coding",
      executionMode: "DOCKER",
      status: "running",
      startedAt: "2026-07-03T12:00:01.000Z",
    });

    const recovery = await service.recover();

    expect(recovery.recoveredCliSessionIds).toEqual([oldSessionId]);
    expect(recovery.reconciledContainerInvocationIds).toEqual([providerInvocation.id]);
    expect(sessionTracking.getSession(oldSessionId)?.state).toBe("CANCELLED");
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      state: "FAILED",
      sessionId: oldSessionId,
    });
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
    expect(executionRepository.getLatestTaskWorkspaceResumeTarget(task.id, sprintRun.id)).toMatchObject({
      sessionId: oldSessionId,
      workerBranch,
      worktreePath: `docker-volume://${oldSessionId}`,
    });

    const cliWorkflowService = new CliWorkflowService({
      sessionTracking,
      executionRepository,
      getDashboardSettings: vi.fn().mockReturnValue({
        ...DEFAULT_DASHBOARD_SETTINGS,
        cliWorkflow: {
          ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
          executionMode: "DOCKER",
          resumeFailedTaskInSameWorkspace: true,
        },
      }),
      agentPresetSyncService: {
        getOptionalWorkerAgentForRepoPath: vi.fn().mockResolvedValue({ instructionMarkdown: "guide" }),
      } as any,
      getGithubToken: vi.fn().mockReturnValue(undefined),
      logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() } as any,
    } as any);
    vi.spyOn((cliWorkflowService as any).workspaceManager, "resolveResumeWorktreePath")
      .mockResolvedValue(`docker-volume://${oldSessionId}`);
    const runTaskWorkflow = vi.spyOn(cliWorkflowService as any, "runTaskWorkflow")
      .mockResolvedValue(undefined);

    await cliWorkflowService.startTask({
      provider: "gemini",
      task: { id: "T01", record_id: task.id, title: "Preserve workspace", prompt: "Implement T01" } as any,
      taskRecordId: task.id,
      repoPath,
      featureBranch,
      sprintNumber: sprint.number,
      settingsScope: { projectId: project.id, sprintId: sprint.id },
    });

    expect(runTaskWorkflow).toHaveBeenCalledWith(expect.objectContaining({
      resumeFromFailedSessionId: oldSessionId,
      resumeWorktreePath: `docker-volume://${oldSessionId}`,
      workerBranch,
    }));
  });

  it("fails orphaned running Docker-backed invocations with no active session container", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture({
      dockerService: {
        listContainers: vi.fn().mockResolvedValue([]),
      },
    });

    const project = projectRepository.createProject({
      name: "Orphaned Invocation Project",
      sourceType: "local",
      sourceRef: "/workspace/orphaned-invocation-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Orphaned Invocation Sprint",
      number: 55,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Reviewable task",
      executorType: "docker_cli",
      status: "completed",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      provider: "gemini",
      mode: "docker_cli",
      state: "COMPLETED",
      startedAt: "2026-04-11T08:00:00.000Z",
      finishedAt: "2026-04-11T08:05:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      sessionId: "qa-review-gemini-stale",
      provider: "gemini",
      purpose: "qa_review",
      executionMode: "DOCKER",
      startedAt: "2026-04-11T08:06:00.000Z",
    });
    const executionInvocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      providerInvocationId: providerInvocation.id,
      type: "qa_review",
      status: "running",
      provider: "gemini",
      model: "gemini-2.5-pro",
      startedAt: "2026-04-11T08:06:01.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledContainerInvocationIds).toEqual([providerInvocation.id]);
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)).toMatchObject({
      id: providerInvocation.id,
      status: "cancelled",
    });
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      id: executionInvocation.id,
      status: "cancelled",
      errorMessage: null,
    });
    expect(executionRepository.listExecutionInvocationMessages(executionInvocation.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          contentMarkdown: expect.stringContaining("No active Docker container remained"),
        }),
      ]),
    );
  });

  it("requeues QA follow-up task executions when restart recovery finds the fix container is gone", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture({
      dockerService: {
        listContainers: vi.fn().mockResolvedValue([]),
      },
    });

    const project = projectRepository.createProject({
      name: "Recovered Fix Follow-Up Project",
      sourceType: "local",
      sourceRef: "/workspace/recovered-fix-follow-up-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Recovered Fix Follow-Up Sprint",
      number: 56,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Resume QA-requested fixes after restart",
      executorType: "docker_cli",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "docker_cli",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      provider: "codex",
      mode: "docker_cli",
      sessionId: "cli-codex-fix-followup",
      sessionName: "sessions/cli-codex-fix-followup",
      state: "COMPLETED",
      startedAt: "2026-04-11T08:00:00.000Z",
      finishedAt: "2026-04-11T08:05:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      sprintRunId: sprintRun.id,
      sessionId: "cli-codex-fix-followup",
      provider: "codex",
      purpose: "task_coding",
      executionMode: "DOCKER",
      startedAt: "2026-04-11T08:06:00.000Z",
    });
    const executionInvocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      sprintRunId: sprintRun.id,
      providerInvocationId: providerInvocation.id,
      type: "cli_task_followup",
      status: "running",
      provider: "codex",
      model: "gpt-5.4",
      startedAt: "2026-04-11T08:06:01.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledContainerInvocationIds).toEqual([providerInvocation.id]);
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)).toMatchObject({
      id: providerInvocation.id,
      status: "cancelled",
    });
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      id: executionInvocation.id,
      status: "cancelled",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "COMPLETED",
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "cli_workflow_cancelled",
          payload: expect.objectContaining({
            providerInvocationId: providerInvocation.id,
            reason: "runtime_restart_interrupted",
          }),
        }),
      ]),
    );
  });

  it("fails interrupted quota-wait QA review invocations so QA can retry after startup", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Quota Wait QA Project",
      sourceType: "local",
      sourceRef: "/workspace/quota-wait-qa-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Quota Wait QA Sprint",
      number: 57,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Review after quota reset",
      executorType: "docker_cli",
      status: "completed",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      provider: "gemini",
      mode: "docker_cli",
      state: "COMPLETED",
      startedAt: "2026-05-18T00:00:00.000Z",
      finishedAt: "2026-05-18T00:10:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      sessionId: "qa-review-gemini-quota",
      provider: "gemini",
      purpose: "qa_review",
      status: "failed",
      executionMode: "DOCKER",
      startedAt: "2026-05-18T00:11:00.000Z",
      finishedAt: "2026-05-18T00:12:00.000Z",
    });
    const executionInvocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      providerInvocationId: providerInvocation.id,
      type: "qa_review",
      status: "running",
      provider: "gemini",
      model: "default",
      startedAt: "2026-05-18T00:11:00.000Z",
      lastErrorCategory: "QUOTA_EXHAUSTED",
      lastErrorMessage: "Gemini quota exhausted.",
      lastRetryAfterIso: "2026-05-18T04:57:04.113Z",
    });

    const result = await service.recover();

    expect(result.reconciledRetryInvocationIds).toEqual([executionInvocation.id]);
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      id: executionInvocation.id,
      status: "cancelled",
      errorMessage: null,
    });
    expect(executionRepository.listExecutionInvocationMessages(executionInvocation.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          contentMarkdown: expect.stringContaining("moved back to a retryable state"),
          metadata: expect.objectContaining({
            recovery: "startup_provider_retry_wait_reconcile",
            retryAfterIso: "2026-05-18T04:57:04.113Z",
          }),
        }),
      ]),
    );
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)).toMatchObject({
      id: providerInvocation.id,
      status: "failed",
    });
  });

  it("requeues task execution interrupted while waiting for quota reset", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Quota Wait Task Project",
      sourceType: "local",
      sourceRef: "/workspace/quota-wait-task-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Quota Wait Task Sprint",
      number: 58,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Continue after quota reset",
      executorType: "docker_cli",
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
      provider: "gemini",
      mode: "docker_cli",
      sessionId: "cli-gemini-quota",
      state: "RUNNING",
      startedAt: "2026-05-18T00:00:00.000Z",
    });
    const executionInvocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      dispatchId: dispatch.id,
      type: "cli_task_coding",
      status: "running",
      provider: "gemini",
      model: "default",
      startedAt: "2026-05-18T00:11:00.000Z",
      lastErrorCategory: "QUOTA_EXHAUSTED",
      lastErrorMessage: "Gemini quota exhausted.",
      lastRetryAfterIso: "2026-05-18T04:57:04.113Z",
    });

    const result = await service.recover();

    expect(result.reconciledRetryInvocationIds).toEqual([executionInvocation.id]);
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      id: dispatch.id,
      status: "cancelled",
      errorMessage: null,
    });
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      id: executionInvocation.id,
      status: "cancelled",
      errorMessage: null,
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "FAILED",
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "cli_workflow_cancelled",
          payload: expect.objectContaining({
            reason: "runtime_restart_interrupted",
          }),
        }),
      ]),
    );
  });

  it("logs startup recovery activity and surfaces recoverSprintRun errors without aborting recovery", async () => {
    const logger = {
      info: vi.fn(),
      error: vi.fn(),
    };
    const recoverSprintRun = vi.fn().mockRejectedValue(new Error("recover failed"));
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture({
      logger,
      recoverSprintRun,
    });

    const project = projectRepository.createProject({
      name: "Recovery Logger Project",
      sourceType: "local",
      sourceRef: "/workspace/recovery-logger-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Recovery Logger Sprint",
      number: 77,
      status: "running",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "queued",
    });

    const result = await service.recover();
    await Promise.resolve();

    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(logger.info).toHaveBeenCalledWith("Recovered runtime state on startup", expect.objectContaining({
      recoveredCliSessions: 0,
      reconciledLocalDispatches: 0,
      reconciledProviderDispatches: 0,
      reconciledRetryInvocations: 0,
      reconciledContainerInvocations: 0,
      reconciledTerminalDispatches: 0,
      rehydratedSprintRuns: 0,
      reconciledTaskRuns: 0,
      reconciledPausedSprintRuns: 0,
      resumedSprintRuns: 1,
      supersededSprintRuns: 0,
    }));
    expect(logger.error).toHaveBeenCalledWith("Failed to recover sprint run on startup", {
      sprintRunId: sprintRun.id,
      sprintId: sprint.id,
      projectId: project.id,
      error: "recover failed",
    });
  });

  it("does not recover sprint runs if the associated sprint is terminal (cancelled/completed)", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Terminal Sprint Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/terminal-sprint-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Cancelled Sprint",
      number: 88,
      status: "cancelled",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });

    const result = await service.recover();

    expect(result.resumedSprintRunIds).toEqual([]);
    expect(result.supersededSprintRunIds).toEqual([sprintRun.id]);
    expect(recoverSprintRun).not.toHaveBeenCalled();

    const updatedRun = executionRepository.getSprintRun(sprintRun.id);
    expect(updatedRun?.status).toBe("failed");
  });

  it("recovers active sprint runs whose sprint sits at the default idle status", async () => {
    // Regression guard: active orchestration tracks "running" on the sprint_run,
    // not the `sprints.status` column (which commonly stays "idle"). Recovery must
    // resume these runs on restart instead of force-failing them.
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Idle Sprint Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/idle-sprint-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Idle Sprint",
      number: 89,
      status: "idle",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });

    const result = await service.recover();

    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(result.supersededSprintRunIds).toEqual([]);
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
  });

  it("does not recover an active sprint run while its unexpired lease owner process is alive", async () => {
    const livePid = 4242;
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture({
      isProcessAlive: (pid) => pid === livePid,
    });

    const project = projectRepository.createProject({
      name: "Live Lease Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/live-lease-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Live Lease Sprint",
      number: 91,
      status: "idle",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });
    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: `sprint_orchestrator:${livePid}`,
      leaseToken: "live-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await service.recover();

    expect(result.resumedSprintRunIds).toEqual([]);
    expect(result.supersededSprintRunIds).toEqual([]);
    expect(recoverSprintRun).not.toHaveBeenCalled();
    expect(executionRepository.getSprintRun(sprintRun.id)?.status).toBe("running");
    expect(executionRepository.getLease("sprint", sprint.id)).toMatchObject({
      ownerKey: `sprint_orchestrator:${livePid}`,
      leaseToken: "live-token",
    });
  });

  it("recovers an active sprint run when its unexpired lease owner process is gone", async () => {
    const deadPid = 5151;
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture({
      isProcessAlive: () => false,
    });

    const project = projectRepository.createProject({
      name: "Dead Lease Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/dead-lease-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Dead Lease Sprint",
      number: 92,
      status: "idle",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });
    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: `sprint_orchestrator:${deadPid}`,
      leaseToken: "dead-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const result = await service.recover();

    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(result.supersededSprintRunIds).toEqual([]);
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
  });

  it("syncs paused sprint projections so paused runs do not look running after restart", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture();

    const project = projectRepository.createProject({
      name: "Paused Projection Project",
      sourceType: "local",
      sourceRef: "/workspace/paused-projection-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Paused Projection Sprint",
      number: 93,
      status: "running",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "paused",
    });

    const result = await service.recover();

    expect(result.restartPolicySyncedPausedSprintIds).toEqual([sprint.id]);
    expect(result.resumedSprintRunIds).toEqual([]);
    expect(recoverSprintRun).not.toHaveBeenCalled();
    expect(executionRepository.getSprintRun(sprintRun.id)?.status).toBe("paused");
    expect(projectRepository.getRawSprintStatus(sprint.id)).toBe("paused");
  });

  it("pauses active sprint runs on startup when restart sprint policy is pause", async () => {
    const {
      projectRepository,
      executionRepository,
      qaReviewRepository,
      service,
      recoverSprintRun,
    } = await createFixture({
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        restartSprintPolicy: "pause",
      }),
    });

    const project = projectRepository.createProject({
      name: "Restart Pause Policy Project",
      sourceType: "local",
      sourceRef: "/workspace/restart-pause-policy-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Restart Pause Policy Sprint",
      number: 94,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Pause interrupted task",
      executorType: "docker_cli",
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
      sprintRunId: sprintRun.id,
      taskId: task.id,
      executorType: "docker_cli",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      dispatchId: dispatch.id,
      provider: "codex",
      mode: "docker_cli",
      sessionId: "cli-codex-pause-policy",
      state: "RUNNING",
      startedAt: "2026-07-06T10:00:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      dispatchId: dispatch.id,
      sessionId: "cli-codex-pause-policy",
      provider: "codex",
      purpose: "task_coding",
      executionMode: "DOCKER",
      startedAt: "2026-07-06T10:00:01.000Z",
    });
    const qaRun = qaReviewRepository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      triggerType: "task_completion",
      runIndex: 1,
    });

    const result = await service.recover();

    expect(result.restartPolicyPausedSprintRunIds).toEqual([sprintRun.id]);
    expect(result.resumedSprintRunIds).toEqual([]);
    expect(recoverSprintRun).not.toHaveBeenCalled();
    expect(executionRepository.getSprintRun(sprintRun.id)?.status).toBe("paused");
    expect(projectRepository.getRawSprintStatus(sprint.id)).toBe("paused");
    expect(executionRepository.getTaskDispatch(dispatch.id)?.status).toBe("paused");
    expect(executionRepository.getTaskRun(taskRun.id)?.state).toBe("PAUSED");
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)?.status).toBe("cancelled");
    expect(qaReviewRepository.listRunningRuns().some((run) => run.id === qaRun.id)).toBe(false);
  });

  it("cancels active sprint runs on startup when restart sprint policy is cancel", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture({
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        restartSprintPolicy: "cancel",
      }),
    });

    const project = projectRepository.createProject({
      name: "Restart Cancel Policy Project",
      sourceType: "local",
      sourceRef: "/workspace/restart-cancel-policy-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Restart Cancel Policy Sprint",
      number: 95,
      status: "running",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });

    const result = await service.recover();

    expect(result.restartPolicyCancelledSprintRunIds).toEqual([sprintRun.id]);
    expect(result.resumedSprintRunIds).toEqual([]);
    expect(recoverSprintRun).not.toHaveBeenCalled();
    expect(executionRepository.getSprintRun(sprintRun.id)).toMatchObject({
      status: "cancelled",
      finishedAt: expect.any(String),
    });
    expect(projectRepository.getRawSprintStatus(sprint.id)).toBe("cancelled");
  });

  it("cancels interrupted invocations without retrying tasks when restart invocation policy is cancel", async () => {
    const {
      projectRepository,
      executionRepository,
      service,
      recoverSprintRun,
    } = await createFixture({
      dockerService: {
        listContainers: vi.fn().mockResolvedValue([]),
      },
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        restartInvocationPolicy: "cancel",
      }),
    });

    const project = projectRepository.createProject({
      name: "Invocation Cancel Policy Project",
      sourceType: "local",
      sourceRef: "/workspace/invocation-cancel-policy-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Invocation Cancel Policy Sprint",
      number: 96,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Do not retry interrupted invocation",
      executorType: "docker_cli",
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
      sprintRunId: sprintRun.id,
      taskId: task.id,
      executorType: "docker_cli",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      dispatchId: dispatch.id,
      provider: "gemini",
      mode: "docker_cli",
      sessionId: "cli-gemini-cancel-policy",
      state: "RUNNING",
      startedAt: "2026-07-06T10:00:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      dispatchId: dispatch.id,
      sessionId: "cli-gemini-cancel-policy",
      provider: "gemini",
      purpose: "task_coding",
      executionMode: "DOCKER",
      status: "running",
      startedAt: "2026-07-06T10:00:01.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledContainerInvocationIds).toEqual([providerInvocation.id]);
    expect(result.resumedSprintRunIds).toEqual([sprintRun.id]);
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
    expect(executionRepository.getTaskRun(taskRun.id)?.state).toBe("BLOCKED");
    expect(projectRepository.getTask(task.id)?.status).toBe("QA_REVIEW_FAILED");
  });

  it("restarts active Docker invocations when restart invocation policy is restart", async () => {
    const removeContainers = vi.fn().mockResolvedValue(undefined);
    const {
      projectRepository,
      executionRepository,
      service,
    } = await createFixture({
      dockerService: {
        listContainers: vi.fn().mockResolvedValue([
          {
            id: "container-restart-policy",
            labels: { "code-ux.session-id": "cli-codex-restart-policy" },
          },
        ]),
        removeContainers,
      },
      getDashboardSettings: () => ({
        ...DEFAULT_DASHBOARD_SETTINGS,
        restartInvocationPolicy: "restart",
      }),
    });

    const project = projectRepository.createProject({
      name: "Invocation Restart Policy Project",
      sourceType: "local",
      sourceRef: "/workspace/invocation-restart-policy-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Invocation Restart Policy Sprint",
      number: 97,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Restart interrupted invocation",
      executorType: "docker_cli",
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
      sprintRunId: sprintRun.id,
      taskId: task.id,
      executorType: "docker_cli",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      dispatchId: dispatch.id,
      provider: "codex",
      mode: "docker_cli",
      sessionId: "cli-codex-restart-policy",
      state: "RUNNING",
      startedAt: "2026-07-06T10:00:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      taskRunId: taskRun.id,
      dispatchId: dispatch.id,
      sessionId: "cli-codex-restart-policy",
      provider: "codex",
      purpose: "task_coding",
      executionMode: "DOCKER",
      status: "running",
      startedAt: "2026-07-06T10:00:01.000Z",
    });

    const result = await service.recover();

    expect(result.reconciledContainerInvocationIds).toEqual([providerInvocation.id]);
    expect(removeContainers).toHaveBeenCalledWith(["container-restart-policy"], { removeVolumes: false });
    expect(executionRepository.getTaskRun(taskRun.id)?.state).toBe("FAILED");
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
  });

  it("leaves paused sprint runs paused when the sprint is not terminal", async () => {
    // A paused run awaiting human action / a pending merge must survive a restart.
    // `sprints.status` is "idle" while paused, so it must not be treated as stale.
    const { projectRepository, executionRepository, service } = await createFixture();

    const project = projectRepository.createProject({
      name: "Paused Sprint Recovery Project",
      sourceType: "local",
      sourceRef: "/workspace/paused-sprint-recovery-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Paused Sprint",
      number: 90,
      status: "idle",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "paused",
    });

    const result = await service.recover();

    expect(result.reconciledPausedSprintRunIds).toEqual([]);
    const updatedRun = executionRepository.getSprintRun(sprintRun.id);
    expect(updatedRun?.status).toBe("paused");
  });
});
