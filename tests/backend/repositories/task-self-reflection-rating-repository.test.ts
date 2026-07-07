import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { TaskSelfReflectionRatingRepository } from "../../../src/repositories/task-self-reflection-rating-repository.js";

const tempDirs: string[] = [];

interface Fixture {
  storage: AppDbStorage;
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  ratingRepository: TaskSelfReflectionRatingRepository;
  projectId: string;
  sprintId: string;
  taskId: string;
  taskRunId: string;
}

async function createFixture(): Promise<Fixture> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-task-self-reflection-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const ratingRepository = new TaskSelfReflectionRatingRepository(storage);
  const project = projectRepository.createProject({
    name: "Self Reflection Test Project",
    sourceType: "local",
    sourceRef: dir,
  });
  const sprint = projectRepository.createSprint(project.id, { name: "Self Reflection Sprint" });
  const task = projectRepository.createTask(project.id, {
    sprintId: sprint.id,
    title: "Implement rating capture",
  });
  const taskRun = executionRepository.createTaskRun({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task.id,
    provider: "codex",
    state: "COMPLETED",
    startedAt: "2026-01-01T00:00:00.000Z",
    finishedAt: "2026-01-01T00:10:00.000Z",
  });

  return {
    storage,
    projectRepository,
    executionRepository,
    ratingRepository,
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task.id,
    taskRunId: taskRun.id,
  };
}

beforeEach(() => {
  tempDirs.length = 0;
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("TaskSelfReflectionRatingRepository", () => {
  it("upserts one rating per task run", async () => {
    const fixture = await createFixture();

    const created = fixture.ratingRepository.upsertForTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: fixture.taskId,
      sourceTaskRunId: fixture.taskRunId,
      overallRating: 4,
      sections: [
        { label: " Implementation ", normalizedLabel: " implementation ", rating: 5, note: " done " },
      ],
      capturedAt: "2026-01-01T00:10:00.000Z",
    });
    const updated = fixture.ratingRepository.upsertForTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: fixture.taskId,
      sourceTaskRunId: fixture.taskRunId,
      overallRating: 3,
      sections: [
        { label: "Tests", normalizedLabel: "tests", rating: 2, note: null },
      ],
      capturedAt: "2026-01-01T00:11:00.000Z",
    });

    expect(updated.id).toBe(created.id);
    expect(updated.createdAt).toBe(created.createdAt);
    expect(updated.overallRating).toBe(3);
    expect(updated.sections).toEqual([
      { label: "Tests", normalizedLabel: "tests", rating: 2, note: null },
    ]);
    expect(fixture.ratingRepository.getByTaskRun(fixture.taskRunId)).toEqual(updated);
  });

  it("clamps ratings and normalizes section labels", async () => {
    const fixture = await createFixture();

    const rating = fixture.ratingRepository.upsertForTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: fixture.taskId,
      sourceTaskRunId: fixture.taskRunId,
      overallRating: 12,
      sections: [
        { label: "Integration Fit", normalizedLabel: "Integration Fit", rating: -2, note: "  needs work  " },
      ],
    });

    expect(rating.overallRating).toBe(5);
    expect(rating.sections).toEqual([
      { label: "Integration Fit", normalizedLabel: "integration-fit", rating: 0, note: "needs work" },
    ]);
  });

  it("returns the latest rating map for task ids", async () => {
    const fixture = await createFixture();
    const taskTwo = fixture.projectRepository.createTask(fixture.projectId, {
      sprintId: fixture.sprintId,
      title: "Second task",
    });
    const olderRun = fixture.executionRepository.createTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: fixture.taskId,
      provider: "codex",
      state: "COMPLETED",
    });
    const taskTwoRun = fixture.executionRepository.createTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: taskTwo.id,
      provider: "codex",
      state: "COMPLETED",
    });

    fixture.ratingRepository.upsertForTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: fixture.taskId,
      sourceTaskRunId: olderRun.id,
      overallRating: 2,
      sections: [],
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    fixture.ratingRepository.upsertForTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: fixture.taskId,
      sourceTaskRunId: fixture.taskRunId,
      overallRating: 5,
      sections: [],
      capturedAt: "2026-01-01T00:05:00.000Z",
    });
    fixture.ratingRepository.upsertForTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: taskTwo.id,
      sourceTaskRunId: taskTwoRun.id,
      overallRating: 4,
      sections: [],
      capturedAt: "2026-01-01T00:03:00.000Z",
    });

    const latest = fixture.ratingRepository.getLatestByTaskIds([fixture.taskId, taskTwo.id, "missing"]);

    expect(latest.get(fixture.taskId)?.overallRating).toBe(5);
    expect(latest.get(taskTwo.id)?.overallRating).toBe(4);
    expect(latest.has("missing")).toBe(false);
  });

  it("cascades ratings when the source task run is deleted", async () => {
    const fixture = await createFixture();
    fixture.ratingRepository.upsertForTaskRun({
      projectId: fixture.projectId,
      sprintId: fixture.sprintId,
      taskId: fixture.taskId,
      sourceTaskRunId: fixture.taskRunId,
      overallRating: 4,
      sections: [],
    });

    fixture.storage.getDatabase().prepare("DELETE FROM task_runs WHERE id = ?").run(fixture.taskRunId);

    expect(fixture.ratingRepository.getByTaskRun(fixture.taskRunId)).toBeNull();
  });
});
