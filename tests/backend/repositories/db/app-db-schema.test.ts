import { afterEach, describe, expect, it, vi } from "vitest";
import { AppDbStorage } from "../../../../src/repositories/app-db-storage.js";
import { SqliteDatabaseAdapter } from "../../../../src/repositories/db/sqlite-database-adapter.js";
import {
  APP_DB_SCHEMA_READ_INDEXES,
  APP_DB_SCHEMA_TABLES,
} from "../../../../src/repositories/db/app-db-schema.js";
import { runMigrations } from "../../../../src/repositories/db/app-db-migrations.js";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";

const liveSnapshotIndexNames = [
  "idx_provider_invocations_project_sprint_started",
  "idx_provider_invocations_project_sprint_run_started",
  "idx_provider_invocations_sprint_started",
  "idx_provider_invocations_sprint_run_started",
  "idx_provider_invocations_task_run",
  "idx_provider_invocations_session_owner",
  "idx_sprint_runs_project_sprint",
  "idx_sprint_runs_project_status_recency",
  "idx_task_runs_dispatch",
  "idx_task_runs_session_id_owner",
  "idx_task_runs_session_name_owner",
  "idx_task_runs_pr_url_owner",
  "idx_task_dispatches_project_task_recency",
  "idx_task_dispatches_project_sprint_run_recency",
  "idx_task_runs_project_sprint_lookup",
  "idx_task_runs_project_sprint_run_lookup",
  "idx_task_run_events_project_created",
  "idx_task_run_events_task_run_created_id",
  "idx_task_run_events_task_run_type_created_id",
  "idx_sprint_run_events_sprint_run_created_id",
  "idx_sprint_runs_project_lookup",
  "idx_project_attention_items_project_status_updated",
  "idx_project_attention_items_project_status_updated_opened",
  "idx_project_attention_items_sprint_run_status_updated_opened",
  "idx_execution_invocations_project_started",
  "idx_execution_invocations_project_sprint_started",
  "idx_execution_invocations_project_sprint_run_started",
  "idx_execution_invocations_status_started",
  "idx_node_flows_project_updated",
  "idx_node_flow_versions_flow_version",
  "idx_node_flow_agent_skills_agent",
  "idx_node_flow_runs_flow_created",
  "idx_node_flow_runs_project_created",
  "idx_node_flow_node_runs_run_created",
] as const;

const liveSnapshotIndexColumns: Record<(typeof liveSnapshotIndexNames)[number], string[]> = {
  idx_provider_invocations_project_sprint_started: ["project_id", "sprint_id", "started_at"],
  idx_provider_invocations_project_sprint_run_started: ["project_id", "sprint_run_id", "started_at"],
  idx_provider_invocations_sprint_started: ["sprint_id", "started_at"],
  idx_provider_invocations_sprint_run_started: ["sprint_run_id", "started_at"],
  idx_provider_invocations_task_run: ["task_run_id", "started_at"],
  idx_provider_invocations_session_owner: ["session_id", "project_id", "sprint_id", "task_id"],
  idx_sprint_runs_project_sprint: ["project_id", "sprint_id", "created_at"],
  idx_sprint_runs_project_status_recency: ["project_id", "status", "last_heartbeat_at", "updated_at", "created_at"],
  idx_task_runs_dispatch: ["dispatch_id"],
  idx_task_runs_session_id_owner: ["session_id", "project_id", "sprint_id", "task_id"],
  idx_task_runs_session_name_owner: ["session_name", "project_id", "sprint_id", "task_id"],
  idx_task_runs_pr_url_owner: ["pr_url", "project_id", "sprint_id", "task_id"],
  idx_task_dispatches_project_task_recency: ["project_id", "task_id", "last_heartbeat_at", "started_at", "claimed_at", "queued_at"],
  idx_task_dispatches_project_sprint_run_recency: ["project_id", "sprint_run_id", "last_heartbeat_at", "started_at", "claimed_at", "queued_at"],
  idx_task_runs_project_sprint_lookup: ["project_id", "sprint_id", "sprint_run_id", "id"],
  idx_task_runs_project_sprint_run_lookup: ["project_id", "sprint_run_id", "id"],
  idx_task_run_events_project_created: ["project_id", "created_at", "id"],
  idx_task_run_events_task_run_created_id: ["task_run_id", "created_at", "id"],
  idx_task_run_events_task_run_type_created_id: ["task_run_id", "event_type", "created_at", "id"],
  idx_sprint_run_events_sprint_run_created_id: ["sprint_run_id", "created_at", "id"],
  idx_sprint_runs_project_lookup: ["project_id", "id", "sprint_id", "status"],
  idx_project_attention_items_project_status_updated: ["project_id", "status", "updated_at"],
  idx_project_attention_items_project_status_updated_opened: ["project_id", "status", "updated_at", "opened_at", "id"],
  idx_project_attention_items_sprint_run_status_updated_opened: ["sprint_run_id", "status", "updated_at", "opened_at", "id"],
  idx_execution_invocations_project_started: ["project_id", "started_at"],
  idx_execution_invocations_project_sprint_started: ["project_id", "sprint_id", "started_at"],
  idx_execution_invocations_project_sprint_run_started: ["project_id", "sprint_run_id", "started_at"],
  idx_execution_invocations_status_started: ["status", "started_at"],
  idx_node_flows_project_updated: ["project_id", "updated_at"],
  idx_node_flow_versions_flow_version: ["flow_id", "version"],
  idx_node_flow_agent_skills_agent: ["project_id", "agent_preset_id"],
  idx_node_flow_runs_flow_created: ["flow_id", "created_at"],
  idx_node_flow_runs_project_created: ["project_id", "created_at"],
  idx_node_flow_node_runs_run_created: ["run_id", "created_at"],
};

