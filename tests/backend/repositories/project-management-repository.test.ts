import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SprintMarkdownService } from "../../../src/services/sprint-markdown-service.js";

const tempDirs: string[] = [];

async function createRepository(): Promise<{
  repository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  markdownService: SprintMarkdownService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-project-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const markdownService = new SprintMarkdownService(repository);
  return { repository, executionRepository, markdownService };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("ProjectManagementRepository", () => {

  it("updates a project and sprint gracefully with empty or partial inputs", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Update Project",
      sourceType: "local",
      sourceRef: "/workspace/update-project",
    });

    const sprint = repository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
    });

    // Empty project update
    const updatedProject = repository.updateProject(project.id, {});
    expect(updatedProject.name).toBe("Update Project");
    expect(updatedProject.slug).toBe(project.slug);
    expect(updatedProject.baseDir).toBe(project.baseDir);
    expect(updatedProject.defaultBranch).toBe("main");
    expect(updatedProject.featureBranchPrefix).toBe("feature/");
    expect(updatedProject.status).toBe("idle");

    // Empty sprint update
    const updatedSprint = repository.updateSprint(sprint.id, {});
    expect(updatedSprint.name).toBe("Sprint 1");
    expect(updatedSprint.slug).toBe(sprint.slug);
    expect(updatedSprint.number).toBe(1);
    expect(updatedSprint.status).toBe("idle");
  });

  it("preserves active sprint selection on creation and deletion", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Sprint Selection",
      sourceType: "local",
      sourceRef: "/workspace/sprint-selection",
    });

    const sprint1 = repository.createSprint(project.id, {
      name: "Sprint 1",
    });

    expect(repository.getSelectedSprintId(project.id)).toBe(sprint1.id);
    expect(repository.listSprints(project.id).selectedSprintId).toBe(sprint1.id);

    const sprint2 = repository.createSprint(project.id, {
      name: "Sprint 2",
    });

    expect(repository.getSelectedSprintId(project.id)).toBe(sprint2.id);
    expect(repository.listSprints(project.id).selectedSprintId).toBe(sprint2.id);

    repository.setSelectedSprintId(project.id, sprint1.id);
    expect(repository.getSelectedSprintId(project.id)).toBe(sprint1.id);

    // Deleting the selected sprint should fall back to next sprint
    repository.deleteSprint(sprint1.id);
    expect(repository.getSelectedSprintId(project.id)).toBe(sprint2.id);

    repository.deleteSprint(sprint2.id);
    expect(repository.getSelectedSprintId(project.id)).toBeNull();
  });

  it("creates projects, sprints, tasks, and dependency summaries in sqlite", async () => {
    const { repository, executionRepository } = await createRepository();

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
    executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });

    const projects = repository.listProjects().projects;
    const sprints = repository.listSprints(project.id).sprints;
    const tasks = repository.listTasks(project.id, sprint.id);

    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      name: "Sprint OS",
      sprintsCount: 1,
      completedTasks: 1,
      openTasks: 1,
      isRunning: true,
      settingsOverrides: {},
      agentBindings: [],
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

  it("handles originalPrompt in sprints and supports clearing tasks", async () => {
    const { repository } = await createRepository();

    const project = repository.createProject({
      name: "Original Prompt Project",
      sourceType: "local",
      sourceRef: "/workspace/original-prompt-project",
    });

    const sprint = repository.createSprint(project.id, {
      name: "Planning Sprint",
      originalPrompt: "Help me build a login page.",
      goal: "Implement a secure login page with MFA.",
    });

    expect(sprint.originalPrompt).toBe("Help me build a login page.");
    expect(sprint.goal).toBe("Implement a secure login page with MFA.");

    repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task 1",
    });
    repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task 2",
    });

    expect(repository.listTasks(project.id, sprint.id)).toHaveLength(2);

    repository.deleteTasksBySprint(sprint.id);

    expect(repository.listTasks(project.id, sprint.id)).toHaveLength(0);

    const updated = repository.updateSprint(sprint.id, {
      originalPrompt: "Actually, help me build a dashboard.",
    });
    expect(updated.originalPrompt).toBe("Actually, help me build a dashboard.");
  });

  it("persists showcasePinned status across updates", async () => {
    const { repository } = await createRepository();

    const project = repository.createProject({
      name: "Showcase Project",
      sourceType: "local",
      sourceRef: "/workspace/showcase-project",
    });

    const sprint = repository.createSprint(project.id, {
      name: "Showcase Sprint",
      showcasePinned: true,
    });

    expect(sprint.showcasePinned).toBe(true);

    // Update other fields, pin should persist
    const updated1 = repository.updateSprint(sprint.id, {
      name: "Updated Showcase Sprint",
    });
    expect(updated1.showcasePinned).toBe(true);
    expect(updated1.name).toBe("Updated Showcase Sprint");

    // Explicitly unpin
    const updated2 = repository.updateSprint(sprint.id, {
      showcasePinned: false,
    });
    expect(updated2.showcasePinned).toBe(false);

    // Explicitly pin again
    const updated3 = repository.updateSprint(sprint.id, {
      showcasePinned: true,
    });
    expect(updated3.showcasePinned).toBe(true);
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

  it("derives sprint summary status from the latest sprint run", async () => {
    const { repository, executionRepository } = await createRepository();

    const project = repository.createProject({
      name: "Runtime Status Project",
      sourceType: "local",
      sourceRef: "/workspace/runtime-status-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Runtime Status Sprint",
      number: 1,
      status: "running",
    });

    executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "running",
    });
    executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      status: "cancelled",
    });

    expect(repository.getSprint(sprint.id)).toMatchObject({
      status: "cancelled",
    });
    expect(repository.listSprints(project.id).sprints[0]).toMatchObject({
      status: "cancelled",
    });
  });

  it("publishes project collection and structure refreshes on project mutations", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-os-project-repo-realtime-"));
    tempDirs.push(dir);
    const storage = new AppDbStorage(path.join(dir, "app.db"));
    const notifier = {
      scheduleProjectsRefresh: vi.fn(),
      scheduleProjectLiveRefresh: vi.fn(),
      scheduleProjectExecutionRefresh: vi.fn(),
      scheduleProjectStructureRefresh: vi.fn(),
    };
    const repository = new ProjectManagementRepository(storage, notifier);

    const project = repository.createProject({
      name: "Realtime Project",
      sourceType: "local",
      sourceRef: "/workspace/realtime-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Realtime Sprint",
      status: "idle",
    });
    const task = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Realtime Task",
      promptMarkdown: "Keep the dashboard fresh.",
    });

    repository.updateTask(task.id, {
      status: "in_progress",
    });
    repository.deleteTask(task.id);

    expect(notifier.scheduleProjectsRefresh).toHaveBeenCalled();
    expect(notifier.scheduleProjectStructureRefresh).toHaveBeenCalledWith(project.id, { includeProjects: true });
  });
});
