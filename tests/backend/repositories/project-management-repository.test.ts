import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { SprintMarkdownService } from "../../../src/services/sprint-markdown-service.js";

const tempDirs: string[] = [];

async function createRepository(): Promise<{
  repository: ProjectManagementRepository;
  markdownService: SprintMarkdownService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-project-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new ProjectManagementRepository(storage);
  const markdownService = new SprintMarkdownService(repository);
  return { repository, markdownService };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ProjectManagementRepository", () => {
  it("creates projects, sprints, tasks, and dependency summaries in sqlite", async () => {
    const { repository } = await createRepository();

    const project = repository.createProject({
      name: "Sprint OS",
      sourceType: "local",
      sourceRef: "/workspace/sprint-os",
    });

    expect(repository.listProjects().selectedProjectId).toBe(project.id);

    const sprint = repository.createSprint(project.id, {
      name: "Foundation",
      goal: "Stand up the database-backed model",
      startDate: "2026-03-09",
      endDate: "2026-03-23",
      status: "running",
    });

    const taskA = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Create schema",
      promptMarkdown: "Write migrations",
      priority: "critical",
      status: "completed",
    });
    const taskB = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Wire dashboard",
      promptMarkdown: "Replace mocks",
      priority: "high",
      executorType: "mcp_worker",
      status: "in_progress",
      dependsOnTaskIds: [taskA.id],
    });

    const projects = repository.listProjects().projects;
    const sprints = repository.listSprints(project.id);
    const tasks = repository.listTasks(project.id, sprint.id);

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: "Sprint OS",
      sprintsCount: 1,
      completedTasks: 1,
      openTasks: 1,
      isRunning: true,
    });

    expect(sprints[0]).toMatchObject({
      name: "Foundation",
      tasksCount: 2,
      completion: 50,
      status: "running",
    });

    expect(tasks).toHaveLength(2);
    expect(tasks[1]).toMatchObject({
      taskKey: "T02",
      dependsOnTaskIds: [taskA.id],
      executorType: "mcp_worker",
      status: "in_progress",
    });
  });

  it("imports and exports sprint markdown against the database model", async () => {
    const { repository, markdownService } = await createRepository();

    const project = repository.createProject({
      name: "Markdown Project",
      sourceType: "local",
      sourceRef: "/workspace/markdown-project",
    });

    const sprint = markdownService.importSprint(project.id, {
      sprintMarkdown: [
        "name: Import Sprint",
        "number: 7",
        "status: running",
        "start_date: 2026-03-09",
        "end_date: 2026-03-16",
        "goal:",
        "Move sprint content into sqlite.",
      ].join("\n"),
      tasks: [
        {
          taskKey: "T01",
          markdown: [
            "title: First Task",
            "depends_on: []",
            "is_independent: true",
            "merged: false",
            "prompt:",
            "Document the import pipeline.",
          ].join("\n"),
        },
        {
          taskKey: "T02",
          markdown: [
            "title: Second Task",
            "depends_on: [\"T01\"]",
            "is_independent: false",
            "merged: false",
            "prompt:",
            "Hook dependencies into the export path.",
          ].join("\n"),
        },
      ],
    });

    const tasks = repository.listTasks(project.id, sprint.id);
    const exported = markdownService.exportSprint(project.id, sprint.id);

    expect(tasks).toHaveLength(2);
    expect(tasks[1].dependsOnTaskIds).toEqual([tasks[0].id]);
    expect(exported.sprint.markdown).toContain("name: Import Sprint");
    expect(exported.tasks[1].markdown).toContain('depends_on: ["T01"]');
  });
});
