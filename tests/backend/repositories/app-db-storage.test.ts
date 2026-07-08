process.env.VITEST_IN_MEMORY_DB = "false";

import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as path from "path";
import { AppDbStorage, resolveAppDbPath } from "../../../src/repositories/app-db-storage.js";
import {
  createSqliteTempHome,
  expectSqliteSidecarsRemoved,
  getExistingSqliteSidecars,
  removeSqliteTempHome,
} from "./sqlite-cleanup-test-helper.js";

const tempDirs: string[] = [];
const openStorages: AppDbStorage[] = [];

function getIndexColumns(db: ReturnType<AppDbStorage["getDatabase"]>, indexName: string): string[] {
  return (db.prepare(`PRAGMA index_info('${indexName}')`).all() as Array<{ name: string }>)
    .map((row) => row.name);
}

async function createTempDbPath(): Promise<string> {
  const dir = await createSqliteTempHome("code-ux-app-db-");
  tempDirs.push(dir);
  return path.join(dir, "app.db");
}

afterEach(async () => {
  for (const storage of openStorages.splice(0).reverse()) {
    try {
      storage.close();
    } catch {
      // Already closed by the test.
    }
  }
  await Promise.all(tempDirs.splice(0).map((dir) => removeSqliteTempHome(dir)));
});

function trackStorage(storage: AppDbStorage): AppDbStorage {
  openStorages.push(storage);
  return storage;
}

function closeTrackedStorage(storage: AppDbStorage): void {
  storage.close();
  const index = openStorages.indexOf(storage);
  if (index >= 0) {
    openStorages.splice(index, 1);
  }
}

