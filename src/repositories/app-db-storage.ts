import * as fs from "fs";
import * as path from "path";
import { DatabaseSync } from "node:sqlite";
import { getHomeSprintOsPath } from "../shared/config/sprint-os-paths.js";

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
  private readonly db: DatabaseSync;
  private readonly dbPath: string;

  constructor(dbPath?: string) {
    this.dbPath = resolveAppDbPath(dbPath);
    fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_settings (
        key TEXT PRIMARY KEY,
        payload TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        base_dir TEXT NOT NULL,
        repo_url TEXT,
        source_id TEXT,
        default_branch TEXT,
        feature_branch_prefix TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS project_sources (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sprints (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        number INTEGER,
        slug TEXT NOT NULL,
        name TEXT NOT NULL,
        goal TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        showcase_pinned INTEGER NOT NULL DEFAULT 0,
        start_date TEXT,
        end_date TEXT,
        feature_branch TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        task_key TEXT NOT NULL,
        title TEXT NOT NULL,
        prompt_markdown TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        priority TEXT NOT NULL DEFAULT 'medium',
        executor_type TEXT NOT NULL DEFAULT 'auto',
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_independent INTEGER NOT NULL DEFAULT 0,
        is_merged INTEGER NOT NULL DEFAULT 0,
        merge_indicator TEXT,
        source_type TEXT,
        source_path TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_dependencies (
        task_id TEXT NOT NULL,
        depends_on_task_id TEXT NOT NULL,
        PRIMARY KEY (task_id, depends_on_task_id),
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (depends_on_task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS mcp_connections (
        id TEXT PRIMARY KEY,
        connection_key TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL,
        transport TEXT NOT NULL,
        status TEXT NOT NULL,
        capabilities_json TEXT,
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS worker_endpoints (
        id TEXT PRIMARY KEY,
        endpoint_key TEXT NOT NULL UNIQUE,
        endpoint_type TEXT NOT NULL,
        display_name TEXT NOT NULL,
        status TEXT NOT NULL,
        connection_id TEXT UNIQUE,
        connection_key TEXT,
        transport TEXT,
        capabilities_json TEXT,
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (connection_id) REFERENCES mcp_connections(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS project_worker_assignments (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        worker_endpoint_id TEXT,
        worker_endpoint_key TEXT NOT NULL,
        worker_endpoint_type TEXT NOT NULL,
        worker_display_name TEXT NOT NULL,
        connection_id TEXT,
        connection_key TEXT,
        worker_transport TEXT,
        assignment_role TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_at TEXT NOT NULL,
        released_at TEXT,
        release_reason TEXT,
        last_affinity_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (worker_endpoint_id) REFERENCES worker_endpoints(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS project_attention_items (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT,
        task_id TEXT,
        sprint_run_id TEXT,
        dispatch_id TEXT,
        attention_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        owner_type TEXT NOT NULL,
        status TEXT NOT NULL,
        assigned_worker_endpoint_id TEXT,
        title TEXT NOT NULL,
        summary_markdown TEXT NOT NULL,
        payload_json TEXT,
        opened_at TEXT NOT NULL,
        claimed_at TEXT,
        resolved_at TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_run_id) REFERENCES sprint_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (dispatch_id) REFERENCES task_dispatches(id) ON DELETE CASCADE,
        FOREIGN KEY (assigned_worker_endpoint_id) REFERENCES worker_endpoints(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS connection_project_bindings (
        connection_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        is_active INTEGER NOT NULL DEFAULT 1,
        last_attention_cursor TEXT,
        last_assignment_cursor TEXT,
        created_at TEXT NOT NULL,
        PRIMARY KEY (connection_id, project_id),
        FOREIGN KEY (connection_id) REFERENCES mcp_connections(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        sprint_run_id TEXT,
        dispatch_id TEXT,
        connection_id TEXT,
        provider TEXT,
        mode TEXT,
        session_id TEXT,
        session_name TEXT,
        state TEXT NOT NULL,
        worker_branch TEXT,
        pr_url TEXT,
        started_at TEXT,
        finished_at TEXT,
        duration_ms INTEGER,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (connection_id) REFERENCES mcp_connections(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS task_run_events (
        id TEXT PRIMARY KEY,
        task_run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        originator TEXT,
        payload_json TEXT,
        source_event_key TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sprint_run_events (
        id TEXT PRIMARY KEY,
        sprint_run_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        originator TEXT,
        payload_json TEXT,
        source_event_key TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (sprint_run_id) REFERENCES sprint_runs(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS conversation_threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        connection_id TEXT,
        scope TEXT NOT NULL,
        title TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (connection_id) REFERENCES mcp_connections(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        direction TEXT NOT NULL,
        author_type TEXT NOT NULL,
        author_connection_id TEXT,
        body_markdown TEXT NOT NULL,
        delivery_status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        FOREIGN KEY (thread_id) REFERENCES conversation_threads(id) ON DELETE CASCADE,
        FOREIGN KEY (author_connection_id) REFERENCES mcp_connections(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS agent_presets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        instruction_markdown TEXT NOT NULL DEFAULT '',
        labels_json TEXT,
        source_path TEXT,
        source_scope TEXT,
        source_updated_at TEXT,
        source_imported_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS sprint_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        status TEXT NOT NULL,
        trigger_type TEXT NOT NULL,
        triggered_by TEXT,
        executor_mode TEXT NOT NULL,
        started_at TEXT,
        finished_at TEXT,
        last_heartbeat_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS task_dispatches (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        sprint_run_id TEXT NOT NULL,
        connection_id TEXT,
        executor_type TEXT NOT NULL,
        status TEXT NOT NULL,
        priority INTEGER NOT NULL DEFAULT 0,
        queued_at TEXT NOT NULL,
        claimed_at TEXT,
        started_at TEXT,
        finished_at TEXT,
        last_heartbeat_at TEXT,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_run_id) REFERENCES sprint_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (connection_id) REFERENCES mcp_connections(id) ON DELETE SET NULL
      );

      CREATE TABLE IF NOT EXISTS execution_leases (
        id TEXT PRIMARY KEY,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        owner_key TEXT NOT NULL,
        lease_token TEXT NOT NULL,
        acquired_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        last_heartbeat_at TEXT,
        UNIQUE(scope_type, scope_id)
      );

      CREATE TABLE IF NOT EXISTS dashboard_realtime_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        scope_type TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        entity_type TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        project_id TEXT,
        sprint_id TEXT,
        thread_id TEXT,
        task_id TEXT,
        dispatch_id TEXT,
        sprint_run_id TEXT,
        task_run_id TEXT,
        connection_id TEXT,
        correlation_id TEXT,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );
    `);

    this.ensureColumn("task_runs", "sprint_run_id", "TEXT");
    this.ensureColumn("task_runs", "dispatch_id", "TEXT");
    this.ensureColumn("tasks", "executor_type", "TEXT NOT NULL DEFAULT 'auto'");
    this.ensureColumn("task_run_events", "source_event_key", "TEXT");
    this.ensureColumn("sprints", "showcase_pinned", "INTEGER NOT NULL DEFAULT 0");
    this.ensureColumn("agent_presets", "source_path", "TEXT");
    this.ensureColumn("agent_presets", "source_scope", "TEXT");
    this.ensureColumn("agent_presets", "source_updated_at", "TEXT");
    this.ensureColumn("agent_presets", "source_imported_at", "TEXT");
    this.ensureColumn("connection_project_bindings", "last_attention_cursor", "TEXT");
    this.ensureColumn("connection_project_bindings", "last_assignment_cursor", "TEXT");
    this.ensureIndex("idx_sprint_runs_project_sprint", "sprint_runs", "project_id, sprint_id, created_at DESC");
    this.ensureIndex("idx_task_dispatches_sprint_run", "task_dispatches", "sprint_run_id, status, queued_at ASC");
    this.ensureIndex("idx_task_dispatches_task", "task_dispatches", "task_id, created_at DESC");
    this.ensureIndex("idx_execution_leases_scope", "execution_leases", "scope_type, scope_id");
    this.ensureIndex("idx_task_run_events_task_run_created", "task_run_events", "task_run_id, created_at DESC");
    this.ensureUniqueIndex("idx_task_run_events_source_event", "task_run_events", "task_run_id, source_event_key");
    this.ensureIndex("idx_sprint_run_events_sprint_run_created", "sprint_run_events", "sprint_run_id, created_at DESC");
    this.ensureUniqueIndex("idx_sprint_run_events_source_event", "sprint_run_events", "sprint_run_id, source_event_key");
    this.ensureIndex("idx_dashboard_realtime_events_scope_sequence", "dashboard_realtime_events", "scope_type, scope_id, sequence DESC");
    this.ensureIndex("idx_agent_presets_project_updated", "agent_presets", "project_id, updated_at DESC");
    this.ensureIndex("idx_agent_presets_project_name", "agent_presets", "project_id, name");
    this.ensureUniqueIndex("idx_worker_endpoints_connection", "worker_endpoints", "connection_id");
    this.ensureIndex("idx_worker_endpoints_type_status", "worker_endpoints", "endpoint_type, status, updated_at DESC");
    this.ensureIndex("idx_project_worker_assignments_project_status", "project_worker_assignments", "project_id, status, assignment_role, last_affinity_at DESC");
    this.ensureIndex("idx_project_worker_assignments_worker_status", "project_worker_assignments", "worker_endpoint_id, status, last_affinity_at DESC");
    this.ensureIndex("idx_project_attention_items_project_status", "project_attention_items", "project_id, status, opened_at DESC");
    this.ensureIndex("idx_project_attention_items_dispatch_status", "project_attention_items", "dispatch_id, status, opened_at DESC");
  }

  getPath(): string {
    return this.dbPath;
  }

  getDatabase(): DatabaseSync {
    return this.db;
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

    this.db.exec("PRAGMA foreign_keys = OFF");
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
      this.db.exec("PRAGMA foreign_keys = ON");
    }
  }

  private ensureColumn(tableName: string, columnName: string, columnDefinition: string): void {
    const rows = this.db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
    if (rows.some((row) => row.name === columnName)) {
      return;
    }
    this.db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
  }

  private ensureIndex(indexName: string, tableName: string, columns: string): void {
    this.db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns})`);
  }

  private ensureUniqueIndex(indexName: string, tableName: string, columns: string): void {
    this.db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns})`);
  }
}
