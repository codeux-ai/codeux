import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { RuntimeStatusProjection } from "../../../../src/repositories/project-runtime/runtime-status-projection.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import { TaskSelfReflectionRatingRepository } from "../../../../src/repositories/task-self-reflection-rating-repository.js";

const tempDirs: string[] = [];

async function createProjection(): Promise<{
  storage: AppDbStorage;
  projection: RuntimeStatusProjection;
  projectRepository: ProjectManagementRepository;
  executionRepository: ExecutionRepository;
  ratingRepository: TaskSelfReflectionRatingRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-status-projection-test-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    storage,
    projection: new RuntimeStatusProjection(storage, storage.getDatabase()),
    projectRepository: new ProjectManagementRepository(storage),
    executionRepository: new ExecutionRepository(storage),
    ratingRepository: new TaskSelfReflectionRatingRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("RuntimeStatusProjection", () => {
  it("falls back to planned-task status when no run exists", async () => {
    const { projection, projectRepository } = await createProjection();
    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });

    projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "pending",
    });

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.status).toBe("PENDING");
  });

  it("selects the latest run when mapping tasks", async () => {
    const { storage, projection, projectRepository } = await createProjection();
    const db = storage.getDatabase();

    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "pending",
    });

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-1", project.id, sprint.id, task.id, "FAILED", "2024-01-01T10:00:00Z");

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-2", project.id, sprint.id, task.id, "RUNNING", "2024-01-01T11:00:00Z");

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.status).toBe("RUNNING");
  });

  it("keeps completed merged tasks completed when a stale failed run is newer", async () => {
    const { storage, projection, projectRepository } = await createProjection();
    const db = storage.getDatabase();

    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "completed",
      isMerged: true,
      mergeIndicator: "MERGED",
    });

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("run-1", project.id, sprint.id, task.id, "COMPLETED", "2024-01-01T10:00:00Z", "2024-01-01T10:05:00Z");

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, worker_branch, started_at, finished_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("run-2", project.id, sprint.id, task.id, "FAILED", "task/stale-merged-branch", "2024-01-01T11:00:00Z", "2024-01-01T11:01:00Z");

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]).toMatchObject({
      status: "COMPLETED",
      is_merged: true,
      merge_indicator: "MERGED",
    });
    expect(status.subtasks[0]?.worker_branch).toBeUndefined();
  });

  it("projects latest task QA review summaries for live status", async () => {
    const { storage, projection, projectRepository } = await createProjection();
    const db = storage.getDatabase();

    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "coding_completed",
    });

    db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, task_id, trigger_type, status, outcome, run_index,
        target_task_key, summary_markdown, fix_instructions, payload_json, agent_name,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'task_completion', 'running', NULL, 1, ?, ?, ?, ?, 'QA Bot', ?, NULL, ?, ?)
    `).run(
      "run-qa-1",
      project.id,
      sprint.id,
      task.id,
      "T1",
      "Review in progress",
      "Verify the error path before completion.",
      JSON.stringify({
        findings: ["Error path is not verified"],
        followUpTasks: [{
          title: "Verify error path",
          promptMarkdown: "Add a deterministic error-path test.",
          priority: "medium",
        }],
      }),
      "2026-05-30T09:00:00.000Z",
      "2026-05-30T09:00:00.000Z",
      "2026-05-30T09:00:00.000Z",
    );

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.latestReview).toEqual(projectRepository.listTasks(project.id, sprint.id)[0]?.latestReview);
    expect(status.subtasks[0]?.latestReview).toEqual({
      status: "running",
      outcome: null,
      summary: "Review in progress",
      findings: ["Error path is not verified"],
      reviewer: "QA Bot",
      finishedAt: null,
      fixInstructions: "Verify the error path before completion.",
      targetTaskKey: "T1",
      followUpTasks: [{
        title: "Verify error path",
        promptMarkdown: "Add a deterministic error-path test.",
        description: null,
        dependsOnTaskKeys: [],
        priority: "medium",
      }],
    });
  });

  it("projects recent activity correctly", async () => {
    const { storage, projection, projectRepository } = await createProjection();
    const db = storage.getDatabase();

    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Task 1",
      status: "pending",
    });

    db.prepare(`
      INSERT INTO task_runs (id, project_id, sprint_id, task_id, state, started_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run("run-1", project.id, sprint.id, task.id, "RUNNING", "2024-01-01T10:00:00Z");

    db.prepare(`
      INSERT INTO task_run_events (id, task_run_id, project_id, event_type, originator, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "event-1",
      "run-1",
      project.id,
      "provider_activity",
      "agent",
      JSON.stringify({
        activityId: "act-1",
        activityName: "Activity 1",
        agentMessaged: { agentMessage: "Hello" }
      }),
      "2024-01-01T10:05:00Z"
    );

    const status = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(status.subtasks).toHaveLength(1);
    expect(status.subtasks[0]?.activities).toHaveLength(1);
    expect(status.subtasks[0]?.activities?.[0]).toMatchObject({
      id: "act-1",
      originator: "agent",
      agentMessaged: { agentMessage: "Hello" }
    });

    db.prepare(`
      INSERT INTO task_run_events (id, task_run_id, project_id, event_type, originator, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      "event-2",
      "run-1",
      project.id,
      "provider_activity",
      "agent",
      JSON.stringify({
        activityId: "act-2",
        activityName: "Activity 2",
        progressUpdated: { message: "Still working" }
      }),
      "2024-01-01T10:06:00Z"
    );

    const refreshedStatus = projection.buildProjectStatus(project.id, sprint.id, null);

    expect(refreshedStatus.subtasks[0]?.activities?.map((activity) => activity.id)).toEqual(["act-1", "act-2"]);
  });

  it("projects latest task self-reflection ratings for live status and omits unrated tasks", async () => {
    const { projection, projectRepository, executionRepository, ratingRepository } = await createProjection();

    const project = projectRepository.createProject({ name: "Proj", sourceType: "local", sourceRef: "/path" });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const ratedTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "Rated task",
      status: "completed",
    });
    const unratedTask = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T2",
      title: "Unrated task",
      status: "pending",
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
      overallRating: 1,
      sections: [
        { label: "Quality", normalizedLabel: "quality", rating: 1, note: "Older" },
      ],
      capturedAt: "2026-06-01T10:00:00.000Z",
    });
    ratingRepository.upsertForTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: ratedTask.id,
      sourceTaskRunId: latestRun.id,
      overallRating: 5,
      sections: [
        { label: "Quality", normalizedLabel: "quality", rating: 5, note: "Latest" },
      ],
      capturedAt: "2026-06-01T10:05:00.000Z",
    });

    const status = projection.buildProjectStatus(project.id, sprint.id, null);
    const mappedRated = status.subtasks.find((task) => task.record_id === ratedTask.id);
    const mappedUnrated = status.subtasks.find((task) => task.record_id === unratedTask.id);

    expect(mappedUnrated?.selfReflectionRating).toBeUndefined();
    expect(mappedRated?.selfReflectionRating).toMatchObject({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: ratedTask.id,
      sourceTaskRunId: latestRun.id,
      overallRating: 5,
      sections: [
        { label: "Quality", normalizedLabel: "quality", rating: 5, note: "Latest" },
      ],
    });
  });

  it("projects the same persisted CI state as task cards and clears it after settlement", async () => {
    const { storage, projection, projectRepository, executionRepository } = await createProjection();
    const project = projectRepository.createProject({
      name: "Runtime CI Projection",
      sourceType: "local",
      sourceRef: "/workspace/runtime-ci-projection",
    });
    const sprint = projectRepository.createSprint(project.id, { name: "Sprint 1", number: 1 });
    const task = projectRepository.createTask(project.id, {
      sprintId: sprint.id,
      taskKey: "T1",
      title: "CI task",
      status: "in_progress",
      mergeIndicator: "CI",
    });
    const taskRun = executionRepository.createTaskRun({
      projectId: project.id,
      sprintId: sprint.id,
      taskId: task.id,
      state: "RUNNING",
    });

    expect(projection.buildProjectStatus(project.id, sprint.id, null).subtasks[0]?.ciStatus).toBe("pending");

    executionRepository.appendTaskRunEvent(taskRun.id, "ci_gate_status", "system", {
      state: "waiting_checks",
      hasPendingChecks: true,
    }, { createdAt: "2026-07-13T11:00:00.000Z" });
    expect(projection.buildProjectStatus(project.id, sprint.id, null).subtasks[0]?.ciStatus).toBe("running");

    const now = "2026-07-13T11:01:00.000Z";
    storage.getDatabase().prepare(`
      INSERT INTO project_attention_items (
        id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id,
        attention_type, severity, owner_type, status, assigned_worker_endpoint_id,
        title, summary_markdown, payload_json, opened_at, claimed_at, resolved_at, updated_at
      ) VALUES (?, ?, ?, ?, NULL, NULL, 'human_escalation_required', 'high', 'human', 'claimed', NULL, ?, ?, ?, ?, ?, NULL, ?)
    `).run(
      "runtime-ci-handoff",
      project.id,
      sprint.id,
      task.id,
      "CI handoff",
      "CI requires human repair.",
      JSON.stringify({ sourceAttentionType: "ci_fix" }),
      now,
      now,
      now,
    );
    expect(projection.buildProjectStatus(project.id, sprint.id, null).subtasks[0]?.ciStatus).toBe("failed");

    storage.getDatabase().prepare(`
      UPDATE project_attention_items
      SET status = 'resolved', resolved_at = ?, updated_at = ?
      WHERE id = 'runtime-ci-handoff'
    `).run("2026-07-13T11:02:00.000Z", "2026-07-13T11:02:00.000Z");
    executionRepository.appendTaskRunEvent(taskRun.id, "ci_gate_status", "system", {
      state: "ready_for_merge",
    }, { createdAt: "2026-07-13T11:03:00.000Z" });

    expect(projection.buildProjectStatus(project.id, sprint.id, null).subtasks[0]?.ciStatus).toBeNull();
  });
});
