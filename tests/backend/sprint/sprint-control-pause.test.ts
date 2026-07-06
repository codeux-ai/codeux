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
import { SprintRunLifecycleService } from "../../../src/services/sprint-run-lifecycle-service.js";

const tempDirs: string[] = [];
const storages: AppDbStorage[] = [];

async function createFixture(): Promise<{
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  service: ExecutionControlService;
  executeOrchestrator: ReturnType<typeof vi.fn>;
  recoverSprintRun: ReturnType<typeof vi.fn>;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-sprint-pause-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  storages.push(storage);
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const executeOrchestrator = vi.fn().mockResolvedValue({ ok: true });
  const recoverSprintRun = vi.fn().mockResolvedValue({ ok: true });
  const sprintRunLifecycleService = new SprintRunLifecycleService({
    executionRepository,
    projectManagementRepository: projectRepository,
  });

  const service = new ExecutionControlService({
    projectManagementRepository: projectRepository,
    executionRepository,
    sprintRunLifecycleService,
    projectAttentionService: new ProjectAttentionService(
      new ProjectAttentionRepository(storage),
      new ProjectWorkerAssignmentRepository(storage),
    ),
    taskRerunService: { rerunTask: vi.fn() } as any,
    sprintOrchestrator: { execute: executeOrchestrator, recoverSprintRun, setConsecutiveFailures: vi.fn() } as any,
    julesApi: { sendSessionMessage: vi.fn().mockResolvedValue({ ok: true }) } as any,
    activeDispatchRegistry: { requestStop: vi.fn().mockResolvedValue({ accepted: true }) } as any,
  });

  return { projectRepository, executionRepository, service, executeOrchestrator, recoverSprintRun };
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
    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: "sprint_orchestrator:test",
      leaseToken: "lease-1",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const paused = service.pauseSprintRun(sprintRun.id);
    const pausedAgain = service.pauseSprintRun(sprintRun.id);

    expect(paused.status).toBe("paused");
    expect(pausedAgain.status).toBe("paused");
    expect(executionRepository.getLease("sprint", sprint.id)).toBeNull();
    const pauseEvents = executionRepository.listSprintRunEvents(sprintRun.id).filter((event) => event.eventType === "sprint_pause_requested");
    expect(pauseEvents).toHaveLength(1);
  });

  it("resumes a paused sprint by scheduling orchestration and recording a resume event", async () => {
    const { projectRepository, executionRepository, service, executeOrchestrator, recoverSprintRun } = await createFixture();
    const project = projectRepository.createProject({ name: "Resume Project", sourceType: "local", sourceRef: "/workspace/resume-project" });
    const sprint = projectRepository.createSprint(project.id, { name: "Resume Sprint", number: 1 });
    const sprintRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "paused" });
    executionRepository.acquireLease({
      scopeType: "sprint",
      scopeId: sprint.id,
      ownerKey: "sprint_orchestrator:previous",
      leaseToken: "previous-lease",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const resumed = await service.resumeSprintRun(sprintRun.id);

    expect(resumed.status).toBe("running");
    expect(executionRepository.getSprintRun(sprintRun.id)?.status).toBe("running");
    expect(executionRepository.getSprintRun(sprintRun.id)?.lastHeartbeatAt).toEqual(expect.any(String));
    expect(executionRepository.getLease("sprint", sprint.id)).toBeNull();
    expect(recoverSprintRun).toHaveBeenCalledWith(sprintRun.id);
    expect(executeOrchestrator).not.toHaveBeenCalled();
    expect(executionRepository.listSprintRunEvents(sprintRun.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ eventType: "sprint_resume_requested" }),
    ]));
  });

  it("does not resume a paused sprint run while another run for the sprint is active", async () => {
    const { projectRepository, executionRepository, service, executeOrchestrator } = await createFixture();
    const project = projectRepository.createProject({ name: "Duplicate Resume Project", sourceType: "local", sourceRef: "/workspace/duplicate-resume-project" });
    const sprint = projectRepository.createSprint(project.id, { name: "Duplicate Resume Sprint", number: 2 });
    const pausedRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "paused" });
    const activeRun = executionRepository.createSprintRun({ projectId: project.id, sprintId: sprint.id, status: "running" });

    await expect(service.resumeSprintRun(pausedRun.id)).rejects.toThrow(`run ${activeRun.id}, status running`);

    expect(executionRepository.getSprintRun(pausedRun.id)?.status).toBe("paused");
    expect(executeOrchestrator).not.toHaveBeenCalled();
  });
});
