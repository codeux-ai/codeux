import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { WorkerAttentionOutcomeService } from "../../../../src/domain/workers/worker-attention-outcome-service.js";
import { ProjectAttentionService } from "../../../../src/domain/workers/project-attention-service.js";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../../src/repositories/connection-chat-repository.js";
import { ProjectAttentionRepository } from "../../../../src/repositories/project-attention-repository.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../../src/repositories/project-worker-assignment-repository.js";
import { WorkerEndpointRepository } from "../../../../src/repositories/worker-endpoint-repository.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "worker-attention-outcome-service-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const connectionRepository = new ConnectionChatRepository(storage);
  const workerEndpointRepository = new WorkerEndpointRepository(storage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
  const projectAttentionRepository = new ProjectAttentionRepository(storage);
  const projectAttentionService = new ProjectAttentionService(
    projectAttentionRepository,
    projectWorkerAssignmentRepository,
  );
  const service = new WorkerAttentionOutcomeService(
    projectAttentionService,
    connectionRepository,
  );

  const project = projectRepository.createProject({
    name: "Attention Outcome Project",
    sourceType: "local",
    sourceRef: "/repo/attention-outcome-project",
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
    connectionKey: "worker-outcome-alpha",
    displayName: "Worker Outcome Alpha",
    role: "worker",
    projectIds: [project.id],
    activeProjectIds: [project.id],
  });
  const connection = connectionRepository.getConnectionByKey("worker-outcome-alpha");
  const workerEndpoint = workerEndpointRepository.getWorkerEndpointByConnectionId(connection!.id);
  projectWorkerAssignmentRepository.createAssignment(project.id, workerEndpoint!, "primary");

  return {
    projectRepository,
    connectionRepository,
    projectAttentionRepository,
    service,
    project,
    sprint,
    task,
    connection: connection!,
    workerEndpoint: workerEndpoint!,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("WorkerAttentionOutcomeService", () => {
  it("resolves a worker-owned item locally when the worker handled it", async () => {
    const {
      service,
      projectAttentionRepository,
      project,
      sprint,
      task,
      connection,
      workerEndpoint,
    } = await createFixture();
    const item = projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "worker_dispatch_blocked",
      severity: "medium",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint.id,
      title: "Dispatch blocked",
      summaryMarkdown: "Execution is blocked.",
    });
    projectAttentionRepository.claimAttentionItem(item.id, {
      assignedWorkerEndpointId: workerEndpoint.id,
      claimReason: "worker_started",
    });

    const result = service.reportOutcome({
      attentionItemId: item.id,
      workerEndpointId: workerEndpoint.id,
      connectionId: connection.id,
      outcome: "handled_locally",
      summaryMarkdown: "Recovered the execution path and resumed the run.",
    });

    expect(result.handoffItem).toBeNull();
    expect(result.threadId).toBeNull();
    expect(result.sourceItem).toMatchObject({
      id: item.id,
      status: "resolved",
      payload: expect.objectContaining({
        workerOutcome: "handled_locally",
        workerOutcomeSummaryMarkdown: "Recovered the execution path and resumed the run.",
      }),
    });
  });

  it("hands off a worker-owned item into a dashboard thread and human queue item", async () => {
    const {
      service,
      connectionRepository,
      projectAttentionRepository,
      project,
      sprint,
      task,
      connection,
      workerEndpoint,
    } = await createFixture();
    const item = projectAttentionRepository.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint.id,
      title: "Merge required",
      summaryMarkdown: "Feature branch cannot be merged automatically.",
      payload: {
        repoPath: "/repo/attention-outcome-project",
        workingDirectoryHint: "cd /repo/attention-outcome-project",
      },
    });
    projectAttentionRepository.claimAttentionItem(item.id, {
      assignedWorkerEndpointId: workerEndpoint.id,
      claimReason: "worker_started",
    });

    const result = service.reportOutcome({
      attentionItemId: item.id,
      workerEndpointId: workerEndpoint.id,
      connectionId: connection.id,
      outcome: "needs_human_escalation",
      summaryMarkdown: "The merge conflict requires an operator decision before the sprint can continue.",
    });

    expect(result.sourceItem).toMatchObject({
      id: item.id,
      status: "resolved",
      payload: expect.objectContaining({
        workerOutcome: "needs_human_escalation",
        handoffAttentionItemId: result.handoffItem?.id,
        handoffThreadId: result.threadId,
      }),
    });
    expect(result.handoffItem).toMatchObject({
      ownerType: "human",
      attentionType: "human_escalation_required",
      status: "open",
      payload: expect.objectContaining({
        sourceAttentionItemId: item.id,
        handoffThreadId: result.threadId,
      }),
    });
    expect(result.threadId).toBeTruthy();
    expect(result.threadMessageId).toBeTruthy();

    const threads = connectionRepository.listThreads(project.id);
    expect(threads).toHaveLength(1);
    expect(threads[0]).toMatchObject({
      id: result.threadId,
      connectionId: connection.id,
    });
    const messages = connectionRepository.listMessages(result.threadId!);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      id: result.threadMessageId,
      direction: "connection_to_dashboard",
      authorType: "system",
      deliveryStatus: "processed",
    });
    expect(messages[0].bodyMarkdown).toContain("Needs human escalation");
  });
});
