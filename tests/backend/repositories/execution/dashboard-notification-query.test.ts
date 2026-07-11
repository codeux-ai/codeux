import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { ExecutionRepository } from "../../../../src/repositories/execution-repository.js";
import { ProjectManagementRepository } from "../../../../src/repositories/project-management-repository.js";

const tempDirs: string[] = [];

async function createRepositories(): Promise<{
  storage: AppDbStorage;
  projects: ProjectManagementRepository;
  execution: ExecutionRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-notifications-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return {
    storage,
    projects: new ProjectManagementRepository(storage),
    execution: new ExecutionRepository(storage),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("DashboardNotificationQuery", () => {
  it("returns an empty typed feed", async () => {
    const { execution } = await createRepositories();

    expect(execution.getDashboardNotifications()).toEqual({ notifications: [], updatedAt: null });
  });

  it("returns active cross-project attention with task and sprint context and suppresses represented failures", async () => {
    const { storage, projects, execution } = await createRepositories();
    const projectOne = projects.createProject({ name: "First Project", sourceType: "local", sourceRef: "/first" });
    const sprintOne = projects.createSprint(projectOne.id, { name: "First Sprint", number: 7 });
    const taskOne = projects.createTask(projectOne.id, { sprintId: sprintOne.id, title: "Repair deployment", promptMarkdown: "Repair it" });
    const projectTwo = projects.createProject({ name: "Second Project", sourceType: "local", sourceRef: "/second" });
    const sprintTwo = projects.createSprint(projectTwo.id, { name: "Second Sprint", number: 12 });
    const db = storage.getDatabase();

    db.prepare(`INSERT INTO sprint_runs
      (id, project_id, sprint_id, status, trigger_type, executor_mode, created_at, updated_at)
      VALUES ('run-one', ?, ?, 'completed', 'manual', 'autonomous', '2026-07-01T10:00:00.000Z', '2026-07-01T10:05:00.000Z')`
    ).run(projectOne.id, sprintOne.id);
    db.prepare(`INSERT INTO task_dispatches
      (id, project_id, sprint_id, task_id, sprint_run_id, executor_type, status, queued_at, finished_at, error_message, created_at, updated_at)
      VALUES ('dispatch-one', ?, ?, ?, 'run-one', 'cli', 'failed', '2026-07-01T10:00:00.000Z', '2026-07-01T10:04:00.000Z', 'Bearer very-secret-token', '2026-07-01T10:00:00.000Z', '2026-07-01T10:04:00.000Z')`
    ).run(projectOne.id, sprintOne.id, taskOne.id);
    db.prepare(`INSERT INTO project_attention_items
      (id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, attention_type, severity, owner_type, status, title, summary_markdown, payload_json, opened_at, updated_at)
      VALUES ('attention-task', ?, ?, ?, 'run-one', 'dispatch-one', 'action_required', 'critical', 'human', 'claimed', 'Operator decision required', '**Choose** the safe recovery path.', '{"apiKey":"must-not-leak"}', '2026-07-01T10:06:00.000Z', '2026-07-01T10:07:00.000Z')`
    ).run(projectOne.id, sprintOne.id, taskOne.id);
    db.prepare(`INSERT INTO project_attention_items
      (id, project_id, sprint_id, attention_type, severity, owner_type, status, title, summary_markdown, opened_at, updated_at)
      VALUES ('attention-sprint', ?, ?, 'manual_attention', 'medium', 'system', 'open', 'Sprint review required', 'Review the sprint stop.', '2026-07-01T10:08:00.000Z', '2026-07-01T10:09:00.000Z')`
    ).run(projectTwo.id, sprintTwo.id);
    db.prepare(`INSERT INTO project_attention_items
      (id, project_id, sprint_id, attention_type, severity, owner_type, status, title, summary_markdown, opened_at, resolved_at, updated_at)
      VALUES ('attention-resolved', ?, ?, 'manual_attention', 'high', 'human', 'resolved', 'Already handled', 'Do not return this.', '2026-07-01T09:00:00.000Z', '2026-07-01T09:01:00.000Z', '2026-07-01T09:01:00.000Z')`
    ).run(projectTwo.id, sprintTwo.id);

    const first = execution.getDashboardNotifications();
    const second = execution.getDashboardNotifications();

    expect(first).toEqual(second);
    expect(first.notifications).toHaveLength(2);
    expect(first.notifications.map((item) => item.id)).toEqual([
      "attention:attention-sprint",
      "attention:attention-task",
    ]);
    expect(first.notifications[1]).toMatchObject({
      kind: "human_intervention",
      severity: "critical",
      projectId: projectOne.id,
      projectName: "First Project",
      sprintId: sprintOne.id,
      sprintName: "First Sprint",
      sprintNumber: 7,
      taskId: taskOne.id,
      taskTitle: "Repair deployment",
      attentionItemId: "attention-task",
      source: { type: "attention_item", id: "attention-task", attentionStatus: "claimed" },
    });
    expect(JSON.stringify(first)).not.toContain("must-not-leak");
    expect(JSON.stringify(first)).not.toContain("very-secret-token");
    expect(JSON.stringify(first)).not.toContain("attention-resolved");
  });

  it("excludes open and claimed worker attention while retaining human and system attention", async () => {
    const { storage, projects, execution } = await createRepositories();
    const project = projects.createProject({ name: "Ownership Project", sourceType: "local", sourceRef: "/ownership" });
    const sprint = projects.createSprint(project.id, { name: "Ownership Sprint", number: 3 });
    const task = projects.createTask(project.id, { sprintId: sprint.id, title: "Recover task", promptMarkdown: "Recover" });
    const db = storage.getDatabase();

    db.prepare(`INSERT INTO sprint_runs
      (id, project_id, sprint_id, status, trigger_type, executor_mode, created_at, updated_at)
      VALUES ('ownership-run', ?, ?, 'completed', 'manual', 'autonomous', '2026-07-01T11:00:00.000Z', '2026-07-01T11:05:00.000Z')`
    ).run(project.id, sprint.id);
    db.prepare(`INSERT INTO task_dispatches
      (id, project_id, sprint_id, task_id, sprint_run_id, executor_type, status, queued_at, finished_at, error_message, created_at, updated_at)
      VALUES ('ownership-dispatch', ?, ?, ?, 'ownership-run', 'cli', 'failed', '2026-07-01T11:00:00.000Z', '2026-07-01T11:04:00.000Z', 'Worker recovery failed', '2026-07-01T11:00:00.000Z', '2026-07-01T11:04:00.000Z')`
    ).run(project.id, sprint.id, task.id);
    const insertAttention = db.prepare(`INSERT INTO project_attention_items
      (id, project_id, sprint_id, task_id, sprint_run_id, dispatch_id, attention_type, severity, owner_type, status, title, summary_markdown, opened_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'action_required', 'high', ?, ?, ?, ?, ?, ?)`);
    insertAttention.run("worker-open", project.id, sprint.id, task.id, "ownership-run", "ownership-dispatch", "worker", "open", "Worker open", "Do not show", "2026-07-01T11:06:00.000Z", "2026-07-01T11:06:00.000Z");
    insertAttention.run("worker-claimed", project.id, sprint.id, null, null, null, "worker", "claimed", "Worker claimed", "Do not show", "2026-07-01T11:07:00.000Z", "2026-07-01T11:07:00.000Z");
    insertAttention.run("human-open", project.id, sprint.id, null, null, null, "human", "open", "Human open", "Show human", "2026-07-01T11:08:00.000Z", "2026-07-01T11:08:00.000Z");
    insertAttention.run("system-claimed", project.id, sprint.id, null, null, null, "system", "claimed", "System claimed", "Show system", "2026-07-01T11:09:00.000Z", "2026-07-01T11:09:00.000Z");

    const feed = execution.getDashboardNotifications();

    expect(feed.notifications.map((item) => item.id)).toEqual([
      "attention:system-claimed",
      "attention:human-open",
      "dispatch:ownership-dispatch:failed",
    ]);
    expect(feed.notifications.map((item) => item.source.attentionOwnerType)).toEqual(["system", "human", null]);
  });

  it("returns newest deduplicated task failures, sprint failures, automatic stops, and system errors", async () => {
    const { storage, projects, execution } = await createRepositories();
    const project = projects.createProject({ name: "Runtime Project", sourceType: "local", sourceRef: "/runtime" });
    const failedTaskSprint = projects.createSprint(project.id, { name: "Task Failures", number: 1 });
    const failedTask = projects.createTask(project.id, { sprintId: failedTaskSprint.id, title: "Compile assets", promptMarkdown: "Compile" });
    const failedSprint = projects.createSprint(project.id, { name: "Failed Sprint", number: 2 });
    const stoppedSprint = projects.createSprint(project.id, { name: "Stopped Sprint", number: 3 });
    const errorSprint = projects.createSprint(project.id, { name: "Error Sprint", number: 4 });
    const db = storage.getDatabase();

    const insertRun = db.prepare(`INSERT INTO sprint_runs
      (id, project_id, sprint_id, status, trigger_type, executor_mode, created_at, finished_at, updated_at)
      VALUES (?, ?, ?, ?, 'manual', 'autonomous', ?, ?, ?)`);
    insertRun.run("run-task", project.id, failedTaskSprint.id, "completed", "2026-07-02T09:00:00.000Z", "2026-07-02T09:10:00.000Z", "2026-07-02T09:10:00.000Z");
    insertRun.run("run-failed", project.id, failedSprint.id, "failed", "2026-07-02T10:00:00.000Z", "2026-07-02T10:10:00.000Z", "2026-07-02T10:10:00.000Z");
    insertRun.run("run-stopped", project.id, stoppedSprint.id, "cancelled", "2026-07-02T11:00:00.000Z", "2026-07-02T11:10:00.000Z", "2026-07-02T11:10:00.000Z");
    insertRun.run("run-error", project.id, errorSprint.id, "paused", "2026-07-02T12:00:00.000Z", null, "2026-07-02T12:10:00.000Z");

    const insertDispatch = db.prepare(`INSERT INTO task_dispatches
      (id, project_id, sprint_id, task_id, sprint_run_id, executor_type, status, queued_at, finished_at, error_message, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'run-task', 'cli', 'failed', ?, ?, ?, ?, ?)`);
    insertDispatch.run("dispatch-old", project.id, failedTaskSprint.id, failedTask.id, "2026-07-02T09:00:00.000Z", "2026-07-02T09:05:00.000Z", "Old failure", "2026-07-02T09:00:00.000Z", "2026-07-02T09:05:00.000Z");
    insertDispatch.run("dispatch-new", project.id, failedTaskSprint.id, failedTask.id, "2026-07-02T09:06:00.000Z", "2026-07-02T09:09:00.000Z", "password=hunter2 compile failed", "2026-07-02T09:06:00.000Z", "2026-07-02T09:09:00.000Z");

    db.prepare(`INSERT INTO sprint_run_events (id, sprint_run_id, event_type, originator, payload_json, created_at)
      VALUES ('stop-event', 'run-stopped', 'sprint_cancelled', 'system', '{"reason":"startup_restart_policy","secret":"hidden"}', '2026-07-02T11:10:00.000Z')`).run();
    db.prepare(`INSERT INTO sprint_run_events (id, sprint_run_id, event_type, originator, payload_json, created_at)
      VALUES ('user-stop-event', 'run-failed', 'sprint_cancelled', 'user', '{"reason":"user request"}', '2026-07-02T10:11:00.000Z')`).run();
    db.prepare(`INSERT INTO sprint_run_events (id, sprint_run_id, event_type, originator, payload_json, created_at)
      VALUES ('system-error-event', 'run-error', 'sprint_run_error', 'system', '{"errorMessage":"api_key=super-secret runtime exploded","raw":"do not expose"}', '2026-07-02T12:10:00.000Z')`).run();

    const feed = execution.getDashboardNotifications();

    expect(feed.notifications.map((item) => item.kind)).toEqual([
      "system_execution_error",
      "sprint_automatically_stopped",
      "sprint_execution_failed",
      "task_execution_failed",
    ]);
    expect(feed.notifications.find((item) => item.kind === "task_execution_failed")).toMatchObject({
      id: "dispatch:dispatch-new:failed",
      taskId: failedTask.id,
      taskTitle: "Compile assets",
      source: { type: "task_dispatch", dispatchId: "dispatch-new" },
    });
    const sprintError = feed.notifications.find((item) => item.kind === "system_execution_error");
    expect(sprintError).toMatchObject({
      taskId: null,
      taskKey: null,
      taskTitle: null,
      source: { type: "sprint_run_event", eventType: "sprint_run_error" },
    });
    expect(JSON.stringify(feed)).not.toContain("hunter2");
    expect(JSON.stringify(feed)).not.toContain("super-secret");
    expect(JSON.stringify(feed)).not.toContain("do not expose");
    expect(JSON.stringify(feed)).not.toContain("user-stop-event");
  });
});