function getSchemaSignature(adapter: SqliteDatabaseAdapter): {
  tables: string[];
  indexes: string[];
  providerInvocationColumns: string[];
} {
  const tables = (adapter.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    ORDER BY name ASC
  `).all() as Array<{ name: string }>).map((row) => row.name);
  const indexes = (adapter.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
    ORDER BY name ASC
  `).all() as Array<{ name: string }>).map((row) => row.name);
  const providerInvocationColumns = (
    adapter.prepare("PRAGMA table_info(provider_invocations)").all() as Array<{ name: string }>
  ).map((row) => row.name);

  return { tables, indexes, providerInvocationColumns };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("AppDbSchema", () => {
  it("initializes the database with all requested indexes", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-schema-test-"));
    const adapter = new SqliteDatabaseAdapter(path.join(dir, "app.db"));
    try {
      adapter.exec(APP_DB_SCHEMA_TABLES);
      adapter.exec(APP_DB_SCHEMA_READ_INDEXES);
      runMigrations(adapter);

      const getIndex = (name: string) => {
        return adapter.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(name);
      };
      const getIndexColumns = (name: (typeof liveSnapshotIndexNames)[number]) => {
        return (adapter.prepare(`PRAGMA index_info('${name}')`).all() as Array<{ name: string }>)
          .map((row) => row.name);
      };
      const getColumnNames = (tableName: string) => (
        adapter.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
      ).map((row) => row.name);

      expect(getIndex("idx_provider_invocations_provider_status")).toBeDefined();
      expect(getIndex("idx_task_dispatches_project_executor_status_priority")).toBeDefined();
      expect(getIndex("idx_task_runs_task_sprint_session")).toBeDefined();
      expect(getIndex("idx_task_self_reflection_ratings_task_run")).toBeDefined();
      expect(getIndex("idx_task_self_reflection_ratings_task_latest")).toBeDefined();
      expect(getIndex("idx_task_self_reflection_ratings_project_task_latest")).toBeDefined();
      expect(getIndex("idx_project_attention_items_project_owner_status")).toBeDefined();
      expect(getIndex("idx_execution_invocations_provider_invocation")).toBeDefined();
      for (const indexName of liveSnapshotIndexNames) {
        expect(getIndex(indexName)).toBeDefined();
        expect(getIndexColumns(indexName)).toEqual(liveSnapshotIndexColumns[indexName]);
      }
      expect(getColumnNames("sprint_linked_issues")).toEqual(expect.arrayContaining([
        "issue_body_markdown",
        "issue_conversation_markdown",
        "include_conversation",
        "issue_author",
        "issue_created_at",
        "issue_updated_at",
        "metadata_json",
      ]));
    } finally {
      adapter.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("creates execution snapshot indexes during in-memory startup migrations", () => {
    const storage = new AppDbStorage(":memory:");
    try {
      const db = storage.getDatabase();
      const getIndexColumns = (name: (typeof liveSnapshotIndexNames)[number]) => {
        return (db.prepare(`PRAGMA index_info('${name}')`).all() as Array<{ name: string }>)
          .map((row) => row.name);
      };

      for (const indexName of liveSnapshotIndexNames) {
        const row = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name=?").get(indexName);
        expect(row).toBeDefined();
        expect(getIndexColumns(indexName)).toEqual(liveSnapshotIndexColumns[indexName]);
      }
    } finally {
      storage.close();
    }
  });

  it("replays startup migrations without duplicating indexes or dropping migrated columns", () => {
    const storage = new AppDbStorage(":memory:");
    try {
      const db = storage.getDatabase();

      for (let replay = 0; replay < 3; replay += 1) {
        runMigrations(db);
      }

      const getTable = (name: string) => db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
      `).get(name);
      const getColumnNames = (tableName: string) => (
        db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name: string }>
      ).map((row) => row.name);
      const getIndexCount = (indexName: string) => {
        const row = db.prepare(`
          SELECT COUNT(*) AS count
          FROM sqlite_master
          WHERE type = 'index' AND name = ?
        `).get(indexName) as { count: number };
        return row.count;
      };

      expect(getTable("memory_claims")).toBeDefined();
      expect(getTable("knowledge_documents")).toBeDefined();
      expect(getTable("sprint_file_browser_sessions")).toBeDefined();
      expect(getTable("task_self_reflection_ratings")).toBeDefined();
      expect(getTable("node_flows")).toBeDefined();
      expect(getTable("node_flow_versions")).toBeDefined();
      expect(getTable("node_flow_agent_skills")).toBeDefined();
      expect(getTable("node_flow_runs")).toBeDefined();
      expect(getTable("node_flow_node_runs")).toBeDefined();
      expect(getColumnNames("node_flow_runs")).toContain("execution_invocation_id");
      expect(getColumnNames("node_flow_node_runs")).toContain("execution_invocation_id");
      expect(getColumnNames("automation_credentials")).toContain("management_project_id");
      expect(getColumnNames("sprint_linked_issues")).toEqual(expect.arrayContaining([
        "issue_body_markdown",
        "issue_conversation_markdown",
        "include_conversation",
        "issue_author",
        "issue_created_at",
        "issue_updated_at",
        "metadata_json",
      ]));
      expect(getColumnNames("provider_invocations")).toEqual(expect.arrayContaining([
        "tool_call_count",
        "execution_mode",
        "jules_tokens",
        "invocation_source",
        "token_accounting_version",
      ]));
      expect(getColumnNames("task_run_events")).toContain("project_id");
      expect(getIndexCount("idx_task_run_events_project_created")).toBe(1);
      expect(getIndexCount("idx_task_self_reflection_ratings_task_latest")).toBe(1);
      expect(getIndexCount("idx_guardrail_ledger_task_purpose")).toBe(1);
      expect(getIndexCount("idx_memory_claims_project_fingerprint_active")).toBe(1);
      expect(getIndexCount("idx_node_flows_project_updated")).toBe(1);
      expect(getColumnNames("sprints")).toEqual(expect.arrayContaining([
        "kind",
        "rollback_source_sprint_id",
        "rollback_mode",
        "rollback_instructions",
        "rollback_safety_reason",
      ]));
      expect(getIndexCount("idx_sprints_rollback_source")).toBe(1);
    } finally {
      storage.close();
    }
  });

  it("initializes startup schema idempotently without external runtime dependencies", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "db-schema-idempotency-"));
    const dbPath = path.join(dir, "app.db");

    vi.stubEnv("GIT_ASKPASS", path.join(dir, "missing-git-askpass"));
    vi.stubEnv("DOCKER_HOST", "tcp://127.0.0.1:1");
    vi.stubEnv("JULES_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");

    const first = new SqliteDatabaseAdapter(dbPath);
    try {
      first.exec(APP_DB_SCHEMA_TABLES);
      first.exec(APP_DB_SCHEMA_READ_INDEXES);
      runMigrations(first);
      first.prepare(`
        INSERT INTO projects (id, slug, name, base_dir, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        "schema-idempotency-project",
        "schema-idempotency-project",
        "Schema Idempotency Project",
        path.join(dir, "project"),
        "idle",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
      first.prepare(`
        INSERT INTO provider_invocations (
          id, project_id, session_id, provider, purpose, status, started_at, created_at, updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "schema-idempotency-provider-invocation",
        "schema-idempotency-project",
        "schema-idempotency-session",
        "codex",
        "task_coding",
        "running",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
      );
    } finally {
      first.close();
    }

    const second = new SqliteDatabaseAdapter(dbPath);
    try {
      const before = getSchemaSignature(second);
      second.exec(APP_DB_SCHEMA_TABLES);
      second.exec(APP_DB_SCHEMA_READ_INDEXES);
      runMigrations(second);
      const after = getSchemaSignature(second);

      expect(after).toEqual(before);
      expect(after.providerInvocationColumns).toEqual(expect.arrayContaining([
        "status",
        "provider",
        "model",
        "session_id",
        "native_session_id",
        "prompt_chars",
        "transcript_chars",
        "input_tokens",
        "cached_input_tokens",
        "output_tokens",
        "reasoning_output_tokens",
        "total_tokens",
        "tool_call_count",
        "jules_tokens",
        "usage_source",
        "invocation_source",
        "raw_usage_json",
        "started_at",
        "finished_at",
        "created_at",
        "updated_at",
      ]));

      const tableCounts = second.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).get() as { count: number };
      const distinctTableCounts = second.prepare(`
        SELECT COUNT(DISTINCT name) AS count
        FROM sqlite_master
        WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
      `).get() as { count: number };
      const indexCounts = second.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      `).get() as { count: number };
      const distinctIndexCounts = second.prepare(`
        SELECT COUNT(DISTINCT name) AS count
        FROM sqlite_master
        WHERE type = 'index' AND name NOT LIKE 'sqlite_%'
      `).get() as { count: number };
      const seededRows = second.prepare(`
        SELECT COUNT(*) AS count
        FROM provider_invocations
        WHERE id = ?
      `).get("schema-idempotency-provider-invocation") as { count: number };

      expect(tableCounts.count).toBe(distinctTableCounts.count);
      expect(indexCounts.count).toBe(distinctIndexCounts.count);
      expect(seededRows.count).toBe(1);
    } finally {
      second.close();
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
