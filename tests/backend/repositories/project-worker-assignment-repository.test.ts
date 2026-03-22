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

  it("promotes the selected worker connection to primary without mutating other project assignments", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectWorkerAssignmentService,
    } = await createRepositories();
    const projectA = projectRepository.createProject({
      name: "Preferred Worker Project A",
      sourceType: "local",
      sourceRef: "/workspace/preferred-worker-project-a",
    });
    const projectB = projectRepository.createProject({
      name: "Preferred Worker Project B",
      sourceType: "local",
      sourceRef: "/workspace/preferred-worker-project-b",
    });

    const workerA = connectionRepository.upsertConnection({
      connectionKey: "preferred-worker-a",
      displayName: "Preferred Worker A",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [projectA.id],
      activeProjectIds: [projectA.id],
    });
    const workerB = connectionRepository.upsertConnection({
      connectionKey: "preferred-worker-b",
      displayName: "Preferred Worker B",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [projectA.id],
      activeProjectIds: [projectA.id],
    });
    const workerC = connectionRepository.upsertConnection({
      connectionKey: "preferred-worker-c",
      displayName: "Preferred Worker C",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [projectB.id],
      activeProjectIds: [projectB.id],
    });

    const endpointA = workerEndpointRepository.getWorkerEndpointByConnectionId(workerA.id)!;
    const endpointB = workerEndpointRepository.getWorkerEndpointByConnectionId(workerB.id)!;
    const endpointC = workerEndpointRepository.getWorkerEndpointByConnectionId(workerC.id)!;

    projectWorkerAssignmentService.noteWorkerActivity(projectA.id, endpointA.id);
    projectWorkerAssignmentService.noteWorkerActivity(projectA.id, endpointB.id);
    projectWorkerAssignmentService.noteWorkerActivity(projectB.id, endpointC.id);

    const updatedProjectAAssignments = projectWorkerAssignmentService.setProjectPreferredWorker(projectA.id, {
      workerConnectionId: workerB.id,
    });

    expect(updatedProjectAAssignments.find((assignment) => assignment.assignmentRole === "primary")).toMatchObject({
      workerEndpointId: endpointB.id,
      workerDisplayName: "Preferred Worker B",
    });
    expect(updatedProjectAAssignments.filter((assignment) => assignment.assignmentRole === "overflow")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          workerEndpointId: endpointA.id,
          workerDisplayName: "Preferred Worker A",
        }),
      ]),
    );

    const projectBAssignments = projectWorkerAssignmentRepository.listAssignmentsForProject(projectB.id, { activeOnly: true });
    expect(projectBAssignments).toHaveLength(1);
    expect(projectBAssignments[0]).toMatchObject({
      workerEndpointId: endpointC.id,
      assignmentRole: "primary",
      workerDisplayName: "Preferred Worker C",
    });

    const refreshedOverflow = projectWorkerAssignmentService.noteWorkerActivity(projectA.id, endpointA.id);
    expect(refreshedOverflow.assignmentRole).toBe("overflow");
  });

  it("rejects selecting an offline worker endpoint as the preferred worker", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentService,
    } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Offline Preferred Worker Project",
      sourceType: "local",
      sourceRef: "/workspace/offline-preferred-worker-project",
    });

    const worker = connectionRepository.upsertConnection({
      connectionKey: "preferred-worker-offline",
      displayName: "Offline Preferred Worker",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const endpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(worker.id)!;
    workerEndpointRepository.updateWorkerEndpoint(endpoint.id, {
      status: "offline",
    });

    expect(() => projectWorkerAssignmentService.setProjectPreferredWorker(project.id, {
      workerEndpointId: endpoint.id,
    })).toThrow(`Preferred worker target is not live: ${endpoint.id}`);
  });

  it("clears the preferred worker by demoting the current primary to overflow", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentService,
    } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Clear Preferred Worker Project",
      sourceType: "local",
      sourceRef: "/workspace/clear-preferred-worker-project",
    });

    const workerA = connectionRepository.upsertConnection({
      connectionKey: "clear-preferred-worker-a",
      displayName: "Clear Preferred Worker A",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const workerB = connectionRepository.upsertConnection({
      connectionKey: "clear-preferred-worker-b",
      displayName: "Clear Preferred Worker B",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const endpointA = workerEndpointRepository.getWorkerEndpointByConnectionId(workerA.id)!;
    const endpointB = workerEndpointRepository.getWorkerEndpointByConnectionId(workerB.id)!;

    projectWorkerAssignmentService.noteWorkerActivity(project.id, endpointA.id);
    projectWorkerAssignmentService.noteWorkerActivity(project.id, endpointB.id);

    const clearedAssignments = projectWorkerAssignmentService.setProjectPreferredWorker(project.id, {
      workerConnectionId: null,
    });

    expect(clearedAssignments.find((assignment) => assignment.assignmentRole === "primary") || null).toBeNull();
    expect(clearedAssignments.filter((assignment) => assignment.assignmentRole === "overflow")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ workerEndpointId: endpointA.id }),
        expect.objectContaining({ workerEndpointId: endpointB.id }),
      ]),
    );
  });
});
