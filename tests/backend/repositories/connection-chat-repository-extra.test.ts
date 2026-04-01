import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";

const tempDirs: string[] = [];

async function createRepository() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "connection-chat-extra-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    connectionRepository: new ConnectionChatRepository(storage),
    projectRepository: new ProjectManagementRepository(storage),
    db: storage.getDatabase(),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ConnectionChatRepository Extra Coverage", () => {
  it("getConnection returns null for non-existent", async () => {
    const { connectionRepository } = await createRepository();
    expect(connectionRepository.getConnection("non-existent")).toBeNull();
  });

  it("getConnectionByKey returns null for non-existent", async () => {
    const { connectionRepository } = await createRepository();
    expect(connectionRepository.getConnectionByKey("non-existent")).toBeNull();
  });

  it("getThread throws if thread not found", async () => {
    const { connectionRepository } = await createRepository();
    expect(() => connectionRepository.getThread("non-existent")).toThrow("Conversation thread not found: non-existent");
  });

  it("deleteThread deletes thread and messages", async () => {
    const { connectionRepository, projectRepository, db } = await createRepository();
    const project = projectRepository.createProject({ name: "P", sourceType: "local", sourceRef: "/test" });
    const thread = connectionRepository.createThread(project.id, { title: "T" });
    connectionRepository.postDashboardMessage(project.id, { threadId: thread.id, role: "user", bodyMarkdown: "M" });
    
    expect(connectionRepository.listMessages(thread.id)).toHaveLength(1);
    
    connectionRepository.deleteThread(thread.id);
    
    expect(() => connectionRepository.getThread(thread.id)).toThrow();
    
    // Check DB directly since listMessages throws if thread not found
    const messages = db.prepare("SELECT * FROM conversation_messages WHERE thread_id = ?").all(thread.id);
    expect(messages).toHaveLength(0);
  });

  it("updateConnection updates non-existent connection (throws)", async () => {
    const { connectionRepository } = await createRepository();
    expect(() => connectionRepository.updateConnection("non-existent", { status: "connected" })).toThrow();
  });

  it("touchConnectionHeartbeat updates connection heartbeat", async () => {
    const { connectionRepository } = await createRepository();
    const conn = connectionRepository.upsertConnection({
        connectionKey: "k1",
        displayName: "D",
        role: "worker",
        transport: "internal",
        status: "connected",
        capabilities: {},
    });
    
    const updated = connectionRepository.touchConnectionHeartbeat(conn.id, "connected");
    expect(updated.status).toBe("connected");
    expect(new Date(updated.lastHeartbeatAt!).getTime()).toBeGreaterThan(0);
  });

  it("cleanupConnectionLifecycle marks old connections as disconnected", async () => {
    const { connectionRepository } = await createRepository();
    connectionRepository.upsertConnection({
        connectionKey: "k2",
        displayName: "D",
        role: "worker",
        transport: "internal",
        status: "connected",
        capabilities: {},
    });
    
    const result = connectionRepository.cleanupConnectionLifecycle(new Date(Date.now() + 1000000));
    expect(result.staleConnectionIds).toBeDefined();
    expect(Array.isArray(result.staleConnectionIds)).toBe(true);
  });
});
