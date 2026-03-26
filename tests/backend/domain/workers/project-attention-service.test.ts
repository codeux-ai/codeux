import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../../src/repositories/connection-chat-repository.js";
import { ProjectAttentionRepository } from "../../../../src/repositories/project-attention-repository.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../../src/repositories/project-worker-assignment-repository.js";
import { WorkerEndpointRepository } from "../../../../src/repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentService } from "../../../../src/domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionService } from "../../../../src/domain/workers/project-attention-service.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "project-attention-service-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const workerEndpointRepository = new WorkerEndpointRepository(storage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
  const projectAttentionRepository = new ProjectAttentionRepository(storage);

  return {
    storage,
    projectRepository: new ProjectManagementRepository(storage),
    connectionRepository: new ConnectionChatRepository(storage, undefined, workerEndpointRepository),
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectAttentionRepository,
    projectAttentionService: new ProjectAttentionService(
      projectAttentionRepository,
      projectWorkerAssignmentRepository,
    ),
  };
}

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ProjectAttentionService", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00.000Z"));
  });

  it("falls back from a stale preferred worker to a live supervising worker", async () => {
    const {
      storage,
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Preferred Worker Fallback Project",
      sourceType: "local",
      sourceRef: "/workspace/preferred-worker-fallback-project",
    });

    const staleWorker = connectionRepository.startListen({
      connectionKey: "worker-preferred-stale",
      displayName: "Worker Preferred Stale",
      role: "worker",
      projectId: project.id,
    });
    const liveWorker = connectionRepository.startListen({
      connectionKey: "worker-preferred-live",
      displayName: "Worker Preferred Live",
      role: "worker",
      projectId: project.id,
    });

    const staleEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(staleWorker.connection.id)!;
    const liveEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(liveWorker.connection.id)!;

    projectWorkerAssignmentRepository.createAssignment(project.id, staleEndpoint, "primary");
    projectWorkerAssignmentRepository.createAssignment(project.id, liveEndpoint, "overflow");

    storage.getDatabase().prepare(`
      UPDATE worker_endpoints
      SET status = 'connected', last_heartbeat_at = ?
      WHERE id = ?
    `).run(new Date(Date.now() - 2 * 60 * 1000).toISOString(), staleEndpoint.id);

    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      preferredWorkerEndpointId: staleEndpoint.id,
      title: "Merge conflict for T5",
      summaryMarkdown: "Needs worker merge-conflict resolution.",
    });

    expect(item.assignedWorkerEndpointId).toBe(liveEndpoint.id);
  });

  it("leaves worker-owned attention unassigned when the project uses virtual workers", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionRepository,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Virtual Worker Attention Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-worker-attention-project",
    });
    const worker = connectionRepository.startListen({
      connectionKey: "virtual-worker-connected",
      displayName: "Connected Worker",
      role: "worker",
      projectId: project.id,
    });
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(worker.connection.id)!;
    projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint, "primary");

    const projectAttentionService = new ProjectAttentionService(
      projectAttentionRepository,
      projectWorkerAssignmentRepository,
      () => "VIRTUAL",
    );

    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      preferredWorkerEndpointId: workerEndpoint.id,
      title: "Merge conflict for T6",
      summaryMarkdown: "Should stay unassigned for the virtual worker runtime.",
    });

    expect(item.assignedWorkerEndpointId).toBeNull();
  });

  it("allows reclaiming a claimed worker item when the assigned worker is no longer active on the project", async () => {
    const {
      projectRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionService,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Reclaimable Worker Attention Project",
      sourceType: "local",
      sourceRef: "/workspace/reclaimable-worker-attention-project",
    });

    const assignmentService = new ProjectWorkerAssignmentService(
      projectWorkerAssignmentRepository,
      workerEndpointRepository,
    );
    const staleEndpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:stale",
      displayName: "Stale Virtual Worker",
      status: "connected",
      transport: "internal",
    });
    assignmentService.ensureWorkerAssignment(project.id, staleEndpoint.id);

    const item = projectAttentionService.openItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      title: "Merge conflict for T7",
      summaryMarkdown: "Originally claimed by a stale worker.",
    });
    projectAttentionService.claimItem(item.id, staleEndpoint.id, "initial_claim");

    assignmentService.releaseWorkerAssignment(project.id, staleEndpoint.id, "worker_gone");
    workerEndpointRepository.deleteWorkerEndpoint(staleEndpoint.id);

    const replacementEndpoint = workerEndpointRepository.createVirtualEndpoint({
      endpointKey: "virtual:replacement",
      displayName: "Replacement Virtual Worker",
      status: "connected",
      transport: "internal",
    });
    assignmentService.ensureWorkerAssignment(project.id, replacementEndpoint.id);

    const reclaimed = projectAttentionService.claimItem(item.id, replacementEndpoint.id, "reclaim_after_stale_assignment");
    expect(reclaimed.assignedWorkerEndpointId).toBe(replacementEndpoint.id);
    expect(reclaimed.status).toBe("claimed");
  });
});
