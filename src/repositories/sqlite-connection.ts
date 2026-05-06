import { DatabaseSync } from "node:sqlite";

const SQLITE_BUSY_TIMEOUT_MS = 5_000;
const SQLITE_OPEN_RETRY_COUNT = 3;
const SQLITE_OPEN_RETRY_DELAY_MS = 250;

function sleepSync(ms: number): void {
  if (ms <= 0) {
    return;
  }

  const buffer = new SharedArrayBuffer(4);
  const array = new Int32Array(buffer);
  Atomics.wait(array, 0, 0, ms);
}

function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const code = "code" in error ? String((error as { code?: unknown }).code || "") : "";
  const errcode = "errcode" in error ? Number((error as { errcode?: unknown }).errcode) : NaN;
  const message = "message" in error ? String((error as { message?: unknown }).message || "") : "";

  return code === "ERR_SQLITE_ERROR"
    && (errcode === 5 || /database is locked/i.test(message));
}

export function openSqliteDatabase(dbPath: string): DatabaseSync {
  let attempt = 0;
  let lastError: unknown;

  while (attempt < SQLITE_OPEN_RETRY_COUNT) {
    attempt += 1;
    try {
      const db = new DatabaseSync(dbPath, {
        timeout: SQLITE_BUSY_TIMEOUT_MS,
        enableForeignKeyConstraints: true,
      });
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA busy_timeout = ${SQLITE_BUSY_TIMEOUT_MS};
      `);
      return db;
    } catch (error) {
      lastError = error;
      if (!isSqliteBusyError(error) || attempt >= SQLITE_OPEN_RETRY_COUNT) {
        if (isSqliteBusyError(error)) {
          throw new Error(
            `SQLite database remained locked after ${SQLITE_OPEN_RETRY_COUNT} attempts (${dbPath}). Another Code UX process may still be holding the database.`,
            { cause: error instanceof Error ? error : undefined },
          );
        }
        throw error;
      }
      sleepSync(SQLITE_OPEN_RETRY_DELAY_MS * attempt);
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError || "Failed to open sqlite database"));
}
