import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SessionTrackingRepository } from "../../../src/repositories/session-tracking-repository.js";
import { RuntimeStartupRecoveryService } from "../../../src/services/runtime-startup-recovery-service.js";
import type { SprintOrchestrator } from "../../../src/sprint/sprint-orchestrator.js";
import type { Logger } from "../../../src/shared/logging/logger.js";

const tempDirs: string[] = [];

async function createFixture(options?: {
  recoverSprintRun?: SprintOrchestrator["recoverSprintRun"];
  logger?: Pick<Logger, "info" | "error">;
}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-startup-recovery-"));
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
      errorMessage: "Local CLI execution was interrupted before Sprint OS could persist a resumable session. The task was moved back to a retryable state.",
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
