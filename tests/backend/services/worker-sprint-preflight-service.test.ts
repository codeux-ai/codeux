import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ConnectionChatRepository } from "../../../src/repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { WorkerSprintPreflightService } from "../../../src/services/worker-sprint-preflight-service.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

const tempDirs: string[] = [];

async function createFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-worker-preflight-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const connectionRepository = new ConnectionChatRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const execute = vi.fn().mockResolvedValue({ content: [] });

  const service = new WorkerSprintPreflightService(
    executionRepository,
    projectRepository,
    connectionRepository,
    { execute } as any,
    () => DEFAULT_DASHBOARD_SETTINGS,
  );

  return {
    projectRepository,
    connectionRepository,
    executionRepository,
    execute,
    service,
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("WorkerSprintPreflightService", () => {
  it("claims queued sprint preflight jobs with the project repo path and resumes the queued sprint run on completion", async () => {
    const { projectRepository, connectionRepository, executionRepository, execute, service } = await createFixture();
    const project = projectRepository.createProject({
      name: "Preflight Resume Project",
      sourceType: "local",
      sourceRef: "/workspace/preflight-resume",
      defaultBranch: "main",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mcp_worker",
      status: "queued",
    });
    executionRepository.createSprintPreflightJob({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
    });
    connectionRepository.upsertConnection({
      connectionKey: "worker-1",
      displayName: "Worker 1",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const claim = service.pullNextJob({
      connectionKey: "worker-1",
      projectId: project.id,
    });

    expect(claim?.executionContext.repoPath).toBe(project.baseDir);
    expect(claim?.executionContext.defaultBranch).toBe("main");
    expect(claim?.executionContext.featureBranch).toContain("sprint");

    service.updateJob({
      connectionKey: "worker-1",
      jobId: claim!.job.id,
      leaseToken: claim!.leaseToken,
      state: "COMPLETED",
      summaryMarkdown: "branch ready",
    });

    expect(execute).toHaveBeenCalledWith(expect.objectContaining({
      action: "orchestrate",
      project_id: project.id,
      sprint_id: sprint.id,
      existing_sprint_run_id: sprintRun.id,
      skip_branch_preflight: true,
      wait: true,
    }));
  });

  it("pauses the queued sprint run when preflight blocks", async () => {
    const { projectRepository, connectionRepository, executionRepository, service } = await createFixture();
    const project = projectRepository.createProject({
      name: "Preflight Blocked Project",
      sourceType: "local",
      sourceRef: "/workspace/preflight-blocked",
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 2",
      number: 2,
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "queued",
    });
    executionRepository.createSprintPreflightJob({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
    });
    connectionRepository.upsertConnection({
      connectionKey: "worker-2",
      displayName: "Worker 2",
      role: "worker",
      transport: "stdio",
      status: "listening",
      projectIds: [project.id],
      activeProjectIds: [project.id],
    });

    const claim = service.pullNextJob({
      connectionKey: "worker-2",
      projectId: project.id,
    });
    service.updateJob({
      connectionKey: "worker-2",
      jobId: claim!.job.id,
      leaseToken: claim!.leaseToken,
      state: "BLOCKED",
      errorMessage: "repo is not ready",
    });

    expect(executionRepository.getSprintRun(sprintRun.id)).toMatchObject({
      status: "paused",
    });
  });
});
