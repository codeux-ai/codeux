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

  it("recomputes nextRunAt to the next future occurrence when resuming a paused entry", async () => {
    const { dir, projectRepository, schedulerRepository } = await createRepositories();
    const project = projectRepository.createProject({
      name: "Scheduler Project",
      sourceType: "local",
      sourceRef: dir,
    });

    const pastDate = "2026-05-18T09:00:00.000Z";
    const now = new Date("2026-06-11T10:00:00.000Z");
    const nextFutureDate = "2026-06-12T09:00:00.000Z";

    // Create a daily entry that started in the past
    const entry = schedulerRepository.createEntry(project.id, {
      targetType: "chat",
      scheduledFor: pastDate,
      recurrence: { frequency: "daily", interval: 1 },
      chatTarget: { bodyMarkdown: "Daily Ping" },
    });

    // Pause it
    schedulerRepository.updateEntry(entry.id, { status: "paused" });

    // Mock Date.now to control "now" during resumption
    const originalDate = global.Date;
    global.Date = class extends originalDate {
      constructor(arg?: any) {
        if (arg === undefined) return new originalDate(now);
        return new originalDate(arg);
      }
    } as any;

    try {
      // Resume it
      const resumed = schedulerRepository.updateEntry(entry.id, { status: "scheduled" });

      expect(resumed.status).toBe("scheduled");
      // It should skip all past occurrences and pick the next one >= now
      expect(resumed.nextRunAt).toBe(nextFutureDate);

      // Ensure it's not in the due list for "now"
      const due = schedulerRepository.listDueEntries(now.toISOString());
      expect(due.find((e) => e.id === entry.id)).toBeUndefined();
    } finally {
      global.Date = originalDate;
    }
  });
});
