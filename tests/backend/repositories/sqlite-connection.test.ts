import { beforeEach, describe, expect, it, vi } from "vitest";
import * as path from "path";
import {
  createSqliteTempHome,
  expectSqliteSidecarsRemoved,
  getExistingSqliteSidecars,
  removeSqliteTempHome,
} from "./sqlite-cleanup-test-helper.js";

const databaseSyncCtor = vi.fn();

function mockNodeSqlite(): void {
  vi.doMock("node:sqlite", () => ({
    DatabaseSync: function DatabaseSyncMock(this: unknown, ...args: unknown[]) {
      return databaseSyncCtor(...args);
    },
  }));
}

describe("openSqliteDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mockNodeSqlite();
  });

  it("opens sqlite with timeout and pragmas", async () => {
    const exec = vi.fn();
    databaseSyncCtor.mockReturnValue({ exec });

    const { openSqliteDatabase } = await import("../../../src/repositories/sqlite-connection.js");
    const db = openSqliteDatabase("/tmp/test.db");

    expect(databaseSyncCtor).toHaveBeenCalledWith("/tmp/test.db", {
      timeout: 5000,
      enableForeignKeyConstraints: true,
    });
    expect(exec).toHaveBeenCalledWith(expect.stringContaining("PRAGMA journal_mode = WAL;"));
    expect(exec).toHaveBeenCalledWith(expect.stringContaining("PRAGMA wal_autocheckpoint = 0;"));
    expect(db).toEqual({ exec });
  });

  it("retries busy startup failures before succeeding", async () => {
    const exec = vi.fn();
    databaseSyncCtor
      .mockImplementationOnce(() => {
        const error = new Error("database is locked") as Error & { code: string; errcode: number };
        error.code = "ERR_SQLITE_ERROR";
        error.errcode = 5;
        throw error;
      })
      .mockReturnValueOnce({ exec });

    const { openSqliteDatabase } = await import("../../../src/repositories/sqlite-connection.js");
    const db = openSqliteDatabase("/tmp/retry.db");

    expect(databaseSyncCtor).toHaveBeenCalledTimes(2);
    expect(db).toEqual({ exec });
  });

  it("allows file-backed WAL sidecars to be removed after the database is closed", async () => {
    vi.doUnmock("node:sqlite");
    vi.resetModules();
    const homeDir = await createSqliteTempHome("code-ux-sqlite-connection-");
    const dbPath = path.join(homeDir, "app.db");

    try {
      const { openSqliteDatabase } = await import("../../../src/repositories/sqlite-connection.js");
      const db = openSqliteDatabase(dbPath);
      db.exec(`
        CREATE TABLE cleanup_probe (
          id INTEGER PRIMARY KEY,
          value TEXT NOT NULL
        );
        INSERT INTO cleanup_probe (value) VALUES ('ready');
      `);

      expect(await getExistingSqliteSidecars(dbPath)).toEqual(["app.db-wal", "app.db-shm"]);

      db.close();
      await expectSqliteSidecarsRemoved(dbPath);
    } finally {
      await removeSqliteTempHome(homeDir);
    }
  });
});
