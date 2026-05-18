import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SchedulerRepository } from "../../../src/repositories/scheduler-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  dir: string;
  projectRepository: ProjectManagementRepository;
  schedulerRepository: SchedulerRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "scheduler-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    dir,
    projectRepository: new ProjectManagementRepository(storage),
    schedulerRepository: new SchedulerRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SchedulerRepository", () => {
  it("persists sprint scheduler entries with recurrence metadata", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Morning check",
      goal: "Run morning checks.",
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "sprint",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      recurrence: { frequency: "daily", interval: 1, endMode: "after_count", count: 4 },
      sprintTarget: { sprintId: sprint.id },
    });

    expect(entry.projectId).toBe(project.id);
    expect(entry.targetType).toBe("sprint");
    expect(entry.sprintTarget?.sprintId).toBe(sprint.id);
    expect(entry.recurrence.count).toBe(4);
    expect(entry.nextRunAt).toBe("2026-05-18T09:00:00.000Z");

    const [listed] = schedulerRepository.listEntries(project.id);
    expect(listed.id).toBe(entry.id);
  });

  it("marks successful runs and completes one-time entries", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "chat",
      scheduledFor: "2026-05-18T09:00:00.000Z",
      chatTarget: { bodyMarkdown: "Status please" },
    });

    const updated = schedulerRepository.markRunSucceeded(entry.id, entry.scheduledFor, null);

    expect(updated.status).toBe("completed");
    expect(updated.runCount).toBe(1);
    expect(updated.nextRunAt).toBeNull();
  });
});
