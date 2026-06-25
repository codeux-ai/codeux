import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";
import { migrateGuardrailLedgerDropTaskForeignKey } from "../../../../src/repositories/db/app-db-migrations.js";

const tempDirs: string[] = [];

async function makeDb(): Promise<SqliteDatabaseAdapter> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "guardrail-migration-"));
  tempDirs.push(dir);
  const db = new SqliteDatabaseAdapter(path.join(dir, "app.db"));
  // Minimal referenced tables so the legacy FKs are valid.
  db.exec(`CREATE TABLE projects (id TEXT PRIMARY KEY)`);
  db.exec(`CREATE TABLE tasks (id TEXT PRIMARY KEY)`);
  return db;
}

const LEGACY_TABLE = `
  CREATE TABLE guardrail_ledger (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL,
    task_id TEXT NOT NULL,
    purpose TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
  )
`;

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("migrateGuardrailLedgerDropTaskForeignKey", () => {
  it("rebuilds a legacy table to drop the tasks(id) foreign key while preserving rows", async () => {
    const db = await makeDb();
    try {
      db.exec(LEGACY_TABLE);
      db.exec(`INSERT INTO projects (id) VALUES ('p1')`);
      db.exec(`INSERT INTO tasks (id) VALUES ('t1')`);
      db.exec(`
        INSERT INTO guardrail_ledger (id, project_id, task_id, purpose, count, created_at, updated_at)
        VALUES ('g1', 'p1', 't1', 'task_coding', 3, 'now', 'now')
      `);

      const before = db.prepare("PRAGMA foreign_key_list(guardrail_ledger)").all() as Array<{ table?: string }>;
      expect(before.some((fk) => fk.table === "tasks")).toBe(true);

      migrateGuardrailLedgerDropTaskForeignKey(db);

      const after = db.prepare("PRAGMA foreign_key_list(guardrail_ledger)").all() as Array<{ table?: string }>;
      expect(after.some((fk) => fk.table === "tasks")).toBe(false);
      expect(after.some((fk) => fk.table === "projects")).toBe(true);

      const row = db.prepare("SELECT count FROM guardrail_ledger WHERE id = 'g1'").get() as { count: number };
      expect(row.count).toBe(3);

      // Synthetic, taskless keys now insert without violating any FK.
      expect(() =>
        db.exec(`
          INSERT INTO guardrail_ledger (id, project_id, task_id, purpose, count, created_at, updated_at)
          VALUES ('g2', 'p1', 'main-merge-ci-fix:sprint-run-1', 'ci_fix', 1, 'now', 'now')
        `),
      ).not.toThrow();
    } finally {
      db.close();
    }
  });

  it("is a no-op when the task foreign key is already absent", async () => {
    const db = await makeDb();
    try {
      db.exec(`
        CREATE TABLE guardrail_ledger (
          id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          task_id TEXT NOT NULL,
          purpose TEXT NOT NULL,
          count INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
        )
      `);
      expect(() => migrateGuardrailLedgerDropTaskForeignKey(db)).not.toThrow();
      const fks = db.prepare("PRAGMA foreign_key_list(guardrail_ledger)").all() as Array<{ table?: string }>;
      expect(fks.some((fk) => fk.table === "tasks")).toBe(false);
    } finally {
      db.close();
    }
  });
});
