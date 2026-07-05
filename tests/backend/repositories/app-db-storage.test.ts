process.env.VITEST_IN_MEMORY_DB = "false";

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { AppDbStorage, resolveAppDbPath } from "../../../src/repositories/app-db-storage.js";

const tempDirs: string[] = [];

interface TableColumnInfo {
  name: string;
  type: string;
  notnull: number;
  dflt_value: string | number | null;
}

function getIndexColumns(db: ReturnType<AppDbStorage["getDatabase"]>, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info('${indexName}')`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function getIndexNames(db: ReturnType<AppDbStorage["getDatabase"]>, tableName: string): string[] {
  return (db.prepare(`PRAGMA index_list('${tableName}')`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

function getTableColumns(db: ReturnType<AppDbStorage["getDatabase"]>, tableName: string): Map<string, TableColumnInfo> {
  const rows = db.prepare(`PRAGMA table_info('${tableName}')`).all() as TableColumnInfo[];
  return new Map(rows.map((row) => [row.name, row]));
}

async function createTempDbPath(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-app-db-"));
  tempDirs.push(dir);
  return path.join(dir, "app.db");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("AppDbStorage", () => {
  it("runs migrations repeatedly and preserves execution telemetry schema contracts", async () => {
    const dbPath = await createTempDbPath();
    new AppDbStorage(dbPath);
    const storage = new AppDbStorage(dbPath);
    const db = storage.getDatabase();

    for (const tableName of [
      "provider_invocations",
      "execution_invocations",
      "execution_invocation_messages",
      "sprint_runs",
      "task_dispatches",
      "task_runs",
      "task_run_events",
      "sprint_run_events",
      "dashboard_realtime_events",
    ]) {
      expect(storage.hasTable(tableName)).toBe(true);
    }

    const providerColumns = getTableColumns(db, "provider_invocations");
    expect(providerColumns.get("execution_mode")?.type).toBe("TEXT");
    expect(providerColumns.get("token_accounting_version")?.dflt_value).toBe("2");
    expect(providerColumns.get("tool_call_count")?.dflt_value).toBe("0");
    expect(providerColumns.get("jules_tokens")?.dflt_value).toBe("0");
    expect(providerColumns.get("invocation_source")?.dflt_value).toBe("'internal'");

    const executionColumns = getTableColumns(db, "execution_invocations");
    expect(executionColumns.get("last_error_category")?.type).toBe("TEXT");
    expect(executionColumns.get("last_error_message")?.type).toBe("TEXT");
    expect(executionColumns.get("last_retry_after_iso")?.type).toBe("TEXT");
    expect(executionColumns.get("preserved_at")?.type).toBe("TEXT");
    expect(executionColumns.get("invocation_source")?.dflt_value).toBe("'internal'");
    expect(executionColumns.get("agent_preset_id")?.type).toBe("TEXT");

    const messageColumns = getTableColumns(db, "execution_invocation_messages");
    expect(messageColumns.get("metadata_json")?.type).toBe("TEXT");

    const eventColumns = getTableColumns(db, "task_run_events");
    expect(eventColumns.get("project_id")?.type).toBe("TEXT");
    expect(eventColumns.get("source_event_key")?.type).toBe("TEXT");

    expect(getIndexNames(db, "provider_invocations")).toEqual(expect.arrayContaining([
      "idx_provider_invocations_project_started",
      "idx_provider_invocations_project_sprint_started",
      "idx_provider_invocations_project_sprint_run_started",
      "idx_provider_invocations_sprint_started",
      "idx_provider_invocations_sprint_run_started",
      "idx_provider_invocations_task_started",
      "idx_provider_invocations_task_run",
      "idx_provider_invocations_attention",
      "idx_provider_invocations_session",
      "idx_provider_invocations_status_provider_started",
    ]));
    expect(getIndexColumns(db, "idx_provider_invocations_status_provider_started")).toEqual(["status", "provider", "started_at"]);

    expect(getIndexNames(db, "execution_invocations")).toEqual(expect.arrayContaining([
      "idx_execution_invocations_project_started",
      "idx_execution_invocations_sprint_started",
      "idx_execution_invocations_task_started",
      "idx_execution_invocations_sprint_run_started",
      "idx_execution_invocations_project_sprint_started",
      "idx_execution_invocations_project_sprint_run_started",
      "idx_execution_invocations_task_run_started",
      "idx_execution_invocations_status_started",
      "idx_execution_invocations_provider_invocation",
    ]));
    expect(getIndexNames(db, "execution_invocation_messages")).toContain("idx_execution_invocation_messages_invocation_created");

    expect(getIndexNames(db, "task_run_events")).toEqual(expect.arrayContaining([
      "idx_task_run_events_task_run_created",
      "idx_task_run_events_task_run_created_id",
      "idx_task_run_events_source_event",
      "idx_task_run_events_project_created",
      "idx_task_run_events_provider_activity_run_created",
      "idx_task_run_events_provider_activity_project_created",
    ]));
    expect(getIndexNames(db, "sprint_run_events")).toEqual(expect.arrayContaining([
      "idx_sprint_run_events_sprint_run_created",
      "idx_sprint_run_events_sprint_run_created_id",
      "idx_sprint_run_events_source_event",
    ]));
    expect(getIndexNames(db, "sprint_runs")).toEqual(expect.arrayContaining([
      "idx_sprint_runs_project_sprint",
      "idx_sprint_runs_project_status_recency",
      "idx_sprint_runs_project_lookup",
    ]));
    expect(getIndexNames(db, "task_dispatches")).toEqual(expect.arrayContaining([
      "idx_task_dispatches_sprint_run",
      "idx_task_dispatches_project_status",
      "idx_task_dispatches_project_sprint_run_recency",
    ]));
    expect(getIndexNames(db, "dashboard_realtime_events")).toContain("idx_dashboard_realtime_events_scope_sequence");
  });

  it("creates the phase 1 foundation tables", async () => {
    const dbPath = await createTempDbPath();
    const storage = new AppDbStorage(dbPath);

    expect(storage.getPath()).toBe(dbPath);
    expect(storage.hasTable("schema_migrations")).toBe(true);
    expect(storage.hasTable("app_settings")).toBe(true);
    expect(storage.hasTable("projects")).toBe(true);
    expect(storage.hasTable("project_sources")).toBe(true);
    expect(storage.hasTable("sprints")).toBe(true);
    expect(storage.hasTable("tasks")).toBe(true);
    expect(storage.hasTable("task_dependencies")).toBe(true);
    expect(storage.hasTable("mcp_connections")).toBe(true);
    expect(storage.hasTable("worker_endpoints")).toBe(true);
    expect(storage.hasTable("project_worker_assignments")).toBe(true);
    expect(storage.hasTable("project_attention_items")).toBe(true);
    expect(storage.hasTable("connection_project_bindings")).toBe(true);
    expect(storage.hasTable("sprint_runs")).toBe(true);
    expect(storage.hasTable("task_dispatches")).toBe(true);
    expect(storage.hasTable("task_runs")).toBe(true);
    expect(storage.hasTable("task_run_events")).toBe(true);
    expect(storage.hasTable("execution_leases")).toBe(true);
    expect(storage.hasTable("dashboard_realtime_events")).toBe(true);
    expect(storage.hasTable("conversation_threads")).toBe(true);
    expect(storage.hasTable("conversation_messages")).toBe(true);
    expect(storage.hasTable("agent_presets")).toBe(true);

    const db = storage.getDatabase();
    const taskDispatchesIndexes = db.prepare("PRAGMA index_list('task_dispatches')").all() as Array<{ name: string }>;
    expect(taskDispatchesIndexes.some((idx) => idx.name === "idx_task_dispatches_connection_executor")).toBe(true);

    const conversationThreadsIndexes = db.prepare("PRAGMA index_list('conversation_threads')").all() as Array<{ name: string }>;
    expect(conversationThreadsIndexes.some((idx) => idx.name === "idx_conversation_threads_project_updated")).toBe(true);

    const conversationMessagesIndexes = db.prepare("PRAGMA index_list('conversation_messages')").all() as Array<{ name: string }>;
    expect(conversationMessagesIndexes.some((idx) => idx.name === "idx_conversation_messages_thread_created")).toBe(true);

    const connectionBindingsIndexes = db.prepare("PRAGMA index_list('connection_project_bindings')").all() as Array<{ name: string }>;
    expect(connectionBindingsIndexes.some((idx) => idx.name === "idx_connection_project_bindings_connection_active")).toBe(true);

    const attentionItemsIndexes = db.prepare("PRAGMA index_list('project_attention_items')").all() as Array<{ name: string }>;
    expect(attentionItemsIndexes.some((idx) => idx.name === "idx_project_attention_items_project_status_updated")).toBe(true);
    expect(attentionItemsIndexes.some((idx) => idx.name === "idx_project_attention_items_sprint_run_status_updated")).toBe(true);
    expect(attentionItemsIndexes.some((idx) => idx.name === "idx_project_attention_items_project_status_updated_opened")).toBe(true);
    expect(attentionItemsIndexes.some((idx) => idx.name === "idx_project_attention_items_sprint_run_status_updated_opened")).toBe(true);
    expect(getIndexColumns(db, "idx_project_attention_items_project_status_updated_opened")).toEqual(["project_id", "status", "updated_at", "opened_at", "id"]);
    expect(getIndexColumns(db, "idx_project_attention_items_sprint_run_status_updated_opened")).toEqual(["sprint_run_id", "status", "updated_at", "opened_at", "id"]);

    const executionInvocationIndexes = db.prepare("PRAGMA index_list('execution_invocations')").all() as Array<{ name: string }>;
    expect(executionInvocationIndexes.some((idx) => idx.name === "idx_execution_invocations_status_started")).toBe(true);
    expect(getIndexColumns(db, "idx_execution_invocations_status_started")).toEqual(["status", "started_at"]);

    const providerInvocationIndexes = db.prepare("PRAGMA index_list('provider_invocations')").all() as Array<{ name: string }>;
    expect(providerInvocationIndexes.some((idx) => idx.name === "idx_provider_invocations_sprint_started")).toBe(true);
    expect(providerInvocationIndexes.some((idx) => idx.name === "idx_provider_invocations_sprint_run_started")).toBe(true);
    expect(providerInvocationIndexes.some((idx) => idx.name === "idx_provider_invocations_status_provider_started")).toBe(true);
    expect(getIndexColumns(db, "idx_provider_invocations_sprint_started")).toEqual(["sprint_id", "started_at"]);
    expect(getIndexColumns(db, "idx_provider_invocations_sprint_run_started")).toEqual(["sprint_run_id", "started_at"]);
    expect(getIndexColumns(db, "idx_provider_invocations_status_provider_started")).toEqual(["status", "provider", "started_at"]);

    const taskRunEventIndexes = db.prepare("PRAGMA index_list('task_run_events')").all() as Array<{ name: string }>;
    expect(taskRunEventIndexes.some((idx) => idx.name === "idx_task_run_events_project_created")).toBe(true);
    expect(taskRunEventIndexes.some((idx) => idx.name === "idx_task_run_events_task_run_created_id")).toBe(true);
    expect(getIndexColumns(db, "idx_task_run_events_project_created")).toEqual(["project_id", "created_at", "id"]);
    expect(getIndexColumns(db, "idx_task_run_events_task_run_created_id")).toEqual(["task_run_id", "created_at", "id"]);
  });

  it("uses the explicit dbPath when provided", async () => {
    const dbPath = await createTempDbPath();

    expect(resolveAppDbPath(dbPath)).toBe(dbPath);
  });

  it("closes the underlying sqlite connection", async () => {
    const dbPath = await createTempDbPath();
    const storage = new AppDbStorage(dbPath);

    storage.close();

    expect(() => storage.getDatabase().prepare("SELECT 1").get()).toThrow();
  });

  it("backfills estimated Docker CLI usage from persisted character counts", async () => {
    const dbPath = await createTempDbPath();
    const storage = new AppDbStorage(dbPath);
    const db = storage.getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, slug, name, base_dir, repo_url, source_id, default_branch, feature_branch_prefix, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("project-usage", "project-usage", "Project Usage", "/tmp/project-usage", null, null, "main", "feature/", "idle", now, now);

    db.prepare(`
      INSERT INTO provider_invocations (
        id, project_id, session_id, provider, purpose, status, model, execution_mode, started_at,
        prompt_chars, transcript_chars, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens,
        total_tokens, usage_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "usage-1",
      "project-usage",
      "session-1",
      "codex",
      "task_coding",
      "completed",
      "default",
      "DOCKER",
      now,
      9,
      5,
      0,
      0,
      0,
      0,
      0,
      "unavailable",
      now,
      now,
    );

    // Re-opening the storage runs migrations against existing data.
    new AppDbStorage(dbPath);

    const row = db.prepare(`
      SELECT input_tokens, output_tokens, total_tokens, usage_source, raw_usage_json
      FROM provider_invocations
      WHERE id = ?
    `).get("usage-1") as {
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      usage_source: string;
      raw_usage_json: string;
    };

    expect(row).toMatchObject({
      input_tokens: 3,
      output_tokens: 2,
      total_tokens: 5,
      usage_source: "estimated",
    });
    expect(JSON.parse(row.raw_usage_json)).toMatchObject({
      source: "migration:estimated-docker-cli-usage",
    });
  });

  it("normalizes legacy cached-token accounting rows once", async () => {
    const dbPath = await createTempDbPath();
    const storage = new AppDbStorage(dbPath);
    const db = storage.getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, slug, name, base_dir, repo_url, source_id, default_branch, feature_branch_prefix, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("project-token-v2", "project-token-v2", "Project Token V2", "/tmp/project-token-v2", null, null, "main", "feature/", "idle", now, now);

    db.prepare(`
      INSERT INTO provider_invocations (
        id, project_id, session_id, provider, purpose, status, model, execution_mode, started_at,
        input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
        token_accounting_version, usage_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "usage-token-v2-codex",
      "project-token-v2",
      "session-1",
      "codex",
      "task_coding",
      "completed",
      "default",
      "DOCKER",
      now,
      1000,
      800,
      50,
      0,
      1050,
      1,
      "reported",
      now,
      now,
    );

    db.prepare(`
      INSERT INTO provider_invocations (
        id, project_id, session_id, provider, purpose, status, model, execution_mode, started_at,
        input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens, total_tokens,
        token_accounting_version, usage_source, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "usage-token-v2-claude",
      "project-token-v2",
      "session-2",
      "claude-code",
      "task_coding",
      "completed",
      "default",
      "DOCKER",
      now,
      100,
      40,
      20,
      0,
      120,
      1,
      "reported",
      now,
      now,
    );

    new AppDbStorage(dbPath);
    new AppDbStorage(dbPath);

    const rows = db.prepare(`
      SELECT id, input_tokens, cached_input_tokens, output_tokens, total_tokens, token_accounting_version
      FROM provider_invocations
      WHERE project_id = ?
      ORDER BY id ASC
    `).all("project-token-v2") as Array<{
      id: string;
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      token_accounting_version: number;
    }>;

    expect(rows).toEqual([
      {
        id: "usage-token-v2-claude",
        input_tokens: 100,
        cached_input_tokens: 40,
        output_tokens: 20,
        total_tokens: 160,
        token_accounting_version: 2,
      },
      {
        id: "usage-token-v2-codex",
        input_tokens: 200,
        cached_input_tokens: 800,
        output_tokens: 50,
        total_tokens: 1050,
        token_accounting_version: 2,
      },
    ]);
  });

  it("resets all application tables while preserving the schema", async () => {
    const dbPath = await createTempDbPath();
    const storage = new AppDbStorage(dbPath);
    const db = storage.getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, slug, name, base_dir, repo_url, source_id, default_branch, feature_branch_prefix, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("project-1", "project-1", "Project 1", "/tmp/project-1", null, null, "main", "feature/", "idle", now, now);
    db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
    `).run("selected_project", JSON.stringify({ projectId: "project-1" }), now);

    storage.resetAllData();

    const projectCount = db.prepare("SELECT COUNT(*) AS count FROM projects").get() as { count: number };
    const appSettingsCount = db.prepare("SELECT COUNT(*) AS count FROM app_settings").get() as { count: number };

    expect(projectCount.count).toBe(0);
    expect(appSettingsCount.count).toBe(0);
    expect(storage.hasTable("projects")).toBe(true);
    expect(storage.hasTable("app_settings")).toBe(true);
  });
});
