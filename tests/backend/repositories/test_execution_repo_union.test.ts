import { expect, test } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from '../../../src/repositories/app-db-storage';
import { ExecutionRepository } from '../../../src/repositories/execution-repository';
import { ProjectManagementRepository } from '../../../src/repositories/project-management-repository';

test("wall time union and active task runs", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"));
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  const projectRepository = new ProjectManagementRepository(storage);
  const executionRepository = new ExecutionRepository(storage);

  const project = projectRepository.createProject({
    name: "Wall Time Project",
    sourceType: "local",
    sourceRef: "/workspace/wall-time",
  });

  const sprint = projectRepository.createSprint(project.id, {
    name: "Wall Time Sprint",
    number: 1,
    status: "running",
  });

  const task1 = projectRepository.createTask(project.id, {
    sprintId: sprint.id,
    title: "Task with invocations but no task runs in range",
  });

  const task2 = projectRepository.createTask(project.id, {
    sprintId: sprint.id,
    title: "Task with task runs but no invocations",
  });

  const task3 = projectRepository.createTask(project.id, {
    sprintId: sprint.id,
    title: "Running task with no finished_at",
  });

  const sprintRun = executionRepository.createSprintRun({
    projectId: project.id,
    sprintId: sprint.id,
    status: "running",
    executorMode: "mixed",
  });

  const now = Date.now();
  const startedAt = new Date(now - 300_000).toISOString();
  const finishedAt = new Date(now - 100_000).toISOString();

  const dispatch1 = executionRepository.createTaskDispatch({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task1.id,
    sprintRunId: sprintRun.id,
    executorType: "docker_cli",
    status: "completed",
  });

  const run1 = executionRepository.createTaskRun({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task1.id,
    sprintRunId: sprintRun.id,
    dispatchId: dispatch1.id,
    provider: "codex",
    state: "completed",
    sessionId: "run1",
    startedAt,
    finishedAt,
    durationMs: 0,
  });

  executionRepository.createProviderInvocationUsage({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task1.id,
    sprintRunId: sprintRun.id,
    dispatchId: dispatch1.id,
    taskRunId: run1.id,
    attentionItemId: null,
    sessionId: "s1",
    provider: "codex",
    purpose: "task_coding",
    status: "success",
    startedAt,
    finishedAt,
    durationMs: 150_000,
    promptChars: 100,
    transcriptChars: 100,
    inputTokens: 10,
    cachedInputTokens: 0,
    outputTokens: 10,
    reasoningOutputTokens: 0,
    totalTokens: 20,
    usageSource: "reported",
    rawUsageJson: null,
  });

  const dispatch2 = executionRepository.createTaskDispatch({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task2.id,
    sprintRunId: sprintRun.id,
    executorType: "docker_cli",
    status: "completed",
  });

  // Task 2: Task run recorded, no invocations
  executionRepository.createTaskRun({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task2.id,
    sprintRunId: sprintRun.id,
    dispatchId: dispatch2.id,
    provider: "codex",
    state: "completed",
    sessionId: "run2",
    startedAt,
    finishedAt,
    durationMs: 200_000,
  });

  const dispatch3 = executionRepository.createTaskDispatch({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task3.id,
    sprintRunId: sprintRun.id,
    executorType: "docker_cli",
    status: "running",
  });

  // Task 3: Running task run, no finished_at
  executionRepository.createTaskRun({
    projectId: project.id,
    sprintId: sprint.id,
    taskId: task3.id,
    sprintRunId: sprintRun.id,
    dispatchId: dispatch3.id,
    provider: "codex",
    state: "running",
    sessionId: "run3",
    startedAt,
    finishedAt: null,
    durationMs: null,
  });

  const stats = executionRepository.getProjectStatsSnapshot(project.id, "all");

  console.log("Task 1 wall time:", stats.tasks.find(t => t.id === task1.id)?.usage.wallTimeMs);
  console.log("Task 2 wall time:", stats.tasks.find(t => t.id === task2.id)?.usage.wallTimeMs);
  console.log("Task 3 wall time:", stats.tasks.find(t => t.id === task3.id)?.usage.wallTimeMs);
  console.log("Total usage wall time:", stats.usage.wallTimeMs);

});
