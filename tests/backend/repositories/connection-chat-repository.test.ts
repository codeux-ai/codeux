import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";

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
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ConnectionChatRepository", () => {
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
    expect(messages[0].deliveryStatus).toBe("processed");
    expect(messages[1].bodyMarkdown).toContain("dependency ordering");

    const connections = connectionRepository.listConnections(project.id);
    expect(connections[0]).toMatchObject({
      pendingInboxCount: 0,
      threadCount: 1,
      messageCount: 2,
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
    `).run(new Date(Date.now() - 11 * 60 * 1000).toISOString(), stale.connection.id);
    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(Date.now() - 31 * 60 * 1000).toISOString(), offline.connection.id);

    const connections = connectionRepository.listConnections(project.id);
    expect(connections.find((connection) => connection.id === listening.connection.id)?.status).toBe("listening");
    expect(connections.find((connection) => connection.id === stale.connection.id)?.status).toBe("stale");
    expect(connections.find((connection) => connection.id === offline.connection.id)?.status).toBe("offline");
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
    `).run(new Date(now.getTime() - 11 * 60 * 1000).toISOString(), stale.connection.id);
    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(now.getTime() - 31 * 60 * 1000).toISOString(), offline.connection.id);
    storage.getDatabase().prepare(`
      UPDATE mcp_connections
      SET status = 'offline', last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000).toISOString(), prunable.connection.id);

    const result = connectionRepository.cleanupConnectionLifecycle(now);
    expect(result.staleConnectionIds).toContain(stale.connection.id);
    expect(result.offlineConnectionIds).toContain(offline.connection.id);
    expect(result.prunedConnectionIds).toContain(prunable.connection.id);

    expect(connectionRepository.getConnection(stale.connection.id)?.status).toBe("stale");
    expect(connectionRepository.getConnection(offline.connection.id)?.status).toBe("offline");
    expect(connectionRepository.getConnection(prunable.connection.id)).toBeNull();
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
});
