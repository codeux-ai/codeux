import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import { ProjectAttentionRepository } from "../../../../src/repositories/project-attention-repository.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../../src/repositories/project-worker-assignment-repository.js";
import { WorkerEndpointRepository } from "../../../../src/repositories/worker-endpoint-repository.js";
import { WorkerListenEventService } from "../../../../src/domain/workers/worker-listen-event-service.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-listen-event-service-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const connectionRepository = new ConnectionChatRepository(storage);
  const workerEndpointRepository = new WorkerEndpointRepository(storage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
  const projectAttentionRepository = new ProjectAttentionRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const service = new WorkerListenEventService(
    connectionRepository,
    workerEndpointRepository,
    projectRepository,
    projectWorkerAssignmentRepository,
    projectAttentionRepository,
    executionRepository,
  );

  return {
    projectRepository,
    connectionRepository,
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectAttentionRepository,
    executionRepository,
    service,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("WorkerListenEventService", () => {
  it("delivers assignment_changed once per connection/project cursor", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      service,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Worker Event Project",
      sourceType: "local",
      sourceRef: "/repo/worker-event-project",
    });
    connectionRepository.startListen({
      connectionKey: "worker-alpha",
      displayName: "Worker Alpha",
      role: "worker",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const connection = connectionRepository.getConnectionByKey("worker-alpha");
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
    projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");

    const firstEvent = service.pullNextEvent({
      connectionKey: "worker-alpha",
    });
    const secondEvent = service.pullNextEvent({
      connectionKey: "worker-alpha",
    });

    expect(firstEvent?.kind).toBe("assignment_changed");
    expect(firstEvent && "assignment" in firstEvent ? firstEvent.assignment.assignmentRole : null).toBe("primary");
    expect(firstEvent && "project" in firstEvent ? firstEvent.project.repoPath : null).toBe("/repo/worker-event-project");
    expect(secondEvent).toBeNull();
  });

  it("delivers worker-owned attention items with repo context", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionRepository,
      service,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Attention Project",
      sourceType: "local",
      sourceRef: "/repo/attention-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      promptMarkdown: "Handle it",
      status: "pending",
      isIndependent: true,
    });
    connectionRepository.startListen({
      connectionKey: "worker-beta",
      displayName: "Worker Beta",
      role: "worker",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const connection = connectionRepository.getConnectionByKey("worker-beta");
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
    projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");
    service.pullNextEvent({ connectionKey: "worker-beta" });

    projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint!.id,
      title: "Merge required for T1",
      summaryMarkdown: "Task T1 needs merge handling.",
      payload: {
        repoPath: "/repo/attention-project",
      },
    });

    const event = service.pullNextEvent({
      connectionKey: "worker-beta",
    });

    expect(event?.kind).toBe("attention_item");
    expect(event && "item" in event ? event.item.attentionType : null).toBe("merge_required");
    expect(event && "project" in event ? event.project.featureBranch : null).toBe("feature/sprint-1");
    expect(event && "workingDirectoryHint" in event ? event.workingDirectoryHint : null).toBe("cd /repo/attention-project");
  });

  it("does not re-deliver a claimed attention item", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionRepository,
      service,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Claimed Attention Project",
      sourceType: "local",
      sourceRef: "/repo/claimed-attention-project",
    });
    connectionRepository.startListen({
      connectionKey: "worker-gamma",
      displayName: "Worker Gamma",
      role: "worker",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const connection = connectionRepository.getConnectionByKey("worker-gamma");
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
    projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");
    service.pullNextEvent({ connectionKey: "worker-gamma" });

    const item = projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint!.id,
      title: "Merge required",
      summaryMarkdown: "Needs merge handling",
    });

    const firstEvent = service.pullNextEvent({
      connectionKey: "worker-gamma",
    });
    projectAttentionRepository.claimAttentionItem(item.id, {
      assignedWorkerEndpointId: workerEndpoint!.id,
      claimReason: "worker_started_investigation",
    });
    const secondEvent = service.pullNextEvent({
      connectionKey: "worker-gamma",
    });

    expect(firstEvent?.kind).toBe("attention_item");
    expect(secondEvent).toBeNull();
  });
});
