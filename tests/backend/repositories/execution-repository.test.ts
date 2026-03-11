import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  projectRepository: ProjectManagementRepository;
  connectionRepository: ConnectionChatRepository;
  executionRepository: ExecutionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-execution-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    projectRepository: new ProjectManagementRepository(storage),
    connectionRepository: new ConnectionChatRepository(storage),
    executionRepository: new ExecutionRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ExecutionRepository", () => {
  it("creates sprint runs and queues task dispatches against project/sprint tasks", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Execution Project",
      sourceType: "local",
      sourceRef: "/workspace/execution-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Execution Sprint",
      number: 2,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Queue task dispatch",
      promptMarkdown: "Dispatch this task through DB-native execution.",
      priority: "critical",
    });

    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "dashboard",
      triggeredBy: "user:test",
      executorMode: "mixed",
      status: "queued",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      priority: 100,
    });

    expect(executionRepository.listSprintRuns(project.id, sprint.id)).toHaveLength(1);
    expect(dispatch).toMatchObject({
      sprintRunId: sprintRun.id,
      taskId: task.id,
      executorType: "docker_cli",
      status: "queued",
      priority: 100,
    });

    const claimed = executionRepository.claimNextTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
    });
    expect(claimed).toMatchObject({
      id: dispatch.id,
      status: "claimed",
    });

    const started = executionRepository.updateTaskDispatch(dispatch.id, {
      status: "running",
      startedAt: "2026-03-09T10:00:00.000Z",
    });
    expect(started).toMatchObject({
      status: "running",
      startedAt: "2026-03-09T10:00:00.000Z",
    });
  });

  it("acquires, renews, and releases execution leases with token checks", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Lease Project",
      sourceType: "local",
      sourceRef: "/workspace/lease-project",
    });

    const lease = executionRepository.acquireLease({
      scopeType: "project",
      scopeId: project.id,
      ownerKey: "scheduler-1",
      leaseToken: "lease-token-1",
      expiresAt: "2030-03-09T12:00:00.000Z",
    });

    expect(lease).toMatchObject({
      scopeType: "project",
      scopeId: project.id,
      ownerKey: "scheduler-1",
      leaseToken: "lease-token-1",
    });

    expect(() => executionRepository.acquireLease({
      scopeType: "project",
      scopeId: project.id,
      ownerKey: "scheduler-2",
      leaseToken: "lease-token-2",
      expiresAt: "2030-03-09T12:30:00.000Z",
    })).toThrow("Lease already held");

    const renewed = executionRepository.renewLease({
      scopeType: "project",
      scopeId: project.id,
      leaseToken: "lease-token-1",
      expiresAt: "2030-03-09T13:00:00.000Z",
    });
    expect(renewed.expiresAt).toBe("2030-03-09T13:00:00.000Z");

    executionRepository.releaseLease("project", project.id, "lease-token-1");
    expect(executionRepository.getLease("project", project.id)).toBeNull();
  });

  it("releases a stale sprint lease once cancellation is finalized", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Cancel Lease Project",
      sourceType: "local",
      sourceRef: "/workspace/cancel-lease-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Cancel Lease Sprint",
      number: 5,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "cancel_requested",
    });

    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: "sprint_agent",
      leaseToken: "cancel-lease-token",
      expiresAt: "2030-03-09T12:00:00.000Z",
    });

    const finalized = executionRepository.finalizeSprintRunCancellationIfIdle(sprintRun.id);

    expect(finalized?.status).toBe("cancelled");
    expect(executionRepository.getLease("sprint", sprint.id)).toBeNull();
  });

  it("allows worker dispatch claims by connection identity", async () => {
    const { projectRepository, connectionRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Worker Project",
      sourceType: "local",
      sourceRef: "/workspace/worker-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Worker Sprint",
      number: 4,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Claim worker task",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-1",
      displayName: "Worker 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
      priority: 50,
    });

    const claimed = executionRepository.claimNextTaskDispatch({
      projectId: project.id,
      executorType: "mcp_worker",
      connectionId: worker.id,
    });

    expect(claimed).toMatchObject({
      id: dispatch.id,
      status: "claimed",
      connectionId: worker.id,
    });
  });

  it("creates and claims sprint preflight jobs for worker-owned sprint starts", async () => {
    const { projectRepository, connectionRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Preflight Project",
      sourceType: "local",
      sourceRef: "/workspace/preflight-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Preflight Sprint",
      number: 3,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "queued",
    });
    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-preflight-1",
      displayName: "Worker Preflight 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const created = executionRepository.createSprintPreflightJob({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
    });
    const claimed = executionRepository.claimNextSprintPreflightJob({
      projectId: project.id,
      sprintRunId: sprintRun.id,
      connectionId: worker.id,
    });

    expect(created.status).toBe("queued");
    expect(claimed).toMatchObject({
      id: created.id,
      status: "claimed",
      connectionId: worker.id,
    });
  });

  it("does not finalize sprint cancellation while a sprint preflight job is still active", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Preflight Cancel Project",
      sourceType: "local",
      sourceRef: "/workspace/preflight-cancel-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Preflight Cancel Sprint",
      number: 6,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "cancel_requested",
    });
    executionRepository.createSprintPreflightJob({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      status: "running",
    });

    const finalized = executionRepository.finalizeSprintRunCancellationIfIdle(sprintRun.id);

    expect(finalized).toBeNull();
    expect(executionRepository.getSprintRun(sprintRun.id)?.status).toBe("cancel_requested");
  });

  it("projects sprint runs and dispatches into an execution snapshot", async () => {
    const { projectRepository, connectionRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Snapshot Project",
      sourceType: "local",
      sourceRef: "/workspace/snapshot-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Snapshot Sprint",
      number: 9,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Expose runtime panel",
      executorType: "mcp_worker",
    });
    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-snapshot-1",
      displayName: "Worker Snapshot 1",
      role: "worker",
      transport: "stdio",
      status: "connected",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
      triggerType: "dashboard",
    });
    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: "sprint_agent",
      leaseToken: "lease-sprint-1",
      expiresAt: "2030-03-09T12:00:00.000Z",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
      connectionId: worker.id,
      status: "running",
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      connectionId: worker.id,
      mode: "mcp_worker",
      provider: "codex",
      sessionId: "session-snapshot-1",
      state: "RUNNING",
      startedAt: "2026-03-09T10:00:00.000Z",
    });
    executionRepository.appendTaskRunEvent(run.id, "provider_activity", "agent", {
      activityId: "activity-1",
      preview: "Implementing runtime panel",
    }, {
      createdAt: "2026-03-09T10:05:00.000Z",
      sourceEventKey: "activity:activity-1",
    });
    executionRepository.acquireLease({
      scopeType: "task_dispatch",
      scopeId: dispatch.id,
      ownerKey: "worker-snapshot-1",
      leaseToken: "lease-dispatch-1",
      expiresAt: "2030-03-09T12:05:00.000Z",
    });

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);

    expect(snapshot).toMatchObject({
      projectId: project.id,
      projectName: "Snapshot Project",
    });
    expect(snapshot.sprintRuns[0]).toMatchObject({
      id: sprintRun.id,
      sprintId: sprint.id,
      sprintName: "Snapshot Sprint",
      status: "running",
      activeLeaseOwnerKey: "sprint_agent",
    });
    expect(snapshot.taskDispatches[0]).toMatchObject({
      id: dispatch.id,
      taskId: task.id,
      taskKey: "T01",
      taskTitle: "Expose runtime panel",
      executorType: "mcp_worker",
      connectionDisplayName: "Worker Snapshot 1",
      taskRunState: "RUNNING",
      sessionId: "session-snapshot-1",
      activeLeaseOwnerKey: "worker-snapshot-1",
    });
    expect(snapshot.recentEvents[0]).toMatchObject({
      scopeType: "task_run",
      taskId: task.id,
      taskKey: "T01",
      eventType: "provider_activity",
      originator: "agent",
      connectionDisplayName: "Worker Snapshot 1",
    });
    expect(snapshot.recentEvents[0]?.payload).toMatchObject({
      activityId: "activity-1",
      preview: "Implementing runtime panel",
    });
  });

  it("deduplicates task run events by source event key within the same task run", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Event Project",
      sourceType: "local",
      sourceRef: "/workspace/event-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Event Sprint",
      number: 3,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Record event once",
    });
    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      state: "RUNNING",
    });

    executionRepository.appendTaskRunEvent(run.id, "provider_activity", "agent", {
      activityId: "a-1",
      preview: "First event",
    }, {
      sourceEventKey: "activity:a-1",
    });
    executionRepository.appendTaskRunEvent(run.id, "provider_activity", "agent", {
      activityId: "a-1",
      preview: "Duplicate event",
    }, {
      sourceEventKey: "activity:a-1",
    });

    const events = executionRepository.listTaskRunEvents(run.id);
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      activityId: "a-1",
      preview: "First event",
    });
  });

  it("projects sprint-run events into the unified runtime timeline", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Sprint Event Project",
      sourceType: "local",
      sourceRef: "/workspace/sprint-event-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint Event Sprint",
      number: 5,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "paused",
      triggerType: "mcp",
      triggeredBy: "sprint_agent",
    });

    executionRepository.appendSprintRunEvent(sprintRun.id, "planning_preflight_blocked", "system", {
      planningTarget: "Sprint Event Project / Sprint Event Sprint",
    }, {
      sourceEventKey: "planning-blocked",
    });

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);

    expect(snapshot.recentEvents[0]).toMatchObject({
      scopeType: "sprint_run",
      sprintRunId: sprintRun.id,
      eventType: "planning_preflight_blocked",
      taskId: null,
      sprintRunStatus: "paused",
    });
  });
});
