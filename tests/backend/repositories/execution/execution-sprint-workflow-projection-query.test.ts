import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { queryExecutionSprintWorkflowProjections } from "../../../../src/repositories/execution/execution-sprint-workflow-projection-query.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<AppDbStorage> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-sprint-workflow-projection-"));
  tempDirs.push(dir);
  return new AppDbStorage(path.join(dir, "app.db"));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function seedProject(storage: AppDbStorage): void {
  storage.getDatabase().prepare(`
    INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at)
    VALUES ('project-1', 'project-1', 'Project 1', '/tmp/project-1', ?, ?)
  `).run("2026-07-16T00:00:00.000Z", "2026-07-16T00:00:00.000Z");
}

function seedSprint(storage: AppDbStorage, sprintId: string, number: number): void {
  storage.getDatabase().prepare(`
    INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at)
    VALUES (?, 'project-1', ?, ?, ?, 'idle', ?, ?)
  `).run(
    sprintId,
    number,
    sprintId,
    sprintId,
    "2026-07-16T00:00:00.000Z",
    "2026-07-16T00:00:00.000Z",
  );
}

function seedTask(storage: AppDbStorage, sprintId: string, taskId: string, taskKey: string): void {
  storage.getDatabase().prepare(`
    INSERT INTO tasks (
      id, project_id, sprint_id, task_key, title, prompt_markdown, created_at, updated_at
    )
    VALUES (?, 'project-1', ?, ?, ?, 'Test task', ?, ?)
  `).run(
    taskId,
    sprintId,
    taskKey,
    taskKey,
    "2026-07-16T00:00:00.000Z",
    "2026-07-16T00:00:00.000Z",
  );
}

