import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../src/repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../../src/repositories/project-management-repository.js";
import {
  loadLatestSprintReviewSummaryMap,
  loadLatestTaskReviewSummaryMap,
} from "../../../src/repositories/project-management/qa-review-summary-query.js";

const tempDirs: string[] = [];

async function createFixture(): Promise<{
  storage: AppDbStorage;
  repository: ProjectManagementRepository;
}> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "qa-review-summary-query-"));
  tempDirs.push(dir);
  const storage = new AppDbStorage(path.join(dir, "app.db"));
  return { storage, repository: new ProjectManagementRepository(storage) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("QA review summary query", () => {
  it("selects the blocking task reviewer from the latest cycle and redacts unapproved payload fields", async () => {
    const { storage, repository } = await createFixture();
    const project = repository.createProject({ name: "QA summary", sourceType: "local", sourceRef: "/workspace/qa-summary" });
    const sprint = repository.createSprint(project.id, { name: "Sprint" });
    const task = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T01", title: "Task" });
    const db = storage.getDatabase();
    const insert = db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, task_id, trigger_type, status, outcome, run_index,
        target_task_key, summary_markdown, fix_instructions, payload_json, agent_name,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'task_completion', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "older-running",
      project.id,
      sprint.id,
      task.id,
      "running",
      null,
      1,
      null,
      "Older cycle",
      null,
      null,
      "Older reviewer",
      "2026-07-13T09:00:00.000Z",
      null,
      "2026-07-13T09:00:00.000Z",
      "2026-07-13T09:00:00.000Z",
    );
    insert.run(
      "latest-pass",
      project.id,
      sprint.id,
      task.id,
      "completed",
      "pass",
      2,
      null,
      "Passing reviewer",
      null,
      JSON.stringify({ findings: [] }),
      "Passing reviewer",
      "2026-07-13T10:05:00.000Z",
      "2026-07-13T10:06:00.000Z",
      "2026-07-13T10:05:00.000Z",
      "2026-07-13T10:06:00.000Z",
    );
    insert.run(
      "latest-changes",
      project.id,
      sprint.id,
      task.id,
      "completed",
      "changes_requested",
      2,
      "  T01  ",
      "Changes are required.",
      "  Add the missing regression path.  ",
      JSON.stringify({
        findings: ["Missing regression coverage", 42, { private: "ignore" }],
        fixInstructions: "Payload fallback must not replace the column.",
        targetTaskKey: "WRONG",
        followUpTasks: [
          {
            title: "  Add regression coverage  ",
            promptMarkdown: "  Add the complete regression scenario.  ",
            description: "  Cover the failure path.  ",
            dependsOnTaskKeys: ["T01", "T01", 99],
            priority: "high",
            providerPrompt: "must not leak",
          },
          { title: "Legacy prompt", prompt: "Use the supported prompt alias." },
          { title: "Invalid without instructions", credentials: "must not leak" },
        ],
        providerPrompt: "must not leak",
        credentials: "must not leak",
      }),
      "Blocking reviewer",
      "2026-07-13T10:00:00.000Z",
      "2026-07-13T10:01:00.000Z",
      "2026-07-13T10:00:00.000Z",
      "2026-07-13T10:01:00.000Z",
    );

    expect(loadLatestTaskReviewSummaryMap(storage, [task.id]).get(task.id)).toEqual({
      status: "completed",
      outcome: "changes_requested",
      summary: "Changes are required.",
      findings: ["Missing regression coverage"],
      reviewer: "Blocking reviewer",
      finishedAt: "2026-07-13T10:01:00.000Z",
      fixInstructions: "Add the missing regression path.",
      targetTaskKey: "T01",
      followUpTasks: [
        {
          title: "Add regression coverage",
          promptMarkdown: "Add the complete regression scenario.",
          description: "Cover the failure path.",
          dependsOnTaskKeys: ["T01"],
          priority: "high",
        },
        {
          title: "Legacy prompt",
          promptMarkdown: "Use the supported prompt alias.",
          description: null,
          dependsOnTaskKeys: [],
          priority: "medium",
        },
      ],
    });
  });

  it("keeps legacy and malformed rows readable with safe defaults", async () => {
    const { storage, repository } = await createFixture();
    const project = repository.createProject({ name: "Legacy QA", sourceType: "local", sourceRef: "/workspace/legacy-qa" });
    const sprint = repository.createSprint(project.id, { name: "Sprint" });
    const legacyTask = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T01", title: "Legacy" });
    const malformedTask = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T02", title: "Malformed" });
    const payloadTask = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T03", title: "Payload fallback" });
    const db = storage.getDatabase();
    const insert = db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, task_id, trigger_type, status, outcome, run_index,
        summary_markdown, payload_json, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'task_completion', 'completed', 'pass', 1, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run(
      "legacy-review",
      project.id,
      sprint.id,
      legacyTask.id,
      "Legacy pass",
      null,
      "Legacy reviewer",
      "2026-07-13T11:00:00.000Z",
      "2026-07-13T11:01:00.000Z",
      "2026-07-13T11:00:00.000Z",
      "2026-07-13T11:01:00.000Z",
    );
    insert.run(
      "malformed-review",
      project.id,
      sprint.id,
      malformedTask.id,
      "Malformed payload pass",
      "{malformed",
      "Legacy reviewer",
      "2026-07-13T11:02:00.000Z",
      "2026-07-13T11:03:00.000Z",
      "2026-07-13T11:02:00.000Z",
      "2026-07-13T11:03:00.000Z",
    );
    insert.run(
      "payload-review",
      project.id,
      sprint.id,
      payloadTask.id,
      "Payload fallback",
      JSON.stringify({
        findings: [],
        fixInstructions: "Use the approved payload fallback.",
        targetTaskKey: "T03",
        followUpTasks: [],
      }),
      "Legacy reviewer",
      "2026-07-13T11:04:00.000Z",
      "2026-07-13T11:05:00.000Z",
      "2026-07-13T11:04:00.000Z",
      "2026-07-13T11:05:00.000Z",
    );

    const summaries = loadLatestTaskReviewSummaryMap(storage, [legacyTask.id, malformedTask.id, payloadTask.id]);
    expect(summaries.get(legacyTask.id)).toEqual({
      status: "completed",
      outcome: "pass",
      summary: "Legacy pass",
      findings: [],
      reviewer: "Legacy reviewer",
      finishedAt: "2026-07-13T11:01:00.000Z",
    });
    expect(summaries.get(malformedTask.id)?.findings).toEqual([]);
    expect(summaries.get(malformedTask.id)?.followUpTasks).toBeUndefined();
    expect(summaries.get(payloadTask.id)).toMatchObject({
      fixInstructions: "Use the approved payload fallback.",
      targetTaskKey: "T03",
      followUpTasks: [],
    });
  });

  it("projects a cancelled task reviewer ahead of a passing reviewer in the latest cycle", async () => {
    const { storage, repository } = await createFixture();
    const project = repository.createProject({ name: "Cancelled task QA", sourceType: "local", sourceRef: "/workspace/cancelled-task-qa" });
    const sprint = repository.createSprint(project.id, { name: "Sprint" });
    const task = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T01", title: "Task" });
    const db = storage.getDatabase();
    const insert = db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, task_id, trigger_type, status, outcome, run_index,
        summary_markdown, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'task_completion', ?, ?, 2, ?, ?, ?, ?, ?, ?)
    `);
    insert.run("task-pass", project.id, sprint.id, task.id, "completed", "pass", "Pass", "Pass reviewer", "2026-07-13T11:05:00.000Z", "2026-07-13T11:06:00.000Z", "2026-07-13T11:05:00.000Z", "2026-07-13T11:06:00.000Z");
    insert.run("task-cancelled", project.id, sprint.id, task.id, "cancelled", null, "Provider cancelled", "Cancelled reviewer", "2026-07-13T11:00:00.000Z", "2026-07-13T11:01:00.000Z", "2026-07-13T11:00:00.000Z", "2026-07-13T11:01:00.000Z");

    expect(loadLatestTaskReviewSummaryMap(storage, [task.id]).get(task.id)).toMatchObject({
      status: "cancelled",
      outcome: null,
      summary: "Provider cancelled",
      reviewer: "Cancelled reviewer",
    });
  });

  it("projects a later recovery verdict instead of a cancelled attempt from the same reviewer cycle", async () => {
    const { storage, repository } = await createFixture();
    const project = repository.createProject({ name: "Recovered QA", sourceType: "local", sourceRef: "/workspace/recovered-qa" });
    const sprint = repository.createSprint(project.id, { name: "Recovered review" });
    const task = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T01", title: "Recovered task" });
    const db = storage.getDatabase();
    const insert = db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, task_id, trigger_type, status, outcome, run_index,
        summary_markdown, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, 'Recovery reviewer', ?, ?, ?, ?)
    `);
    insert.run(
      "task-review-cancelled",
      project.id,
      sprint.id,
      task.id,
      "task_completion",
      "cancelled",
      null,
      "Interrupted before restart.",
      "2026-07-13T11:00:00.000Z",
      "2026-07-13T11:01:00.000Z",
      "2026-07-13T11:00:00.000Z",
      "2026-07-13T11:01:00.000Z",
    );
    insert.run(
      "task-review-recovered",
      project.id,
      sprint.id,
      task.id,
      "task_completion",
      "completed",
      "pass",
      "Recovered task review passed.",
      "2026-07-13T11:02:00.000Z",
      "2026-07-13T11:03:00.000Z",
      "2026-07-13T11:02:00.000Z",
      "2026-07-13T11:03:00.000Z",
    );
    insert.run(
      "sprint-review-cancelled",
      project.id,
      sprint.id,
      null,
      "sprint_completion",
      "cancelled",
      null,
      "Interrupted sprint review.",
      "2026-07-13T12:00:00.000Z",
      "2026-07-13T12:01:00.000Z",
      "2026-07-13T12:00:00.000Z",
      "2026-07-13T12:01:00.000Z",
    );
    insert.run(
      "sprint-review-recovered",
      project.id,
      sprint.id,
      null,
      "sprint_completion",
      "completed",
      "pass",
      "Recovered sprint review passed.",
      "2026-07-13T12:02:00.000Z",
      "2026-07-13T12:03:00.000Z",
      "2026-07-13T12:02:00.000Z",
      "2026-07-13T12:03:00.000Z",
    );

    expect(loadLatestTaskReviewSummaryMap(storage, [task.id]).get(task.id)).toMatchObject({
      status: "completed",
      outcome: "pass",
      summary: "Recovered task review passed.",
    });
    expect(loadLatestSprintReviewSummaryMap(storage, [sprint.id]).get(sprint.id)).toMatchObject({
      status: "completed",
      outcome: "pass",
      summary: "Recovered sprint review passed.",
    });
  });

  it("does not project a prior sprint attempt task review onto the latest run", async () => {
    const { storage, repository } = await createFixture();
    const project = repository.createProject({ name: "Run-scoped task QA", sourceType: "local", sourceRef: "/workspace/run-scoped-task-qa" });
    const sprint = repository.createSprint(project.id, { name: "Run-scoped task review" });
    const scopedTask = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T01", title: "Scoped task" });
    const legacyTask = repository.createTask(project.id, { sprintId: sprint.id, taskKey: "T02", title: "Legacy task" });
    const db = storage.getDatabase();
    const insertRun = db.prepare(`
      INSERT INTO sprint_runs (
        id, project_id, sprint_id, status, trigger_type, executor_mode,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'manual', 'mixed', ?, ?, ?, ?)
    `);
    insertRun.run(
      "task-qa-old-run",
      project.id,
      sprint.id,
      "completed",
      "2026-07-13T08:00:00.000Z",
      "2026-07-13T08:30:00.000Z",
      "2026-07-13T08:00:00.000Z",
      "2026-07-13T08:30:00.000Z",
    );
    insertRun.run(
      "task-qa-current-run",
      project.id,
      sprint.id,
      "paused",
      "2026-07-13T10:00:00.000Z",
      null,
      "2026-07-13T10:00:00.000Z",
      "2026-07-13T10:00:00.000Z",
    );
    const insertReview = db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, sprint_run_id, task_id, trigger_type, status, outcome, run_index,
        summary_markdown, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, 'task_completion', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertReview.run(
      "task-qa-old-review",
      project.id,
      sprint.id,
      "task-qa-old-run",
      scopedTask.id,
      "completed",
      "pass",
      7,
      "Prior attempt passed.",
      "Scoped reviewer",
      "2026-07-13T08:20:00.000Z",
      "2026-07-13T08:25:00.000Z",
      "2026-07-13T08:20:00.000Z",
      "2026-07-13T08:25:00.000Z",
    );
    insertReview.run(
      "task-qa-current-legacy-review",
      project.id,
      sprint.id,
      null,
      legacyTask.id,
      "completed",
      "pass",
      1,
      "Current unlinked review passed.",
      "Legacy reviewer",
      "2026-07-13T10:05:00.000Z",
      "2026-07-13T10:06:00.000Z",
      "2026-07-13T10:05:00.000Z",
      "2026-07-13T10:06:00.000Z",
    );

    let summaries = loadLatestTaskReviewSummaryMap(storage, [scopedTask.id, legacyTask.id]);
    expect(summaries.has(scopedTask.id)).toBe(false);
    expect(summaries.get(legacyTask.id)?.summary).toBe("Current unlinked review passed.");

    insertReview.run(
      "task-qa-current-review",
      project.id,
      sprint.id,
      "task-qa-current-run",
      scopedTask.id,
      "running",
      null,
      1,
      "Current attempt review in progress.",
      "Scoped reviewer",
      "2026-07-13T10:07:00.000Z",
      null,
      "2026-07-13T10:07:00.000Z",
      "2026-07-13T10:07:00.000Z",
    );
    summaries = loadLatestTaskReviewSummaryMap(storage, [scopedTask.id]);
    expect(summaries.get(scopedTask.id)).toMatchObject({
      status: "running",
      summary: "Current attempt review in progress.",
    });
  });

  it("uses blocking-state precedence for sprint reviewers in the latest run index", async () => {
    const { storage, repository } = await createFixture();
    const project = repository.createProject({ name: "Sprint QA", sourceType: "local", sourceRef: "/workspace/sprint-qa" });
    const runningSprint = repository.createSprint(project.id, { name: "Running review" });
    const failedSprint = repository.createSprint(project.id, { name: "Failed review" });
    const erroredSprint = repository.createSprint(project.id, { name: "Errored review" });
    const db = storage.getDatabase();
    const insert = db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, trigger_type, status, outcome, run_index,
        summary_markdown, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, 'sprint_completion', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insert.run("running-pass", project.id, runningSprint.id, "completed", "pass", 3, "Pass", "Pass reviewer", "2026-07-13T12:05:00.000Z", "2026-07-13T12:06:00.000Z", "2026-07-13T12:05:00.000Z", "2026-07-13T12:06:00.000Z");
    insert.run("running-blocker", project.id, runningSprint.id, "running", null, 3, "Still reviewing", "Running reviewer", "2026-07-13T12:00:00.000Z", null, "2026-07-13T12:00:00.000Z", "2026-07-13T12:00:00.000Z");
    insert.run("failed-pass", project.id, failedSprint.id, "completed", "pass", 2, "Pass", "Pass reviewer", "2026-07-13T12:05:00.000Z", "2026-07-13T12:06:00.000Z", "2026-07-13T12:05:00.000Z", "2026-07-13T12:06:00.000Z");
    insert.run("failed-blocker", project.id, failedSprint.id, "failed", null, 2, "Reviewer failed", "Failed reviewer", "2026-07-13T12:00:00.000Z", "2026-07-13T12:01:00.000Z", "2026-07-13T12:00:00.000Z", "2026-07-13T12:01:00.000Z");
    insert.run("errored-pass", project.id, erroredSprint.id, "completed", "pass", 4, "Pass", "Pass reviewer", "2026-07-13T12:05:00.000Z", "2026-07-13T12:06:00.000Z", "2026-07-13T12:05:00.000Z", "2026-07-13T12:06:00.000Z");
    insert.run("errored-blocker", project.id, erroredSprint.id, "errored", null, 4, "Reviewer errored", "Errored reviewer", "2026-07-13T12:00:00.000Z", "2026-07-13T12:01:00.000Z", "2026-07-13T12:00:00.000Z", "2026-07-13T12:01:00.000Z");

    const summaries = loadLatestSprintReviewSummaryMap(storage, [runningSprint.id, failedSprint.id, erroredSprint.id]);
    expect(summaries.get(runningSprint.id)?.status).toBe("running");
    expect(summaries.get(runningSprint.id)?.reviewer).toBe("Running reviewer");
    expect(summaries.get(failedSprint.id)?.status).toBe("failed");
    expect(summaries.get(failedSprint.id)?.reviewer).toBe("Failed reviewer");
    expect(summaries.get(erroredSprint.id)?.status).toBe("errored");
    expect(summaries.get(erroredSprint.id)?.reviewer).toBe("Errored reviewer");
  });

  it("does not project a prior sprint run review onto the latest run", async () => {
    const { storage, repository } = await createFixture();
    const project = repository.createProject({ name: "Run-scoped QA", sourceType: "local", sourceRef: "/workspace/run-scoped-qa" });
    const scopedSprint = repository.createSprint(project.id, { name: "Scoped review" });
    const manualSprint = repository.createSprint(project.id, { name: "Manual review" });
    const db = storage.getDatabase();
    const insertRun = db.prepare(`
      INSERT INTO sprint_runs (
        id, project_id, sprint_id, status, trigger_type, executor_mode,
        started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'manual', 'mixed', ?, ?, ?, ?)
    `);
    insertRun.run(
      "scoped-old-run",
      project.id,
      scopedSprint.id,
      "completed",
      "2026-07-13T08:00:00.000Z",
      "2026-07-13T08:30:00.000Z",
      "2026-07-13T08:00:00.000Z",
      "2026-07-13T08:30:00.000Z",
    );
    insertRun.run(
      "scoped-current-run",
      project.id,
      scopedSprint.id,
      "paused",
      "2026-07-13T10:00:00.000Z",
      null,
      "2026-07-13T10:00:00.000Z",
      "2026-07-13T10:00:00.000Z",
    );
    insertRun.run(
      "manual-current-run",
      project.id,
      manualSprint.id,
      "completed",
      "2026-07-13T09:00:00.000Z",
      "2026-07-13T09:30:00.000Z",
      "2026-07-13T09:00:00.000Z",
      "2026-07-13T09:30:00.000Z",
    );

    const insertReview = db.prepare(`
      INSERT INTO qa_review_runs (
        id, project_id, sprint_id, sprint_run_id, trigger_type, status, outcome, run_index,
        summary_markdown, agent_name, started_at, finished_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'sprint_completion', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    insertReview.run(
      "scoped-old-review",
      project.id,
      scopedSprint.id,
      "scoped-old-run",
      "completed",
      "pass",
      7,
      "Prior run passed.",
      "Prior reviewer",
      "2026-07-13T08:20:00.000Z",
      "2026-07-13T08:25:00.000Z",
      "2026-07-13T08:20:00.000Z",
      "2026-07-13T08:25:00.000Z",
    );
    insertReview.run(
      "manual-latest-review",
      project.id,
      manualSprint.id,
      null,
      "completed",
      "pass",
      2,
      "Manually approved after the run.",
      "Manual QA",
      "2026-07-13T09:35:00.000Z",
      "2026-07-13T09:35:00.000Z",
      "2026-07-13T09:35:00.000Z",
      "2026-07-13T09:35:00.000Z",
    );

    let summaries = loadLatestSprintReviewSummaryMap(storage, [scopedSprint.id, manualSprint.id]);
    expect(summaries.has(scopedSprint.id)).toBe(false);
    expect(summaries.get(manualSprint.id)?.summary).toBe("Manually approved after the run.");

    insertReview.run(
      "scoped-current-review",
      project.id,
      scopedSprint.id,
      "scoped-current-run",
      "running",
      null,
      1,
      "Current run review in progress.",
      "Current reviewer",
      "2026-07-13T10:05:00.000Z",
      null,
      "2026-07-13T10:05:00.000Z",
      "2026-07-13T10:05:00.000Z",
    );

    summaries = loadLatestSprintReviewSummaryMap(storage, [scopedSprint.id]);
    expect(summaries.get(scopedSprint.id)).toMatchObject({
      status: "running",
      summary: "Current run review in progress.",
      reviewer: "Current reviewer",
    });
  });
});
