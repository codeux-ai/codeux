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
    executionRepository.createTaskRun({
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
  });
});