describe("AppDbStorage", () => {
  it("creates the phase 1 foundation tables", async () => {
    const dbPath = await createTempDbPath();
    const storage = trackStorage(new AppDbStorage(dbPath));

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
    expect(storage.hasTable("skill_storages")).toBe(true);
    expect(storage.hasTable("skills")).toBe(true);
    expect(storage.hasTable("skill_embeddings")).toBe(true);
    expect(storage.hasTable("agent_skill_storage_bindings")).toBe(true);

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
    expect(providerInvocationIndexes.some((idx) => idx.name === "idx_provider_invocations_session_owner")).toBe(true);
    expect(getIndexColumns(db, "idx_provider_invocations_sprint_started")).toEqual(["sprint_id", "started_at"]);
    expect(getIndexColumns(db, "idx_provider_invocations_sprint_run_started")).toEqual(["sprint_run_id", "started_at"]);
    expect(getIndexColumns(db, "idx_provider_invocations_session_owner")).toEqual(["session_id", "project_id", "sprint_id", "task_id"]);

    const taskRunIndexes = db.prepare("PRAGMA index_list('task_runs')").all() as Array<{ name: string }>;
    expect(taskRunIndexes.some((idx) => idx.name === "idx_task_runs_session_id_owner")).toBe(true);
    expect(taskRunIndexes.some((idx) => idx.name === "idx_task_runs_session_name_owner")).toBe(true);
    expect(taskRunIndexes.some((idx) => idx.name === "idx_task_runs_pr_url_owner")).toBe(true);
    expect(getIndexColumns(db, "idx_task_runs_session_id_owner")).toEqual(["session_id", "project_id", "sprint_id", "task_id"]);
    expect(getIndexColumns(db, "idx_task_runs_session_name_owner")).toEqual(["session_name", "project_id", "sprint_id", "task_id"]);
    expect(getIndexColumns(db, "idx_task_runs_pr_url_owner")).toEqual(["pr_url", "project_id", "sprint_id", "task_id"]);

    const skillStorageIndexes = db.prepare("PRAGMA index_list('skill_storages')").all() as Array<{ name: string }>;
    expect(skillStorageIndexes.some((idx) => idx.name === "idx_skill_storages_project")).toBe(true);
    expect(getIndexColumns(db, "idx_agent_skill_storage_bindings_agent")).toEqual(["agent_preset_id"]);
    expect(getIndexColumns(db, "idx_agent_skill_storage_bindings_storage")).toEqual(["project_id", "storage_id"]);

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
    const storage = trackStorage(new AppDbStorage(dbPath));

    storage.close();

    expect(() => storage.getDatabase().prepare("SELECT 1").get()).toThrow();
  });

  it("closes file-backed cycles before removing sqlite sidecars and temp home", async () => {
    const homeDir = await createSqliteTempHome("code-ux-app-db-home-");
    tempDirs.push(homeDir);
    const dbPath = path.join(homeDir, ".code-ux", "app.db");

    for (let cycle = 0; cycle < 3; cycle += 1) {
      const storage = trackStorage(new AppDbStorage(dbPath));
      storage.getDatabase().exec(`
        CREATE TABLE IF NOT EXISTS cleanup_probe (
          id INTEGER PRIMARY KEY,
          cycle INTEGER NOT NULL
        );
        INSERT INTO cleanup_probe (cycle) VALUES (${cycle});
      `);

      expect(await getExistingSqliteSidecars(dbPath)).toEqual(["app.db-wal", "app.db-shm"]);

      closeTrackedStorage(storage);
      await expectSqliteSidecarsRemoved(dbPath);
    }

    await removeSqliteTempHome(homeDir);
    const tempDirIndex = tempDirs.indexOf(homeDir);
    if (tempDirIndex >= 0) {
      tempDirs.splice(tempDirIndex, 1);
    }

    await expect(fs.access(homeDir)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("backfills estimated Docker CLI usage from persisted character counts", async () => {
    const dbPath = await createTempDbPath();
    const storage = trackStorage(new AppDbStorage(dbPath));
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
    trackStorage(new AppDbStorage(dbPath));

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
    const storage = trackStorage(new AppDbStorage(dbPath));
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

    trackStorage(new AppDbStorage(dbPath));
    trackStorage(new AppDbStorage(dbPath));

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

  it("preserves legacy guardrail ledger rows when startup migrations rebuild the table", async () => {
    const dbPath = await createTempDbPath();
    const storage = trackStorage(new AppDbStorage(dbPath));
    const db = storage.getDatabase();
    const now = new Date().toISOString();

    db.prepare(`
      INSERT INTO projects (id, slug, name, base_dir, repo_url, source_id, default_branch, feature_branch_prefix, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("project-guardrail", "project-guardrail", "Project Guardrail", "/tmp/project-guardrail", null, null, "main", "feature/", "idle", now, now);
    db.prepare(`
      INSERT INTO sprints (id, project_id, slug, name, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("sprint-guardrail", "project-guardrail", "sprint-guardrail", "Sprint Guardrail", "idle", now, now);
    db.prepare(`
      INSERT INTO tasks (
        id, project_id, sprint_id, task_key, title, prompt_markdown, status, priority,
        sort_order, is_independent, is_merged, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "task-guardrail",
      "project-guardrail",
      "sprint-guardrail",
      "TASK-1",
      "Task Guardrail",
      "Prompt",
      "pending",
      "medium",
      0,
      0,
      0,
      now,
      now,
    );

    db.exec("DROP TABLE guardrail_ledger");
    db.exec(`
      CREATE TABLE guardrail_ledger (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      )
    `);
    db.prepare(`
      INSERT INTO guardrail_ledger (id, project_id, task_id, purpose, count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("guardrail-1", "project-guardrail", "task-guardrail", "task_coding", 4, now, now);

    closeTrackedStorage(storage);

    const migrated = trackStorage(new AppDbStorage(dbPath));
    const migratedDb = migrated.getDatabase();
    const fks = migratedDb.prepare("PRAGMA foreign_key_list(guardrail_ledger)").all() as Array<{ table?: string }>;
    const row = migratedDb.prepare(`
      SELECT task_id, purpose, count
      FROM guardrail_ledger
      WHERE id = ?
    `).get("guardrail-1") as { task_id: string; purpose: string; count: number };

    expect(fks.some((fk) => fk.table === "tasks")).toBe(false);
    expect(fks.some((fk) => fk.table === "projects")).toBe(true);
    expect(row).toEqual({
      task_id: "task-guardrail",
      purpose: "task_coding",
      count: 4,
    });
    expect(() => migratedDb.prepare(`
      INSERT INTO guardrail_ledger (id, project_id, task_id, purpose, count, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run("guardrail-synthetic", "project-guardrail", "main-merge-ci-fix:sprint-run-1", "ci_fix", 1, now, now)).not.toThrow();
  });

  it("resets all application tables while preserving the schema", async () => {
    const dbPath = await createTempDbPath();
    const storage = trackStorage(new AppDbStorage(dbPath));
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
