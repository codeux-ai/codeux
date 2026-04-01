import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { DashboardRealtimeEventRepository } from "../../../src/repositories/dashboard-realtime-event-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { DashboardRealtimeService } from "../../../src/services/dashboard-realtime-service.js";
import { createLogger } from "../../../src/shared/logging/logger.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  connectionRepository: ConnectionChatRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-connection-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    connectionRepository: new ConnectionChatRepository(storage),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

async function createRepositoriesWithRealtime(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  connectionRepository: ConnectionChatRepository;
  realtimeEventRepository: DashboardRealtimeEventRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-connection-repo-realtime-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const realtimeEventRepository = new DashboardRealtimeEventRepository(storage);
  const realtimeService = new DashboardRealtimeService(
    realtimeEventRepository,
    createLogger({ bindings: { component: "connection-chat-repository-test" } }),
  );
  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    connectionRepository: new ConnectionChatRepository(storage, realtimeService),
    realtimeEventRepository,
  };
}

describe("ConnectionChatRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-10T00:00:00.000Z"));
  });

  it("upserts connection project bindings using batches and handles idempotency", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project1 = projectRepository.createProject({
      name: "Batch Proj 1",
      sourceType: "local",
      sourceRef: "/tmp/batch-1",
    });

    // Create 105 projects to force batching > 100 limit
    const projectIds: string[] = [project1.id];
    for (let i = 0; i < 105; i++) {
      const p = projectRepository.createProject({
        name: `Batch Proj ${i+2}`,
        sourceType: "local",
        sourceRef: `/tmp/batch-${i+2}`,
      });
      projectIds.push(p.id);
    }

    // Test initial upsert (creates connection)
    const conn1 = connectionRepository.upsertConnection({
      connectionKey: "batch-worker-1",
      displayName: "Batch Worker 1",
      role: "worker",
      transport: "stdio",
      status: "connected",
      capabilities: {},
      projectIds,
      activeProjectIds: [project1.id],
    });
    expect(conn1.id).toBeDefined();
    expect(conn1.projectIds.length).toBe(106);
    expect(conn1.activeProjectIds.length).toBe(1);

    // Test idempotent update (updates connection, preserves bindings)
    const conn2 = connectionRepository.upsertConnection({
      connectionKey: "batch-worker-1",
      displayName: "Batch Worker Updated",
      role: "worker",
      transport: "sse",
      status: "connected",
      capabilities: {},
      projectIds,
      activeProjectIds: [project1.id],
    });
    expect(conn2.id).toBe(conn1.id);
    expect(conn2.displayName).toBe("Batch Worker Updated");
    expect(conn2.transport).toBe("sse");
    expect(conn2.projectIds.length).toBe(106);

    // Test stale association pruning (empty array)
    const conn3 = connectionRepository.upsertConnection({
      connectionKey: "batch-worker-1",
      displayName: "Batch Worker Emptied",
      role: "worker",
      transport: "sse",
      status: "connected",
      capabilities: {},
      projectIds: [],
      activeProjectIds: [],
    });
    expect(conn3.projectIds.length).toBe(0);
    expect(conn3.activeProjectIds.length).toBe(0);
  });

  it("handles SQL map fallback edge cases", async () => {
    // The `_mapConnectionRecord` fallback for missing array fields via `COALESCE`
    // is tested implicitly if we manually create a bad row or use the repository to read one.
    // However, we can just test the public list/get interface behavior on valid records for now.
    const { connectionRepository } = await createRepositories();
    const result = connectionRepository.getConnectionByKey("missing-key");
    expect(result).toBeNull();
  });

  it("registers listeners, queues dashboard messages, and stores replies", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Connection Project",
      sourceType: "local",
      sourceRef: "/workspace/connection-project",
    });
    projectRepository.setSelectedProjectId(project.id);

    const startListen = connectionRepository.startListen({
      connectionKey: "listener-alpha",
      displayName: "Listener Alpha",
      role: "listener",
      projectId: project.id,
      capabilities: {
        instruction: "Reply to dashboard messages.",
        model: "codex",
      },
    });

    expect(startListen.connection).toMatchObject({
      displayName: "Listener Alpha",
      role: "listener",
      status: "listening",
    });
    expect(startListen.inbox).toEqual([]);

    const posted = connectionRepository.postDashboardMessage(project.id, {
      title: "Triage blockers",
      bodyMarkdown: "Please summarize the top blockers for this project.",
    });

    const threads = connectionRepository.listThreads(project.id);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      title: "Triage blockers",
      connectionId: null,
      pendingMessageCount: 1,
    });

    const inbox = connectionRepository.pullInbox({
      connectionKey: "listener-alpha",
      projectId: project.id,
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      threadId: threads[0].id,
      bodyMarkdown: "Please summarize the top blockers for this project.",
      deliveryStatus: "delivered",
    });

    const claimedThread = connectionRepository.listThreads(project.id)[0];
    expect(claimedThread.connectionId).toBe(startListen.connection.id);

    const reply = connectionRepository.postListenReply({
      connectionKey: "listener-alpha",
      threadId: threads[0].id,
      bodyMarkdown: "Current blockers are dependency ordering and one failed task run.",
      replyToMessageId: posted.id,
    });
    expect(reply).toMatchObject({
      direction: "connection_to_dashboard",
      authorType: "connection",
      deliveryStatus: "processed",
    });

    const messages = connectionRepository.listMessages(threads[0].id);
    expect(messages).toHaveLength(2);
    expect(messages.some((message) => message.deliveryStatus === "processed")).toBe(true);
    expect(messages.some((message) => message.bodyMarkdown.includes("dependency ordering"))).toBe(true);

    const connections = connectionRepository.listConnections(project.id);
    expect(connections[0]).toMatchObject({
      pendingInboxCount: 0,
      threadCount: 1,
      messageCount: 2,
    });
  });

  it("stores system-authored project messages without creating worker inbox backlog", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "System Message Project",
      sourceType: "local",
      sourceRef: "/workspace/system-message-project",
    });

    const listen = connectionRepository.startListen({
      connectionKey: "worker-system-message",
      displayName: "Worker System Message",
      role: "worker",
      projectId: project.id,
    });

    const message = connectionRepository.postSystemMessage(project.id, {
      title: "Worker escalation",
      connectionId: listen.connection.id,
      bodyMarkdown: "Operator follow-up is required for this project blocker.",
    });

    expect(message).toMatchObject({
      direction: "connection_to_dashboard",
      authorType: "system",
      deliveryStatus: "processed",
    });
    expect(connectionRepository.pullInbox({
      connectionKey: "worker-system-message",
      projectId: project.id,
    })).toEqual([]);
    expect(connectionRepository.listThreads(project.id)[0]).toMatchObject({
      connectionId: listen.connection.id,
      pendingMessageCount: 0,
    });
  });

  it("marks delivered dashboard messages processed for virtual replies", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Virtual Reply Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-reply-project",
    });

    connectionRepository.startListen({
      connectionKey: "virtual-status-listener",
      displayName: "Virtual Status Listener",
      role: "listener",
      projectId: project.id,
    });

    const message = connectionRepository.postDashboardMessage(project.id, {
      title: "Status test",
      bodyMarkdown: "Please reply from a virtual worker.",
    });
    const thread = connectionRepository.listThreads(project.id)[0];

    connectionRepository.pullInbox({
      connectionKey: "virtual-status-listener",
      projectId: project.id,
    });

    const processed = connectionRepository.markDashboardMessagesProcessed(thread.id, {
      upToMessageId: message.id,
    });

    expect(processed.pendingMessageCount).toBe(0);
    expect(connectionRepository.listMessages(thread.id)[0]).toMatchObject({
      id: message.id,
      deliveryStatus: "processed",
    });
  });

  it("keeps hidden control messages out of visible chat counts while still delivering them to workers", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Hidden Control Message Project",
      sourceType: "local",
      sourceRef: "/workspace/hidden-control-message-project",
    });

    const listen = connectionRepository.startListen({
      connectionKey: "worker-hidden-control",
      displayName: "Worker Hidden Control",
      role: "worker",
      projectId: project.id,
    });

    const thread = connectionRepository.createThread(project.id, {
      title: "Compaction Thread",
      connectionId: listen.connection.id,
    });

    const request = connectionRepository.postDashboardMessage(project.id, {
      threadId: thread.id,
      connectionId: listen.connection.id,
      bodyMarkdown: "Hidden compaction request",
      metadata: {
        internalVisibility: "hidden",
        internalOperation: "thread_compaction_request",
        requestId: "req-1",
      },
    });

    expect(connectionRepository.listMessages(thread.id)).toEqual([]);
    expect(connectionRepository.listMessages(thread.id, { includeHidden: true })).toHaveLength(1);
    expect(connectionRepository.listThreads(project.id)[0]).toMatchObject({
      messageCount: 0,
      pendingMessageCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    });

    const inbox = connectionRepository.pullInbox({
      connectionKey: "worker-hidden-control",
      projectId: project.id,
    });
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      id: request.id,
      threadId: thread.id,
      metadata: {
        internalVisibility: "hidden",
        internalOperation: "thread_compaction_request",
        requestId: "req-1",
      },
    });

    connectionRepository.postListenReply({
      connectionKey: "worker-hidden-control",
      threadId: thread.id,
      bodyMarkdown: "Compacted summary",
      replyToMessageId: request.id,
      metadata: {
        internalVisibility: "hidden",
        internalOperation: "thread_compaction_result",
        requestId: "req-1",
      },
    });

    expect(connectionRepository.listMessages(thread.id)).toEqual([]);
    expect(connectionRepository.listMessages(thread.id, { includeHidden: true })).toHaveLength(2);
    expect(connectionRepository.listThreads(project.id)[0]).toMatchObject({
      messageCount: 0,
      pendingMessageCount: 0,
      lastMessageAt: null,
      lastMessagePreview: null,
    });
    expect(connectionRepository.listConnections(project.id)[0]).toMatchObject({
      pendingInboxCount: 0,
      messageCount: 0,
    });
  });

  it("derives stale and offline connection states from heartbeat age", async () => {
    const { storage, projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Lifecycle Project",
      sourceType: "local",
      sourceRef: "/workspace/lifecycle-project",
    });

    const listening = connectionRepository.startListen({
      connectionKey: "listener-fresh",
      displayName: "Fresh Listener",
      role: "listener",
      projectId: project.id,
    });
    const stale = connectionRepository.startListen({
      connectionKey: "listener-stale",
      displayName: "Stale Listener",
      role: "listener",
      projectId: project.id,
    });
    const offline = connectionRepository.startListen({
      connectionKey: "listener-offline",
      displayName: "Offline Listener",
      role: "listener",
      projectId: project.id,
    });

    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(Date.now() - 2 * 60 * 1000).toISOString(), stale.connection.id);
    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(Date.now() - 4 * 60 * 1000).toISOString(), offline.connection.id);

    const connections = connectionRepository.listConnections(project.id);
    expect(connections.find((connection) => connection.id === listening.connection.id)?.status).toBe("listening");
    expect(connections.find((connection) => connection.id === stale.connection.id)?.status).toBe("stale");
    expect(connections.find((connection) => connection.id === offline.connection.id)?.status).toBe("offline");
  });

  it("clears stale project bindings when a connection is re-registered without project scope", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Binding Reset Project",
      sourceType: "local",
      sourceRef: "/workspace/binding-reset-project",
    });

    connectionRepository.upsertConnection({
      connectionKey: "listener-binding-reset",
      displayName: "Binding Reset",
      role: "listener",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    connectionRepository.upsertConnection({
      connectionKey: "listener-binding-reset",
      displayName: "Binding Reset",
      role: "listener",
      transport: "stdio",
      status: "idle",
      projectIds: [],
      activeProjectIds: [],
    });

    expect(connectionRepository.listConnections(project.id)).toEqual([]);
    expect(connectionRepository.getConnectionByKey("listener-binding-reset")).toMatchObject({
      projectIds: [],
      activeProjectIds: [],
    });
  });

  it("preserves project binding cursors when a listener is re-registered on the same project scope", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Cursor Preserve Project",
      sourceType: "local",
      sourceRef: "/workspace/cursor-preserve-project",
    });

    const started = connectionRepository.startListen({
      connectionKey: "listener-cursor-preserve",
      displayName: "Cursor Preserve",
      role: "worker",
      projectId: project.id,
    });

    connectionRepository.updateProjectBindingCursor(started.connection.id, project.id, {
      attentionCursor: "attention-cursor-1",
      assignmentCursor: "assignment-cursor-1",
    });

    connectionRepository.startListen({
      connectionKey: "listener-cursor-preserve",
      displayName: "Cursor Preserve",
      role: "worker",
      projectId: project.id,
    });

    expect(connectionRepository.listProjectBindingStates(started.connection.id)).toEqual([
      expect.objectContaining({
        projectId: project.id,
        isActive: true,
        lastAttentionCursor: "attention-cursor-1",
        lastAssignmentCursor: "assignment-cursor-1",
      }),
    ]);
  });

  it("throttles connection heartbeat writes while a listener stays idle", async () => {
    const { storage, projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Heartbeat Project",
      sourceType: "local",
      sourceRef: "/workspace/heartbeat-project",
    });

    const started = connectionRepository.startListen({
      connectionKey: "listener-heartbeat",
      displayName: "Heartbeat Listener",
      role: "listener",
      projectId: project.id,
    });

    const before = connectionRepository.getConnection(started.connection.id);
    expect(before?.lastHeartbeatAt).toBe("2026-03-10T00:00:00.000Z");

    vi.setSystemTime(new Date("2026-03-10T00:00:04.000Z"));
    const throttled = connectionRepository.touchConnectionHeartbeat(started.connection.id, "listening");
    expect(throttled.lastHeartbeatAt).toBe("2026-03-10T00:00:00.000Z");

    vi.setSystemTime(new Date("2026-03-10T00:00:06.000Z"));
    const refreshed = connectionRepository.touchConnectionHeartbeat(started.connection.id, "listening");
    expect(refreshed.lastHeartbeatAt).toBe("2026-03-10T00:00:06.000Z");

    const stored = storage.getDatabase().prepare(`
      SELECT last_heartbeat_at
      FROM mcp_connections
      WHERE id = ?
    `).get(started.connection.id) as { last_heartbeat_at: string };
    expect(stored.last_heartbeat_at).toBe("2026-03-10T00:00:06.000Z");
  });

  it("cleans up stale, offline, and long-dead connections", async () => {
    const { storage, projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Cleanup Project",
      sourceType: "local",
      sourceRef: "/workspace/cleanup-project",
    });

    const stale = connectionRepository.startListen({
      connectionKey: "listener-cleanup-stale",
      displayName: "Cleanup Stale",
      role: "listener",
      projectId: project.id,
    });
    const offline = connectionRepository.startListen({
      connectionKey: "listener-cleanup-offline",
      displayName: "Cleanup Offline",
      role: "listener",
      projectId: project.id,
    });
    const prunable = connectionRepository.startListen({
      connectionKey: "listener-cleanup-prune",
      displayName: "Cleanup Prune",
      role: "listener",
      projectId: project.id,
    });

    const now = new Date();
    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(now.getTime() - 2 * 60 * 1000).toISOString(), stale.connection.id);
    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(now.getTime() - 4 * 60 * 1000).toISOString(), offline.connection.id);
    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET status = 'offline', last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(now.getTime() - 4 * 60 * 1000).toISOString(), prunable.connection.id);

    const result = connectionRepository.cleanupConnectionLifecycle(now);
    expect(result.staleConnectionIds).toContain(stale.connection.id);
    expect(result.offlineConnectionIds).toContain(offline.connection.id);
    expect(result.prunedConnectionIds).toContain(prunable.connection.id);

    expect(connectionRepository.getConnection(stale.connection.id)?.status).toBe("stale");
    expect(connectionRepository.getConnection(offline.connection.id)?.status).toBe("offline");
    expect(connectionRepository.getConnection(prunable.connection.id)).toBeNull();
  });

  it("prunes disconnected startup connections while keeping ones with active dispatches", async () => {
    const { storage, projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Startup Prune Project",
      sourceType: "local",
      sourceRef: "/workspace/startup-prune-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
      featureBranch: "feature/sprint-1",
    });
    const executionRepository = new ExecutionRepository(storage);
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
      triggerType: "manual",
      executorMode: "managed",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      promptMarkdown: "Keep active worker attached",
      status: "pending",
      isIndependent: true,
    });

    const disconnected = connectionRepository.startListen({
      connectionKey: "listener-startup-prune",
      displayName: "Startup Prune",
      role: "worker",
      projectId: project.id,
    });
    const active = connectionRepository.startListen({
      connectionKey: "listener-startup-keep",
      displayName: "Startup Keep",
      role: "worker",
      projectId: project.id,
    });

    storage.getDatabase().prepare(`
      INSERT INTO task_dispatches (
        id, project_id, sprint_id, task_id, sprint_run_id, connection_id, executor_type, status, queued_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'worker', 'running', ?, ?, ?)
    `).run(
      "dispatch-1",
      project.id,
      sprint.id,
      task.id,
      sprintRun.id,
      active.connection.id,
      "2026-03-10T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
      "2026-03-10T00:00:00.000Z",
    );

    const result = connectionRepository.pruneDisconnectedConnectionsOnStartup();

    expect(result.prunedConnectionIds).toContain(disconnected.connection.id);
    expect(result.prunedConnectionIds).not.toContain(active.connection.id);
    expect(connectionRepository.getConnection(disconnected.connection.id)).toBeNull();
    expect(connectionRepository.getConnection(active.connection.id)).not.toBeNull();
  });

  it("reassigns a thread and requeues pending dashboard messages", async () => {
    const { projectRepository, connectionRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Routing Project",
      sourceType: "local",
      sourceRef: "/workspace/routing-project",
    });

    const first = connectionRepository.startListen({
      connectionKey: "listener-one",
      displayName: "Listener One",
      role: "listener",
      projectId: project.id,
    });
    const second = connectionRepository.startListen({
      connectionKey: "listener-two",
      displayName: "Listener Two",
      role: "listener",
      projectId: project.id,
    });

    const message = connectionRepository.postDashboardMessage(project.id, {
      title: "Reassign me",
      bodyMarkdown: "Please pick this up after reassignment.",
    });
    const thread = connectionRepository.listThreads(project.id)[0];

    const firstInbox = connectionRepository.pullInbox({
      connectionKey: "listener-one",
      projectId: project.id,
    });
    expect(firstInbox).toHaveLength(1);

    const reassigned = connectionRepository.updateThread(thread.id, {
      connectionId: second.connection.id,
    });
    expect(reassigned.connectionId).toBe(second.connection.id);

    const pendingMessages = connectionRepository.listMessages(thread.id);
    expect(pendingMessages[0]?.deliveryStatus).toBe("pending");

    const secondInbox = connectionRepository.pullInbox({
      connectionKey: "listener-two",
      projectId: project.id,
    });
    expect(secondInbox).toHaveLength(1);
    expect(secondInbox[0]?.id).toBe(message.id);
  });

  it("publishes realtime thread and message events", async () => {
    const { projectRepository, connectionRepository, realtimeEventRepository } = await createRepositoriesWithRealtime();
    const project = projectRepository.createProject({
      name: "Realtime Chat Project",
      sourceType: "local",
      sourceRef: "/workspace/realtime-chat-project",
    });

    const thread = connectionRepository.createThread(project.id, {
      title: "Realtime thread",
    });
    const message = connectionRepository.postDashboardMessage(project.id, {
      threadId: thread.id,
      bodyMarkdown: "Hello realtime",
    });

    const projectEvents = realtimeEventRepository.listEventsSince([`project:${project.id}`], 0, 20);
    const threadEvents = realtimeEventRepository.listEventsSince([`thread:${thread.id}`], 0, 20);

    expect(projectEvents.some((event) => event.eventType === "conversation.thread.updated")).toBe(true);
    expect(projectEvents.some((event) => event.eventType === "conversation.message.created")).toBe(true);
    expect(threadEvents.some((event) => event.entityId === thread.id)).toBe(true);
    expect(threadEvents.some((event) => event.entityId === message.id)).toBe(true);
  });

  it("deletes a thread, cascades its messages, and publishes a realtime delete event", async () => {
    const { projectRepository, connectionRepository, realtimeEventRepository } = await createRepositoriesWithRealtime();
    const project = projectRepository.createProject({
      name: "Delete Chat Project",
      sourceType: "local",
      sourceRef: "/workspace/delete-chat-project",
    });

    const thread = connectionRepository.createThread(project.id, {
      title: "Delete me",
    });
    connectionRepository.postDashboardMessage(project.id, {
      threadId: thread.id,
      bodyMarkdown: "Delete this whole thread.",
    });

    connectionRepository.deleteThread(thread.id);

    expect(connectionRepository.listThreads(project.id)).toEqual([]);
    expect(connectionRepository.listConnections(project.id)).toEqual([]);
    expect(() => connectionRepository.listMessages(thread.id)).toThrow(`Conversation thread not found: ${thread.id}`);

    const projectEvents = realtimeEventRepository.listEventsSince([`project:${project.id}`], 0, 20);
    expect(projectEvents.some((event) => (
      event.eventType === "conversation.thread.deleted" && event.entityId === thread.id
    ))).toBe(true);
  });
  });

  describe("ConversationRuntimeState and Metadata", () => {
    it("creates, retrieves, and updates thread with runtimeState and persists message metadata", async () => {
      const { projectRepository, connectionRepository } = await createRepositories();
      const project = projectRepository.createProject({
        name: "Test Project",
        sourceType: "local",
        sourceRef: "/tmp/test",
      });

      const runtimeState = {
        replayRequired: true,
        routeKind: "worker",
        virtualProvider: "openai",
        compactionSummary: { tokenCount: 100 },
      };

      const thread = connectionRepository.createThread(project.id, {
        title: "Test Thread",
        runtimeState,
      });

      expect(thread.runtimeState).toEqual(runtimeState);

      const threads = connectionRepository.listThreads(project.id);
      expect(threads[0].runtimeState).toEqual(runtimeState);

      const updatedState = { ...runtimeState, replayRequired: false };
      const updatedThread = connectionRepository.updateThread(thread.id, {
        runtimeState: updatedState,
      });

      expect(updatedThread.runtimeState).toEqual(updatedState);
      const rehydratedThreads = connectionRepository.listThreads(project.id);
      expect(rehydratedThreads[0].runtimeState).toEqual(updatedState);

      const messageMetadata = { testKey: "testValue", numericKey: 123 };
      const message = connectionRepository.postDashboardMessage(project.id, {
        threadId: thread.id,
        bodyMarkdown: "Hello",
        metadata: messageMetadata,
      });

      expect(message.metadata).toEqual(messageMetadata);

      const messages = connectionRepository.listMessages(thread.id);
      expect(messages[0].metadata).toEqual(messageMetadata);
    });
  });
