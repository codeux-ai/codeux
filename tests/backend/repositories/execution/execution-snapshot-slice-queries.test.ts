import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { queryProjectExecutionSnapshotInvocations } from "../../../../src/repositories/execution/execution-invocations-query.js";
import { queryExecutionRuntimeEvents } from "../../../../src/repositories/execution/execution-runtime-events-query.js";

const tempDirs: string[] = [];

async function createStorage(): Promise<AppDbStorage> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-execution-snapshot-"));
  tempDirs.push(dir);
  return new AppDbStorage(path.join(dir, "app.db"));
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function seedProject(storage: AppDbStorage): void {
  const db = storage.getDatabase();
  db.prepare(`
    INSERT INTO projects (id, slug, name, base_dir, created_at, updated_at)
    VALUES ('project-1', 'project-1', 'Project 1', '/tmp/project-1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO sprints (id, project_id, number, slug, name, status, created_at, updated_at)
    VALUES
      ('sprint-active', 'project-1', 1, 'active', 'Active sprint', 'running', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('sprint-inactive', 'project-1', 2, 'inactive', 'Inactive sprint', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('sprint-other', 'project-1', 3, 'other', 'Other sprint', 'completed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run();
  db.prepare(`
    INSERT INTO sprint_runs (id, project_id, sprint_id, status, trigger_type, executor_mode, created_at, updated_at)
    VALUES
      ('run-active', 'project-1', 'sprint-active', 'running', 'dashboard', 'mixed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'),
      ('run-quiet', 'project-1', 'sprint-other', 'running', 'dashboard', 'mixed', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run();
}

function insertInvocation(
  storage: AppDbStorage,
  params: {
    id: string;
    sprintId: string;
    sprintRunId?: string | null;
    startedAt: string;
    providerInvocationId?: string | null;
  },
): void {
  storage.getDatabase().prepare(`
    INSERT INTO execution_invocations (
      id, project_id, sprint_id, sprint_run_id, provider_invocation_id, type, status, provider,
      started_at, message_count, invocation_source, created_at, updated_at
    )
    VALUES (?, 'project-1', ?, ?, ?, 'cli_task_coding', 'completed', 'codex', ?, 1, 'internal', ?, ?)
  `).run(
    params.id,
    params.sprintId,
    params.sprintRunId ?? null,
    params.providerInvocationId ?? null,
    params.startedAt,
    params.startedAt,
    params.startedAt,
  );
}

describe("execution snapshot invocation slices", () => {
  it("deduplicates overlapping project, expanded-run, and selected-sprint invocations", async () => {
    const storage = await createStorage();
    seedProject(storage);

    storage.getDatabase().prepare(`
      INSERT INTO provider_invocations (
        id, project_id, sprint_id, sprint_run_id, session_id, provider, purpose, status,
        started_at, input_tokens, cached_input_tokens, output_tokens, total_tokens,
        created_at, updated_at
      )
      VALUES (
        'provider-overlap', 'project-1', 'sprint-active', 'run-active', 'session-1', 'codex', 'coding', 'completed',
        '2026-01-01T10:00:00.000Z', 10, 2, 20, 30,
        '2026-01-01T10:00:00.000Z', '2026-01-01T10:00:00.000Z'
      )
    `).run();

    insertInvocation(storage, {
      id: "inv-overlap",
      sprintId: "sprint-active",
      sprintRunId: "run-active",
      providerInvocationId: "provider-overlap",
      startedAt: "2026-01-01T10:00:00.000Z",
    });
    insertInvocation(storage, {
      id: "inv-expanded",
      sprintId: "sprint-active",
      sprintRunId: "run-active",
      startedAt: "2026-01-01T09:59:00.000Z",
    });
    insertInvocation(storage, {
      id: "inv-project",
      sprintId: "sprint-other",
      sprintRunId: null,
      startedAt: "2026-01-01T09:58:00.000Z",
    });

    const invocations = queryProjectExecutionSnapshotInvocations(storage.getDatabase(), {
      projectId: "project-1",
      sprintRunIds: ["run-active", "run-active"],
      selectedSprintId: "sprint-active",
    });

    expect(invocations.map((invocation) => invocation.id)).toEqual([
      "inv-overlap",
      "inv-expanded",
      "inv-project",
    ]);
    expect(invocations.filter((invocation) => invocation.id === "inv-overlap")).toHaveLength(1);
    expect(invocations[0]).toMatchObject({
      id: "inv-overlap",
      inputTokens: 10,
      cachedInputTokens: 2,
      outputTokens: 20,
      totalTokens: 30,
    });
  });

  it("keeps a selected inactive sprint invocation outside the project-recent slice", async () => {
    const storage = await createStorage();
    seedProject(storage);

    for (let i = 0; i < 30; i += 1) {
      insertInvocation(storage, {
        id: `inv-recent-${String(i).padStart(2, "0")}`,
        sprintId: "sprint-other",
        sprintRunId: null,
        startedAt: `2026-01-01T11:${String(i).padStart(2, "0")}:00.000Z`,
      });
    }
    insertInvocation(storage, {
      id: "inv-selected-inactive",
      sprintId: "sprint-inactive",
      sprintRunId: null,
      startedAt: "2026-01-01T09:00:00.000Z",
    });

    const invocations = queryProjectExecutionSnapshotInvocations(storage.getDatabase(), {
      projectId: "project-1",
      sprintRunIds: [],
      selectedSprintId: "sprint-inactive",
    });

    expect(invocations.map((invocation) => invocation.id)).toContain("inv-selected-inactive");
    expect(invocations).toHaveLength(25);
  });
});

function seedRuntimeTask(
  storage: AppDbStorage,
  params: {
    sprintId: string;
    taskId: string;
    taskRunId: string;
    sprintRunId: string;
  },
): void {
  const db = storage.getDatabase();
  db.prepare(`
    INSERT INTO tasks (id, project_id, sprint_id, task_key, title, prompt_markdown, created_at, updated_at)
    VALUES (?, 'project-1', ?, ?, ?, 'Do work', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')
  `).run(params.taskId, params.sprintId, params.taskId, params.taskId);
  db.prepare(`
    INSERT INTO task_runs (id, project_id, sprint_id, task_id, sprint_run_id, state)
    VALUES (?, 'project-1', ?, ?, ?, 'running')
  `).run(params.taskRunId, params.sprintId, params.taskId, params.sprintRunId);
}

describe("execution snapshot runtime event slices", () => {
  it("keeps another expanded run's event when one active run is chatty", async () => {
    const storage = await createStorage();
    seedProject(storage);
    seedRuntimeTask(storage, {
      sprintId: "sprint-active",
      taskId: "task-chatty",
      taskRunId: "task-run-chatty",
      sprintRunId: "run-active",
    });
    seedRuntimeTask(storage, {
      sprintId: "sprint-other",
      taskId: "task-quiet",
      taskRunId: "task-run-quiet",
      sprintRunId: "run-quiet",
    });

    const db = storage.getDatabase();
    for (let i = 0; i < 300; i += 1) {
      db.prepare(`
        INSERT INTO task_run_events (id, task_run_id, project_id, event_type, originator, created_at)
        VALUES (?, 'task-run-chatty', 'project-1', 'provider_activity', 'system', ?)
      `).run(
        `event-chatty-${String(i).padStart(3, "0")}`,
        `2026-01-01T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${String(i % 60).padStart(2, "0")}.000Z`,
      );
    }
    db.prepare(`
      INSERT INTO task_run_events (id, task_run_id, project_id, event_type, originator, created_at)
      VALUES ('event-quiet', 'task-run-quiet', 'project-1', 'provider_activity', 'system', '2026-01-01T10:02:30.500Z')
    `).run();
    db.prepare(`
      INSERT INTO task_run_events (id, task_run_id, project_id, event_type, originator, created_at)
      VALUES ('event-status-sync', 'task-run-quiet', 'project-1', 'status_sync', 'system', '2026-01-01T10:05:00.000Z')
    `).run();

    const events = queryExecutionRuntimeEvents(storage.getDatabase(), storage, "project-1", [
      "run-active",
      "run-quiet",
    ]);

    expect(events).toHaveLength(300);
    expect(events.map((event) => event.id)).toContain("event-quiet");
    expect(events.map((event) => event.id)).not.toContain("event-status-sync");
  });
});
