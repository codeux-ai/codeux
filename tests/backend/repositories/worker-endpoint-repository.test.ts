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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-worker-endpoint-repo-"));
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
      endpointKey: "mcp:worker-endpoint-1",
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

  it("upserts external worker endpoints by stable connection key", async () => {
    const { workerEndpointRepository } = await createRepositories();

    const first = workerEndpointRepository.upsertExternalWorkerEndpoint({
      connectionKey: "cluster-worker-1",
      displayName: "Cluster Worker 1",
      transport: "streamable-http",
      projectIds: ["project-a", "project-b"],
      activeProjectIds: ["project-b"],
      capabilities: {
        canExecuteTasks: true,
        canSuperviseProjects: false,
      },
    });
    const second = workerEndpointRepository.upsertExternalWorkerEndpoint({
      connectionKey: "cluster-worker-1",
      displayName: "Cluster Worker 1B",
      transport: "streamable-http",
      projectIds: ["project-a"],
      activeProjectIds: ["project-a"],
      capabilities: {
        canExecuteTasks: false,
      },
    });

    expect(second.id).toBe(first.id);
    expect(second).toMatchObject({
      endpointKey: "mcp:cluster-worker-1",
      endpointType: "mcp_connection",
      displayName: "Cluster Worker 1B",
      status: "connected",
      connectionId: null,
      connectionKey: "cluster-worker-1",
      transport: "streamable-http",
      capabilities: {
        canExecuteTasks: false,
        canSuperviseProjects: true,
      },
    });
    expect(workerEndpointRepository.listWorkerEndpoints()).toHaveLength(1);
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

  it("creates and deletes ephemeral virtual CLI worker endpoints", async () => {
    const { workerEndpointRepository } = await createRepositories();

    const endpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:test-project:123",
      displayName: "Virtual Codex Worker",
      capabilities: {
        canSuperviseProjects: true,
        canExecuteTasks: true,
      },
    });

    expect(endpoint).toMatchObject({
      endpointType: "virtual_cli",
      endpointKey: "virtual:test-project:123",
      displayName: "Virtual Codex Worker",
      status: "connected",
      connectionId: null,
      transport: "internal",
    });
    expect(workerEndpointRepository.getWorkerEndpointByKey("virtual:test-project:123")?.id).toBe(endpoint.id);

    workerEndpointRepository.deleteWorkerEndpoint(endpoint.id);

    expect(workerEndpointRepository.getWorkerEndpoint(endpoint.id)).toBeNull();
  });
});
