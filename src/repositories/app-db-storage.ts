import * as fs from "fs";
import * as path from "path";
import type { StatementSync } from "node:sqlite";
import { getHomeSprintOsPath } from "../shared/config/sprint-os-paths.js";
import { SqliteDatabaseAdapter } from "./db/sqlite-database-adapter.js";
import { APP_DB_SCHEMA_TABLES } from "./db/app-db-schema.js";
import { runMigrations } from "./db/app-db-migrations.js";
import { executeChunkedInQuery } from "./repository-utils.js";

interface TableRow {
  name: string;
}

const APP_DB_PATH = getHomeSprintOsPath("app.db");

export function resolveAppDbPath(dbPath?: string): string {
  if (dbPath && dbPath.trim().length > 0) {
    return dbPath;
  }

  fs.mkdirSync(path.dirname(APP_DB_PATH), { recursive: true });
  return APP_DB_PATH;
}

export class AppDbStorage {
  private readonly db: SqliteDatabaseAdapter;
  private readonly dbPath: string;
  private readonly cachedStatements = new Map<string, StatementSync>();

  constructor(dbPath?: string) {
    this.dbPath = resolveAppDbPath(dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new SqliteDatabaseAdapter(this.dbPath);
    this.db.exec(APP_DB_SCHEMA_TABLES);
    runMigrations(this.db);
  }

  getPath(): string {
    return this.dbPath;
  }

  getDatabase(): SqliteDatabaseAdapter {
    return this.db;
  }


  getCachedStatement(sql: string): StatementSync {
    let stmt = this.cachedStatements.get(sql);
    if (!stmt) {
      stmt = this.db.getRawDatabase().prepare(sql);
      this.cachedStatements.set(sql, stmt);
    }
    return stmt;
  }

  executeChunkedInQuery<T>(params: {
    sqlPrefix: string;
    sqlSuffix?: string;
    items: string[];
    bindParamsBefore?: any[];
    bindParamsAfter?: any[];
  }): T[] {
    return executeChunkedInQuery<T>((sql) => this.getCachedStatement(sql), params);
  }

  hasTable(name: string): boolean {
    const row = this.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = ?
    `).get(name) as TableRow | undefined;

    return row?.name === name;
  }

  resetAllData(): void {
    const rows = this.db.prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table'
        AND name NOT LIKE 'sqlite_%'
        AND name != 'schema_migrations'
    `).all() as unknown as TableRow[];

    this.db.getRawDatabase().exec("PRAGMA foreign_keys = OFF");
    try {
      this.db.exec("BEGIN");
      for (const row of rows) {
        this.db.exec(`DELETE FROM ${row.name}`);
      }
      if (this.hasTable("sqlite_sequence")) {
        this.db.exec("DELETE FROM sqlite_sequence");
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    } finally {
      this.db.getRawDatabase().exec("PRAGMA foreign_keys = ON");
    }
  }

}
