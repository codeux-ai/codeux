import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { AppDbStorage, resolveAppDbPath } from "../../../src/repositories/app-db-storage.js";
import {
  createSqliteTempHome,
  expectSqliteSidecarsRemoved,
  getExistingSqliteSidecars,
  removeSqliteTempHome,
  withSqliteTempHome,
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

  it("runs with deterministic Vitest environment defaults", () => {
    expect(process.env.TZ).toBe("UTC");
    expect(process.env.LANG).toBe("C.UTF-8");
    expect(process.env.LC_ALL).toBe("C.UTF-8");
    expect(process.env.VITEST_IN_MEMORY_DB).toBe("true");
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe("UTC");
  });

  it("keeps default repository storage off the real user database during Vitest", async () => {
    const homeDir = await createSqliteTempHome("code-ux-default-db-isolation-");
    const realRuntimeDbPath = path.join(homeDir, ".code-ux", "app.db");
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    process.env.HOME = homeDir;
    process.env.USERPROFILE = homeDir;

    try {
      expect(process.env.VITEST_IN_MEMORY_DB).toBe("true");
      expect(resolveAppDbPath()).toBe(":memory:");

      const storage = new AppDbStorage();
      try {
        expect(storage.getPath()).toBe(":memory:");
        expect(storage.getDatabase().prepare("SELECT 1 AS value").get()).toEqual({ value: 1 });
      } finally {
        storage.close();
      }

      await expect(fs.stat(realRuntimeDbPath)).rejects.toMatchObject({ code: "ENOENT" });
      await expectSqliteSidecarsRemoved(realRuntimeDbPath);
    } finally {
      if (originalHome === undefined) {
        delete process.env.HOME;
      } else {
        process.env.HOME = originalHome;
      }
      if (originalUserProfile === undefined) {
        delete process.env.USERPROFILE;
      } else {
        process.env.USERPROFILE = originalUserProfile;
      }
      await removeSqliteTempHome(homeDir);
    }
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

  it("allows file-backed WAL sidecars to be removed after repeated database close cycles", async () => {
    vi.doUnmock("node:sqlite");
    vi.resetModules();
    const homeDir = await createSqliteTempHome("code-ux-sqlite-connection-");
    const dbPath = path.join(homeDir, "app.db");

    try {
      const { openSqliteDatabase } = await import("../../../src/repositories/sqlite-connection.js");
      for (const value of ["first", "second"]) {
        const db = openSqliteDatabase(dbPath);
        db.exec(`
          CREATE TABLE IF NOT EXISTS cleanup_probe (
            id INTEGER PRIMARY KEY,
            value TEXT NOT NULL
          );
          INSERT INTO cleanup_probe (value) VALUES ('${value}');
        `);

        expect(await getExistingSqliteSidecars(dbPath)).toEqual(["app.db-wal", "app.db-shm"]);

        db.close();
        await expectSqliteSidecarsRemoved(dbPath);
      }
    } finally {
      await removeSqliteTempHome(homeDir);
    }
  });

  it("cleans HOME and USERPROFILE temp state created by the SQLite helper", async () => {
    const originalHome = process.env.HOME;
    const originalUserProfile = process.env.USERPROFILE;
    let helperHome = "";

    await withSqliteTempHome(async (homeDir) => {
      helperHome = homeDir;
      expect(process.env.HOME).toBe(homeDir);
      expect(process.env.USERPROFILE).toBe(homeDir);
      expect(process.env.XDG_CONFIG_HOME).toBe(path.join(homeDir, ".config"));
      expect(process.env.XDG_STATE_HOME).toBe(path.join(homeDir, ".local", "state"));
      expect(process.env.XDG_CACHE_HOME).toBe(path.join(homeDir, ".cache"));
    });

    expect(process.env.HOME).toBe(originalHome);
    expect(process.env.USERPROFILE).toBe(originalUserProfile);
    await expectSqliteSidecarsRemoved(path.join(helperHome, "app.db"));
    await expect(fs.stat(helperHome)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
