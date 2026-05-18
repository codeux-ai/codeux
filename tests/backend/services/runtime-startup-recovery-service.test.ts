import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { RuntimeStartupRecoveryService } from "../../../src/services/runtime-startup-recovery-service.js";
import type { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import type { Logger } from "../../../src/shared/logging/logger.js";

const tempDirs: string[] = [];

async function createFixture(options?: {
  recoverSprintRun?: SprintOrchestrator["recoverSprintRun"];
  logger?: Pick<Logger, "info" | "error">;
  dockerService?: { listContainers: () => Promise<Array<{ labels?: Record<string, string> }>> };
}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-startup-recovery-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const sessionTracking = new SessionTrackingRepository(path.join(dir, "session-tracking.db"));
  const recoverSprintRun = options?.recoverSprintRun ?? vi.fn().mockResolvedValue(null);

  const service = new RuntimeStartupRecoveryService({
    sessionTracking,
    executionRepository,
    projectManagementRepository: projectRepository,
    sprintOrchestrator: {
      recoverSprintRun,
    } as SprintOrchestrator,
    dockerService: options?.dockerService,
    getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    logger: options?.logger,
  });

  return {
    projectRepository,
    executionRepository,
    sessionTracking,
    service,
    recoverSprintRun,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RuntimeStartupRecoveryService", () => {
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

    expect(sessionTracking.getSession("cli-codex-running")?.state).toBe("FAILED");
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      id: dispatch.id,
      status: "failed",
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
      status: "failed",
      errorMessage: "Local CLI execution was interrupted before Code UX could persist a resumable session. The task was moved back to a retryable state.",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "FAILED",
      durationMs: 321,
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)[0]).toMatchObject({
      eventType: "cli_workflow_failed",
      payload: expect.objectContaining({
        recoveredSessionId: null,
        reason: "runtime_restart_interrupted",
      }),
    });
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
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
      status: "failed",
    });
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      id: executionInvocation.id,
      status: "failed",
      errorMessage: expect.stringContaining("No active Docker container remained"),
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
      status: "failed",
    });
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      id: executionInvocation.id,
      status: "failed",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "COMPLETED",
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "cli_workflow_failed",
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
      status: "failed",
      errorMessage: expect.stringContaining("waiting for provider QUOTA_EXHAUSTED recovery"),
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
      status: "failed",
      errorMessage: expect.stringContaining("Local CLI execution was interrupted"),
    });
    expect(executionRepository.getExecutionInvocation(executionInvocation.id)).toMatchObject({
      id: executionInvocation.id,
      status: "failed",
      errorMessage: expect.stringContaining("provider QUOTA_EXHAUSTED recovery"),
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      id: taskRun.id,
      state: "FAILED",
    });
    expect(executionRepository.listTaskRunEvents(taskRun.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          eventType: "cli_workflow_failed",
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
    expect(logger.info).toHaveBeenCalledWith("Recovered runtime state on startup", {
      recoveredCliSessions: 0,
      reconciledLocalDispatches: 0,
      reconciledProviderDispatches: 0,
      reconciledRetryInvocations: 0,
      reconciledContainerInvocations: 0,
      resumedSprintRuns: 1,
      supersededSprintRuns: 0,
    });
    expect(logger.error).toHaveBeenCalledWith("Failed to recover sprint run on startup", {
      sprintRunId: sprintRun.id,
      sprintId: sprint.id,
      projectId: project.id,
      error: "recover failed",
    });
  });
});
