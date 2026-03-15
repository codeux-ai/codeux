import { beforeEach, describe, expect, it, vi } from "vitest";

const databaseSyncCtor = vi.fn();

vi.mock("node:sqlite", () => ({
  DatabaseSync: function DatabaseSyncMock(this: unknown, ...args: unknown[]) {
    return databaseSyncCtor(...args);
  },
}));

describe("openSqliteDatabase", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
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
});
