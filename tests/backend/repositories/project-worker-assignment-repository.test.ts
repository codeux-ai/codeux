import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { WorkerEndpointRepository } from "../../../src/repositories/worker-endpoint-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { ProjectWorkerAssignmentService } from "../../../src/domain/workers/project-worker-assignment-service.js";

const tempDirs: string[] = [];

async function createRepositories() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-project-worker-assignment-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const workerEndpointRepository = new WorkerEndpointRepository(storage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);

  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    connectionRepository: new ConnectionChatRepository(storage, undefined, workerEndpointRepository),
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectWorkerAssignmentService: new ProjectWorkerAssignmentService(
      projectWorkerAssignmentRepository,
      workerEndpointRepository,
    ),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ProjectWorkerAssignmentRepository", () => {
  it("creates a primary assignment for a worker's first project and overflow for additional projects", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService,
    } = await createRepositories();
    const projectA = projectRepository.createProject({
      name: "Assignment Project A",
      sourceType: "local",
      sourceRef: "/workspace/assignment-project-a",
    });
    const projectB = projectRepository.createProject({
      name: "Assignment Project B",
      sourceType: "local",
      sourceRef: "/workspace/assignment-project-b",
    });

    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-assignment-1",
      displayName: "Worker Assignment 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [projectA.id, projectB.id],
      activeProjectIds: [projectA.id, projectB.id],
    });
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id);
    expect(workerEndpoint).not.toBeNull();

    projectWorkerAssignmentService.noteWorkerActivity(projectA.id, workerEndpoint!.id);
    projectWorkerAssignmentService.noteWorkerActivity(projectB.id, workerEndpoint!.id);

    expect(projectWorkerAssignmentRepository.listAssignmentsForProject(projectA.id, { activeOnly: true })[0]).toMatchObject({
      assignmentRole: "primary",
      workerDisplayName: "Worker Assignment 1",
    });
    expect(projectWorkerAssignmentRepository.listAssignmentsForProject(projectB.id, { activeOnly: true })[0]).toMatchObject({
      assignmentRole: "overflow",
      workerDisplayName: "Worker Assignment 1",
    });
  });

  it("promotes an overflow assignment to primary when no primary remains for the project", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService,
    } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Promotion Project",
      sourceType: "local",
      sourceRef: "/workspace/promotion-project",
    });

    const workerA = connectionRepository.upsertConnection({
      connectionKey: "worker-promotion-a",
      displayName: "Worker Promotion A",
      role: "worker",
      transport: "stdio",
      status: "connected",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const workerB = connectionRepository.upsertConnection({
      connectionKey: "worker-promotion-b",
      displayName: "Worker Promotion B",
      role: "worker",
      transport: "stdio",
      status: "connected",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const endpointA = workerEndpointRepository.getWorkerEndpointByConnectionId(workerA.id)!;
    const endpointB = workerEndpointRepository.getWorkerEndpointByConnectionId(workerB.id)!;

    projectWorkerAssignmentService.noteWorkerActivity(project.id, endpointA.id);
    const overflow = projectWorkerAssignmentService.noteWorkerActivity(project.id, endpointB.id);
    expect(overflow.assignmentRole).toBe("overflow");

    const primary = projectWorkerAssignmentRepository.listAssignmentsForProject(project.id, { activeOnly: true })
      .find((assignment) => assignment.assignmentRole === "primary");
    expect(primary?.workerEndpointId).toBe(endpointA.id);
    projectWorkerAssignmentRepository.releaseAssignment(primary!.id, "worker disconnected");

    const promoted = projectWorkerAssignmentService.noteWorkerActivity(project.id, endpointB.id);
    expect(promoted.assignmentRole).toBe("primary");
  });

  it("does not churn an existing assignment when ensuring the same worker/project binding", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentService,
    } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Ensure Project",
      sourceType: "local",
      sourceRef: "/workspace/ensure-project",
    });

    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-ensure-1",
      displayName: "Worker Ensure 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id)!;

    const first = projectWorkerAssignmentService.ensureWorkerAssignment(project.id, workerEndpoint.id);
    const second = projectWorkerAssignmentService.ensureWorkerAssignment(project.id, workerEndpoint.id);

    expect(second.id).toBe(first.id);
    expect(second.updatedAt).toBe(first.updatedAt);
    expect(second.lastAffinityAt).toBe(first.lastAffinityAt);
  });

  it("promotes a live worker to primary when the older primary has gone stale", async () => {
    const {
      storage,
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService,
    } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Stale Primary Project",
      sourceType: "local",
      sourceRef: "/workspace/stale-primary-project",
    });

    const staleWorker = connectionRepository.upsertConnection({
      connectionKey: "worker-stale-primary",
      displayName: "Stale Primary",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const liveWorker = connectionRepository.upsertConnection({
      connectionKey: "worker-live-primary",
      displayName: "Live Primary",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const staleEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(staleWorker.id)!;
    const liveEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(liveWorker.id)!;
    storage.getDatabase().prepare(`
      UPDATE worker_endpoints
      SET status = 'connected', last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(Date.now() - 2 * 60 * 1000).toISOString(), staleEndpoint.id);

    projectWorkerAssignmentRepository.createAssignment(project.id, staleEndpoint, "primary");
    const promoted = projectWorkerAssignmentService.ensureWorkerAssignment(project.id, liveEndpoint.id);

    expect(promoted.assignmentRole).toBe("primary");
  });
});
