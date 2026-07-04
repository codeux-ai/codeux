import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ActiveDispatchRegistry } from "../../../src/services/active-dispatch-registry.js";
import { ExecutionInvocationControlService } from "../../../src/services/execution-invocation-control-service.js";

vi.mock("../../../src/services/cli-process-runner.js", () => ({
  runCommandStrict: vi.fn(),
}));

import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

const tempDirs: string[] = [];
const storages: AppDbStorage[] = [];

async function createFixture(): Promise<{
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  activeDispatchRegistry: ActiveDispatchRegistry;
  service: ExecutionInvocationControlService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-invocation-control-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  storages.push(storage);
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const activeDispatchRegistry = new ActiveDispatchRegistry();
  const service = new ExecutionInvocationControlService({
    executionRepository,
    projectManagementRepository: projectRepository,
    activeDispatchRegistry,
  });

  return { storage, projectRepository, executionRepository, activeDispatchRegistry, service };
}

beforeEach(() => {
  vi.mocked(runCommandStrict).mockImplementation(async (_command, args) => {
    if (args[0] === "ps") {
      return { ok: true, code: 0, stdout: "container-1\n", stderr: "", signal: null } as any;
    }
    return { ok: true, code: 0, stdout: "", stderr: "", signal: null } as any;
  });
});

afterEach(async () => {
  vi.clearAllMocks();
  try {
    for (const storage of storages.splice(0)) {
      storage.close();
    }
  } finally {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
});

describe("ExecutionInvocationControlService", () => {
  it("cancels a running invocation and kills its Docker session container", async () => {
    const { projectRepository, executionRepository, activeDispatchRegistry, service } = await createFixture();
    const project = projectRepository.createProject({
      name: "Invocation Cancel Project",
      sourceType: "local",
      sourceRef: "/workspace/invocation-cancel",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Cancel Sprint", number: 1 });
    const task = projectRepository.createTask(project.id, { sprintId: sprint.id, title: "Cancel invocation" });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      executorType: "docker_cli",
      status: "running",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      state: "RUNNING",
      sessionId: "session-1",
      startedAt: "2026-07-02T10:00:00.000Z",
    });
    const providerInvocation = executionRepository.createProviderInvocationUsage({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      sessionId: "session-1",
      provider: "codex",
      purpose: "task_coding",
      status: "running",
      executionMode: "DOCKER",
      startedAt: "2026-07-02T10:00:00.000Z",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      sprintRunId: sprintRun.id,
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      providerInvocationId: providerInvocation.id,
      type: "task_coding",
      status: "running",
      provider: "codex",
      startedAt: "2026-07-02T10:00:00.000Z",
    });
    const requestStop = vi.fn().mockResolvedValue({ accepted: true });
    activeDispatchRegistry.register({
      dispatchId: dispatch.id,
      taskRunId: taskRun.id,
      sessionId: "session-1",
      executorType: "docker_cli",
      requestStop,
    });

    const result = await service.cancelInvocation(invocation.id);

    expect(result).toMatchObject({
      cancelled: true,
      invocationId: invocation.id,
      stoppedContainerIds: ["container-1"],
    });
    expect(requestStop).toHaveBeenCalledWith("Invocation cancelled from Chat -> Invocations.");
    expect(runCommandStrict).toHaveBeenCalledWith("docker", [
      "ps",
      "--filter",
      "label=code-ux.session-id=session-1",
      "-q",
    ], process.cwd());
    expect(runCommandStrict).toHaveBeenCalledWith("docker", ["kill", "container-1"], process.cwd());
    expect(executionRepository.getExecutionInvocation(invocation.id)?.status).toBe("cancelled");
    expect(executionRepository.getProviderInvocationUsage(providerInvocation.id)?.status).toBe("cancelled");
    expect(executionRepository.getTaskDispatch(dispatch.id)).toMatchObject({
      status: "cancelled",
      errorMessage: "Invocation cancelled from Chat -> Invocations.",
    });
    expect(executionRepository.getTaskRun(taskRun.id)).toMatchObject({
      state: "BLOCKED",
    });
    expect(projectRepository.getTask(task.id)?.status).toBe("pending");
    expect(executionRepository.listExecutionInvocationMessages(invocation.id).at(-1)?.contentMarkdown)
      .toContain("Invocation cancelled from Chat -> Invocations.");
  });

  it("does not stop containers for terminal invocations", async () => {
    const { projectRepository, executionRepository, service } = await createFixture();
    const project = projectRepository.createProject({
      name: "Terminal Invocation Project",
      sourceType: "local",
      sourceRef: "/workspace/terminal-invocation",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      type: "planning",
      status: "completed",
      finishedAt: "2026-07-02T10:01:00.000Z",
    });

    const result = await service.cancelInvocation(invocation.id);

    expect(result).toMatchObject({
      cancelled: false,
      invocationId: invocation.id,
      message: "Invocation is already completed.",
    });
    expect(runCommandStrict).not.toHaveBeenCalled();
  });
});
