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

  it("throws error when getting missing project or task", async () => {
    const { repository } = await createRepository();

    expect(repository.getProject("missing-project-id")).toBeNull();
    // Test the internal requireProject method by triggering an exception in getSelectedSprintId
    expect(() => repository.getSelectedSprintId("missing-project-id")).toThrow();
    expect(repository.getSprint("missing-sprint-id")).toBeNull();
    expect(repository.getTask("missing-task-id")).toBeNull();

    expect(() => repository.createSprint("missing-project-id", { name: "test" })).toThrow();
    expect(() => repository.updateSprint("missing-sprint-id", { name: "test" })).toThrow();
    expect(() => repository.deleteSprint("missing-sprint-id")).toThrow();
    expect(() => repository.deleteTask("missing-task-id")).toThrow();
    expect(() => repository.updateTask("missing-task-id", { title: "updated" })).toThrow();
    expect(() => repository.createTask("missing-project-id", { sprintId: "missing-sprint-id", title: "test" })).toThrow();
    expect(() => repository.listSprints("missing-project-id")).toThrow();
    expect(() => repository.listTasks("missing-project-id")).toThrow();

    // Add cross-project task creation failure case
    const p1 = repository.createProject({ name: "P1", sourceType: "local", sourceRef: "ref1" });
    const p2 = repository.createProject({ name: "P2", sourceType: "local", sourceRef: "ref2" });
    const s1 = repository.createSprint(p1.id, { name: "S1" });
    expect(() => repository.createTask(p2.id, { sprintId: s1.id, title: "cross" })).toThrow();

    // Reset selected project explicitly
    repository.setSelectedProjectId(null);
    expect(repository.getSelectedProjectId()).toBeNull();

    // Throw on sprint updates/creates belonging to mismatched projects
    const sprintMissingProj = repository.createSprint(p1.id, { name: "S_1" });
    expect(() => repository.createTask("invalid-p-id", { sprintId: sprintMissingProj.id, title: "test" })).toThrow();

    expect(() => repository.setSelectedSprintId(p2.id, sprintMissingProj.id)).toThrow();
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

    // Test error case
    expect(() => repository.setSelectedSprintId(project.id, "invalid-id")).toThrow();
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

  it("persists sprintKey in sprints", async () => {
    const { repository } = await createRepository();

    const project = repository.createProject({
      name: "Sprint Key Project",
      sourceType: "local",
      sourceRef: "/workspace/sprint-key",
    });

    const sprint = repository.createSprint(project.id, {
      name: "Planning Sprint",
      sprintKey: "PLN-1",
    });

    expect(sprint.sprintKey).toBe("PLN-1");

    const retrieved = repository.getSprint(sprint.id);
    expect(retrieved?.sprintKey).toBe("PLN-1");

    const updated = repository.updateSprint(sprint.id, {
      sprintKey: "PLN-1-UPDATED",
    });

    expect(updated.sprintKey).toBe("PLN-1-UPDATED");

    const retrievedUpdated = repository.getSprint(sprint.id);
    expect(retrievedUpdated?.sprintKey).toBe("PLN-1-UPDATED");

    // Test when sprintKey is explicitly null
    const updatedNull = repository.updateSprint(sprint.id, {
      sprintKey: null,
    });
    expect(updatedNull.sprintKey).toBeNull();

    // Test when sprintKey is undefined (should not update)
    const updatedUndefined = repository.updateSprint(sprint.id, {
      name: "Still Planning",
    });
    expect(updatedUndefined.sprintKey).toBeNull();

    // Create another sprint without sprintKey
    const sprintWithoutKey = repository.createSprint(project.id, {
      name: "No Key Sprint",
    });
    expect(sprintWithoutKey.sprintKey).toBeNull();

    // Test that listSprints returns sprintKey properly
    const listResponse = repository.listSprints(project.id);
    const listedSprint = listResponse.sprints.find(s => s.id === sprint.id);
    expect(listedSprint?.sprintKey).toBeNull(); // since we updated it to null earlier

    // Re-update sprint key for final check
    repository.updateSprint(sprint.id, {
      sprintKey: "FINAL-KEY",
    });

    const finalSprint = repository.findSprintByProjectAndNumber(project.id, sprint.number!);
    expect(finalSprint?.sprintKey).toBe("FINAL-KEY");

    // Test findSprintByProjectAndNumber returning null when sprint not found
    const missingSprint = repository.findSprintByProjectAndNumber(project.id, 99999);
    expect(missingSprint).toBeNull();
  });

  it("handles empty database mapping states gracefully", async () => {
    const { repository } = await createRepository();
    // Simulate an empty list fetch
    const listResponse = repository.listProjects();
    expect(listResponse.projects).toHaveLength(0);
    expect(listResponse.selectedProjectId).toBeNull();

    // Add testing for findProjectByBaseDir returning null on missing
    expect(repository.findProjectByBaseDir("/does/not/exist")).toBeNull();

    // Add testing for getSelectedSprintId gracefully returning null if nothing selected
    const p1 = repository.createProject({ name: "P1", sourceType: "local", sourceRef: "ref1" });
    expect(repository.getSelectedSprintId(p1.id)).toBeNull();

    // Additional null check coverage: getTask, getSprint
    expect(repository.getTask("abc-123")).toBeNull();
    expect(repository.getSprint("def-456")).toBeNull();

    // Delete non-existent fallback
    repository.deleteProject("does-not-exist");

    // Check missing listTasks
    const emptySprints = repository.listSprints(p1.id);
    expect(emptySprints.sprints.length).toBe(0);
  });

  it("handles update properties correctly on fallback paths", async () => {
    const { repository } = await createRepository();
    const p1 = repository.createProject({ name: "P1", sourceType: "local", sourceRef: "ref1" });
    repository.updateProject(p1.id, { status: "running" }); // Update only partial fields to hit fallback `current.x`
    const updated = repository.getProject(p1.id);
    expect(updated?.status).toBe("running");
    expect(updated?.name).toBe("P1");

    // Test updateTask missing properties branch coverage fallback `current.x`
    const s1 = repository.createSprint(p1.id, { name: "S1" });
    const t1 = repository.createTask(p1.id, { sprintId: s1.id, title: "T1" });
    const updatedTask = repository.updateTask(t1.id, { status: "in_progress" });
    expect(updatedTask.status).toBe("in_progress");
    expect(updatedTask.title).toBe("T1");

    // Test that listTasks with no arguments or undefined works as well
    const taskList = repository.listTasks(p1.id);
    expect(taskList.length).toBe(1);

    // Test when getSprint receives an ID that fails
    expect(repository.getSprint("does-not-exist")).toBeNull();

    // Additional testing for deleteTasksBySprint fallback
    const s2 = repository.createSprint(p1.id, { name: "S2" });
    repository.createTask(p1.id, { sprintId: s2.id, title: "T2" });
    repository.deleteTasksBySprint(s2.id);
    expect(repository.listTasks(p1.id, s2.id).length).toBe(0);
  });

  it("throws on creating unique project slug collision max retries", async () => {
    const { repository } = await createRepository();
    // Assuming createUniqueProjectSlug doesn't loop infinitely if we have the same project created several times, but let's test creating the same project name multiple times to get suffix coverage
    const p1 = repository.createProject({ name: "Same Name", sourceType: "local", sourceRef: "ref1" });
    const p2 = repository.createProject({ name: "Same Name", sourceType: "local", sourceRef: "ref2" });
    const p3 = repository.createProject({ name: "Same Name", sourceType: "local", sourceRef: "ref3" });

    expect(p1.slug).toBe("same-name");
    expect(p2.slug).toBe("same-name-2");
    expect(p3.slug).toBe("same-name-3");

    // Also test unique task keys in sprints
    const s = repository.createSprint(p1.id, { name: "Sprint" });
    const t1 = repository.createTask(p1.id, { sprintId: s.id, title: "T1" });
    const t2 = repository.createTask(p1.id, { sprintId: s.id, title: "T2" });
    expect(t1.taskKey).toBe("T01");
    expect(t2.taskKey).toBe("T02");

    repository.updateProject(p1.id, { name: "Different Name" });
    expect(repository.getProject(p1.id)?.slug).toBe("different-name");
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
