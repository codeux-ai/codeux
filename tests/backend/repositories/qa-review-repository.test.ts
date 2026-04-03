import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { QaReviewRepository } from "../../../src/repositories/qa-review-repository.js";

const tempDirs: string[] = [];

const createRepository = async (): Promise<{
  dir: string;
  repository: QaReviewRepository;
  projectRepository: ProjectManagementRepository;
}> => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-review-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    dir,
    repository: new QaReviewRepository(storage),
    projectRepository: new ProjectManagementRepository(storage),
  };
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("QaReviewRepository", () => {
  it("tracks task review runs and sprint review presence", async () => {
    const { repository, projectRepository } = await createRepository();
    const project = projectRepository.createProject({
      name: "QA Project",
      sourceType: "local",
      sourceRef: path.join(os.tmpdir(), "qa-project"),
    });
    const sprint = projectRepository.createSprint(project.id, {
      name: "Sprint 1",
      goal: "Ship the QA feature",
      status: "active",
      featureBranch: "feature/sprint-1",
    });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Implement QA card",
      promptMarkdown: "Build the QA settings card.",
      status: "coding_completed",
      isIndependent: true,
    });

    const taskRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      triggerType: "task_completion",
      runIndex: 1,
      agentName: "Quality Assurance Agent",
      targetTaskKey: "T1",
      targetSessionId: "session-1",
      targetProvider: "codex",
      payload: { summary: "initial review" },
    });

    expect(repository.countTaskRuns(task.id)).toBe(0);

    const completedTaskRun = repository.updateRun(taskRun.id, {
      status: "completed",
      outcome: "changes_requested",
      summaryMarkdown: "Needs a follow-up fix",
      fixInstructions: "Address the missing validation path.",
      finishedAt: new Date().toISOString(),
    });

    expect(completedTaskRun.outcome).toBe("changes_requested");
    expect(repository.countTaskRuns(task.id)).toBe(1);
    expect(repository.listRunsForTask(task.id)).toHaveLength(1);

    expect(repository.hasSprintReviewRun(sprint.id)).toBe(false);

    const sprintRun = repository.createRun({
      projectId: project.id,
      sprintId: sprint.id,
      triggerType: "sprint_completion",
      runIndex: 1,
      payload: { summary: "sprint review" },
    });

    expect(repository.hasSprintReviewRun(sprint.id)).toBe(true);

    const storedSprintRun = repository.getRun(sprintRun.id);
    expect(storedSprintRun?.triggerType).toBe("sprint_completion");
    expect(storedSprintRun?.payload).toEqual({ summary: "sprint review" });
  });
});
