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
  storage: AppDbStorage;
  repository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  markdownService: SprintMarkdownService;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-repo-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const repository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);
  const markdownService = new SprintMarkdownService(repository);
  return { storage, repository, executionRepository, markdownService };
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
      name: "Code UX",
      sourceType: "local",
      sourceRef: "/workspace/code-ux",
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
      name: "Code UX",
      sprintsCount: 1,
      completedTasks: 1,
      openTasks: 1,
      isRunning: true,
      settingsOverrides: {},
      agentBindings: [],
      gitProvider: "local",
      gitHostDomain: null,
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

  it("infers remote GitHub metadata for local projects from origin", async () => {
    const { repository } = await createRepository();
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-local-origin-"));
    tempDirs.push(repoPath);
    await fs.mkdir(path.join(repoPath, ".git"), { recursive: true });
    await fs.writeFile(path.join(repoPath, ".git", "config"), `
[core]
  repositoryformatversion = 0
[remote "origin"]
  url = git@github.com:numnx/jules-agent-mcp.git
  fetch = +refs/heads/*:refs/remotes/origin/*
`);

    const project = repository.createProject({
      name: "Code UX",
      sourceType: "local",
      sourceRef: repoPath,
    });

    expect(project).toMatchObject({
      sourceType: "local",
      repoUrl: "git@github.com:numnx/jules-agent-mcp.git",
      gitProvider: "github",
      gitHostDomain: "github.com",
    });
  });

  it("defaults empty local source refs into the home codex projects directory", async () => {
    const { repository } = await createRepository();

    const project = repository.createProject({
      name: "Local Default Path",
      sourceType: "local",
      sourceRef: "",
    });

    const expectedBaseDir = path.join(os.homedir(), ".codex-ux", "projects", project.slug);

    expect(project.baseDir).toBe(expectedBaseDir);
    expect(project.baseDir.endsWith(path.join(".codex-ux", "projects", project.slug))).toBe(true);
    expect(project.sourceRef).toBe(expectedBaseDir);
    expect(project.sourceRef).not.toBe("");
  });

  it("resolves relative local source refs against the user's home directory", async () => {
    const { repository } = await createRepository();

    const project = repository.createProject({
      name: "Relative Local Project",
      sourceType: "local",
      sourceRef: "workspace/relative-local-project",
    });

    const expectedBaseDir = path.resolve(os.homedir(), "workspace/relative-local-project");

    expect(project.baseDir).toBe(expectedBaseDir);
    expect(project.sourceRef).toBe(expectedBaseDir);
  });


  it("supports optional sprint review summaries in listSprints and ignores task-level QA", async () => {
    const { repository, storage } = await createRepository();

    const project = repository.createProject({
      name: "QA Review Summary Project",
      sourceType: "local",
      sourceRef: "/tmp/qa",
    });

    const sprint1 = repository.createSprint(project.id, {
      name: "Sprint Unreviewed",
      goal: "No QA review run yet",
    });

    const sprint2 = repository.createSprint(project.id, {
      name: "Sprint Reviewed",
      goal: "Has QA review run",
    });

    const db = storage.getDatabase();

    // Insert task level QA run for Sprint 1
    db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, trigger_type, status, outcome, run_index, summary_markdown, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'task_completion', 'completed', 'pass', 1, 'Task looks good', 'Task Bot', ?, ?, ?, ?)
    `).run('task-qa-run', project.id, sprint1.id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());

    // Insert sprint completion QA run for Sprint 2
    db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, trigger_type, status, outcome, run_index, summary_markdown, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'sprint_completion', 'completed', 'pass', 1, 'Looks good!', 'QA Bot', ?, ?, ?, ?)
    `).run('qa-run-123', project.id, sprint2.id, new Date().toISOString(), new Date().toISOString(), new Date().toISOString(), new Date().toISOString());

    const { sprints } = repository.listSprints(project.id);
    expect(sprints.length).toBe(2);

    const mappedUnreviewed = sprints.find(s => s.id === sprint1.id);
    expect(mappedUnreviewed?.latestReview).toBeUndefined(); // Ignored task-level QA

    const mappedReviewed = sprints.find(s => s.id === sprint2.id);
    expect(mappedReviewed?.latestReview).toBeDefined();
    expect(mappedReviewed?.latestReview?.status).toBe('completed');
    expect(mappedReviewed?.latestReview?.outcome).toBe('pass');
    expect(mappedReviewed?.latestReview?.summary).toBe('Looks good!');
    expect(mappedReviewed?.latestReview?.reviewer).toBe('QA Bot');
  });

  it("includes latest task QA review summaries in listTasks", async () => {
    const { storage, repository } = await createRepository();

    const project = repository.createProject({
      name: "Task QA Review Project",
      sourceType: "local",
      sourceRef: "/tmp/task-qa",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Task QA Sprint",
      goal: "Expose task QA state",
    });
    const task = repository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Reviewed task",
      promptMarkdown: "Implement and review",
    });

    const db = storage.getDatabase();
    db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, task_id, trigger_type, status, outcome, run_index,
        summary_markdown, payload_json, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'task_completion', 'running', NULL, 1, NULL, ?, 'QA Bot', ?, NULL, ?, ?)
    `).run(
      "task-qa-running",
      project.id,
      sprint.id,
      task.id,
      JSON.stringify({ findings: [] }),
      "2026-05-30T09:00:00.000Z",
      "2026-05-30T09:00:00.000Z",
      "2026-05-30T09:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, task_id, trigger_type, status, outcome, run_index,
        summary_markdown, payload_json, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'task_completion', 'completed', 'changes_requested', 2, ?, ?, 'QA Bot', ?, ?, ?, ?)
    `).run(
      "task-qa-latest",
      project.id,
      sprint.id,
      task.id,
      "Needs one follow-up.",
      JSON.stringify({ findings: ["Missing regression test"] }),
      "2026-05-30T09:05:00.000Z",
      "2026-05-30T09:06:00.000Z",
      "2026-05-30T09:05:00.000Z",
      "2026-05-30T09:06:00.000Z",
    );

    const [mappedTask] = repository.listTasks(project.id, sprint.id);
    expect(mappedTask.latestReview).toEqual({
      status: "completed",
      outcome: "changes_requested",
      summary: "Needs one follow-up.",
      findings: ["Missing regression test"],
      reviewer: "QA Bot",
      finishedAt: "2026-05-30T09:06:00.000Z",
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

  it("loads task records by id through the chunked IN helper", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Batch Lookup Project",
      sourceType: "local",
      sourceRef: "/workspace/batch-lookup-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Batch Lookup Sprint",
      number: 1,
    });
    const taskA = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "First lookup task",
    });
    const taskB = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Second lookup task",
    });

    const records = repository.getTasksByIds([taskA.id, taskB.id, taskA.id]);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.id).sort()).toEqual([taskA.id, taskB.id].sort());
  });

  it("publishes project collection and structure refreshes on project mutations", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-project-repo-realtime-"));
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

  it("allows valid DAG dependencies within the same sprint", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "DAG Project",
      sourceType: "local",
      sourceRef: "/workspace/dag",
    });
    const sprint = repository.createSprint(project.id, { name: "Sprint 1" });

    const taskA = repository.createTask(project.id, { sprintId: sprint.id, title: "A" });
    const taskB = repository.createTask(project.id, { sprintId: sprint.id, title: "B", dependsOnTaskIds: [taskA.id] });
    const taskC = repository.createTask(project.id, { sprintId: sprint.id, title: "C", dependsOnTaskIds: [taskB.id] });

    const tasks = repository.listTasks(project.id, sprint.id);
    expect(tasks.find((t) => t.id === taskB.id)?.dependsOnTaskIds).toEqual([taskA.id]);
    expect(tasks.find((t) => t.id === taskC.id)?.dependsOnTaskIds).toEqual([taskB.id]);
  });

  it("persists and updates linked sprint issues", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Issue Project",
      sourceType: "git",
      sourceRef: "https://github.com/acme/widgets.git",
    });

    const sprint = repository.createSprint(project.id, {
      name: "Issue Sprint",
      linkedIssues: [
        {
          provider: "github",
          hostDomain: "github.com",
          repository: "acme/widgets",
          issueNumber: 42,
          issueKey: "#42",
          title: "Improve imports",
          url: "https://github.com/acme/widgets/issues/42",
          labels: ["ux", "import"],
          assignees: ["pierre"],
        },
      ],
    });

    expect(sprint.linkedIssues).toHaveLength(1);
    expect(sprint.linkedIssues[0]?.title).toBe("Improve imports");
    expect(repository.getSprint(sprint.id)?.linkedIssues[0]?.labels).toEqual(["ux", "import"]);

    const issue = sprint.linkedIssues[0]!;
    const closed = repository.updateSprintLinkedIssueCloseState(issue.id, {
      closeState: "closed",
      closedAt: "2026-05-17T00:00:00.000Z",
      closeError: null,
      issueState: "closed",
    });

    expect(closed.closeState).toBe("closed");
    expect(closed.state).toBe("closed");
    expect(repository.listSprintLinkedIssues(project.id, sprint.id)[0]?.closedAt).toBe("2026-05-17T00:00:00.000Z");
  });

  it("rejects self-dependencies during creation and update", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Self Dep Project",
      sourceType: "local",
      sourceRef: "/workspace/self-dep",
    });
    const sprint = repository.createSprint(project.id, { name: "Sprint 1" });

    const taskA = repository.createTask(project.id, { sprintId: sprint.id, title: "A" });

    expect(() => {
      repository.updateTask(taskA.id, { dependsOnTaskIds: [taskA.id] });
    }).toThrow(/cannot depend on itself/);
  });

  it("rejects cross-sprint dependencies", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Cross Sprint Project",
      sourceType: "local",
      sourceRef: "/workspace/cross-sprint",
    });
    const sprint1 = repository.createSprint(project.id, { name: "Sprint 1" });
    const sprint2 = repository.createSprint(project.id, { name: "Sprint 2" });

    const task1 = repository.createTask(project.id, { sprintId: sprint1.id, title: "Task 1" });

    expect(() => {
      repository.createTask(project.id, { sprintId: sprint2.id, title: "Task 2", dependsOnTaskIds: [task1.id] });
    }).toThrow(/does not belong to the same sprint/);
  });

  it("rejects cycles created via updates", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Cycle Project",
      sourceType: "local",
      sourceRef: "/workspace/cycle",
    });
    const sprint = repository.createSprint(project.id, { name: "Sprint 1" });

    const taskA = repository.createTask(project.id, { sprintId: sprint.id, title: "A" });
    const taskB = repository.createTask(project.id, { sprintId: sprint.id, title: "B", dependsOnTaskIds: [taskA.id] });
    const taskC = repository.createTask(project.id, { sprintId: sprint.id, title: "C", dependsOnTaskIds: [taskB.id] });

    // Try to make A depend on C (creating a cycle: A -> C -> B -> A)
    expect(() => {
      repository.updateTask(taskA.id, { dependsOnTaskIds: [taskC.id] });
    }).toThrow(/circular dependency graph/);
  });

  it("does not touch updatedAt on no-op task updates", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "No Op Project",
      sourceType: "local",
      sourceRef: "/workspace/no-op-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Sprint 1",
    });
    const task = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task 1",
      promptMarkdown: "Do the work.",
      status: "completed",
    });

    const updated = repository.updateTask(task.id, {
      status: "completed",
    });

    expect(updated.updatedAt).toBe(task.updatedAt);
  });

  it("supports creating and updating task with a specific model", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Model Project",
      sourceType: "local",
      sourceRef: "/workspace/model-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Sprint 1",
    });
    const task = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Model Task",
      promptMarkdown: "Do the work.",
      model: "gemini-2.5-pro",
    });

    expect(task.model).toBe("gemini-2.5-pro");

    const updated = repository.updateTask(task.id, {
      model: "claude-3-5-sonnet",
    });

    expect(updated.model).toBe("claude-3-5-sonnet");

    const cleared = repository.updateTask(task.id, {
      model: null,
    });

    expect(cleared.model).toBeNull();
  });
});
