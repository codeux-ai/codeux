import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { WorkerEndpointRepository } from "../../../src/repositories/worker-endpoint-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  connectionRepository: ConnectionChatRepository;
  workerEndpointRepository: WorkerEndpointRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-worker-endpoint-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const workerEndpointRepository = new WorkerEndpointRepository(storage);

  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    connectionRepository: new ConnectionChatRepository(storage, undefined, workerEndpointRepository),
    workerEndpointRepository,
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("WorkerEndpointRepository", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  it("syncs MCP worker registrations into worker endpoints", async () => {
    const { projectRepository, connectionRepository, workerEndpointRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Endpoint Project",
      sourceType: "local",
      sourceRef: "/workspace/endpoint-project",
    });

    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-endpoint-1",
      displayName: "Worker Endpoint 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      capabilities: {
        workerCanExecuteTasks: false,
      },
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const endpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id);
    expect(endpoint).toMatchObject({
      endpointType: "mcp_connection",
      displayName: "Worker Endpoint 1",
      status: "connected",
      connectionId: worker.id,
      connectionKey: "worker-endpoint-1",
      transport: "stdio",
      capabilities: {
        canSuperviseProjects: true,
        canExecuteTasks: false,
      },
    });
  });

  it("removes synced worker endpoints when the connection stops being a worker", async () => {
    const { projectRepository, connectionRepository, workerEndpointRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Endpoint Removal Project",
      sourceType: "local",
      sourceRef: "/workspace/endpoint-removal-project",
    });

    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-endpoint-2",
      displayName: "Worker Endpoint 2",
      role: "worker",
      transport: "stdio",
      status: "connected",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    expect(workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id)).not.toBeNull();

    connectionRepository.updateConnection(worker.id, {
      role: "listener",
      status: "idle",
    });

    expect(workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id)).toBeNull();
  });

  it("derives stale worker endpoint status from heartbeat age", async () => {
    const { storage, projectRepository, connectionRepository, workerEndpointRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Endpoint Staleness Project",
      sourceType: "local",
      sourceRef: "/workspace/endpoint-staleness-project",
    });

    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-endpoint-stale",
      displayName: "Worker Endpoint Stale",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const endpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id);
    expect(endpoint?.status).toBe("connected");

    const staleAt = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    storage.getDatabase().prepare(`
      UPDATE worker_endpoints
      SET status = 'connected', last_heartbeat_at = ?
      WHERE connection_id = ?
    `).run(staleAt, worker.id);

    expect(workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id)?.status).toBe("stale");
  });
});
