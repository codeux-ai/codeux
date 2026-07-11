import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { migrateSprintLinkedIssuesExternalSources } from "../../../src/repositories/db/app-db-migrations.js";
import { SqliteDatabaseAdapter } from "../../../src/repositories/db/sqlite-database-adapter.js";
import {
  createGeneratedSprintName,
  isGeneratedSprintName,
  ProjectManagementRepository,
} from "../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../src/repositories/execution-repository.js";
import { SprintMarkdownService } from "../../../src/services/sprint-markdown-service.js";
import { TaskSelfReflectionRatingRepository } from "../../../src/repositories/task-self-reflection-rating-repository.js";

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
  it("creates untitled sprints with deterministic generated names and slugs", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Untitled Sprint Project",
      sourceType: "local",
      sourceRef: "/workspace/untitled-sprint-project",
    });

    const sprint1 = repository.createSprint(project.id, {
      goal: "Plan without a user title",
    });
    const sprint2 = repository.createSprint(project.id, {
      name: "   ",
      goal: "Plan another untitled sprint",
    });
    const custom = repository.createSprint(project.id, {
      name: "Custom sprint title",
      goal: "Plan with a user title",
    });
    const customPlaceholder = repository.createSprint(project.id, {
      name: "Untitled sprint 1",
      goal: "Plan with a user title that resembles a generated placeholder",
    });

    expect(sprint1.name).toBe(createGeneratedSprintName(1));
    expect(sprint1.slug).toBe("untitled-sprint-1");
    expect(sprint1.isGeneratedName).toBe(true);
    expect(isGeneratedSprintName(sprint1.name)).toBe(true);
    expect(sprint2.name).toBe(createGeneratedSprintName(2));
    expect(sprint2.slug).toBe("untitled-sprint-2");
    expect(sprint2.isGeneratedName).toBe(true);
    expect(custom.name).toBe("Custom sprint title");
    expect(custom.slug).toBe("custom-sprint-title");
    expect(custom.isGeneratedName).toBe(false);
    expect(customPlaceholder.name).toBe("Untitled sprint 1");
    expect(customPlaceholder.isGeneratedName).toBe(false);
    expect(isGeneratedSprintName(customPlaceholder.name)).toBe(true);
  });

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

  it("blocks sprint deletion when it would prune a preserved invocation transcript", async () => {
    const { repository, executionRepository } = await createRepository();
    const project = repository.createProject({
      name: "Preserved Invocation Project",
      sourceType: "local",
      sourceRef: "/workspace/preserved-invocation-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Planning Sprint",
    });
    const invocation = executionRepository.createExecutionInvocation({
      projectId: project.id,
      sprintId: sprint.id,
      type: "planning",
      status: "failed",
      preservedAt: "2026-07-02T22:20:00.000Z",
    });

    expect(() => repository.deleteSprint(sprint.id)).toThrow(`Sprint ${sprint.id} has preserved execution invocation ${invocation.id}`);
    expect(repository.getSprint(sprint.id)).not.toBeNull();
  });

  it("blocks sprint deletion while an active sprint run exists", async () => {
    const { repository, executionRepository } = await createRepository();
    const project = repository.createProject({
      name: "Active Sprint Run Delete Project",
      sourceType: "local",
      sourceRef: "/workspace/active-sprint-run-delete-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Active Sprint",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });

    expect(() => repository.deleteSprint(sprint.id)).toThrow(`Sprint ${sprint.id} has active run ${sprintRun.id}`);
    expect(repository.getSprint(sprint.id)).not.toBeNull();

    executionRepository.updateSprintRun(sprintRun.id, {
      status: "cancelled",
      finishedAt: "2026-01-01T00:00:00.000Z",
      lastHeartbeatAt: "2026-01-01T00:00:00.000Z",
    });
    expect(() => repository.deleteSprint(sprint.id)).not.toThrow();
    expect(repository.getSprint(sprint.id)).toBeNull();
  });

  it("blocks sprint deletion briefly after cancellation so runtime cleanup can settle", async () => {
    const { repository, executionRepository } = await createRepository();
    const project = repository.createProject({
      name: "Recently Cancelled Sprint Delete Project",
      sourceType: "local",
      sourceRef: "/workspace/recently-cancelled-sprint-delete-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Recently Cancelled Sprint",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "mixed",
      status: "running",
    });
    executionRepository.updateSprintRun(sprintRun.id, {
      status: "cancelled",
      finishedAt: new Date().toISOString(),
      lastHeartbeatAt: new Date().toISOString(),
    });

    expect(() => repository.deleteSprint(sprint.id)).toThrow(`Sprint ${sprint.id} has recently finished run ${sprintRun.id}`);
    expect(repository.getSprint(sprint.id)).not.toBeNull();
  });

  it("blocks sprint deletion while active runtime children are still linked", async () => {
    const { repository, executionRepository } = await createRepository();
    const project = repository.createProject({
      name: "Active Runtime Delete Project",
      sourceType: "local",
      sourceRef: "/workspace/active-runtime-delete-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Active Runtime Sprint",
    });
    const task = repository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T01",
      title: "Active runtime task",
      status: "in_progress",
    });
    const sprintRun = executionRepository.createSprintRun({
      projectId: project.id,
      sprintId: sprint.id,
      executorMode: "docker_cli",
      status: "cancelled",
      finishedAt: "2026-01-01T00:00:00.000Z",
    });
    const dispatch = executionRepository.createTaskDispatch({
      projectId: project.id,
      sprintId: sprint.id,
      sprintRunId: sprintRun.id,
      taskId: task.id,
      executorType: "docker_cli",
      status: "running",
    } as any);

    expect(() => repository.deleteSprint(sprint.id)).toThrow(`Sprint ${sprint.id} has active task dispatch ${dispatch.id}`);
    expect(repository.getSprint(sprint.id)).not.toBeNull();
  });

  it("normalizes stale provided sprint numbers to the next project number", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Stale Number Project",
      sourceType: "local",
      sourceRef: "/workspace/stale-number-project",
    });

    const sprint1 = repository.createSprint(project.id, {
      name: "Sprint 1",
      number: 1,
    });
    const sprint2 = repository.createSprint(project.id, {
      name: "Sprint 2",
      number: sprint1.number,
    });

    expect(sprint1.number).toBe(1);
    expect(sprint2.number).toBe(2);
  });

  it("increments sprint number when number is omitted after an existing sprint", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Auto Number Project",
      sourceType: "local",
      sourceRef: "/workspace/auto-number-project",
    });

    const sprint1 = repository.createSprint(project.id, {
      name: "Sprint 1",
      number: 7,
    });
    const sprint2 = repository.createSprint(project.id, {
      name: "Sprint 2",
    });

    expect(sprint1.number).toBe(7);
    expect(sprint2.number).toBe(8);
  });

  it("defaults blank local projects into the Code UX projects folder", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Blank Local Project",
      sourceType: "local",
      sourceRef: "",
    });

    expect(project.baseDir).toBe(path.join(os.homedir(), ".code-ux", "projects", project.slug));
    expect(project.lastRunAt).toBeNull();
    expect(project.lastRunStatus).toBeNull();
  });

  it("defaults Git projects into the Code UX projects folder", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "Git Project",
      sourceType: "git",
      sourceRef: "https://github.com/codeux-ai/example-project.git",
    });

    expect(project.baseDir).toBe(path.join(os.homedir(), ".code-ux", "projects", "example-project"));
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

  it("creates imported special tasks with source metadata and prompt sections", async () => {
    const { repository } = await createRepository();

    const project = repository.createProject({
      name: "Imported Tasks Project",
      sourceType: "local",
      sourceRef: "/workspace/imported-tasks-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Imported Tasks Sprint",
    });
    const prerequisite = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Prerequisite task",
    });

    const [securityTask, mergeConflictTask, failedCiTask] = repository.createImportedTasks(project.id, sprint.id, [
      {
        kind: "security",
        title: "Security review import",
        sourceUrl: "https://github.com/acme/widgets/issues/12",
        provider: "github",
        repository: "acme/widgets",
        labels: ["security", "urgent"],
        priority: "critical",
      },
      {
        kind: "merge_conflict",
        title: "Merge conflict import",
        sourcePath: "/tmp/merge-conflict.log",
        provider: "github",
        repository: "acme/widgets",
        branch: "feature/imported-task",
        baseBranch: "main",
        pullRequestNumber: 17,
        pullRequestUrl: "https://github.com/acme/widgets/pull/17",
        commitSha: "abc1234",
        errorMessage: "Auto-merge failed with conflict markers.",
      },
      {
        kind: "failed_ci",
        title: "Failed CI import",
        sourceUrl: "https://github.com/acme/widgets/actions/runs/55",
        provider: "github",
        repository: "acme/widgets",
        branch: "feature/imported-task",
        baseBranch: "main",
        workflowRunId: "55",
        workflowRunUrl: "https://github.com/acme/widgets/actions/runs/55",
        commitSha: "def5678",
        errorMessage: "npm test failed with exit code 1",
        dependsOnTaskIds: [prerequisite.id],
      },
    ]);

    expect(securityTask).toMatchObject({
      priority: "critical",
      executorType: "auto",
      sourceType: "import:security",
      sourcePath: "https://github.com/acme/widgets/issues/12",
      agentPresetId: null,
      isIndependent: true,
      dependsOnTaskIds: [],
    });
    expect(securityTask.promptMarkdown).toContain("## Objective");
    expect(securityTask.promptMarkdown).toContain("## Source");
    expect(securityTask.promptMarkdown).toContain("## Context");
    expect(securityTask.promptMarkdown).toContain("Imported security work item.");
    expect(securityTask.promptMarkdown).toContain("acme/widgets");
    expect(securityTask.promptMarkdown).toContain("Priority: critical");

    expect(mergeConflictTask).toMatchObject({
      priority: "critical",
      executorType: "auto",
      sourceType: "import:merge_conflict",
      sourcePath: "/tmp/merge-conflict.log",
      isIndependent: true,
      dependsOnTaskIds: [],
    });
    expect(mergeConflictTask.promptMarkdown).toContain("### Branch Details");
    expect(mergeConflictTask.promptMarkdown).toContain("feature/imported-task");
    expect(mergeConflictTask.promptMarkdown).toContain("main");
    expect(mergeConflictTask.promptMarkdown).toContain("Pull request: #17");

    expect(failedCiTask).toMatchObject({
      priority: "high",
      executorType: "auto",
      sourceType: "import:failed_ci",
      sourcePath: "https://github.com/acme/widgets/actions/runs/55",
      isIndependent: false,
      dependsOnTaskIds: [prerequisite.id],
    });
    expect(failedCiTask.promptMarkdown).toContain("### CI Run Details");
    expect(failedCiTask.promptMarkdown).toContain("Workflow run ID: 55");
    expect(failedCiTask.promptMarkdown).toContain("npm test failed with exit code 1");

    const tasks = repository.listTasks(project.id, sprint.id);
    expect(tasks).toHaveLength(4);
    expect(repository.listSprintLinkedIssues(project.id, sprint.id)).toHaveLength(0);
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
      lastRunAt: null,
      lastRunStatus: null,
    });
  });

  it("tracks the latest run activity for git projects", async () => {
    const { repository, storage } = await createRepository();
    const project = repository.createProject({
      name: "Git Project",
      sourceType: "git",
      sourceRef: "https://github.com/acme/widgets.git",
    });

    const sprint = repository.createSprint(project.id, {
      name: "Sprint 1",
    });
    const task = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Task 1",
    });

    const db = storage.getDatabase();
    db.prepare(`
      INSERT INTO sprint_runs (
        id, project_id, sprint_id, status, trigger_type, executor_mode,
        started_at, finished_at, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sprint-run-1",
      project.id,
      sprint.id,
      "running",
      "manual",
      "mixed",
      null,
      null,
      null,
      "2026-03-09T12:00:00.000Z",
      "2026-03-09T12:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO task_runs (
        id, project_id, sprint_id, task_id, state, started_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "task-run-1",
      project.id,
      sprint.id,
      task.id,
      "COMPLETED",
      "2026-03-09T12:30:00.000Z",
    );

    const updated = repository.getProject(project.id);
    expect(updated).not.toBeNull();
    expect(updated).toMatchObject({
      sourceType: "git",
      repoUrl: "https://github.com/acme/widgets.git",
      lastRunAt: "2026-03-09T12:30:00.000Z",
      lastRunStatus: "COMPLETED",
    });
  });

  it("loads project and sprint summaries through batched aggregation helpers", async () => {
    const { repository, storage } = await createRepository();
    const projectA = repository.createProject({
      name: "Batch Summary A",
      sourceType: "local",
      sourceRef: "/workspace/batch-summary-a",
    });
    const projectB = repository.createProject({
      name: "Batch Summary B",
      sourceType: "local",
      sourceRef: "/workspace/batch-summary-b",
    });

    const sprintA1 = repository.createSprint(projectA.id, {
      name: "A Sprint 1",
      number: 1,
      status: "running",
    });
    const sprintA2 = repository.createSprint(projectA.id, {
      name: "A Sprint 2",
      number: 2,
      status: "idle",
    });
    const sprintB1 = repository.createSprint(projectB.id, {
      name: "B Sprint 1",
      number: 1,
      status: "idle",
    });

    const taskA1 = repository.createTask(projectA.id, {
      sprintId: sprintA1.id,
      title: "A1 Task 1",
      status: "completed",
    });
    repository.createTask(projectA.id, {
      sprintId: sprintA1.id,
      title: "A1 Task 2",
      status: "completed",
    });
    repository.createTask(projectA.id, {
      sprintId: sprintA1.id,
      title: "A1 Task 3",
      status: "pending",
    });
    repository.createTask(projectA.id, {
      sprintId: sprintA2.id,
      title: "A2 Task 1",
      status: "pending",
    });
    repository.createTask(projectA.id, {
      sprintId: sprintA2.id,
      title: "A2 Task 2",
      status: "in_progress",
    });
    repository.createTask(projectB.id, {
      sprintId: sprintB1.id,
      title: "B1 Task 1",
      status: "completed",
    });

    repository.replaceSprintLinkedIssues(projectA.id, sprintA1.id, [{
      provider: "github",
      hostDomain: "github.com",
      repository: "acme/widgets",
      issueNumber: 42,
      title: "Batch summary linked issue",
      url: "https://github.com/acme/widgets/issues/42",
      state: "open",
    }]);

    const db = storage.getDatabase();
    db.prepare(`
      INSERT INTO sprint_runs (
        id, project_id, sprint_id, status, trigger_type, executor_mode,
        started_at, finished_at, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "batch-summary-sprint-run-old",
      projectA.id,
      sprintA1.id,
      "running",
      "manual",
      "mixed",
      "2026-03-09T10:00:00.000Z",
      null,
      null,
      "2026-03-09T10:00:00.000Z",
      "2026-03-09T10:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO sprint_runs (
        id, project_id, sprint_id, status, trigger_type, executor_mode,
        started_at, finished_at, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "batch-summary-sprint-run-latest",
      projectA.id,
      sprintA1.id,
      "cancelled",
      "manual",
      "mixed",
      "2026-03-09T11:00:00.000Z",
      "2026-03-09T11:30:00.000Z",
      null,
      "2026-03-09T11:00:00.000Z",
      "2026-03-09T11:30:00.000Z",
    );
    db.prepare(`
      INSERT INTO sprint_runs (
        id, project_id, sprint_id, status, trigger_type, executor_mode,
        started_at, finished_at, last_heartbeat_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "batch-summary-sprint-run-active",
      projectA.id,
      sprintA2.id,
      "running",
      "manual",
      "mixed",
      "2026-03-09T12:00:00.000Z",
      null,
      null,
      "2026-03-09T12:00:00.000Z",
      "2026-03-09T12:00:00.000Z",
    );
    db.prepare(`
      INSERT INTO task_runs (
        id, project_id, sprint_id, task_id, state, started_at
      ) VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      "batch-summary-task-run-latest",
      projectA.id,
      sprintA1.id,
      taskA1.id,
      "COMPLETED",
      "2026-03-09T12:30:00.000Z",
    );
    db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, trigger_type, status, outcome, run_index,
        summary_markdown, payload_json, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'sprint_completion', 'completed', 'pass', 1, ?, ?, 'QA Bot', ?, ?, ?, ?)
    `).run(
      "batch-summary-qa",
      projectA.id,
      sprintA1.id,
      "Batch summary looks good.",
      JSON.stringify({ findings: ["Verified batching"] }),
      "2026-03-09T13:00:00.000Z",
      "2026-03-09T13:05:00.000Z",
      "2026-03-09T13:00:00.000Z",
      "2026-03-09T13:05:00.000Z",
    );

    const executeSpy = vi.spyOn(storage, "executeChunkedInQuery");

    const projects = repository.listProjects().projects;
    const mappedProjectA = projects.find((project) => project.id === projectA.id);
    const mappedProjectB = projects.find((project) => project.id === projectB.id);

    expect(mappedProjectA).toMatchObject({
      sprintsCount: 2,
      completedTasks: 2,
      openTasks: 3,
      isRunning: true,
      status: "running",
      lastRunAt: "2026-03-09T12:30:00.000Z",
      lastRunStatus: "COMPLETED",
    });
    expect(mappedProjectB).toMatchObject({
      sprintsCount: 1,
      completedTasks: 1,
      openTasks: 0,
      isRunning: false,
      status: "idle",
      lastRunAt: null,
      lastRunStatus: null,
    });

    const projectBatchSql = executeSpy.mock.calls.map(([params]) => `${params.sqlPrefix} ${params.sqlSuffix || ""}`);
    expect(projectBatchSql.some((sql) => sql.includes("FROM sprints") && sql.includes("COUNT(*) AS sprints_count"))).toBe(true);
    expect(projectBatchSql.some((sql) => sql.includes("FROM tasks") && sql.includes("completed_tasks"))).toBe(true);
    expect(projectBatchSql.some((sql) => sql.includes("latest_sprint_runs"))).toBe(true);
    expect(projectBatchSql.some((sql) => sql.includes("project_run_activity"))).toBe(true);
    for (const [params] of executeSpy.mock.calls.filter(([params]) => params.sqlPrefix.includes("sprints_count")
      || params.sqlPrefix.includes("completed_tasks")
      || params.sqlPrefix.includes("latest_sprint_runs")
      || params.sqlPrefix.includes("project_run_activity"))) {
      expect(params.items).toEqual(expect.arrayContaining([projectA.id, projectB.id]));
    }

    executeSpy.mockClear();

    const sprints = repository.listSprints(projectA.id).sprints;
    const mappedSprintA1 = sprints.find((sprint) => sprint.id === sprintA1.id);
    const mappedSprintA2 = sprints.find((sprint) => sprint.id === sprintA2.id);

    expect(sprints.map((sprint) => sprint.id)).toEqual([sprintA2.id, sprintA1.id]);
    expect(mappedSprintA1).toMatchObject({
      tasksCount: 3,
      completion: 66.7,
      status: "cancelled",
      linkedIssues: [{
        issueNumber: 42,
        title: "Batch summary linked issue",
      }],
      latestReview: {
        status: "completed",
        outcome: "pass",
        summary: "Batch summary looks good.",
        findings: ["Verified batching"],
        reviewer: "QA Bot",
        finishedAt: "2026-03-09T13:05:00.000Z",
      },
    });
    expect(mappedSprintA2).toMatchObject({
      tasksCount: 2,
      completion: 0,
      status: "running",
      linkedIssues: [],
    });

    const sprintBatchSql = executeSpy.mock.calls.map(([params]) => `${params.sqlPrefix} ${params.sqlSuffix || ""}`);
    expect(sprintBatchSql.some((sql) => sql.includes("FROM tasks") && sql.includes("coding_tool_call_count"))).toBe(true);
    expect(sprintBatchSql.some((sql) => sql.includes("FROM sprint_runs"))).toBe(true);
    expect(sprintBatchSql.some((sql) => sql.includes("FROM qa_review_runs"))).toBe(true);
    expect(sprintBatchSql.some((sql) => sql.includes("FROM sprint_linked_issues"))).toBe(true);
    expect(executeSpy.mock.calls.some(([params]) => params.sqlPrefix.includes("coding_tool_call_count")
      && params.items.includes(sprintA1.id)
      && params.items.includes(sprintA2.id))).toBe(true);
    expect(executeSpy.mock.calls.some(([params]) => params.sqlPrefix.includes("FROM sprint_runs")
      && params.items.includes(sprintA1.id)
      && params.items.includes(sprintA2.id))).toBe(true);
    expect(executeSpy.mock.calls.some(([params]) => params.sqlPrefix.includes("FROM qa_review_runs")
      && params.items.includes(sprintA1.id)
      && params.items.includes(sprintA2.id))).toBe(true);
    expect(executeSpy.mock.calls.some(([params]) => params.sqlPrefix.includes("FROM sprint_linked_issues")
      && params.items.includes(sprintA1.id)
      && params.items.includes(sprintA2.id))).toBe(true);
  });

  it("hydrates weighted sprint completion from lifecycle state and task-coding telemetry", async () => {
    const { repository, executionRepository } = await createRepository();
    const project = repository.createProject({
      name: "Weighted Sprint Summary",
      sourceType: "local",
      sourceRef: "/workspace/weighted-sprint-summary",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Weighted Progress",
    });
    const tasks = Array.from({ length: 10 }, (_, index) => repository.createTask(project.id, {
      sprintId: sprint.id,
      title: `Weighted task ${index + 1}`,
      status: index === 0 ? "in_progress" : "pending",
    }));
    const activeTask = tasks[0];

    const addInvocation = (purpose: "task_coding" | "planning" | "ci_fix" | "qa_review", toolCallCount: number): void => {
      const invocation = executionRepository.createProviderInvocationUsage({
        projectId: project.id,
        sprintId: sprint.id,
        taskId: activeTask.id,
        sessionId: `weighted-${purpose}-${toolCallCount}`,
        provider: "codex",
        purpose,
        status: "completed",
      });
      executionRepository.updateProviderInvocationUsage(invocation.id, { toolCallCount });
    };

    addInvocation("task_coding", 10);
    addInvocation("task_coding", 5);
    addInvocation("planning", 500);
    addInvocation("ci_fix", 500);
    addInvocation("qa_review", 500);

    expect(repository.listSprints(project.id).sprints[0]).toMatchObject({
      tasksCount: 10,
      completion: 0.8,
    });
    expect(repository.listProjects().projects[0].completedTasks).toBe(0);

    repository.updateTask(activeTask.id, { status: "coding_completed" });
    expect(repository.listSprints(project.id).sprints[0].completion).toBe(5);

    repository.updateTask(activeTask.id, { mergeIndicator: "CI" });
    expect(repository.listSprints(project.id).sprints[0].completion).toBe(7.5);

    repository.updateTask(activeTask.id, {
      status: "in_progress",
      isMerged: true,
      mergeIndicator: null,
    });
    expect(repository.listSprints(project.id).sprints[0].completion).toBe(0.8);
    expect(repository.listProjects().projects[0].completedTasks).toBe(0);

    repository.updateTask(activeTask.id, {
      status: "coding_completed",
      isMerged: false,
    });
    expect(repository.listSprints(project.id).sprints[0].completion).toBe(5);

    repository.updateTask(activeTask.id, { status: "completed" });
    expect(repository.listSprints(project.id).sprints[0]).toMatchObject({
      tasksCount: 10,
      completion: 10,
    });
    expect(repository.listProjects().projects[0].completedTasks).toBe(1);
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

  it("includes latest task self-reflection ratings in listTasks and omits unrated tasks", async () => {
    const { storage, repository, executionRepository } = await createRepository();
    const ratingRepository = new TaskSelfReflectionRatingRepository(storage);

    const project = repository.createProject({
      name: "Task Self Reflection Project",
      sourceType: "local",
      sourceRef: "/tmp/task-self-reflection",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Task Self Reflection Sprint",
      goal: "Expose task self-reflection state",
    });
    const ratedTask = repository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Rated task",
    });
    const unratedTask = repository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T2",
      title: "Unrated task",
    });
    const olderRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: ratedTask.id,
      provider: "codex",
      state: "COMPLETED",
    });
    const latestRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: ratedTask.id,
      provider: "codex",
      state: "COMPLETED",
    });

    ratingRepository.upsertForTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: ratedTask.id,
      sourceTaskRunId: olderRun.id,
      overallRating: 2,
      sections: [
        { label: "Implementation", normalizedLabel: "implementation", rating: 2, note: "Earlier run" },
      ],
      capturedAt: "2026-06-01T10:00:00.000Z",
    });
    ratingRepository.upsertForTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: ratedTask.id,
      sourceTaskRunId: latestRun.id,
      overallRating: 4,
      sections: [
        { label: "Tests", normalizedLabel: "tests", rating: 5, note: "Covered" },
      ],
      capturedAt: "2026-06-01T10:00:00.000Z",
    });

    const tasks = repository.listTasks(project.id, sprint.id);
    const mappedRated = tasks.find((task) => task.id === ratedTask.id);
    const mappedUnrated = tasks.find((task) => task.id === unratedTask.id);

    expect(mappedUnrated?.selfReflectionRating).toBeUndefined();
    expect(mappedRated?.selfReflectionRating).toMatchObject({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: ratedTask.id,
      sourceTaskRunId: latestRun.id,
      overallRating: 4,
      sections: [
        { label: "Tests", normalizedLabel: "tests", rating: 5, note: "Covered" },
      ],
      capturedAt: "2026-06-01T10:00:00.000Z",
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

  it("persists non-numeric external linked sources by external id", async () => {
    const { repository } = await createRepository();
    const project = repository.createProject({
      name: "External Source Project",
      sourceType: "local",
      sourceRef: "/workspace/external-source-project",
    });
    const sprint = repository.createSprint(project.id, {
      name: "External Source Sprint",
    });

    const linked = repository.replaceSprintLinkedIssues(project.id, sprint.id, [
      {
        provider: "notion",
        sourceProvider: "notion",
        sourceKind: "page",
        externalId: "page-123",
        hostDomain: "api.notion.com",
        repository: "workspace-alpha",
        title: "Document onboarding flow",
        url: "https://notion.test/page-123",
        labels: ["docs", " docs "],
      },
      {
        provider: "notion",
        sourceKind: "page",
        externalId: "page-123",
        hostDomain: "API.NOTION.COM",
        repository: "/workspace-alpha/",
        title: "Duplicate should be ignored",
        url: "https://notion.test/page-123",
      },
      {
        provider: "figma",
        sourceKind: "file",
        externalId: "figma-file-1",
        hostDomain: "api.figma.com",
        repository: "design-team",
        title: "Canvas annotations",
        url: "https://figma.test/file/figma-file-1",
        issueKey: "FIGMA-file-1",
      },
    ]);

    expect(linked).toHaveLength(2);
    expect(linked[0]).toMatchObject({
      provider: "figma",
      sourceProvider: "figma",
      sourceKind: "file",
      externalId: "figma-file-1",
      issueNumber: null,
      issueKey: "FIGMA-file-1",
    });
    expect(linked[1]).toMatchObject({
      provider: "notion",
      sourceProvider: "notion",
      sourceKind: "page",
      externalId: "page-123",
      hostDomain: "api.notion.com",
      repository: "workspace-alpha",
      issueNumber: null,
      issueKey: "page-123",
      labels: ["docs"],
    });

    expect(repository.getSprint(sprint.id)?.linkedIssues.map((issue) => issue.externalId)).toEqual([
      "figma-file-1",
      "page-123",
    ]);
  });

  it("round-trips Jira linked issue prompt context through sprint reloads and updates", async () => {
    const { repository, storage } = await createRepository();
    const project = repository.createProject({
      name: "Jira Context Project",
      sourceType: "local",
      sourceRef: "/workspace/jira-context-project",
    });

    const sprint = repository.createSprint(project.id, {
      name: "Jira Context Sprint",
      linkedIssues: [{
        provider: "jira",
        sourceProvider: "jira",
        sourceKind: "issue",
        externalId: "jira-10042",
        hostDomain: "jira.example.test",
        projectKey: "OPS",
        repository: "OPS",
        issueNumber: 42,
        issueKey: "OPS-42",
        title: "Preserve imported Jira context",
        url: "https://jira.example.test/browse/OPS-42",
        state: "In Progress",
        labels: ["imports", "planning"],
        assignees: ["casey"],
        issueBodyMarkdown: "## Problem\n\nImported Jira description with acceptance criteria.",
        issueConversationMarkdown: "- Morgan: Can we keep the existing labels?\n- Casey: Yes, keep them.",
        includeConversation: true,
        issueAuthor: "Morgan Reporter",
        issueCreatedAt: "2026-05-17T10:00:00.000Z",
        issueUpdatedAt: "2026-05-18T11:30:00.000Z",
        metadata: {
          issueType: "Bug",
          priority: "High",
          apiToken: "should-not-persist",
          nested: {
            safe: "visible",
            authorization: "Bearer should-not-persist",
          },
        },
      }],
    });

    const loadedIssue = repository.getSprint(sprint.id)?.linkedIssues[0];
    expect(loadedIssue).toMatchObject({
      provider: "jira",
      sourceProvider: "jira",
      sourceKind: "issue",
      externalId: "jira-10042",
      hostDomain: "jira.example.test",
      projectKey: "OPS",
      repository: "OPS",
      issueNumber: 42,
      issueKey: "OPS-42",
      title: "Preserve imported Jira context",
      state: "In Progress",
      labels: ["imports", "planning"],
      assignees: ["casey"],
      issueBodyMarkdown: "## Problem\n\nImported Jira description with acceptance criteria.",
      issueConversationMarkdown: "- Morgan: Can we keep the existing labels?\n- Casey: Yes, keep them.",
      includeConversation: true,
      issueAuthor: "Morgan Reporter",
      issueCreatedAt: "2026-05-17T10:00:00.000Z",
      issueUpdatedAt: "2026-05-18T11:30:00.000Z",
      metadata: {
        issueType: "Bug",
        priority: "High",
        nested: {
          safe: "visible",
        },
      },
    });

    expect(loadedIssue?.metadata).not.toHaveProperty("apiToken");
    expect(loadedIssue?.metadata?.nested).not.toHaveProperty("authorization");

    repository.updateSprint(sprint.id, {
      name: "Jira Context Sprint Updated",
      linkedIssues: loadedIssue ? [loadedIssue] : [],
    });

    const updatedIssue = repository.getSprint(sprint.id)?.linkedIssues[0];
    expect(updatedIssue).toMatchObject({
      issueBodyMarkdown: "## Problem\n\nImported Jira description with acceptance criteria.",
      issueConversationMarkdown: "- Morgan: Can we keep the existing labels?\n- Casey: Yes, keep them.",
      includeConversation: true,
      issueAuthor: "Morgan Reporter",
      issueCreatedAt: "2026-05-17T10:00:00.000Z",
      issueUpdatedAt: "2026-05-18T11:30:00.000Z",
      metadata: {
        issueType: "Bug",
        priority: "High",
        nested: {
          safe: "visible",
        },
      },
    });

    const dbRow = storage.getDatabase().prepare(`
      SELECT issue_body_markdown, issue_conversation_markdown, include_conversation, issue_author, issue_created_at, issue_updated_at, metadata_json
      FROM sprint_linked_issues
      WHERE sprint_id = ?
    `).get(sprint.id) as {
      issue_body_markdown: string | null;
      issue_conversation_markdown: string | null;
      include_conversation: number | null;
      issue_author: string | null;
      issue_created_at: string | null;
      issue_updated_at: string | null;
      metadata_json: string | null;
    };
    expect(dbRow.issue_body_markdown).toBe("## Problem\n\nImported Jira description with acceptance criteria.");
    expect(dbRow.issue_conversation_markdown).toBe("- Morgan: Can we keep the existing labels?\n- Casey: Yes, keep them.");
    expect(dbRow.include_conversation).toBe(1);
    expect(dbRow.issue_author).toBe("Morgan Reporter");
    expect(dbRow.issue_created_at).toBe("2026-05-17T10:00:00.000Z");
    expect(dbRow.issue_updated_at).toBe("2026-05-18T11:30:00.000Z");
    expect(JSON.parse(dbRow.metadata_json || "{}")).toEqual({
      issueType: "Bug",
      priority: "High",
      nested: {
        safe: "visible",
      },
    });
  });

  it("keeps backward-compatible numeric linked issue storage", async () => {
    const { repository, storage } = await createRepository();
    const project = repository.createProject({
      name: "Numeric Issue Project",
      sourceType: "git",
      sourceRef: "https://github.com/acme/widgets.git",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Numeric Issue Sprint",
    });

    const [issue] = repository.replaceSprintLinkedIssues(project.id, sprint.id, [
      {
        provider: "github",
        hostDomain: "github.com",
        repository: "acme/widgets",
        issueNumber: 7,
        title: "Keep issue number",
        url: "https://github.com/acme/widgets/issues/7",
      },
    ]);

    expect(issue).toMatchObject({
      provider: "github",
      sourceProvider: "github",
      sourceKind: "issue",
      externalId: null,
      issueNumber: 7,
      issueKey: "#7",
    });

    const dbRow = storage.getDatabase().prepare(`
      SELECT issue_number, external_id, source_kind
      FROM sprint_linked_issues
      WHERE id = ?
    `).get(issue.id) as { issue_number: number | null; external_id: string | null; source_kind: string | null };
    expect(dbRow).toEqual({
      issue_number: 7,
      external_id: null,
      source_kind: "issue",
    });
  });

  it("migrates old linked issue tables to nullable external source columns", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-linked-issue-migration-"));
    tempDirs.push(dir);
    const db = new SqliteDatabaseAdapter(path.join(dir, "app.db"));
    try {
      db.exec(`
        CREATE TABLE projects (
          id TEXT PRIMARY KEY,
          slug TEXT NOT NULL UNIQUE,
          name TEXT NOT NULL,
          base_dir TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE sprints (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          slug TEXT NOT NULL,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE sprint_linked_issues (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          sprint_id TEXT NOT NULL,
          provider TEXT NOT NULL,
          host_domain TEXT NOT NULL,
          repository TEXT NOT NULL,
          issue_number INTEGER NOT NULL,
          issue_key TEXT NOT NULL,
          title TEXT NOT NULL,
          url TEXT NOT NULL,
          state TEXT NOT NULL DEFAULT 'open',
          labels_json TEXT NOT NULL DEFAULT '[]',
          assignees_json TEXT NOT NULL DEFAULT '[]',
          imported_at TEXT NOT NULL,
          closed_at TEXT,
          close_state TEXT NOT NULL DEFAULT 'open',
          close_error TEXT,
          updated_at TEXT NOT NULL
        );
      `);
      db.prepare(`
        INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "project-1",
        "project-1",
        "Migration Project",
        "/workspace/migration-project",
        "2026-05-17T00:00:00.000Z",
        "2026-05-17T00:00:00.000Z",
      );
      db.prepare(`
        INSERT INTO sprints (id, project_id, slug, name, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        "sprint-1",
        "project-1",
        "sprint-1",
        "Migration Sprint",
        "2026-05-17T00:00:00.000Z",
        "2026-05-17T00:00:00.000Z",
      );
      db.prepare(`
        INSERT INTO sprint_linked_issues (
          id, project_id, sprint_id, provider, host_domain, repository, issue_number,
          issue_key, title, url, state, labels_json, assignees_json, imported_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "issue-1",
        "project-1",
        "sprint-1",
        "github",
        "github.com",
        "acme/widgets",
        42,
        "#42",
        "Existing issue",
        "https://github.com/acme/widgets/issues/42",
        "open",
        "[]",
        "[]",
        "2026-05-17T00:00:00.000Z",
        "2026-05-17T00:00:00.000Z",
      );

      migrateSprintLinkedIssuesExternalSources(db);

      const columns = db.prepare("PRAGMA table_info(sprint_linked_issues)").all() as Array<{ name: string; notnull: number }>;
      expect(columns.find((column) => column.name === "issue_number")?.notnull).toBe(0);
      expect(columns.map((column) => column.name)).toEqual(expect.arrayContaining([
        "project_key",
        "external_id",
        "source_kind",
        "issue_body_markdown",
        "issue_conversation_markdown",
        "include_conversation",
        "issue_author",
        "issue_created_at",
        "issue_updated_at",
        "metadata_json",
      ]));

      db.prepare(`
        INSERT INTO sprint_linked_issues (
          id, project_id, sprint_id, provider, host_domain, repository, issue_number, external_id,
          source_kind, issue_key, title, url, state, labels_json, assignees_json, issue_body_markdown,
          issue_conversation_markdown, include_conversation, issue_author, issue_created_at, issue_updated_at,
          metadata_json, imported_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "external-1",
        "project-1",
        "sprint-1",
        "notion",
        "api.notion.com",
        "workspace-alpha",
        null,
        "page-1",
        "page",
        "page-1",
        "Migrated external page",
        "https://notion.test/page-1",
        "open",
        "[]",
        "[]",
        "Persisted external body",
        "Persisted external conversation",
        1,
        "Morgan Reporter",
        "2026-05-16T00:00:00.000Z",
        "2026-05-17T00:00:00.000Z",
        JSON.stringify({ priority: "High" }),
        "2026-05-17T00:00:00.000Z",
        "2026-05-17T00:00:00.000Z",
      );

      const rows = db.prepare(`
        SELECT id, issue_number, external_id, source_kind, issue_body_markdown, issue_conversation_markdown,
          include_conversation, issue_author, issue_created_at, issue_updated_at, metadata_json
        FROM sprint_linked_issues
        ORDER BY id
      `).all();
      expect(rows).toEqual([
        {
          id: "external-1",
          issue_number: null,
          external_id: "page-1",
          source_kind: "page",
          issue_body_markdown: "Persisted external body",
          issue_conversation_markdown: "Persisted external conversation",
          include_conversation: 1,
          issue_author: "Morgan Reporter",
          issue_created_at: "2026-05-16T00:00:00.000Z",
          issue_updated_at: "2026-05-17T00:00:00.000Z",
          metadata_json: JSON.stringify({ priority: "High" }),
        },
        {
          id: "issue-1",
          issue_number: 42,
          external_id: null,
          source_kind: null,
          issue_body_markdown: null,
          issue_conversation_markdown: null,
          include_conversation: null,
          issue_author: null,
          issue_created_at: null,
          issue_updated_at: null,
          metadata_json: null,
        },
      ]);
    } finally {
      db.close();
    }
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

  it("does not restore a worker-resolved merge conflict marker during direct task updates", async () => {
    const { repository, storage } = await createRepository();
    const project = repository.createProject({
      name: "Direct Resolved Conflict",
      sourceType: "local",
      sourceRef: "/workspace/direct-resolved-conflict",
    });
    const sprint = repository.createSprint(project.id, {
      name: "Sprint 1",
    });
    const task = repository.createTask(project.id, {
      sprintId: sprint.id,
      title: "Resolved conflict task",
      promptMarkdown: "Resolve the branch conflict.",
      status: "coding_completed",
      mergeIndicator: "MERGE_CONFLICT",
    });

    const now = "2026-07-07T12:00:00.000Z";
    storage.getDatabase().getRawDatabase().prepare(`
      INSERT INTO project_attention_items (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id,
        attention_type, severity, owner_type, status, assigned_worker_endpoint_id,
        title, summary_markdown, payload_json, opened_at, claimed_at, resolved_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, NULL, ?, ?, ?, ?, NULL, ?, ?)
    `).run(
      "direct-resolved-conflict-attention",
      project.id,
      sprint.id,
      task.id,
      "merge_conflict",
      "high",
      "worker",
      "resolved",
      "Merge conflict for T01",
      "Virtual worker resolved this conflict.",
      JSON.stringify({
        resolutionReason: "virtual_worker_merge_conflict_already_resolved",
        conflictingBranches: {
          source: "task/direct-resolved-conflict-t01",
          target: "feature/direct-resolved-conflict",
        },
      }),
      now,
      now,
      now,
    );

    const updated = repository.updateTask(task.id, {
      status: "coding_completed",
      mergeIndicator: "MERGE_CONFLICT",
      mergeConflictSourceBranch: "task/direct-resolved-conflict-t01",
      mergeConflictTargetBranch: "feature/direct-resolved-conflict",
    });

    expect(updated.mergeIndicator).toBeNull();
  });
});
