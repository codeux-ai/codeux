import { describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";
import { APP_DB_SCHEMA_TABLES } from "../../../../src/repositories/db/app-db-schema.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

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

    adapter.close();
  });
});