describe("queryExecutionSprintWorkflowProjections", () => {
  it("selects the latest planning invocation by start and creation identity, not mutable update time", async () => {
    const storage = await createStorage();
    try {
      seedProject(storage);
      seedSprint(storage, "sprint-1", 1);
      const insert = storage.getDatabase().prepare(`
        INSERT INTO execution_invocations (
          id, project_id, sprint_id, type, status, provider, started_at, message_count,
          invocation_source, created_at, updated_at
        )
        VALUES (?, 'project-1', 'sprint-1', 'planning', ?, 'codex', ?, 0, 'internal', ?, ?)
      `);
      insert.run(
        "planning-old-mutated",
        "failed",
        "2026-07-16T10:00:00.000Z",
        "2026-07-16T10:00:01.000Z",
        "2026-07-16T12:00:00.000Z",
      );
      insert.run(
        "planning-newer-start",
        "running",
        "2026-07-16T11:00:00.000Z",
        "2026-07-16T11:00:01.000Z",
        "2026-07-16T11:00:01.000Z",
      );
      insert.run(
        "planning-newest-creation",
        "completed",
        "2026-07-16T11:00:00.000Z",
        "2026-07-16T11:00:02.000Z",
        "2026-07-16T11:00:02.000Z",
      );

      expect(queryExecutionSprintWorkflowProjections(storage.getDatabase(), "project-1")).toEqual([{
        sprintId: "sprint-1",
        planningStatus: "completed",
        humanIntervention: null,
      }]);
    } finally {
      storage.close();
    }
  });

  it("finds strict unassigned task-level human interventions beyond the 50-item activity feed cap", async () => {
    const storage = await createStorage();
    try {
      seedProject(storage);
      const insertAttention = storage.getDatabase().prepare(`
        INSERT INTO project_attention_items (
          id, project_id, sprint_id, task_id, attention_type, severity, owner_type, status,
          assigned_worker_endpoint_id, title, summary_markdown, payload_json,
          opened_at, claimed_at, resolved_at, updated_at
        )
        VALUES (
          ?, 'project-1', ?, ?, 'human_escalation_required', ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?
        )
      `);

      for (let index = 0; index < 55; index += 1) {
        const sprintId = `sprint-${String(index).padStart(2, "0")}`;
        const taskId = `task-${String(index).padStart(2, "0")}`;
        seedSprint(storage, sprintId, index + 1);
        seedTask(storage, sprintId, taskId, `T${index + 1}`);
        const timestamp = `2026-07-16T10:${String(index).padStart(2, "0")}:00.000Z`;
        insertAttention.run(
          `attention-${String(index).padStart(2, "0")}`,
          sprintId,
          taskId,
          "high",
          "human",
          "open",
          null,
          `Human attention ${index}`,
          "A human decision is required.",
          JSON.stringify({ index }),
          timestamp,
          timestamp,
        );
      }

      const targetSprintId = "sprint-target";
      const targetTaskId = "task-target";
      seedSprint(storage, targetSprintId, 100);
      seedTask(storage, targetSprintId, targetTaskId, "T100");
      insertAttention.run(
        "attention-target",
        targetSprintId,
        targetTaskId,
        "low",
        "user",
        "claimed",
        null,
        "Target human attention",
        "This item sorts outside the bounded activity feed.",
        JSON.stringify({ source: "durable-projection" }),
        "2026-07-16T09:00:00.000Z",
        "2026-07-16T09:00:00.000Z",
      );

      const boundedFeedIds = storage.getDatabase().prepare(`
        SELECT id
        FROM project_attention_items
        WHERE project_id = 'project-1'
          AND status IN ('open', 'claimed')
        ORDER BY
          CASE severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END ASC,
          opened_at DESC,
          id DESC
        LIMIT 50
      `).all() as Array<{ id: string }>;
      expect(boundedFeedIds.map((row) => row.id)).not.toContain("attention-target");

      const projections = queryExecutionSprintWorkflowProjections(storage.getDatabase(), "project-1");
      expect(projections).toHaveLength(56);
      expect(projections.find((projection) => projection.sprintId === targetSprintId)).toEqual({
        sprintId: targetSprintId,
        planningStatus: null,
        humanIntervention: expect.objectContaining({
          id: "attention-target",
          taskId: targetTaskId,
          ownerType: "user",
          status: "claimed",
          assignedWorkerEndpointId: null,
          payload: { source: "durable-projection" },
        }),
      });
    } finally {
      storage.close();
    }
  });

  it("excludes project-level, worker-owned, assigned, and resolved attention from sprint escalation", async () => {
    const storage = await createStorage();
    try {
      seedProject(storage);
      seedSprint(storage, "sprint-1", 1);
      seedTask(storage, "sprint-1", "task-1", "T1");
      storage.getDatabase().prepare(`
        INSERT INTO worker_endpoints (
          id, endpoint_key, endpoint_type, display_name, status, created_at, updated_at
        )
        VALUES ('worker-1', 'worker-1', 'local', 'Worker 1', 'online', ?, ?)
      `).run("2026-07-16T10:00:00.000Z", "2026-07-16T10:00:00.000Z");
      const insert = storage.getDatabase().prepare(`
        INSERT INTO project_attention_items (
          id, project_id, sprint_id, task_id, attention_type, severity, owner_type, status,
          assigned_worker_endpoint_id, title, summary_markdown, opened_at, updated_at
        )
        VALUES (?, 'project-1', ?, ?, 'manual_attention', 'high', ?, ?, ?, ?, 'Test', ?, ?)
      `);
      const at = "2026-07-16T10:00:00.000Z";
      insert.run("project-level", "sprint-1", null, "human", "open", null, "Project level", at, at);
      insert.run("worker-owned", "sprint-1", "task-1", "worker", "open", null, "Worker owned", at, at);
      insert.run("worker-assigned", "sprint-1", "task-1", "human", "open", "worker-1", "Assigned", at, at);
      insert.run("resolved", "sprint-1", "task-1", "human", "resolved", null, "Resolved", at, at);

      expect(queryExecutionSprintWorkflowProjections(storage.getDatabase(), "project-1")).toEqual([]);
    } finally {
      storage.close();
    }
  });
});
