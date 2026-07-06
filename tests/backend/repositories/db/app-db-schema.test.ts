import { describe, expect, it } from "vitest";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";
import { APP_DB_SCHEMA_TABLES } from "../../../../src/repositories/db/app-db-schema.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const liveSnapshotIndexNames = [
  "idx_provider_invocations_project_sprint_started",
  "idx_provider_invocations_project_sprint_run_started",
  "idx_provider_invocations_sprint_started",
  "idx_provider_invocations_sprint_run_started",
  "idx_sprint_runs_project_sprint",
  "idx_sprint_runs_project_status_recency",
  "idx_task_runs_dispatch",
  "idx_task_dispatches_project_task_recency",
  "idx_task_dispatches_project_sprint_run_recency",
  "idx_task_runs_project_sprint_lookup",
  "idx_task_runs_project_sprint_run_lookup",
  "idx_task_run_events_project_created",
  "idx_task_run_events_task_run_created_id",
  "idx_sprint_run_events_sprint_run_created_id",
  "idx_sprint_runs_project_lookup",
  "idx_project_attention_items_project_status_updated",
  "idx_project_attention_items_project_status_updated_opened",
  "idx_project_attention_items_sprint_run_status_updated_opened",
  "idx_execution_invocations_project_started",
  "idx_execution_invocations_project_sprint_started",
  "idx_execution_invocations_project_sprint_run_started",
  "idx_execution_invocations_status_started",
] as const;

const liveSnapshotIndexColumns: Record<(typeof liveSnapshotIndexNames)[number], string[]> = {
  idx_provider_invocations_project_sprint_started: ["project_id", "sprint_id", "started_at"],
  idx_provider_invocations_project_sprint_run_started: ["project_id", "sprint_run_id", "started_at"],
  idx_provider_invocations_sprint_started: ["sprint_id", "started_at"],
  idx_provider_invocations_sprint_run_started: ["sprint_run_id", "started_at"],
  idx_sprint_runs_project_sprint: ["project_id", "sprint_id", "created_at"],
  idx_sprint_runs_project_status_recency: ["project_id", "status", "last_heartbeat_at", "updated_at", "created_at"],
  idx_task_runs_dispatch: ["dispatch_id"],
  idx_task_dispatches_project_task_recency: ["project_id", "task_id", "last_heartbeat_at", "started_at", "claimed_at", "queued_at"],
  idx_task_dispatches_project_sprint_run_recency: ["project_id", "sprint_run_id", "last_heartbeat_at", "started_at", "claimed_at", "queued_at"],
  idx_task_runs_project_sprint_lookup: ["project_id", "sprint_id", "sprint_run_id", "id"],
  idx_task_runs_project_sprint_run_lookup: ["project_id", "sprint_run_id", "id"],
  idx_task_run_events_project_created: ["project_id", "created_at", "id"],
  idx_task_run_events_task_run_created_id: ["task_run_id", "created_at", "id"],
  idx_sprint_run_events_sprint_run_created_id: ["sprint_run_id", "created_at", "id"],
  idx_sprint_runs_project_lookup: ["project_id", "id", "sprint_id", "status"],
  idx_project_attention_items_project_status_updated: ["project_id", "status", "updated_at"],
  idx_project_attention_items_project_status_updated_opened: ["project_id", "status", "updated_at", "opened_at", "id"],
  idx_project_attention_items_sprint_run_status_updated_opened: ["sprint_run_id", "status", "updated_at", "opened_at", "id"],
  idx_execution_invocations_project_started: ["project_id", "started_at"],
  idx_execution_invocations_project_sprint_started: ["project_id", "sprint_id", "started_at"],
  idx_execution_invocations_project_sprint_run_started: ["project_id", "sprint_run_id", "started_at"],
  idx_execution_invocations_status_started: ["status", "started_at"],
};

describe("AppDbSchema", () => {
  it("initializes the database with all requested indexes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-schema-test-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));

    adapter.exec(APP_DB_SCHEMA_TABLES);

    const getIndex = (name: string) => {
      return adapter.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
    };
    const getIndexColumns = (name: (typeof liveSnapshotIndexNames)[number]) => {
      return (adapter.prepare(`PRAGMA index_info('${name}')`).all() as Array<{ name: string }>)
        .map((row) => row.name);
    };

    expect(getIndex("idx_provider_invocations_provider_status")).toBeDefined();
    expect(getIndex("idx_task_dispatches_project_executor_status_priority")).toBeDefined();
    expect(getIndex("idx_task_runs_task_sprint_session")).toBeDefined();
    expect(getIndex("idx_project_attention_items_project_owner_status")).toBeDefined();
    expect(getIndex("idx_execution_invocations_provider_invocation")).toBeDefined();
    for (const indexName of liveSnapshotIndexNames) {
      expect(getIndex(indexName)).toBeDefined();
      expect(getIndexColumns(indexName)).toEqual(liveSnapshotIndexColumns[indexName]);
    }

    adapter.close();
  });

  it("creates execution snapshot indexes during in-memory startup migrations", () => {
    const storage = new AppDbStorage(":memory:");
    const db = storage.getDatabase();
    const getIndexColumns = (name: (typeof liveSnapshotIndexNames)[number]) => {
      return (db.prepare(`PRAGMA index_info('${name}')`).all() as Array<{ name: string }>)
        .map((row) => row.name);
    };

    for (const indexName of liveSnapshotIndexNames) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
      expect(row).toBeDefined();
      expect(getIndexColumns(indexName)).toEqual(liveSnapshotIndexColumns[indexName]);
    }

    storage.close();
  });
});
