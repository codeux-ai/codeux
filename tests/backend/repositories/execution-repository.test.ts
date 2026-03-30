import { afterEach, describe, expect, it } from "vitest";
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ExecutionRepository", () => {

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

    const list = executionRepository.listExecutionInvocations({ projectId: project.id });
    expect(list.length).toBe(2);
    // ordered by startedAt DESC
    expect(list[0]!.id).toBe(invocation2.id);
    expect(list[1]!.id).toBe(invocation1.id);
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

  it("orders worker project affinity by active load and recency", async () => {
    const { projectRepository, connectionRepository, executionRepository } = await createRepositories();
    const projectA = projectRepository.createProject({
      name: "Affinity Project A",
      sourceType: "local",
      sourceRef: "/workspace/affinity-project-a",
    });
    const projectB = projectRepository.createProject({
      name: "Affinity Project B",
      sourceType: "local",
      sourceRef: "/workspace/affinity-project-b",
    });
    const sprintA = projectRepository.createSprint(projectA.id, {
      name: "Affinity Sprint A",
      number: 1,
    });
    const sprintB = projectRepository.createSprint(projectB.id, {
      name: "Affinity Sprint B",
      number: 2,
    });
    const taskA = projectRepository.createTask(projectA.id, {
      sprintId: sprintA.id,
      title: "Affinity task A",
      executorType: "mcp_worker",
    });
    const taskB = projectRepository.createTask(projectB.id, {
      sprintId: sprintB.id,
      title: "Affinity task B",
      executorType: "mcp_worker",
    });
    const sprintRunA = executionRepository.createSprintRun({
      projectId: projectA.id,
      sprintId: sprintA.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const sprintRunB = executionRepository.createSprintRun({
      projectId: projectB.id,
      sprintId: sprintB.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-affinity-1",
      displayName: "Worker Affinity 1",
      role: "worker",
      transport: "stdio",
      status: "connected",
      projectIds: [projectA.id, projectB.id],
      activeProjectIds: [projectA.id, projectB.id],
    });

    const recentCompletedDispatch = executionRepository.createTaskDispatch({
      projectId: projectA.id,
      sprintId: sprintA.id,
      taskId: taskA.id,
      sprintRunId: sprintRunA.id,
      executorType: "mcp_worker",
      connectionId: worker.id,
      status: "completed",
    });
    executionRepository.updateTaskDispatch(recentCompletedDispatch.id, {
      claimedAt: "2026-03-12T11:00:00.000Z",
      startedAt: "2026-03-12T11:01:00.000Z",
      finishedAt: "2026-03-12T11:10:00.000Z",
      lastHeartbeatAt: "2026-03-12T11:10:00.000Z",
    });

    const activeDispatch = executionRepository.createTaskDispatch({
      projectId: projectB.id,
      sprintId: sprintB.id,
      taskId: taskB.id,
      sprintRunId: sprintRunB.id,
      executorType: "mcp_worker",
      connectionId: worker.id,
      status: "running",
    });
    executionRepository.updateTaskDispatch(activeDispatch.id, {
      claimedAt: "2026-03-12T10:00:00.000Z",
      startedAt: "2026-03-12T10:01:00.000Z",
      lastHeartbeatAt: "2026-03-12T10:30:00.000Z",
    });

    expect(executionRepository.listWorkerProjectAffinity(worker.id)).toEqual([
      projectB.id,
      projectA.id,
    ]);
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
      totalTokens: 945,
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
      totalTokens: 1_345,
      activeTimeMs: 420_000,
      wallTimeMs: 420_000,
      invocationCount: 2,
      reportedInvocationCount: 1,
      estimatedInvocationCount: 1,
    });
    expect(firstTaskUsage).toMatchObject({
      totalTokens: 945,
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
      totalTokens: 1_345,
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
        totalTokens: 945,
      }),
    });
    expect(statsSnapshot.sprints[0]).toMatchObject({
      label: "Sprint 7 · Telemetry Sprint",
      usage: expect.objectContaining({
        totalTokens: 1_345,
      }),
    });
    expect(statsSnapshot.providers).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "codex",
        usage: expect.objectContaining({ totalTokens: 945 }),
      }),
      expect.objectContaining({
        id: "claude-code",
        usage: expect.objectContaining({ totalTokens: 400 }),
      }),
    ]));
    expect(statsSnapshot.purposes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: "task_coding",
        usage: expect.objectContaining({ totalTokens: 945 }),
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

    executionRepository.createTaskRun({
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
      startedAt: recentStartedAt,
      finishedAt: recentFinishedAt,
      durationMs: 240_000,
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
      totalTokens: 440,
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
    expect(thirtyDaySnapshot.usage.totalTokens).toBe(1_000);

    const allTimeSnapshot = executionRepository.getProjectStatsSnapshot(project.id, "all");
    expect(allTimeSnapshot.window).toBe("all");
    expect(allTimeSnapshot.range.isCustom).toBe(false);
    expect(allTimeSnapshot.usage.totalTokens).toBe(1_000);
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
});
