import { describe, expect, it } from "vitest";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

describe("SqliteDatabaseAdapter", () => {
  it("executes basic transactions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-adapter-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));

    adapter.exec("CREATE TABLE tests (id INTEGER PRIMARY KEY, value TEXT);");

    const result = adapter.transaction(() => {
      adapter.exec("INSERT INTO tests (value) VALUES ('hello')");
      return "done";
    });

    expect(result).toBe("done");

    const row = adapter.prepare("SELECT value FROM tests").get() as { value: string };
    expect(row.value).toBe("hello");

    adapter.close();
  });

  it("rolls back failed transactions", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-adapter-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));

    adapter.exec("CREATE TABLE tests (id INTEGER PRIMARY KEY, value TEXT);");

    try {
      adapter.transaction(() => {
        adapter.exec("INSERT INTO tests (value) VALUES ('hello')");
        throw new Error("fail");
      });
    } catch (e) {
      // expected
    }

    const row = adapter.prepare("SELECT value FROM tests").get() as { value: string } | undefined;
    expect(row).toBeUndefined();

    adapter.close();
  });

  it("caps the prepared statement cache and evicts old statements", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-adapter-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));

    // Prepare 600 unique statements
    for (let i = 0; i < 600; i++) {
      adapter.prepare(`SELECT ${i} as val`);
    }

    // The cache should not exceed 500
    // We can't access private property directly, but we can access it via casting
    const cache = (adapter as any).cachedStatements;
    expect(cache.size).toBeLessThanOrEqual(500);

    adapter.close();
  });
});
