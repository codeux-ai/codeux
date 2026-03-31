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
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../../src/repositories/settings-defaults.js";

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
    () => DEFAULT_DASHBOARD_SETTINGS,
  );

  return {
    storage,
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

  it("includes branch-aware continuation guidance for merge_conflict attention items", async () => {
    const {
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionRepository,
      service,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Merge Conflict Project",
      sourceType: "local",
      sourceRef: "/repo/merge-conflict-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T9",
      title: "Resolve conflict",
      promptMarkdown: "Handle the conflicting API updates.",
      status: "pending",
      isIndependent: true,
    });
    connectionRepository.startListen({
      connectionKey: "worker-delta",
      displayName: "Worker Delta",
      role: "worker",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const connection = connectionRepository.getConnectionByKey("worker-delta");
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
    projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");
    service.pullNextEvent({ connectionKey: "worker-delta" });

    projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint!.id,
      title: "Merge conflict for T9",
      summaryMarkdown: "Conflict needs worker resolution.",
      payload: {
        workerBranch: "worker/T9",
        featureBranch: "feature/sprint-1",
        conflictingBranches: {
          source: "worker/T9",
          target: "feature/sprint-1",
        },
      },
    });

    const event = service.pullNextEvent({
      connectionKey: "worker-delta",
    });

    expect(event?.kind).toBe("attention_item");
    expect(event?.continuation.instruction).toContain("worker/T9");
    expect(event?.continuation.instruction).toContain("feature/sprint-1");
    expect(event?.continuation.instruction).toContain("/repo/merge-conflict-project");
  });

  it("delivers sibling open attention items even when they share the same updated timestamp", async () => {
    const {
      storage,
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionRepository,
      service,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Timestamp Collision Project",
      sourceType: "local",
      sourceRef: "/repo/timestamp-collision-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
      featureBranch: "feature/sprint-1",
    });
    const firstTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      promptMarkdown: "First task",
      status: "pending",
      isIndependent: true,
    });
    const secondTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T2",
      title: "Task 2",
      promptMarkdown: "Second task",
      status: "pending",
      isIndependent: true,
    });
    connectionRepository.startListen({
      connectionKey: "worker-epsilon",
      displayName: "Worker Epsilon",
      role: "worker",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const connection = connectionRepository.getConnectionByKey("worker-epsilon");
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
    projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");
    service.pullNextEvent({ connectionKey: "worker-epsilon" });

    const first = projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: firstTask.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint!.id,
      title: "Merge conflict for T1",
      summaryMarkdown: "First conflict.",
    });
    const second = projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: secondTask.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint!.id,
      title: "Merge conflict for T2",
      summaryMarkdown: "Second conflict.",
    });
    const sameTimestamp = "2026-03-15T11:34:00.000Z";
    storage.getDatabase().prepare(`
      UPDATE project_attention_items
      SET opened_at = ?, updated_at = ?
      WHERE id IN (?, ?)
    `).run(sameTimestamp, sameTimestamp, first.id, second.id);

    const firstEvent = service.pullNextEvent({ connectionKey: "worker-epsilon" });
    const firstDeliveredItemId = firstEvent && "item" in firstEvent ? firstEvent.item.id : null;
    projectAttentionRepository.claimAttentionItem(firstDeliveredItemId!, {
      assignedWorkerEndpointId: workerEndpoint!.id,
      claimReason: "worker_started_investigation",
    });
    const secondEvent = service.pullNextEvent({ connectionKey: "worker-epsilon" });

    expect(firstEvent?.kind).toBe("attention_item");
    expect(secondEvent?.kind).toBe("attention_item");
    expect(firstEvent && "item" in firstEvent ? firstEvent.item.id : null).not.toBe(
      secondEvent && "item" in secondEvent ? secondEvent.item.id : null,
    );
  });

  it("re-delivers an open attention item even when the stored cursor has already advanced past it", async () => {
    const {
      storage,
      projectRepository,
      connectionRepository,
      workerEndpointRepository,
      projectWorkerAssignmentRepository,
      projectAttentionRepository,
      service,
    } = await createFixture();
    const project = projectRepository.createProject({
      name: "Stale Cursor Project",
      sourceType: "local",
      sourceRef: "/repo/stale-cursor-project",
    });
    connectionRepository.startListen({
      connectionKey: "worker-zeta",
      displayName: "Worker Zeta",
      role: "worker",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const connection = connectionRepository.getConnectionByKey("worker-zeta");
    const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
    projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");
    service.pullNextEvent({ connectionKey: "worker-zeta" });

    const item = projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      attentionType: "merge_conflict",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint!.id,
      title: "Merge conflict for T1",
      summaryMarkdown: "Conflict still open.",
    });
    storage.getDatabase().prepare(`
      UPDATE connection_project_bindings
      SET last_attention_cursor = ?
      WHERE connection_id = ? AND project_id = ?
    `).run("9999-12-31T23:59:59.999Z::zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", connection!.id, project.id);

    const event = service.pullNextEvent({ connectionKey: "worker-zeta" });

    expect(event?.kind).toBe("attention_item");
    expect(event && "item" in event ? event.item.id : null).toBe(item.id);
  });
  describe("Project Cache Verification", () => {
    it("respects assignment cursors when pulling from the project cache", async () => {
      const {
        projectRepository,
        connectionRepository,
        workerEndpointRepository,
        projectWorkerAssignmentRepository,
        service,
      } = await createFixture();
      const project = projectRepository.createProject({
        name: "Assignment Cursor Project",
        sourceType: "local",
        sourceRef: "/repo/assignment-cursor",
      });
      connectionRepository.startListen({
        connectionKey: "worker-cache-1",
        displayName: "Worker Cache 1",
        role: "worker",
        projectIds: [project.id],
        activeProjectIds: [project.id],
      });
      const connection = connectionRepository.getConnectionByKey("worker-cache-1");
      const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);

      const assignment = projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");

      const firstEvent = service.pullNextEvent({ connectionKey: "worker-cache-1" });
      const secondEvent = service.pullNextEvent({ connectionKey: "worker-cache-1" });

      expect(firstEvent?.kind).toBe("assignment_changed");
      expect(firstEvent && "assignment" in firstEvent ? firstEvent.assignment.assignmentId : null).toBe(assignment.id);
      expect(secondEvent).toBeNull();
    });

    it("enforces worker ownership using the project cache", async () => {
      const {
        projectRepository,
        connectionRepository,
        projectAttentionRepository,
        service,
      } = await createFixture();
      const project = projectRepository.createProject({
        name: "Worker Ownership Project",
        sourceType: "local",
        sourceRef: "/repo/worker-ownership",
      });

      connectionRepository.startListen({
        connectionKey: "worker-cache-2",
        displayName: "Worker Cache 2",
        role: "worker",
        projectIds: [project.id],
        activeProjectIds: [project.id],
      });

      projectAttentionRepository.openOrRefreshItem({
        projectId: project.id,
        attentionType: "merge_conflict",
        severity: "high",
        ownerType: "worker",
        title: "Conflict",
        summaryMarkdown: "A conflict.",
      });

      const event = service.pullNextEvent({ connectionKey: "worker-cache-2", includeAttentionItems: true });
      expect(event).toBeNull();
    });

    it("delivers attention items in the correct order using the project cache", async () => {
      const {
        projectRepository,
        connectionRepository,
        workerEndpointRepository,
        projectWorkerAssignmentRepository,
        projectAttentionRepository,
        service,
      } = await createFixture();
      const project = projectRepository.createProject({
        name: "Attention Ordering Project",
        sourceType: "local",
        sourceRef: "/repo/attention-ordering",
      });
      connectionRepository.startListen({
        connectionKey: "worker-cache-3",
        displayName: "Worker Cache 3",
        role: "worker",
        projectIds: [project.id],
        activeProjectIds: [project.id],
      });
      const connection = connectionRepository.getConnectionByKey("worker-cache-3");
      const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
      projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");

      service.pullNextEvent({ connectionKey: "worker-cache-3" });

      const sprint = projectRepository.createSprint(project.id, {
        name: "Sprint 1",
        number: 1,
        featureBranch: "feature/sprint-1",
      });
      const task1 = projectRepository.createTask(project.id, {
        sprintId: sprint.id,
        taskKey: "T1",
        title: "Task 1",
        promptMarkdown: "First task",
        status: "pending",
        isIndependent: true,
      });
      const firstItem = projectAttentionRepository.openOrRefreshItem({
        taskId: task1.id,
        projectId: project.id,
        attentionType: "merge_conflict",
        severity: "high",
        ownerType: "worker",
        assignedWorkerEndpointId: workerEndpoint!.id,
        title: "Conflict 1",
        summaryMarkdown: "A conflict.",
      });

      // to guarantee distinct ids
      await new Promise(r => setTimeout(r, 10));
      const task2 = projectRepository.createTask(project.id, {
        sprintId: sprint.id,
        taskKey: "T2",
        title: "Task 2",
        promptMarkdown: "Second task",
        status: "pending",
        isIndependent: true,
      });
      const secondItem = projectAttentionRepository.openOrRefreshItem({
        taskId: task2.id,
        projectId: project.id,
        attentionType: "merge_conflict",
        severity: "high",
        ownerType: "worker",
        assignedWorkerEndpointId: workerEndpoint!.id,
        title: "Conflict 2",
        summaryMarkdown: "Another conflict.",
      });

      const firstEvent = service.pullNextEvent({ connectionKey: "worker-cache-3", includeAttentionItems: true });
      expect(firstEvent?.kind).toBe("attention_item");
      expect(firstEvent && "item" in firstEvent ? firstEvent.item.id : null).toBe(firstItem.id);

      const itemId = firstEvent && "item" in firstEvent ? firstEvent.item.id : firstItem.id;
      if (!itemId) { throw new Error("No item id to claim"); }
      projectAttentionRepository.claimAttentionItem(itemId, {
        assignedWorkerEndpointId: workerEndpoint!.id,
        claimReason: "worker_started_investigation",
      });

      const secondEvent = service.pullNextEvent({ connectionKey: "worker-cache-3", includeAttentionItems: true });
      expect(secondEvent?.kind).toBe("attention_item");
      expect(secondEvent && "item" in secondEvent ? secondEvent.item.id : null).toBe(secondItem.id);
    });
  });
});
