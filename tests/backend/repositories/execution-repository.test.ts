import { runMigrations } from "../../../src/repositories/db/app-db-migrations.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  projectRepository: ProjectManagementRepository;
  connectionRepository: ConnectionChatRepository;
  executionRepository: ExecutionRepository;
  projectAttentionRepository: ProjectAttentionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-execution-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    projectRepository: new ProjectManagementRepository(storage),
    connectionRepository: new ConnectionChatRepository(storage),
    executionRepository: new ExecutionRepository(storage),
    projectAttentionRepository: new ProjectAttentionRepository(storage),
  };
}

async function createRepositoriesWithRealtimeNotifier(realtimeNotifier: {
  scheduleProjectExecutionRefresh: (projectId: string, options?: { includeOverview?: boolean; includeProjects?: boolean }) => void;
}): Promise<{
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-execution-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    projectRepository: new ProjectManagementRepository(storage),
    executionRepository: new ExecutionRepository(storage, realtimeNotifier as any),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

describe("ExecutionRepository", () => {

  it("validates project existence for execution snapshot", async () => {
    const { executionRepository } = await createRepositories();
    expect(() => executionRepository.getProjectExecutionSnapshot("non-existent-project"))
      .toThrowError("Project not found: non-existent-project");
  });

  it("delegates execution snapshot projection to query module for empty project", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Empty Execution Project",
      sourceType: "local",
      sourceRef: "/workspace/empty-execution",
    });

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);
    expect(snapshot).toMatchObject({
      projectId: project.id,
      projectName: "Empty Execution Project",
      sprintRuns: [],
      taskDispatches: [],
      recentEvents: [],
      connections: [],
      overflowAssignedWorkers: [],
      attentionItems: [],
    });
  });

  it("skips resource validation when skipValidation flag is true", async () => {
    const { executionRepository, projectRepository } = await createRepositories();

    const project = projectRepository.createProject({
      name: "Skip Validation Project",
      sourceType: "local",
      sourceRef: "/workspace/skip-validation",
    });

    // This should fail without skipValidation because sprint doesn't exist
    expect(() => {
      executionRepository.createExecutionInvocation({
        projectId: project.id,
        sprintId: "nonexistent",
        type: "planning",
        status: "running",
      });
    }).toThrowError("Sprint not found: nonexistent");

    // This should succeed with skipValidation (bypassing the application layer requireSprint validation),
    // but it will ultimately throw a SQLite FOREIGN KEY constraint error because we provided an invalid sprintId.
    expect(() => {
      executionRepository.createExecutionInvocation({
        projectId: project.id,
        sprintId: "nonexistent",
        type: "planning",
        status: "running",
        skipValidation: true,
      });
    }).toThrowError(/FOREIGN KEY constraint failed/);
  });

  it("creates, updates, lists, and appends messages to execution invocations", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Invocation Project",
      sourceType: "local",
      sourceRef: "/workspace/invocation-project",
    });

    // Create an invocation
    const invocation1 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      type: "planning",
      status: "running",
      provider: "openai",
      model: "gpt-4",
      systemPrompt: "You are a helpful planner.",
    });

    expect(invocation1.id).toMatch(/^xi_/);
    expect(invocation1.projectId).toBe(project.id);
    expect(invocation1.type).toBe("planning");
    expect(invocation1.status).toBe("running");
    expect(invocation1.messageCount).toBe(0);

    // Update the invocation
    const updatedInvocation = executionRepository.updateExecutionInvocation(invocation1.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
    });
    expect(updatedInvocation.status).toBe("completed");
    expect(updatedInvocation.finishedAt).not.toBeNull();

    // Append messages
    const message1 = executionRepository.appendExecutionInvocationMessage(invocation1.id, {
      role: "user",
      contentMarkdown: "What should we do next?",
    });

    expect(message1.id).toMatch(/^xim_/);
    expect(message1.role).toBe("user");
    expect(message1.contentMarkdown).toBe("What should we do next?");
    expect(message1.toolCallsJson).toBeNull();

    const toolCalls = { calls: [{ name: "search", arguments: "{}" }] };
    const message2 = executionRepository.appendExecutionInvocationMessage(invocation1.id, {
      role: "assistant",
      contentMarkdown: "",
      toolCallsJson: toolCalls,
    });
    expect(message2.toolCallsJson).toEqual(toolCalls);

    // Fetch the updated invocation state directly from DB to check messageCount/lastMessageAt
    const fetchedInvocation = executionRepository.getExecutionInvocation(invocation1.id);
    expect(fetchedInvocation?.messageCount).toBe(2);
    expect(fetchedInvocation?.lastMessageAt).toBe(message2.createdAt);

    // List messages and check ordering
    const messages = executionRepository.listExecutionInvocationMessages(invocation1.id);
    expect(messages.length).toBe(2);
    expect(messages[0]!.id).toBe(message1.id);
    expect(messages[1]!.id).toBe(message2.id);

    // Create a second invocation to check sorting and listing
    // We explicitly delay to ensure a different startedAt
    await new Promise(resolve => setTimeout(resolve, 50));

    const invocation2 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      type: "coding",
      status: "running",
    });

    await new Promise(resolve => setTimeout(resolve, 50));

    const invocation3 = executionRepository.createExecutionInvocation({
      projectId: project.id,
      type: "coding",
      status: "running",
    });

    const list = executionRepository.listExecutionInvocations({ projectId: project.id });
    expect(list.length).toBe(3);
    // ordered by startedAt DESC
    expect(list[0]!.id).toBe(invocation3.id);
    expect(list[1]!.id).toBe(invocation2.id);
    expect(list[2]!.id).toBe(invocation1.id);

    // Pagination test
    const paginatedList = executionRepository.listExecutionInvocations({
      projectId: project.id,
      limit: 1,
      offset: 1
    });
    expect(paginatedList.length).toBe(1);
    expect(paginatedList[0]!.id).toBe(invocation2.id);
  });

  it("coalesces burst invocation message refreshes per project and escalates overview when required", async () => {
    vi.useFakeTimers();
    try {
      const notifier = {
        scheduleProjectExecutionRefresh: vi.fn(),
      };
      const { projectRepository, executionRepository } = await createRepositoriesWithRealtimeNotifier(notifier);
      const project = projectRepository.createProject({
        name: "Realtime Burst Project",
        sourceType: "local",
        sourceRef: "/workspace/realtime-burst-project",
      });

      const invocation = executionRepository.createExecutionInvocation({
        projectId: project.id,
        type: "planning",
        status: "running",
      });

      for (let index = 0; index < 20; index += 1) {
        executionRepository.appendExecutionInvocationMessage(invocation.id, {
          role: "assistant",
          contentMarkdown: `message-${index}`,
        });
      }
      executionRepository.updateExecutionInvocation(invocation.id, {
        status: "completed",
        finishedAt: "2026-03-30T10:00:00.000Z",
      });

      expect(notifier.scheduleProjectExecutionRefresh).not.toHaveBeenCalled();

      vi.runOnlyPendingTimers();
      await Promise.resolve();

      expect(notifier.scheduleProjectExecutionRefresh).toHaveBeenCalledTimes(1);
      expect(notifier.scheduleProjectExecutionRefresh).toHaveBeenLastCalledWith(
        project.id,
        expect.objectContaining({ includeOverview: true }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not drop coalesced refreshes across projects", async () => {
    vi.useFakeTimers();
    try {
      const notifier = {
        scheduleProjectExecutionRefresh: vi.fn(),
      };
      const { projectRepository, executionRepository } = await createRepositoriesWithRealtimeNotifier(notifier);
      const projectA = projectRepository.createProject({
        name: "Project A",
        sourceType: "local",
        sourceRef: "/workspace/project-a",
      });
      const projectB = projectRepository.createProject({
        name: "Project B",
        sourceType: "local",
        sourceRef: "/workspace/project-b",
      });

      executionRepository.createExecutionInvocation({
        projectId: projectA.id,
        type: "planning",
        status: "running",
      });
      executionRepository.createExecutionInvocation({
        projectId: projectB.id,
        type: "planning",
        status: "running",
      });

      vi.runOnlyPendingTimers();
      await Promise.resolve();

      expect(notifier.scheduleProjectExecutionRefresh).toHaveBeenCalledTimes(2);
      expect(notifier.scheduleProjectExecutionRefresh).toHaveBeenCalledWith(
        projectA.id,
        expect.objectContaining({ includeOverview: true }),
      );
      expect(notifier.scheduleProjectExecutionRefresh).toHaveBeenCalledWith(
        projectB.id,
        expect.objectContaining({ includeOverview: true }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("filters task dispatches by complex options combinations", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Complex Options Project",
      sourceType: "local",
      sourceRef: "/workspace/complex-options-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task 1",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });

    // Create a matching dispatch
    const matchingDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
      status: "queued",
    });

    // Create a non-matching dispatch (different executorType)
    const nonMatchingDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "queued",
    });

    const results = executionRepository.listTaskDispatchesByStatus(["queued"], {
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      executorType: "mcp_worker",
    });

    expect(results).toHaveLength(1);
    expect(results[0].id).toBe(matchingDispatch.id);

    // Test empty status filter returns empty array
    const emptyResults = executionRepository.listTaskDispatchesByStatus([]);
    expect(emptyResults).toHaveLength(0);
  });

  it("lists stale cancel requested dispatches", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Stale Dispatch Project",
      sourceType: "local",
      sourceRef: "/workspace/stale-dispatch",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 1", status: "pending" });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running", executorMode: "mixed" });

    const oldDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
      status: "cancel_requested",
    });

    const freshDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
      status: "cancel_requested",
    });

    // Backdate oldDispatch updated_at using raw SQL to make it stale
    const oldDate = new Date(Date.now() - 1000 * 60 * 60).toISOString(); // 1 hour ago
    (executionRepository as any).db.prepare(`UPDATE task_dispatches SET queued_at = ?, updated_at = ? WHERE id = ?`).run(oldDate, oldDate, oldDispatch.id);

    const cutoffIso = new Date(Date.now() - 1000 * 60 * 30).toISOString(); // 30 mins ago
    const staleResults = executionRepository.listStaleCancelRequestedDispatches(cutoffIso);

    expect(staleResults).toHaveLength(1);
    expect(staleResults[0].id).toBe(oldDispatch.id);
  });


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
      ownerKey: "sprint_orchestrator",
      leaseToken: "cancel-lease-token",
      expiresAt: "2030-03-09T12:00:00.000Z",
    });

    const finalized = executionRepository.finalizeSprintRunCancellationIfIdle(sprintRun.id);

    expect(finalized?.status).toBe("cancelled");
    expect(executionRepository.getLease("sprint", sprint.id)).toBeNull();
  });

  it("releases a stale sprint lease when the active run is paused or idle cancel_requested", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Stale Lease Project",
      sourceType: "local",
      sourceRef: "/workspace/stale-lease-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Stale Lease Sprint",
      number: 6,
    });
    
    // Test paused run
    executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "paused",
    });

    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: "sprint_orchestrator",
      leaseToken: "stale-lease-token",
      expiresAt: "2030-03-09T12:00:00.000Z",
    });

    const releasedPaused = executionRepository.releaseStaleSprintLease(project.id, sprint.id);
    expect(releasedPaused).toBe(true);
    expect(executionRepository.getLease("sprint", sprint.id)).toBeNull();

    // Test idle cancel_requested run
    executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "cancel_requested",
    });

    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: "sprint_orchestrator",
      leaseToken: "stale-lease-token-2",
      expiresAt: "2030-03-09T12:00:00.000Z",
    });

    const releasedCancelRequested = executionRepository.releaseStaleSprintLease(project.id, sprint.id);
    expect(releasedCancelRequested).toBe(true);
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
      ownerKey: "sprint_orchestrator",
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

    const invocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      taskRunId: run.id,
      sessionId: "session-snapshot-1",
      provider: "codex",
      purpose: "task_coding",
      status: "completed",
      startedAt: "2026-03-09T10:00:00.000Z",
      promptChars: 100,
    });
    executionRepository.updateProviderInvocationUsage(invocation.id, {
      status: "completed",
      durationMs: 15000,
      inputTokens: 50,
      cachedInputTokens: 0,
      outputTokens: 25,
      reasoningOutputTokens: 0,
      totalTokens: 75,
      usageSource: "reported",
      rawUsageJson: { provider: "codex" },
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
      activeLeaseOwnerKey: "sprint_orchestrator",
    });
    expect(snapshot.sprintRuns[0]?.usage).toMatchObject({
      totalTokens: 75,
      activeTimeMs: 15000,
      invocationCount: 1,
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
      usage: expect.objectContaining({
        totalTokens: 75,
        activeTimeMs: 15000,
        invocationCount: 1,
      }),
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
      triggeredBy: "sprint_orchestrator",
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

  it("keeps full current sprint-run dispatch and event history for completed tasks", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Current Sprint History Project",
      sourceType: "local",
      sourceRef: "/workspace/current-sprint-history-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "History Sprint",
      number: 8,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      triggerType: "dashboard",
    });

    const earlyTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Early completed task",
    });
    const earlyDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: earlyTask.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "completed",
    });
    const earlyRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: earlyTask.id,
      sprintRunId: sprintRun.id,
      dispatchId: earlyDispatch.id,
      provider: "codex",
      state: "COMPLETED",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:01:00.000Z",
    });
    executionRepository.appendTaskRunEvent(earlyRun.id, "dispatch_started", "system", null, {
      createdAt: "2026-03-19T10:00:00.000Z",
    });
    executionRepository.appendTaskRunEvent(earlyRun.id, "cli_git_no_changes", "system", null, {
      createdAt: "2026-03-19T10:01:00.000Z",
    });
    executionRepository.updateTaskDispatch(earlyDispatch.id, {
      status: "completed",
      startedAt: "2026-03-19T10:00:00.000Z",
      finishedAt: "2026-03-19T10:01:00.000Z",
    });

    for (let index = 1; index <= 25; index += 1) {
      const task = projectRepository.createTask(project.id, {
        sprintId: sprint.id,
        title: `Later task ${index}`,
      });
      const dispatch = executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        executorType: "docker_cli",
        status: "completed",
      });
      const run = executionRepository.createTaskRun({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        dispatchId: dispatch.id,
        provider: "codex",
        state: "COMPLETED",
        startedAt: `2026-03-19T10:${String(index).padStart(2, "0")}:00.000Z`,
        finishedAt: `2026-03-19T10:${String(index).padStart(2, "0")}:59.000Z`,
      });
      executionRepository.updateTaskDispatch(dispatch.id, {
        status: "completed",
        startedAt: `2026-03-19T10:${String(index).padStart(2, "0")}:00.000Z`,
        finishedAt: `2026-03-19T10:${String(index).padStart(2, "0")}:59.000Z`,
      });
      for (let eventIndex = 0; eventIndex < 10; eventIndex += 1) {
        executionRepository.appendTaskRunEvent(run.id, "provider_activity", "agent", {
          preview: `Later event ${index}-${eventIndex}`,
        }, {
          createdAt: `2026-03-19T11:${String(index).padStart(2, "0")}:${String(eventIndex).padStart(2, "0")}.000Z`,
          sourceEventKey: `later-${index}-${eventIndex}`,
        });
      }
    }

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);

    expect(snapshot.taskDispatches).toHaveLength(26);
    expect(snapshot.taskDispatches.some((dispatch) => dispatch.id === earlyDispatch.id)).toBe(true);
    expect(snapshot.recentEvents.length).toBeGreaterThan(240);
    expect(snapshot.recentEvents.some((event) => (
      event.taskId === earlyTask.id && event.eventType === "cli_git_no_changes"
    ))).toBe(true);
  });

  it("keeps full dispatch and event history for every active sprint run when sprints run in parallel", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Parallel Active History Project",
      sourceType: "local",
      sourceRef: "/workspace/parallel-active-history-project",
    });
    const olderSprint = projectRepository.createSprint(project.id, {
      name: "Older Active Sprint",
      number: 26,
    });
    const newerSprint = projectRepository.createSprint(project.id, {
      name: "Newer Active Sprint",
      number: 64,
    });
    const olderRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: olderSprint.id,
      status: "running",
    });
    executionRepository.updateSprintRun(olderRun.id, {
      status: "running",
      startedAt: "2026-03-19T09:00:00.000Z",
      lastHeartbeatAt: "2026-03-19T09:15:00.000Z",
    });
    const newerRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: newerSprint.id,
      status: "running",
    });
    executionRepository.updateSprintRun(newerRun.id, {
      status: "running",
      startedAt: "2026-03-19T10:00:00.000Z",
      lastHeartbeatAt: "2026-03-19T11:59:00.000Z",
    });

    const olderTask = projectRepository.createTask(project.id, {
      sprintId: olderSprint.id,
      title: "Keep older active sprint visible",
    });
    const olderDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: olderSprint.id,
      taskId: olderTask.id,
      sprintRunId: olderRun.id,
      executorType: "docker_cli",
      status: "running",
    });
    const olderTaskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: olderSprint.id,
      taskId: olderTask.id,
      sprintRunId: olderRun.id,
      dispatchId: olderDispatch.id,
      provider: "codex",
      state: "RUNNING",
      startedAt: "2026-03-19T09:00:00.000Z",
    });
    executionRepository.appendTaskRunEvent(olderTaskRun.id, "cli_git_no_changes", "system", null, {
      createdAt: "2026-03-19T09:01:00.000Z",
      sourceEventKey: "older-active-event",
    });

    for (let index = 0; index < 25; index += 1) {
      const task = projectRepository.createTask(project.id, {
        sprintId: newerSprint.id,
        title: `Newer active task ${index}`,
      });
      const dispatch = executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: newerSprint.id,
        taskId: task.id,
        sprintRunId: newerRun.id,
        executorType: "docker_cli",
        status: "running",
      });
      const run = executionRepository.createTaskRun({
        projectId: project.id,
        sprintId: newerSprint.id,
        taskId: task.id,
        sprintRunId: newerRun.id,
        dispatchId: dispatch.id,
        provider: "codex",
        state: "RUNNING",
        startedAt: `2026-03-19T10:${String(index).padStart(2, "0")}:00.000Z`,
      });
      for (let eventIndex = 0; eventIndex < 10; eventIndex += 1) {
        executionRepository.appendTaskRunEvent(run.id, "provider_activity", "agent", {
          preview: `Newer active event ${index}-${eventIndex}`,
        }, {
          createdAt: `2026-03-19T11:${String(index).padStart(2, "0")}:${String(eventIndex).padStart(2, "0")}.000Z`,
          sourceEventKey: `newer-active-${index}-${eventIndex}`,
        });
      }
    }

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);

    expect(snapshot.sprintRuns.filter((run) => run.status === "running")).toHaveLength(2);
    expect(snapshot.taskDispatches.some((dispatch) => dispatch.id === olderDispatch.id)).toBe(true);
    expect(snapshot.recentEvents.some((event) => (
      event.taskId === olderTask.id && event.eventType === "cli_git_no_changes"
    ))).toBe(true);
  });

  it("projects human intervention summaries for paused sprint runs", async () => {
    const { projectRepository, executionRepository, projectAttentionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Intervention Project",
      sourceType: "local",
      sourceRef: "/workspace/intervention-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Intervention Sprint",
      number: 7,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Merge the styling update",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "paused",
      triggerType: "dashboard",
      executorMode: "mixed",
    });

    projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      title: "Merge required for T02",
      summaryMarkdown: "Task `T02` is complete and waiting to be merged into the sprint branch.",
      payload: {
        taskKey: "T02",
        featureBranch: "feature/sprint7-work",
        workerBranch: "worker/t02",
        prUrl: "https://github.com/example/repo/pull/22",
      },
    });

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);

    expect(snapshot.sprintRuns[0]?.humanIntervention).toMatchObject({
      title: "Merge required for T02",
      attentionType: "merge_required",
      severity: "high",
      reason: "Task T02 is complete and waiting to be merged into the sprint branch.",
    });
    expect(snapshot.sprintRuns[0]?.humanIntervention?.instructions).toContain("enable feature PR automerge");
  });


  it("includes active projects and orders recent events in overview telemetry", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Active Telemetry Project",
      sourceType: "local",
      sourceRef: "/workspace/active-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Active Sprint",
      number: 9,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      triggerType: "dashboard",
      executorMode: "mixed",
    });

    const task = projectRepository.createTask(project.id, { sprintId: sprint.id,
      title: "Active Task",
      taskKey: "TSK-1",
      status: "running",
      type: "feature",
      promptMarkdown: "Do work",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      state: "RUNNING",
      provider: "virtual",
      workerBranch: "worker-branch",
    });



    // Add some events in order
    executionRepository.appendSprintRunEvent(sprintRun.id, "sprint_run_started", "system", {
      startedBy: "User",
    });

    await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure different timestamps

    executionRepository.appendTaskRunEvent(taskRun.id, "task_run_started", "worker", {
      workerId: "worker-1",
    });

    const telemetry = executionRepository.getOverviewTelemetrySnapshot();

    expect(telemetry.activeProjects).toHaveLength(1);
    expect(telemetry.activeProjects[0]).toMatchObject({
      projectId: project.id,
      sprintRunId: sprintRun.id,
      sprintRunStatus: "running",
    });

    expect(telemetry.attentionProjects).toHaveLength(0);

    // Recent events should be ordered DESC (newest first)
    expect(telemetry.recentEvents.length).toBeGreaterThanOrEqual(2);
    expect(telemetry.recentEvents[0]).toMatchObject({
      scopeType: "task_run",
      eventType: "task_run_started",
    });
    expect(telemetry.recentEvents[1]).toMatchObject({
      scopeType: "sprint_run",
      eventType: "sprint_run_started",
    });
  });

  it("includes paused intervention projects in overview telemetry", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Planning Blocked Project",
      sourceType: "local",
      sourceRef: "/workspace/planning-blocked-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Planning Blocked Sprint",
      number: 8,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "paused",
      triggerType: "dashboard",
      executorMode: "mixed",
    });

    executionRepository.appendSprintRunEvent(sprintRun.id, "planning_preflight_blocked", "system", {
      planningTarget: "Planning Blocked Sprint",
    }, {
      sourceEventKey: "planning-blocked-overview",
    });

    const telemetry = executionRepository.getOverviewTelemetrySnapshot();

    expect(telemetry.activeProjects).toHaveLength(0);
    expect(telemetry.attentionProjects).toHaveLength(1);
    expect(telemetry.attentionProjects[0]).toMatchObject({
      projectId: project.id,
      sprintRunId: sprintRun.id,
    });
    expect(telemetry.attentionProjects[0]?.humanIntervention).toMatchObject({
      title: "Sprint planning required",
      reason: "Planning Blocked Sprint must be planned into executable tasks before orchestration can continue.",
    });
    expect(telemetry.attentionProjects[0]?.humanIntervention?.instructions).toContain("Plan Sprint");
  });

  it("rolls token and time telemetry into task, sprint, and project stats snapshots", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Telemetry Project",
      sourceType: "local",
      sourceRef: "/workspace/telemetry-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Telemetry Sprint",
      number: 7,
      status: "running",
    });
    const firstTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Track coding usage",
    });
    const secondTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Track merge usage",
    });

    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });
    const firstDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "completed",
    });
    const secondDispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: secondTask.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "completed",
    });

    const now = Date.now();
    const firstStartedAt = new Date(now - 50 * 60 * 1000).toISOString();
    const firstFinishedAt = new Date(now - 47 * 60 * 1000).toISOString();
    const secondStartedAt = new Date(now - 28 * 60 * 1000).toISOString();
    const secondFinishedAt = new Date(now - 24 * 60 * 1000).toISOString();

    const firstTaskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      sprintRunId: sprintRun.id,
      dispatchId: firstDispatch.id,
      provider: "codex",
      state: "completed",
      sessionId: "session-task-1",
      startedAt: firstStartedAt,
      finishedAt: firstFinishedAt,
      durationMs: 180_000,
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: secondTask.id,
      sprintRunId: sprintRun.id,
      dispatchId: secondDispatch.id,
      provider: "claude-code",
      state: "completed",
      sessionId: "session-task-2",
      startedAt: secondStartedAt,
      finishedAt: secondFinishedAt,
      durationMs: 240_000,
    });

    const codingInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      sprintRunId: sprintRun.id,
      dispatchId: firstDispatch.id,
      taskRunId: firstTaskRun.id,
      sessionId: "session-task-1",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.3-codex",
      startedAt: firstStartedAt,
      promptChars: 420,
    });
    executionRepository.updateProviderInvocationUsage(codingInvocation.id, {
      status: "completed",
      finishedAt: firstFinishedAt,
      durationMs: 180_000,
      transcriptChars: 180,
      inputTokens: 600,
      cachedInputTokens: 90,
      outputTokens: 210,
      reasoningOutputTokens: 45,
      totalTokens: 810,
      usageSource: "reported",
      rawUsageJson: { provider: "codex" },
    });

    const mergeInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: secondTask.id,
      sprintRunId: sprintRun.id,
      dispatchId: secondDispatch.id,
      sessionId: "session-task-2",
      provider: "claude-code",
      purpose: "merge_conflict",
      model: "claude-sonnet-4-6",
      startedAt: secondStartedAt,
      promptChars: 260,
    });
    executionRepository.updateProviderInvocationUsage(mergeInvocation.id, {
      status: "completed",
      finishedAt: secondFinishedAt,
      durationMs: 240_000,
      transcriptChars: 140,
      inputTokens: 320,
      cachedInputTokens: 0,
      outputTokens: 80,
      reasoningOutputTokens: 0,
      totalTokens: 400,
      usageSource: "estimated",
      rawUsageJson: null,
    });

    const executionSnapshot = executionRepository.getProjectExecutionSnapshot(project.id);
    const sprintUsage = executionSnapshot.sprintRuns[0]?.usage;
    const firstTaskUsage = executionSnapshot.taskDispatches.find((dispatch) => dispatch.taskId === firstTask.id)?.usage;
    const secondTaskUsage = executionSnapshot.taskDispatches.find((dispatch) => dispatch.taskId === secondTask.id)?.usage;

    expect(sprintUsage).toMatchObject({
      totalTokens: 1_210,
      activeTimeMs: 420_000,
      wallTimeMs: 420_000,
      invocationCount: 2,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 1,
    });
    expect(firstTaskUsage).toMatchObject({
      totalTokens: 810,
      activeTimeMs: 180_000,
      wallTimeMs: 180_000,
    });
    expect(secondTaskUsage).toMatchObject({
      totalTokens: 400,
      activeTimeMs: 240_000,
      wallTimeMs: 240_000,
    });

    const statsSnapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");
    expect(statsSnapshot.usage).toMatchObject({
      totalTokens: 1_210,
      activeTimeMs: 420_000,
      wallTimeMs: 420_000,
      invocationCount: 2,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 1,
    });
    expect(statsSnapshot.activeSprint).toMatchObject({
      sprintId: sprint.id,
      sprintName: "Telemetry Sprint",
      sprintNumber: 7,
    });
    expect(statsSnapshot.tasks[0]).toMatchObject({
      label: "T01 Track coding usage",
      usage: expect.objectContaining({
        totalTokens: 810,
      }),
    });
    expect(statsSnapshot.sprints[0]).toMatchObject({
      label: "Sprint 7 · Telemetry Sprint",
      usage: expect.objectContaining({
        totalTokens: 1_210,
      }),
    });
    expect(statsSnapshot.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "codex",
        usage: expect.objectContaining({ totalTokens: 810 }),
      }),
      expect.objectContaining({
        id: "claude-code",
        usage: expect.objectContaining({ totalTokens: 400 }),
      }),
    ]));
    expect(statsSnapshot.purposes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "task_coding",
        usage: expect.objectContaining({ totalTokens: 810 }),
      }),
      expect.objectContaining({
        id: "merge_conflict",
        usage: expect.objectContaining({ totalTokens: 400 }),
      }),
    ]));
    expect(statsSnapshot.tokenSources).toEqual(expect.arrayContaining([
      { source: "reported", count: 1 },
      { source: "estimated", count: 1 },
    ]));
    expect(statsSnapshot.buckets).toHaveLength(24);
    expect(statsSnapshot.chartSeries).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "core_total_tokens", grouping: "totals" }),
      expect.objectContaining({ id: "core_active_time", grouping: "totals" }),
      expect.objectContaining({ id: "core_invocations", grouping: "totals" }),
      expect.objectContaining({ id: "provider_codex", grouping: "providers", data: expect.arrayContaining([810]) }),
      expect.objectContaining({ id: "provider_claude-code", grouping: "providers", data: expect.arrayContaining([400]) }),
      expect.objectContaining({ id: "purpose_time_task_coding", grouping: "purposes_time", data: expect.arrayContaining([180_000]) }),
      expect.objectContaining({ id: "purpose_time_merge_conflict", grouping: "purposes_time", data: expect.arrayContaining([240_000]) }),
      expect.objectContaining({ id: "purpose_invocations_task_coding", grouping: "purposes_invocations", data: expect.arrayContaining([1]) }),
    ]));
  });

  it("supports 30d, all-time, and custom project stats windows", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Windowed Stats Project",
      sourceType: "local",
      sourceRef: "/workspace/windowed-stats-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Windowed Sprint",
      number: 4,
      status: "running",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Measure time windows",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      executorMode: "mixed",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "completed",
    });

    const now = Date.now();
    const olderStartedAt = new Date(now - 20 * 24 * 60 * 60 * 1000).toISOString();
    const olderFinishedAt = new Date(now - 20 * 24 * 60 * 60 * 1000 + 180_000).toISOString();
    const recentStartedAt = new Date(now - 2 * 24 * 60 * 60 * 1000).toISOString();
    const recentFinishedAt = new Date(now - 2 * 24 * 60 * 60 * 1000 + 240_000).toISOString();

    const run = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "codex",
      state: "completed",
      sessionId: "windowed-task-run-1",
      startedAt: olderStartedAt,
      finishedAt: olderFinishedAt,
      durationMs: 180_000,
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      provider: "claude-code",
      state: "completed",
      sessionId: "windowed-task-run-2",
      prUrl: "https://github.com/org/repo/pull/1",
      startedAt: recentStartedAt,
      finishedAt: recentFinishedAt,
      durationMs: 240_000,
    });

    executionRepository.appendTaskRunEvent(run.id, "cli_git_pushed", "system", {
      insertions: 42,
      deletions: 12,
      filesChanged: 3
    }, {
      createdAt: recentFinishedAt,
    });

    const olderInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      sessionId: "windowed-task-run-1",
      provider: "codex",
      purpose: "task_coding",
      model: "gpt-5.3-codex",
      startedAt: olderStartedAt,
      promptChars: 180,
    });
    executionRepository.updateProviderInvocationUsage(olderInvocation.id, {
      status: "completed",
      finishedAt: olderFinishedAt,
      durationMs: 180_000,
      transcriptChars: 90,
      inputTokens: 300,
      cachedInputTokens: 20,
      outputTokens: 110,
      reasoningOutputTokens: 10,
      totalTokens: 410,
      usageSource: "reported",
      rawUsageJson: { provider: "codex" },
    });

    const recentInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      sessionId: "windowed-task-run-2",
      provider: "claude-code",
      purpose: "merge_conflict",
      model: "claude-sonnet-4-6",
      startedAt: recentStartedAt,
      promptChars: 210,
    });
    executionRepository.updateProviderInvocationUsage(recentInvocation.id, {
      status: "completed",
      finishedAt: recentFinishedAt,
      durationMs: 240_000,
      transcriptChars: 120,
      inputTokens: 420,
      cachedInputTokens: 0,
      outputTokens: 140,
      reasoningOutputTokens: 0,
      totalTokens: 560,
      usageSource: "estimated",
      rawUsageJson: null,
    });

    const thirtyDaySnapshot = executionRepository.getProjectStatsSnapshot(project.id, "30d");
    expect(thirtyDaySnapshot.window).toBe("30d");
    expect(thirtyDaySnapshot.range.resolution).toBe("day");
    expect(thirtyDaySnapshot.range.bucketCount).toBe(30);
    expect(thirtyDaySnapshot.usage.totalTokens).toBe(970);

    const allTimeSnapshot = executionRepository.getProjectStatsSnapshot(project.id, "all");
    expect(allTimeSnapshot.window).toBe("all");
    expect(allTimeSnapshot.range.isCustom).toBe(false);
    expect(allTimeSnapshot.usage.totalTokens).toBe(970);
    expect(allTimeSnapshot.tasks[0]?.lastActivityAt).toBe(recentFinishedAt);

    const customSnapshot = executionRepository.getProjectStatsSnapshot(project.id, {
      window: "custom",
      from: new Date(now - 5 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      to: new Date(now).toISOString().slice(0, 10),
    });
    expect(customSnapshot.window).toBe("custom");
    expect(customSnapshot.query).toMatchObject({
      window: "custom",
    });
    expect(customSnapshot.range.isCustom).toBe(true);
    expect(customSnapshot.usage.totalTokens).toBe(560);
    expect(customSnapshot.providers).toEqual([
      expect.objectContaining({
        id: "claude-code",
        usage: expect.objectContaining({ totalTokens: 560 }),
      }),
    ]);
  });

  it("tracks clarification_reply provider usage in purposes", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Clarification Stats Project",
      sourceType: "local",
      sourceRef: "/workspace/clarification-stats-project",
    });

    const usage = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sessionId: "session-clarification-1",
      provider: "gemini",
      purpose: "clarification_reply",
      status: "running",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      promptChars: 1500,
    });

    executionRepository.updateProviderInvocationUsage(usage.id, {
      status: "completed",
      finishedAt: new Date().toISOString(),
      durationMs: 60_000,
      transcriptChars: 500,
      inputTokens: 300,
      cachedInputTokens: 0,
      outputTokens: 100,
      reasoningOutputTokens: 0,
      totalTokens: 400,
      usageSource: "reported",
      rawUsageJson: null,
    });

    const statsSnapshot = executionRepository.getProjectStatsSnapshot(project.id, "24h");

    expect(statsSnapshot.purposes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "clarification_reply",
        usage: expect.objectContaining({ totalTokens: 400 }),
      }),
    ]));

    expect(statsSnapshot.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "gemini",
        usage: expect.objectContaining({ totalTokens: 400 }),
      }),
    ]));
  });

  it("hydrates multiple dispatches dynamically without N+1 regression", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Bulk Snapshot Project",
      sourceType: "local",
      sourceRef: "/workspace/bulk",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Bulk Sprint",
      number: 1,
      status: "running",
    });

    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });

    // Create 5 tasks and dispatches
    for (let i = 0; i < 5; i++) {
      const task = projectRepository.createTask(project.id, {
        sprintId: sprint.id,
        title: `Bulk Task ${i}`,
        executorType: "mcp_worker",
      });

      const dispatch = executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        executorType: "mcp_worker",
        status: "running",
      });

      // Two runs per dispatch to ensure it picks the latest one
      executionRepository.createTaskRun({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        dispatchId: dispatch.id,
        state: "failed",
        provider: "old-provider",
      });

      executionRepository.createTaskRun({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        dispatchId: dispatch.id,
        state: "RUNNING",
        provider: "target-provider",
      });
    }

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);
    expect(snapshot.taskDispatches).toHaveLength(5);

    for (const td of snapshot.taskDispatches) {
      expect(td.taskRunState).toBe("RUNNING");
      expect(td.provider).toBe("target-provider");
    }
  });

  it("asserts refactor preserves ordering, inclusion rules for expanded sprint runs, and attached task-run/runtime-event metadata", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Refactor Verification Project",
      sourceType: "local",
      sourceRef: "/workspace/refactor",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Refactor Sprint",
      number: 1,
      status: "running",
    });

    // Create an active sprint run
    const sprintRun1 = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });

    // Create a paused sprint run
    const sprintRun2 = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "paused",
    });

    // Create an old completed sprint run
    const sprintRun3 = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "completed",
    });

    const task1 = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 1", executorType: "mcp_worker" });
    const task2 = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 2", executorType: "docker_cli" });

    // Dispatches linked to the running sprint run
    const dispatch1 = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task1.id,
      sprintRunId: sprintRun1.id,
      executorType: "mcp_worker",
      status: "running",
      priority: 10,
    });
    const dispatch2 = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task2.id,
      sprintRunId: sprintRun1.id,
      executorType: "docker_cli",
      status: "queued",
      priority: 5,
    });

    // Task runs
    const taskRun1 = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task1.id,
      sprintRunId: sprintRun1.id,
      dispatchId: dispatch1.id,
      state: "RUNNING",
      provider: "claude-code",
    });

    // Runtime event
    executionRepository.appendTaskRunEvent(
      taskRun1.id,
      "worker_dispatch_started",
      "system",
      {}
    );
    executionRepository.appendSprintRunEvent(
      sprintRun1.id,
      "sprint_started",
      "system",
      {}
    );

    const snapshot = executionRepository.getProjectExecutionSnapshot(project.id);

    // Verify sprint runs ordering and inclusion
    expect(snapshot.sprintRuns.map(sr => sr.status)).toEqual([
      "running",
      "paused",
      "completed",
    ]);

    // Verify task dispatches ordering based on rank and priority
    expect(snapshot.taskDispatches.map(td => td.id)).toEqual([
      dispatch1.id, // Running (rank 0)
      dispatch2.id, // Queued (rank 3)
    ]);

    // Verify task run attached metadata to dispatch
    const snapshotDispatch1 = snapshot.taskDispatches.find(td => td.id === dispatch1.id);
    expect(snapshotDispatch1).toBeDefined();
    expect(snapshotDispatch1!.taskRunState).toBe("RUNNING");
    expect(snapshotDispatch1!.provider).toBe("claude-code");

    // Verify runtime events inclusion and formatting
    expect(snapshot.recentEvents).toHaveLength(2);
    const eventTypes = snapshot.recentEvents.map(e => e.eventType);
    expect(eventTypes).toContain("worker_dispatch_started");
    expect(eventTypes).toContain("sprint_started");

    const taskRunEvent = snapshot.recentEvents.find(e => e.eventType === "worker_dispatch_started");
    expect(taskRunEvent!.taskRunState).toBe("RUNNING");
    expect(taskRunEvent!.provider).toBe("claude-code");
    expect(taskRunEvent!.sprintRunStatus).toBe("running");
  });
  });

  it("counts running tasks per provider", async () => {
    const { projectRepository, executionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Concurrency Project",
      sourceType: "local",
      sourceRef: "/workspace/concurrency",
    });
    const project2 = projectRepository.createProject({
      name: "Another Project",
      sourceType: "local",
      sourceRef: "/workspace/another",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const sprint2 = projectRepository.createSprint(project2.id, { name: "Sprint 2", number: 1 });
    const task1 = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 1", promptMarkdown: "Prompt 1" });
    const task2 = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 2", promptMarkdown: "Prompt 2" });
    const task3 = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 3", promptMarkdown: "Prompt 3" });
    const task4 = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 4", promptMarkdown: "Prompt 4" });
    const task5 = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Task 5", promptMarkdown: "Prompt 5" });

    const task6_p2 = projectRepository.createTask(project2.id, { sprintId: sprint2.id, title: "Task 6", promptMarkdown: "Prompt 6" });

    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task1.id,
      provider: "gemini",
      state: "RUNNING"
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task2.id,
      provider: "gemini",
      state: "RUNNING"
    });

    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task3.id,
      provider: "codex",
      state: "RUNNING"
    });

    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task4.id,
      provider: "gemini",
      state: "COMPLETED"
    });

    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task5.id,
      provider: null,
      state: "RUNNING"
    });

    // Create a running task in another project to verify it is NOT counted for 'project'
    executionRepository.createTaskRun({
      projectId: project2.id,
      sprintId: sprint2.id,
      taskId: task6_p2.id,
      provider: "codex",
      state: "RUNNING"
    });

    const counts = executionRepository.countRunningTasksPerProvider(project.id);
    expect(counts.get("gemini")).toBe(2);
    expect(counts.get("codex")).toBe(1);
    expect(counts.has(null as any)).toBe(false);
    expect(counts.size).toBe(2);
  });

  describe("ExecutionInvocationMessageRecord Metadata", () => {
    it("persists and retrieves metadata for execution messages", async () => {
      const { projectRepository, executionRepository } = await createRepositories();
      const project = projectRepository.createProject({
        name: "Test Project Execution",
        sourceType: "local",
        sourceRef: "/tmp/exec",
      });

      const invocation = executionRepository.createExecutionInvocation({
        projectId: project.id,
        type: "test_invocation",
      });

      const messageMetadata = { invocationSpecific: true, tokens: 42 };

      const message = executionRepository.appendExecutionInvocationMessage(invocation.id, {
        role: "user",
        contentMarkdown: "Test prompt",
        metadata: messageMetadata,
      });

      expect(message.metadata).toEqual(messageMetadata);

      const messages = executionRepository.listExecutionInvocationMessages(invocation.id);
      expect(messages[0].metadata).toEqual(messageMetadata);
    });
  });

  describe("claimNextTaskDispatch", () => {
    it("claims the highest priority task", async () => {
      const { projectRepository, executionRepository } = await createRepositories();
      const project = projectRepository.createProject({
        name: "Claim Priority Project",
        sourceType: "local",
        sourceRef: "/workspace/claim-priority",
      });
      const sprint = projectRepository.createSprint(project.id, {
        name: "Claim Sprint",
        goalMarkdown: "Goal",
      });
      const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
      });

      const task1 = projectRepository.createTask(project.id, {
        title: "Task 1",
        sprintId: sprint.id,
      });
      const task2 = projectRepository.createTask(project.id, {
        title: "Task 2",
        sprintId: sprint.id,
      });

      const dispatchLow = executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task1.id,
        sprintRunId: sprintRun.id,
        executorType: "mcp_worker",
        priority: 10,
        queuedAt: new Date(Date.now() - 1000).toISOString(),
      });

      const dispatchHigh = executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task2.id,
        sprintRunId: sprintRun.id,
        executorType: "mcp_worker",
        priority: 100,
        queuedAt: new Date().toISOString(),
      });

      const claimed = executionRepository.claimNextTaskDispatch({
        projectId: project.id,
        executorType: "mcp_worker",
      });

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(dispatchHigh.id);
      expect(claimed?.status).toBe("claimed");
    });

    it("scopes claim by sprint and sprint run filters", async () => {
      const { projectRepository, executionRepository } = await createRepositories();
      const project = projectRepository.createProject({
        name: "Claim Scoped Project",
        sourceType: "local",
        sourceRef: "/workspace/claim-scoped",
      });
      const sprint1 = projectRepository.createSprint(project.id, {
        name: "Sprint 1",
        goalMarkdown: "Goal 1",
      });
      const sprintRun1 = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint1.id,
      });
      const task1 = projectRepository.createTask(project.id, {
        title: "Task 1",
        sprintId: sprint1.id,
      });

      const sprint2 = projectRepository.createSprint(project.id, {
        name: "Sprint 2",
        goalMarkdown: "Goal 2",
      });
      const sprintRun2 = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint2.id,
      });
      const task2 = projectRepository.createTask(project.id, {
        title: "Task 2",
        sprintId: sprint2.id,
      });

      executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint1.id,
        taskId: task1.id,
        sprintRunId: sprintRun1.id,
        executorType: "mcp_worker",
        priority: 100,
      });

      const dispatch2 = executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint2.id,
        taskId: task2.id,
        sprintRunId: sprintRun2.id,
        executorType: "mcp_worker",
        priority: 50,
      });

      const claimed = executionRepository.claimNextTaskDispatch({
        projectId: project.id,
        sprintId: sprint2.id,
        sprintRunId: sprintRun2.id,
        executorType: "mcp_worker",
      });

      expect(claimed).not.toBeNull();
      expect(claimed?.id).toBe(dispatch2.id);
    });

    it("prevents double claiming of the same dispatch", async () => {
      const { projectRepository, executionRepository } = await createRepositories();
      const project = projectRepository.createProject({
        name: "Double Claim Project",
        sourceType: "local",
        sourceRef: "/workspace/double-claim",
      });
      const sprint = projectRepository.createSprint(project.id, {
        name: "Sprint",
        goalMarkdown: "Goal",
      });
      const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
      });
      const task = projectRepository.createTask(project.id, {
        title: "Task",
        sprintId: sprint.id,
      });

      executionRepository.createTaskDispatch({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: task.id,
        sprintRunId: sprintRun.id,
        executorType: "mcp_worker",
      });

      const claim1 = executionRepository.claimNextTaskDispatch({
        projectId: project.id,
        executorType: "mcp_worker",
      });
      expect(claim1).not.toBeNull();

      const claim2 = executionRepository.claimNextTaskDispatch({
        projectId: project.id,
        executorType: "mcp_worker",
      });
      expect(claim2).toBeNull();
    });

    it("returns null if no queued tasks exist for executor type", async () => {
      const { projectRepository, executionRepository } = await createRepositories();
      const project = projectRepository.createProject({
        name: "No Queue Project",
        sourceType: "local",
        sourceRef: "/workspace/no-queue",
      });

      const claimed = executionRepository.claimNextTaskDispatch({
        projectId: project.id,
        executorType: "mcp_worker",
      });

      expect(claimed).toBeNull();
    });

  describe('acquireLease (atomic operation)', () => {
    it('handles concurrent lease acquisition attempts atomically', async () => {
      const storage = new AppDbStorage(':memory:');
      runMigrations(storage.getDatabase());
      const repo = new ExecutionRepository(storage);

      const scopeType = 'TASK';
      const scopeId = 'concurrent-123';
      const expiresAt = new Date(Date.now() + 60000).toISOString();

      const promises = [];
      for (let i = 0; i < 10; i++) {
        promises.push(new Promise((resolve) => {
          setTimeout(() => {
            try {
              const res = repo.acquireLease({
                scopeType,
                scopeId,
                ownerKey: `owner-${i}`,
                leaseToken: `token-${i}`,
                expiresAt,
              });
              resolve({ success: true, res });
            } catch (err: any) {
              resolve({ success: false, err });
            }
          }, 10);
        }));
      }

      const results = await Promise.all(promises);
      const successes = results.filter(r => (r as any).success);
      const failures = results.filter(r => !(r as any).success);

      expect(successes).toHaveLength(1);
      expect(failures).toHaveLength(9);

      failures.forEach((f: any) => {
        expect(f.err.message).toContain(`Lease already held for TASK:${scopeId}`);
      });

      const currentLease = repo.getLease(scopeType, scopeId);
      expect(currentLease).toBeDefined();
      expect(currentLease?.ownerKey).toBe((successes[0] as any).res.ownerKey);
    });

    it('reclaims expired leases successfully', () => {
      const storage = new AppDbStorage(':memory:');
      runMigrations(storage.getDatabase());
      const repo = new ExecutionRepository(storage);

      const scopeType = 'TASK';
      const scopeId = 'expired-123';
      const expiredTime = new Date(Date.now() - 60000).toISOString();
      const newExpiry = new Date(Date.now() + 60000).toISOString();

      // Acquire initially but set it as expired (simulated via DB since acquireLease sets acquired_at = now)
      storage.getDatabase().prepare(`
        INSERT INTO execution_leases (id, scope_type, scope_id, owner_key, lease_token, acquired_at, expires_at, last_heartbeat_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run('id1', scopeType, scopeId, 'old-owner', 'old-token', expiredTime, expiredTime, expiredTime);

      const newLease = repo.acquireLease({
        scopeType,
        scopeId,
        ownerKey: 'new-owner',
        leaseToken: 'new-token',
        expiresAt: newExpiry
      });

      expect(newLease.ownerKey).toBe('new-owner');
      expect(newLease.leaseToken).toBe('new-token');

      const currentLease = repo.getLease(scopeType, scopeId);
      expect(currentLease?.ownerKey).toBe('new-owner');
      expect(currentLease?.leaseToken).toBe('new-token');
    });
  });
});