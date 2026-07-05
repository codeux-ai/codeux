import { afterEach, describe, expect, it } from "vitest";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { APP_DB_SCHEMA_TABLES } from "../../../../src/repositories/db/app-db-schema.js";
import { createTempDbContext } from "../../helpers/temp-db.js";
import type { TempDbContext } from "../../helpers/temp-db.js";

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

const tempContexts: TempDbContext[] = [];

function getNamedSchemaDuplicates(storage: AppDbStorage): Array<{ type: string; name: string; count: number }> {
  return storage.getDatabase().prepare(`
    SELECT type, name, COUNT(*) AS count
    FROM sqlite_master
    WHERE name IS NOT NULL
      AND name NOT LIKE 'sqlite_autoindex_%'
    GROUP BY type, name
    HAVING COUNT(*) > 1
    ORDER BY type, name
  `).all() as Array<{ type: string; name: string; count: number }>;
}

function getSchemaSnapshot(storage: AppDbStorage): {
  indexes: string[];
  migrationCount: number;
  duplicateSchemaEntries: Array<{ type: string; name: string; count: number }>;
} {
  const indexes = storage.getDatabase().prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index'
      AND name NOT LIKE 'sqlite_autoindex_%'
    ORDER BY name
  `).all() as Array<{ name: string }>;
  const migrationCount = storage.getDatabase().prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number };

  return {
    indexes: indexes.map((row) => row.name),
    migrationCount: migrationCount.count,
    duplicateSchemaEntries: getNamedSchemaDuplicates(storage),
  };
}

afterEach(() => {
  for (const context of tempContexts.splice(0)) {
    context.cleanup();
  }
});

describe("AppDbSchema", () => {
  it("initializes the database with all requested indexes", async () => {
    const context = await createTempDbContext("db-schema-test-");
    tempContexts.push(context);
    const adapter = context.createAdapter();

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

  it("runs startup migrations twice against one database without duplicating schema state", async () => {
    const context = await createTempDbContext("db-schema-startup-");
    tempContexts.push(context);
    const dbPath = context.dbPath();
    const originalInMemoryDb = process.env.VITEST_IN_MEMORY_DB;
    process.env.VITEST_IN_MEMORY_DB = "false";

    try {
      const firstStartup = context.createStorage(dbPath);
      const firstSnapshot = getSchemaSnapshot(firstStartup);
      firstStartup.close();

      const secondStartup = context.createStorage(dbPath);
      const secondSnapshot = getSchemaSnapshot(secondStartup);

      expect(secondSnapshot.duplicateSchemaEntries).toEqual([]);
      expect(secondSnapshot.migrationCount).toBe(firstSnapshot.migrationCount);
      expect(secondSnapshot.indexes).toEqual(firstSnapshot.indexes);
      expect(secondSnapshot.indexes).toEqual(expect.arrayContaining([
        "idx_provider_invocations_provider_status",
        "idx_task_dispatches_project_executor_status_priority",
        "idx_task_runs_task_sprint_session",
        "idx_project_attention_items_project_owner_status",
        "idx_execution_invocations_provider_invocation",
        ...liveSnapshotIndexNames,
      ]));
    } finally {
      if (originalInMemoryDb === undefined) {
        delete process.env.VITEST_IN_MEMORY_DB;
      } else {
        process.env.VITEST_IN_MEMORY_DB = originalInMemoryDb;
      }
    }
  });
});
