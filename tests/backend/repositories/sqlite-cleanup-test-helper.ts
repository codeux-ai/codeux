import { expect } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const SQLITE_TEST_CLOSE_SYMBOL = Symbol.for("code-ux.sqlite.closeOpenTestDatabases");

type SqliteTestDatabaseCloser = () => void;

interface HomeEnvSnapshot {
  HOME: string | undefined;
  USERPROFILE: string | undefined;
  XDG_CONFIG_HOME: string | undefined;
  XDG_STATE_HOME: string | undefined;
  XDG_CACHE_HOME: string | undefined;
}

function getSqliteTestDatabaseCloser(): SqliteTestDatabaseCloser | undefined {
  const globalWithSqliteClose = globalThis as Record<symbol, SqliteTestDatabaseCloser | undefined>;
  return globalWithSqliteClose[SQLITE_TEST_CLOSE_SYMBOL];
}

export async function createSqliteTempHome(prefix = "code-ux-sqlite-cleanup-"): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

function captureHomeEnv(): HomeEnvSnapshot {
  return {
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
  };
}

function restoreEnvValue(key: keyof HomeEnvSnapshot, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }
  process.env[key] = value;
}

function restoreHomeEnv(snapshot: HomeEnvSnapshot): void {
  restoreEnvValue("HOME", snapshot.HOME);
  restoreEnvValue("USERPROFILE", snapshot.USERPROFILE);
  restoreEnvValue("XDG_CONFIG_HOME", snapshot.XDG_CONFIG_HOME);
  restoreEnvValue("XDG_STATE_HOME", snapshot.XDG_STATE_HOME);
  restoreEnvValue("XDG_CACHE_HOME", snapshot.XDG_CACHE_HOME);
}

function applySqliteTempHome(homeDir: string): void {
  process.env.HOME = homeDir;
  process.env.USERPROFILE = homeDir;
  process.env.XDG_CONFIG_HOME = path.join(homeDir, ".config");
  process.env.XDG_STATE_HOME = path.join(homeDir, ".local", "state");
  process.env.XDG_CACHE_HOME = path.join(homeDir, ".cache");
}

function isPromiseLike<T>(value: T | Promise<T>): value is Promise<T> {
  return typeof value === "object" && value !== null && "then" in value && typeof value.then === "function";
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

export function withSqliteTempHome<T>(callback: (homeDir: string) => Promise<T>): Promise<T>;
export function withSqliteTempHome<T>(callback: (homeDir: string) => T): Promise<T>;
export async function withSqliteTempHome<T>(callback: (homeDir: string) => T | Promise<T>): Promise<T> {
  const previousEnv = captureHomeEnv();
  const homeDir = await createSqliteTempHome();
  applySqliteTempHome(homeDir);

  try {
    const result = callback(homeDir);
    return isPromiseLike(result) ? await result : result;
  } finally {
    restoreHomeEnv(previousEnv);
    await removeSqliteTempHome(homeDir);
  }
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
