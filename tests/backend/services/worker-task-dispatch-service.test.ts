import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { WorkerEndpointRepository } from "../../../src/repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { ProjectWorkerAssignmentService } from "../../../src/domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { WorkerTaskDispatchService } from "../../../src/services/worker-task-dispatch-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-worker-dispatch-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const workerEndpointRepository = new WorkerEndpointRepository(storage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(storage);
  const projectAttentionRepository = new ProjectAttentionRepository(storage);
  const projectWorkerAssignmentService = new ProjectWorkerAssignmentService(
    projectWorkerAssignmentRepository,
    workerEndpointRepository,
  );
  const projectAttentionService = new ProjectAttentionService(
    projectAttentionRepository,
    projectWorkerAssignmentRepository,
  );
  const connectionRepository = new ConnectionChatRepository(storage, undefined, workerEndpointRepository);
  const executionRepository = new ExecutionRepository(storage);
  const workerService = new WorkerTaskDispatchService(
    executionRepository,
    projectRepository,
    connectionRepository,
    workerEndpointRepository,
    projectWorkerAssignmentService,
    projectAttentionService,
    (scope) => {
      const settings = { ...DEFAULT_DASHBOARD_SETTINGS };
      if (scope?.projectId) {
        const project = projectRepository.getProject(scope.projectId);
        if (project?.defaultBranch) {
          settings.git = { ...settings.git, defaultBranch: project.defaultBranch };
        }
      }
      return settings;
    },
  );

  return {
    storage,
    projectRepository,
    connectionRepository,
    executionRepository,
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectAttentionRepository,
    workerService,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("WorkerTaskDispatchService", () => {
  it("claims queued worker dispatches and completes them through the shared runtime model", async () => {
    const { projectRepository, connectionRepository, executionRepository, workerService } = await createFixture();
    const project = projectRepository.createProject({
      name: "Worker Flow Project",
      sourceType: "local",
      sourceRef: "/workspace/worker-flow",
      defaultBranch: "main",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Worker Flow Sprint",
      number: 5,
      featureBranch: "feature/sprint-5",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Execute via worker",
      promptMarkdown: "Use the connected worker path.",
      executorType: "mcp_worker",
      priority: "critical",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-09T10:00:00.000Z",
    });

    connectionRepository.upsertConnection({
      connectionKey: "worker-claim-1",
      displayName: "Worker Claim 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const claim = workerService.pullNextDispatch({
      connectionKey: "worker-claim-1",
      projectId: project.id,
    });

    expect(claim).not.toBeNull();
    expect(claim?.dispatch).toMatchObject({
      id: dispatch.id,
      status: "running",
    });
    expect(claim?.task).toMatchObject({
      id: task.id,
      executorType: "mcp_worker",
      title: "Execute via worker",
    });
    expect(claim?.executionContext).toMatchObject({
      repoPath: "/workspace/worker-flow",
      featureBranch: "feature/sprint-5",
      defaultBranch: "main",
    });

    const completed = workerService.updateDispatch({
      connectionKey: "worker-claim-1",
      dispatchId: dispatch.id,
      leaseToken: claim?.leaseToken || "",
      state: "COMPLETED",
      sessionId: "worker-session-1",
      sessionName: "workers/worker-session-1",
      provider: "codex",
      workerBranch: "worker/feature-sprint-5",
      prUrl: "https://example.com/pr/123",
      summaryMarkdown: "Worker completed the implementation.",
    });

    expect(completed).toMatchObject({
      controlAction: null,
      dispatch: {
        id: dispatch.id,
        status: "completed",
      },
    });

    const updatedTask = projectRepository.getTask(task.id);
    expect(updatedTask?.status).toBe("coding_completed");

    const updatedRun = executionRepository.getTaskRunByDispatchId(dispatch.id);
    expect(updatedRun).toMatchObject({
      connectionId: claim?.dispatch.connectionId,
      state: "COMPLETED",
      prUrl: "https://example.com/pr/123",
      sessionId: "worker-session-1",
    });

    expect(executionRepository.getLease("task_dispatch", dispatch.id)).toBeNull();
  });

  it("does not let connected workers claim dispatches on virtual-worker projects", async () => {
    const { storage, projectRepository, connectionRepository, executionRepository } = await createFixture();
    const project = projectRepository.createProject({
      name: "Virtual Worker Mode Project",
      sourceType: "local",
      sourceRef: "/workspace/virtual-worker-mode",
      defaultBranch: "main",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Virtual Worker Sprint",
      number: 7,
      featureBranch: "feature/sprint-7",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Reserved for virtual worker",
      promptMarkdown: "A connected worker should not claim this dispatch.",
      executorType: "mcp_worker",
      priority: "high",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-09T10:00:00.000Z",
    });
    connectionRepository.upsertConnection({
      connectionKey: "worker-virtual-mode-1",
      displayName: "Worker Virtual Mode 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const gatedWorkerService = new WorkerTaskDispatchService(
      executionRepository,
      projectRepository,
      connectionRepository,
      new WorkerEndpointRepository(storage),
      new ProjectWorkerAssignmentService(
        new ProjectWorkerAssignmentRepository(storage),
        new WorkerEndpointRepository(storage),
      ),
      new ProjectAttentionService(
        new ProjectAttentionRepository(storage),
        new ProjectWorkerAssignmentRepository(storage),
      ),
      () => DEFAULT_DASHBOARD_SETTINGS,
      () => "VIRTUAL",
    );

    const claim = gatedWorkerService.pullNextDispatch({
      connectionKey: "worker-virtual-mode-1",
      projectId: project.id,
    });

    expect(claim).toBeNull();
    expect(executionRepository.getTaskDispatch(dispatch.id)?.status).toBe("queued");
  });

  it("prefers the worker's sticky project affinity when listening across multiple projects", async () => {
    const {
      projectRepository,
      connectionRepository,
      executionRepository,
      projectWorkerAssignmentRepository,
      workerService,
    } = await createFixture();
    const projectA = projectRepository.createProject({
      name: "Multi Project A",
      sourceType: "local",
      sourceRef: "/workspace/multi-project-a",
      defaultBranch: "main",
    });
    const projectB = projectRepository.createProject({
      name: "Multi Project B",
      sourceType: "local",
      sourceRef: "/workspace/multi-project-b",
      defaultBranch: "develop",
    });
    const sprintA = projectRepository.createSprint(projectA.id, {
      name: "Sprint A",
      number: 1,
    });
    const sprintB = projectRepository.createSprint(projectB.id, {
      name: "Sprint B",
      number: 2,
    });
    const taskA = projectRepository.createTask(projectA.id, {
      sprintId: sprintA.id,
      title: "Queued task on project A",
      promptMarkdown: "Handle project A",
      executorType: "mcp_worker",
      priority: "high",
    });
    const taskB = projectRepository.createTask(projectB.id, {
      sprintId: sprintB.id,
      title: "Queued task on project B",
      promptMarkdown: "Handle project B",
      executorType: "mcp_worker",
      priority: "critical",
    });
    const historicalTaskB = projectRepository.createTask(projectB.id, {
      sprintId: sprintB.id,
      title: "Historical task on project B",
      promptMarkdown: "Existing worker context lives here",
      executorType: "mcp_worker",
      priority: "medium",
    });
    const sprintRunA = executionRepository.createSprintRun({
      projectId: projectA.id,
      sprintId: sprintA.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const sprintRunB = executionRepository.createSprintRun({
      projectId: projectB.id,
      sprintId: sprintB.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const worker = connectionRepository.upsertConnection({
      connectionKey: "worker-sticky-1",
      displayName: "Worker Sticky 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [projectA.id, projectB.id],
      activeProjectIds: [projectA.id, projectB.id],
    });

    const historicalDispatch = executionRepository.createTaskDispatch({
      projectId: projectB.id,
      sprintId: sprintB.id,
      taskId: historicalTaskB.id,
      sprintRunId: sprintRunB.id,
      executorType: "mcp_worker",
      connectionId: worker.id,
      status: "running",
    });
    executionRepository.createTaskRun({
      projectId: projectB.id,
      sprintId: sprintB.id,
      taskId: historicalTaskB.id,
      sprintRunId: sprintRunB.id,
      dispatchId: historicalDispatch.id,
      connectionId: worker.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-12T09:00:00.000Z",
    });
    executionRepository.updateTaskDispatch(historicalDispatch.id, {
      claimedAt: "2026-03-12T09:00:00.000Z",
      startedAt: "2026-03-12T09:01:00.000Z",
      lastHeartbeatAt: "2026-03-12T09:10:00.000Z",
    });

    const dispatchA = executionRepository.createTaskDispatch({
      projectId: projectA.id,
      sprintId: sprintA.id,
      taskId: taskA.id,
      sprintRunId: sprintRunA.id,
      executorType: "mcp_worker",
      priority: 100,
    });
    executionRepository.createTaskRun({
      projectId: projectA.id,
      sprintId: sprintA.id,
      taskId: taskA.id,
      sprintRunId: sprintRunA.id,
      dispatchId: dispatchA.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-12T09:30:00.000Z",
    });

    const dispatchB = executionRepository.createTaskDispatch({
      projectId: projectB.id,
      sprintId: sprintB.id,
      taskId: taskB.id,
      sprintRunId: sprintRunB.id,
      executorType: "mcp_worker",
      priority: 10,
    });
    executionRepository.createTaskRun({
      projectId: projectB.id,
      sprintId: sprintB.id,
      taskId: taskB.id,
      sprintRunId: sprintRunB.id,
      dispatchId: dispatchB.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-12T09:31:00.000Z",
    });

    const claim = workerService.pullNextDispatch({
      connectionKey: "worker-sticky-1",
    });

    expect(claim).not.toBeNull();
    expect(claim?.dispatch.id).toBe(dispatchB.id);
    expect(claim?.project.id).toBe(projectB.id);
    expect(claim?.executionContext).toMatchObject({
      repoPath: "/workspace/multi-project-b",
      defaultBranch: "develop",
    });
    expect(executionRepository.getTaskDispatch(dispatchA.id)?.status).toBe("queued");
    expect(projectWorkerAssignmentRepository.listAssignmentsForProject(projectB.id, { activeOnly: true })[0]).toMatchObject({
      assignmentRole: "primary",
      workerDisplayName: "Worker Sticky 1",
    });
  });

  it("rejects worker dispatch claims when the worker endpoint cannot execute tasks", async () => {
    const { projectRepository, connectionRepository, executionRepository, workerService } = await createFixture();
    const project = projectRepository.createProject({
      name: "Execution Disabled Project",
      sourceType: "local",
      sourceRef: "/workspace/execution-disabled-project",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Execution Disabled Sprint",
      number: 3,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Should not be claimed",
      promptMarkdown: "This worker endpoint is supervision only.",
      executorType: "mcp_worker",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-12T10:00:00.000Z",
    });

    connectionRepository.upsertConnection({
      connectionKey: "worker-supervisor-only-1",
      displayName: "Worker Supervisor Only 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      capabilities: {
        workerCanExecuteTasks: false,
      },
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    expect(() => workerService.pullNextDispatch({
      connectionKey: "worker-supervisor-only-1",
      projectId: project.id,
    })).toThrow("cannot execute task dispatches");

    expect(executionRepository.getTaskDispatch(dispatch.id)?.status).toBe("queued");
  });

  it("opens a project attention item when the worker reports a blocked dispatch", async () => {
    const { projectRepository, connectionRepository, executionRepository, projectAttentionRepository, workerService } = await createFixture();
    const project = projectRepository.createProject({
      name: "Blocked Attention Project",
      sourceType: "local",
      sourceRef: "/workspace/blocked-attention-project",
      defaultBranch: "main",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Blocked Attention Sprint",
      number: 7,
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Escalate blocked worker task",
      promptMarkdown: "Needs worker supervision if blocked.",
      executorType: "mcp_worker",
      priority: "critical",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "mcp_worker",
      state: "RUNNING",
      startedAt: "2026-03-12T10:00:00.000Z",
    });

    connectionRepository.upsertConnection({
      connectionKey: "worker-blocked-1",
      displayName: "Worker Blocked 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const claim = workerService.pullNextDispatch({
      connectionKey: "worker-blocked-1",
      projectId: project.id,
    });

    workerService.updateDispatch({
      connectionKey: "worker-blocked-1",
      dispatchId: dispatch.id,
      leaseToken: claim?.leaseToken || "",
      state: "BLOCKED",
      provider: "codex",
      errorMessage: "Merge conflict requires attention.",
    });

    expect(projectAttentionRepository.listProjectAttentionItems(project.id, { statuses: ["open"] })[0]).toMatchObject({
      dispatchId: dispatch.id,
      attentionType: "worker_dispatch_blocked",
      ownerType: "worker",
      summaryMarkdown: "Merge conflict requires attention.",
    });
  });

  it("prioritizes dashboard settings for defaultBranch over project metadata", async () => {
    const { storage, projectRepository, connectionRepository, executionRepository } = await createFixture();
    const project = projectRepository.createProject({
      name: "Override Project",
      sourceType: "local",
      sourceRef: "/repo",
      defaultBranch: "main", // Metadata says main
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task",
      executorType: "mcp_worker",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "running",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "mcp_worker",
    });
    executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      mode: "mcp_worker",
      state: "RUNNING",
    });

    connectionRepository.upsertConnection({
      connectionKey: "worker-override-1",
      displayName: "Worker Override 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const overrideWorkerService = new WorkerTaskDispatchService(
      executionRepository,
      projectRepository,
      connectionRepository,
      new WorkerEndpointRepository(storage),
      new ProjectWorkerAssignmentService(new ProjectWorkerAssignmentRepository(storage), new WorkerEndpointRepository(storage)),
      new ProjectAttentionService(new ProjectAttentionRepository(storage), new ProjectWorkerAssignmentRepository(storage)),
      (scope) => {
        if (scope?.projectId === project.id) {
          return {
            ...DEFAULT_DASHBOARD_SETTINGS,
            git: { ...DEFAULT_DASHBOARD_SETTINGS.git, defaultBranch: "dev" }, // Dashboard says dev
          };
        }
        return DEFAULT_DASHBOARD_SETTINGS;
      }
    );

    const claim = overrideWorkerService.pullNextDispatch({
      connectionKey: "worker-override-1",
      projectId: project.id,
    });

    expect(claim?.executionContext.defaultBranch).toBe("dev");
    expect(claim?.project.defaultBranch).toBe("main"); // Project metadata remains "main"
  });
});
