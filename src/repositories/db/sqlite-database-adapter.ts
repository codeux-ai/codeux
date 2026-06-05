import type { DatabaseSync, StatementSync } from "node:sqlite";
import { DatabaseAdapter, PreparedStatement } from "./database-adapter.js";
import { SqlDialect, SqliteDialect } from "./sql-dialect.js";
import { openSqliteDatabase } from "../sqlite-connection.js";
import * as fs from "fs";
import * as path from "path";

const SQLITE_TEST_CLOSE_SYMBOL = Symbol.for("code-ux.sqlite.closeOpenTestDatabases");

export class SqliteDatabaseAdapter implements DatabaseAdapter {
  public readonly dialect: SqlDialect = SqliteDialect;
  private static readonly openTestAdapters = new Set<SqliteDatabaseAdapter>();
  private readonly db: DatabaseSync;
  private readonly cachedStatements = new Map<string, StatementSync>();
  private readonly MAX_CACHE_SIZE = 500;
  private closed = false;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = openSqliteDatabase(dbPath);
    if (process.env.VITEST) {
      SqliteDatabaseAdapter.openTestAdapters.add(this);
    }
  }

  prepare(sql: string): PreparedStatement {
    let stmt = this.cachedStatements.get(sql);
    if (stmt) {
      // LRU on hit: delete and re-insert to move to the end
      this.cachedStatements.delete(sql);
      this.cachedStatements.set(sql, stmt);
    } else {
      if (this.cachedStatements.size >= this.MAX_CACHE_SIZE) {
        // Evict the oldest (first inserted) item
        const oldestKey = this.cachedStatements.keys().next().value;
        if (oldestKey !== undefined) {
          this.cachedStatements.delete(oldestKey);
        }
      }
      stmt = this.db.prepare(sql);
      this.cachedStatements.set(sql, stmt);
    }
    return stmt as unknown as PreparedStatement;
  }

  exec(sql: string): void {
    this.db.exec(sql);
  }

  transaction<T>(fn: () => T): T {
    this.exec("BEGIN");
    try {
      const result = fn();
      this.exec("COMMIT");
      return result;
    } catch (error) {
      this.exec("ROLLBACK");
      throw error;
    }
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.cachedStatements.clear();
    this.db.close();
    SqliteDatabaseAdapter.openTestAdapters.delete(this);
  }

  /**
   * For backwards compatibility with direct SQLite accesses in tests or specific instances
   */
  getRawDatabase(): DatabaseSync {
    return this.db;
  }

  static closeOpenTestDatabases(): void {
    for (const adapter of [...SqliteDatabaseAdapter.openTestAdapters]) {
      adapter.close();
    }
  }
}

if (process.env.VITEST) {
  const globalWithSqliteClose = globalThis as Record<symbol, (() => void) | undefined>;
  globalWithSqliteClose[SQLITE_TEST_CLOSE_SYMBOL] = () => {
    SqliteDatabaseAdapter.closeOpenTestDatabases();
  };
}
