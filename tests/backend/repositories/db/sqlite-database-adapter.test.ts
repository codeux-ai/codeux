import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import { createTempDbContext } from "../../helpers/temp-db.js";
import type { TempDbContext } from "../../helpers/temp-db.js";

const tempContexts: TempDbContext[] = [];

afterEach(() => {
  for (const context of tempContexts.splice(0)) {
    context.cleanup();
  }
});

describe("SqliteDatabaseAdapter", () => {
  it("executes basic transactions", async () => {
    const context = await createTempDbContext("db-adapter-");
    tempContexts.push(context);
    const adapter = context.createAdapter();

    adapter.exec("CREATE TABLE tests (id INTEGER PRIMARY KEY, value TEXT);");

    const result = adapter.transaction(() => {
      adapter.exec("INSERT INTO tests (value) VALUES ('hello')");
      return "done";
    });

    expect(result).toBe("done");

    const row = adapter.prepare("SELECT value FROM tests").get() as { value: string };
    expect(row.value).toBe("hello");
  });

  it("rolls back failed transactions", async () => {
    const context = await createTempDbContext("db-adapter-");
    tempContexts.push(context);
    const adapter = context.createAdapter();

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
  });

  it("caps the prepared statement cache and evicts old statements", async () => {
    const context = await createTempDbContext("db-adapter-");
    tempContexts.push(context);
    const adapter = context.createAdapter();

    // Prepare 600 unique statements
    for (let i = 0; i < 600; i++) {
      adapter.prepare(`SELECT ${i} as val`);
    }

    // The cache should not exceed 500
    // We can't access private property directly, but we can access it via casting
    const cache = (adapter as unknown as { cachedStatements: Map<string, unknown> }).cachedStatements;
    expect(cache.size).toBeLessThanOrEqual(500);
  });

  it("closes WAL sidecars before temp database cleanup", async () => {
    const context = await createTempDbContext("db-adapter-wal-");
    tempContexts.push(context);
    const adapter = context.createAdapter();

    adapter.exec("PRAGMA journal_mode=WAL");
    adapter.exec("CREATE TABLE tests (id INTEGER PRIMARY KEY, value TEXT);");
    adapter.exec("INSERT INTO tests (value) VALUES ('wal-write')");
    adapter.close();

    expect(() => context.cleanup()).not.toThrow();
    expect(fs.existsSync(context.rootDir)).toBe(false);
  });
});
