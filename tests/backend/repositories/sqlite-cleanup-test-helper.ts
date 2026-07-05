import { expect } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const SQLITE_TEST_CLOSE_SYMBOL = Symbol.for("code-ux.sqlite.closeOpenTestDatabases");

type SqliteTestDatabaseCloser = () => void;

function getSqliteTestDatabaseCloser(): SqliteTestDatabaseCloser | undefined {
  const globalWithSqliteClose = globalThis as Record<symbol, SqliteTestDatabaseCloser | undefined>;
  return globalWithSqliteClose[SQLITE_TEST_CLOSE_SYMBOL];
}

export async function createSqliteTempHome(prefix = "code-ux-sqlite-cleanup-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export function closeOpenSqliteTestDatabases(): void {
  getSqliteTestDatabaseCloser()?.();
}

export async function removeSqliteTempHome(homeDir: string): Promise<void> {
  closeOpenSqliteTestDatabases();
  await fs.rm(homeDir, {
    recursive: true,
    force: true,
    maxRetries: process.platform === "win32" ? 3 : 0,
    retryDelay: 50,
  });
}

export async function getExistingSqliteSidecars(dbPath: string): Promise<string[]> {
  const sidecars = [`${dbPath}-wal`, `${dbPath}-shm`];
  const existing: string[] = [];

  for (const sidecar of sidecars) {
    try {
      await fs.stat(sidecar);
      existing.push(path.basename(sidecar));
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code || "")
        : "";
      if (code !== "ENOENT") {
        throw error;
      }
    }
  }

  return existing;
}

export async function expectSqliteSidecarsRemoved(dbPath: string): Promise<void> {
  expect(await getExistingSqliteSidecars(dbPath)).toEqual([]);
}
