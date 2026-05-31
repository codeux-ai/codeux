import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../../src/repositories/project-worker-assignment-repository.js";
import { ProjectAttentionRepository } from "../../../src/repositories/project-attention-repository.js";
import { ProjectAttentionService } from "../../../src/domain/workers/project-attention-service.js";
import { ExecutionControlService } from "../../../src/services/execution-control-service.js";

const tempDirs: string[] = [];
const storages: AppDbStorage[] = [];

async function createFixture(): Promise<{
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  service: ExecutionControlService;
  executeOrchestrator: ReturnType<typeof vi.fn>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-sprint-pause-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  storages.push(storage);
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const executeOrchestrator = vi.fn().mockResolvedValue({ ok: true });

  const service = new ExecutionControlService({
    projectManagementRepository: projectRepository,
    executionRepository,
    projectAttentionService: new ProjectAttentionService(
      new ProjectAttentionRepository(storage),
      new ProjectWorkerAssignmentRepository(storage),
    ),
    taskRerunService: { rerunTask: vi.fn() } as any,
    sprintOrchestrator: { execute: executeOrchestrator, setConsecutiveFailures: vi.fn() } as any,
    julesApi: { sendSessionMessage: vi.fn().mockResolvedValue({ ok: true }) } as any,
    activeDispatchRegistry: { requestStop: vi.fn().mockResolvedValue({ accepted: true }) } as any,
  });

  return { projectRepository, executionRepository, service, executeOrchestrator };
}

afterEach(async () => {
  try {
    for (const storage of storages.splice(0)) {
      storage.close();
    }
  } finally {
    await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  }
});

describe("sprint pause/resume control", () => {
  it("pauses a running sprint and keeps repeated pause idempotent", async () => {
    const { projectRepository, executionRepository, service } = await createFixture();
    const project = projectRepository.createProject({ name: "Pause Project", sourceType: "local", sourceRef: "/workspace/pause-project" });
    const sprint = projectRepository.createSprint(project.id, { name: "Pause Sprint", number: 1 });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });

    const paused = service.pauseSprintRun(sprintRun.id);
    const pausedAgain = service.pauseSprintRun(sprintRun.id);

    expect(paused.status).toBe("paused");
    expect(pausedAgain.status).toBe("paused");
    const pauseEvents = executionRepository.listSprintRunEvents(sprintRun.id).filter((event) => event.eventType === "sprint_pause_requested");
    expect(pauseEvents).toHaveLength(1);
  });

  it("resumes a paused sprint by scheduling orchestration and recording a resume event", async () => {
    const { projectRepository, executionRepository, service, executeOrchestrator } = await createFixture();
    const project = projectRepository.createProject({ name: "Resume Project", sourceType: "local", sourceRef: "/workspace/resume-project" });
    const sprint = projectRepository.createSprint(project.id, { name: "Resume Sprint", number: 1 });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "paused" });

    await service.resumeSprintRun(sprintRun.id);

    expect(executeOrchestrator).toHaveBeenCalledWith(expect.objectContaining({
      action: "orchestrate",
      project_id: project.id,
      sprint_id: sprint.id,
      wait: true,
    }));
    expect(executionRepository.listSprintRunEvents(sprintRun.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "sprint_resume_requested" }),
    ]));
  });
});
