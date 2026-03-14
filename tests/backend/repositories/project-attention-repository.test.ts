import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { WorkerEndpointRepository } from "../../../src/repositories/worker-endpoint-repository.js";

describe("ProjectAttentionRepository", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  async function buildFixture() {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "project-attention-repo-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const connections = new ConnectionChatRepository(storage);
    const projects = new ProjectManagementRepository(storage);
    const execution = new ExecutionRepository(storage);
    const attention = new ProjectAttentionRepository(storage);
    const workers = new WorkerEndpointRepository(storage);

    const project = projects.createProject({
      name: "Project 1",
      sourceType: "local",
      sourceRef: "/repo/project-1",
    });
    const sprint = projects.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
      goal: "Ship it",
    });
    const task = projects.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      promptMarkdown: "Do it",
      status: "pending",
      isIndependent: true,
    });
    const sprintRun = execution.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "mcp",
      triggeredBy: "test",
      executorMode: "mixed",
      status: "running",
    });
    const dispatch = execution.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
      queuedAt: new Date().toISOString(),
    });

    return { attention, connections, workers, project, sprint, task, sprintRun, dispatch };
  }

  it("refreshes matching active attention items instead of duplicating them", async () => {
    const { attention, project, sprint, task, sprintRun, dispatch } = await buildFixture();

    const first = attention.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      attentionType: "worker_dispatch_blocked",
      severity: "medium",
      ownerType: "worker",
      title: "Blocked",
      summaryMarkdown: "First summary",
    });
    const refreshed = attention.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      attentionType: "worker_dispatch_blocked",
      severity: "high",
      ownerType: "worker",
      title: "Blocked",
      summaryMarkdown: "Updated summary",
    });

    const items = attention.listProjectAttentionItems(project.id);
    expect(items).toHaveLength(1);
    expect(refreshed.id).toBe(first.id);
    expect(items[0]).toMatchObject({
      id: first.id,
      severity: "high",
      summaryMarkdown: "Updated summary",
    });
  });

  it("resolves active attention items for a dispatch", async () => {
    const { attention, project, sprint, task, sprintRun, dispatch } = await buildFixture();
    attention.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      attentionType: "worker_dispatch_blocked",
      severity: "high",
      ownerType: "worker",
      title: "Blocked",
      summaryMarkdown: "Needs recovery",
    });

    const resolvedCount = attention.resolveAttentionItemsForDispatch(dispatch.id, {
      reason: "retry_requested",
    });

    expect(resolvedCount).toBe(1);
    const items = attention.listProjectAttentionItems(project.id, {
      statuses: ["resolved"],
    });
    expect(items[0]).toMatchObject({
      attentionType: "worker_dispatch_blocked",
      status: "resolved",
      payload: expect.objectContaining({
        resolutionReason: "retry_requested",
      }),
    });
  });

  it("resolves matching task-scoped attention items by type filter", async () => {
    const { attention, project, sprint, task, sprintRun } = await buildFixture();
    attention.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      attentionType: "merge_required",
      severity: "medium",
      ownerType: "worker",
      title: "Merge required",
      summaryMarkdown: "Awaiting merge",
    });
    attention.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      attentionType: "action_required",
      severity: "medium",
      ownerType: "human",
      title: "Action required",
      summaryMarkdown: "Needs operator input",
    });

    const resolvedCount = attention.resolveAttentionItems(
      {
        projectId: project.id,
        taskId: task.id,
        attentionTypes: ["merge_required"],
      },
      {
        reason: "merge_completed",
      },
    );

    expect(resolvedCount).toBe(1);
    const openItems = attention.listProjectAttentionItems(project.id, {
      statuses: ["open"],
    });
    expect(openItems).toHaveLength(1);
    expect(openItems[0].attentionType).toBe("action_required");
    const resolvedItems = attention.listProjectAttentionItems(project.id, {
      statuses: ["resolved"],
    });
    expect(resolvedItems[0]).toMatchObject({
      attentionType: "merge_required",
      payload: expect.objectContaining({
        resolutionReason: "merge_completed",
      }),
    });
  });

  it("claims worker-owned attention items and stamps claim metadata", async () => {
    const { attention, connections, workers, project, sprint, task, sprintRun } = await buildFixture();
    connections.startListen({
      connectionKey: "worker-alpha",
      displayName: "Worker Alpha",
      role: "worker",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });
    const connection = connections.getConnectionByKey("worker-alpha");
    const workerEndpoint = workers.getWorkerEndpointByConnectionId(connection!.id);
    const item = attention.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      attentionType: "merge_required",
      severity: "high",
      ownerType: "worker",
      assignedWorkerEndpointId: workerEndpoint!.id,
      title: "Merge required",
      summaryMarkdown: "Needs worker attention",
      payload: {
        repoPath: "/repo/project-1",
      },
    });

    const claimed = attention.claimAttentionItem(item.id, {
      assignedWorkerEndpointId: workerEndpoint!.id,
      claimReason: "worker_started_investigation",
    });

    expect(claimed).toMatchObject({
      id: item.id,
      status: "claimed",
      assignedWorkerEndpointId: workerEndpoint!.id,
      payload: expect.objectContaining({
        repoPath: "/repo/project-1",
        claimedByWorkerEndpointId: workerEndpoint!.id,
        claimReason: "worker_started_investigation",
      }),
    });
    expect(claimed.claimedAt).toBeTruthy();
  });

  it("resolves a single attention item with summary and resolver metadata", async () => {
    const { attention, project, sprint, task, sprintRun } = await buildFixture();
    const item = attention.openOrRefreshItem({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      attentionType: "action_required",
      severity: "medium",
      ownerType: "human",
      title: "Action required",
      summaryMarkdown: "Needs operator review",
      payload: {
        repoPath: "/repo/project-1",
      },
    });

    const resolved = attention.resolveAttentionItem(item.id, {
      status: "dismissed",
      reason: "handled_manually",
      resolutionSummaryMarkdown: "Operator handled this directly outside the queue.",
      resolvedByWorkerEndpointId: "worker-endpoint-9",
      payloadPatch: {
        workerOutcome: "needs_human_escalation",
      },
    });

    expect(resolved).toMatchObject({
      id: item.id,
      status: "dismissed",
      summaryMarkdown: "Operator handled this directly outside the queue.",
      payload: expect.objectContaining({
        repoPath: "/repo/project-1",
        resolutionReason: "handled_manually",
        resolvedByWorkerEndpointId: "worker-endpoint-9",
        workerOutcome: "needs_human_escalation",
      }),
    });
    expect(resolved.resolvedAt).toBeTruthy();
  });
});
