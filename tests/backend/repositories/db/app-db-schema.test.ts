import { describe, expect, it } from "vitest";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";
import { APP_DB_SCHEMA_TABLES } from "../../../../src/repositories/db/app-db-schema.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const liveSnapshotIndexNames = [
  "idx_sprint_runs_project_status_recency",
  "idx_task_dispatches_project_task_recency",
  "idx_task_dispatches_project_sprint_run_recency",
  "idx_sprint_run_events_sprint_run_created_id",
  "idx_project_attention_items_project_status_updated",
  "idx_execution_invocations_project_started",
  "idx_execution_invocations_project_sprint_started",
  "idx_execution_invocations_project_sprint_run_started",
] as const;

describe("AppDbSchema", () => {
  it("initializes the database with all requested indexes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-schema-test-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));

    adapter.exec(APP_DB_SCHEMA_TABLES);

    const getIndex = (name: string) => {
      return adapter.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
    };

    expect(getIndex("idx_provider_invocations_provider_status")).toBeDefined();
    expect(getIndex("idx_task_dispatches_project_executor_status_priority")).toBeDefined();
    expect(getIndex("idx_task_runs_task_sprint_session")).toBeDefined();
    expect(getIndex("idx_project_attention_items_project_owner_status")).toBeDefined();
    expect(getIndex("idx_execution_invocations_provider_invocation")).toBeDefined();
    for (const indexName of liveSnapshotIndexNames) {
      expect(getIndex(indexName)).toBeDefined();
    }

    adapter.close();
  });

  it("creates execution snapshot indexes during in-memory startup migrations", () => {
    const storage = new AppDbStorage(":memory:");
    const db = storage.getDatabase();

    for (const indexName of liveSnapshotIndexNames) {
      const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
      expect(row).toBeDefined();
    }

    storage.close();
  });
});
