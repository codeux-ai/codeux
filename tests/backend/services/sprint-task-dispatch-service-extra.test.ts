import { describe, expect, it, vi } from "vitest";
import { SprintTaskDispatchService } from "../../../src/services/sprint-task-dispatch-service.js";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { TaskService } from "../../../src/services/task-service.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-dispatch-extra-"));
  const appStorage = new AppDbStorage(path.join(dir, "app.db"));
  const projectManagementRepository = new ProjectManagementRepository(appStorage);
  const executionRepository = new ExecutionRepository(appStorage);
  const taskService = {
    selectProviderForTask: vi.fn().mockReturnValue("codex"),
    selectCliProviderForTask: vi.fn().mockReturnValue("codex"),
    startSprintTask: vi.fn(),
  };

  const service = new SprintTaskDispatchService(
    executionRepository,
    projectManagementRepository,
    taskService as any,
  );

  return { dir, projectManagementRepository, executionRepository, taskService, service };
}

describe("SprintTaskDispatchService Extra Coverage", () => {
  it("startTask respects providerOverride", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    
    const project = projectManagementRepository.createProject({
      name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "S", number: 1 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "T",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        executorMode: "docker_cli",
        status: "running",
    });
    
    taskService.startSprintTask.mockResolvedValue({ id: "sess-1", name: "session-1", provider: "override-provider" });

    const result = await service.startTask({
      task: { id: "T-1", record_id: task.id, provider: "override-provider" } as any,
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feat",
      repoPath: "/test",
      sprintNumber: 1,
    });

    expect(result.provider).toBe("override-provider");
    expect(taskService.selectCliProviderForTask).not.toHaveBeenCalled();
  });

  it("startTask handles jules executor", async () => {
    const { projectManagementRepository, executionRepository, taskService, service } = await createFixture();
    
    const project = projectManagementRepository.createProject({
      name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "S", number: 2 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "T",
      executorType: "jules",
    });
    const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        executorMode: "jules",
        status: "running",
    });
    
    taskService.startSprintTask.mockResolvedValue({ id: "sess-2", name: "session-2", provider: "jules" });

    const result = await service.startTask({
      task: { id: "T-2", record_id: task.id } as any,
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feat",
      repoPath: "/test",
      sprintNumber: 2,
    });

    expect(result.provider).toBe("jules");
  });

  it("startTask handles failure during session start", async () => {
    const { projectManagementRepository, taskService, service, executionRepository } = await createFixture();
    
    const project = projectManagementRepository.createProject({
      name: "P", sourceType: "local", sourceRef: "/test", defaultBranch: "main"
    });
    const sprint = projectManagementRepository.createSprint(project.id, { name: "S", number: 3 });
    const task = projectManagementRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "T",
      executorType: "docker_cli",
    });
    const sprintRun = executionRepository.createSprintRun({
        projectId: project.id,
        sprintId: sprint.id,
        executorMode: "docker_cli",
        status: "running",
    });
    
    taskService.startSprintTask.mockRejectedValue(new Error("Failed to start session"));

    await expect(service.startTask({
      task: { id: "T-3", record_id: task.id } as any,
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      featureBranch: "feat",
      repoPath: "/test",
      sprintNumber: 3,
    })).rejects.toThrow("Failed to start session");

    const dispatches = executionRepository.listTaskDispatches({ projectId: project.id });
    expect(dispatches[0].status).toBe("failed");
    expect(dispatches[0].errorMessage).toBe("Failed to start session");
  });

  it("requireTaskRecordId throws on missing id", async () => {
    const { service } = await createFixture();
    
    expect(() => (service as any).requireTaskRecordId({ id: "T" })).toThrow("Task T is missing its database record id.");
    expect(() => (service as any).requireTaskRecordId({ id: "T", record_id: "" })).toThrow("Task T is missing its database record id.");
  });

  it("resolveWorkerBranch and resolvePrUrl handle missing outputs", async () => {
    const { service } = await createFixture();
    
    expect((service as any).resolveWorkerBranch({})).toBeNull();
    expect((service as any).resolveWorkerBranch({ outputs: [] })).toBeNull();
    expect((service as any).resolveWorkerBranch({ outputs: [{}] })).toBeNull();
    
    expect((service as any).resolvePrUrl({})).toBeNull();
    expect((service as any).resolvePrUrl({ outputs: [] })).toBeNull();
    expect((service as any).resolvePrUrl({ outputs: [{}] })).toBeNull();
  });

  it("calculateDurationMs handles missing startedAt", async () => {
    const { service } = await createFixture();
    
    expect((service as any).calculateDurationMs({}, "2026-04-01T00:00:00Z")).toBeNull();
    expect((service as any).calculateDurationMs({ startedAt: "2026-04-01T00:00:00Z" }, "2026-04-01T00:00:01Z")).toBe(1000);
  });
});
