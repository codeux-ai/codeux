import * as fs from "fs";
import * as path from "path";
import type { StatementSync } from "node:sqlite";
import { getHomeCodeUxPath } from "../shared/config/code-ux-paths.js";
import { SqliteDatabaseAdapter } from "./db/sqlite-database-adapter.js";
import { APP_DB_SCHEMA_READ_INDEXES, APP_DB_SCHEMA_TABLES } from "./db/app-db-schema.js";
import {
  collectDeferredIndexCatalog,
  runBoundedDataMigrationPass,
  runMigrations,
  type BoundedDataMigrationResult,
  type DeferredIndexDefinition,
} from "./db/app-db-migrations.js";
import { buildDeferredIndex, type DeferredIndexBuildStatus } from "./db/deferred-index-builder.js";
import { executeChunkedInQuery, SQLiteParam } from "./repository-utils.js";

interface TableRow {
  name: string;
}

const APP_DB_PATH = getHomeCodeUxPath("app.db");
const MAINTENANCE_CRITICAL_INDEXES = new Set([
  "idx_execution_invocation_messages_invocation_created",
  "idx_execution_invocations_attention",
  "idx_execution_invocations_provider_invocation",
  "idx_execution_invocations_task_run_started",
  "idx_node_flow_node_runs_execution_invocation",
  "idx_node_flow_runs_execution_invocation",
  "idx_provider_invocations_attention",
  "idx_provider_invocations_task_run",
  "idx_qa_review_runs_task_run",
  "idx_task_run_events_task_run_created_id",
]);

export function resolveAppDbPath(dbPath?: string): string {
  if (process.env.VITEST_IN_MEMORY_DB === "true") {
    return ":memory:";
  }
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
  private deferredIndexes: DeferredIndexDefinition[] = [];
  private deferredIndexInFlight = false;
  private readonly deferredIndexAbortController = new AbortController();

  constructor(dbPath?: string) {
    this.dbPath = resolveAppDbPath(dbPath);
    if (this.dbPath !== ":memory:") {
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    }
    this.db = new SqliteDatabaseAdapter(this.dbPath);
    const existingSchema = this.db.prepare(`
      SELECT 1 AS present
      FROM sqlite_master
      WHERE type = 'table' AND name = 'task_runs'
      LIMIT 1
    `).get() !== undefined;
    this.db.exec(APP_DB_SCHEMA_TABLES);
    if (!existingSchema) {
      this.db.exec(APP_DB_SCHEMA_READ_INDEXES);
    }
    const migrationIndexes = runMigrations(this.db, { deferNonUniqueIndexes: existingSchema });
    const catalogIndexes = existingSchema
      ? collectDeferredIndexCatalog(this.db, APP_DB_SCHEMA_READ_INDEXES)
      : [];
    this.deferredIndexes = [...new Map(
      [...catalogIndexes, ...migrationIndexes].map((definition) => [definition.name, definition]),
    ).values()]
      .sort((left, right) => Number(MAINTENANCE_CRITICAL_INDEXES.has(right.name)) - Number(MAINTENANCE_CRITICAL_INDEXES.has(left.name)));
  }

  getPath(): string {
    return this.dbPath;
  }

  getDatabase(): SqliteDatabaseAdapter {
    return this.db;
  }

  getPendingDeferredIndexCount(): number {
    return this.deferredIndexes.length;
  }

  hasPendingMaintenanceCriticalIndexes(): boolean {
    return this.deferredIndexes.some((definition) => MAINTENANCE_CRITICAL_INDEXES.has(definition.name));
  }

  runBoundedDataMigrationsIfIdle(): (BoundedDataMigrationResult & { skipped: false }) | { skipped: true } {
    const active = this.db.prepare(`
      SELECT 1 AS active
      FROM provider_invocations
      WHERE status = 'running'
      LIMIT 1
    `).get() as { active?: number } | undefined;
    if (active?.active === 1) {
      return { skipped: true };
    }
    const result = runBoundedDataMigrationPass(this.db);
    return { ...result, skipped: false };
  }

  async runNextDeferredIndexIfIdle(): Promise<DeferredIndexBuildStatus | "none" | "in_flight"> {
    if (this.deferredIndexInFlight) return "in_flight";
    const definition = this.deferredIndexes[0];
    if (!definition || this.dbPath === ":memory:") return "none";
    const active = this.db.prepare(`
      SELECT 1 AS active
      FROM provider_invocations
      WHERE status = 'running'
      LIMIT 1
    `).get() as { active?: number } | undefined;
    if (active?.active === 1) return "active";

    this.deferredIndexInFlight = true;
    try {
      const status = await buildDeferredIndex(
        this.dbPath,
        definition,
        this.deferredIndexAbortController.signal,
      );
      if (status === "created" && this.deferredIndexes[0]?.name === definition.name) {
        this.deferredIndexes.shift();
      }
      return status;
    } finally {
      this.deferredIndexInFlight = false;
    }
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
    bindParamsBefore?: SQLiteParam[];
    bindParamsAfter?: SQLiteParam[];
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

  close(): void {
    this.deferredIndexAbortController.abort();
    this.cachedStatements.clear();
    this.db.close();
  }

}
