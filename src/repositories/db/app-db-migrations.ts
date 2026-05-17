import { DatabaseAdapter } from "./database-adapter.js";

export function ensureColumn(db: DatabaseAdapter, tableName: string, columnName: string, columnDefinition: string): void {
  // Using direct sqlite PRAGMA for now, until we abstract schema reflections
  const rows = db.prepare(`PRAGMA table_info(${tableName})`).all() as Array<{ name?: string }>;
  if (rows.some((row) => row.name === columnName)) {
    return;
  }
  db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDefinition}`);
}

export function ensureIndex(db: DatabaseAdapter, indexName: string, tableName: string, columns: string): void {
  db.exec(`CREATE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns})`);
}

export function ensureUniqueIndex(db: DatabaseAdapter, indexName: string, tableName: string, columns: string): void {
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName} ON ${tableName} (${columns})`);
}

export function backfillEstimatedDockerCliUsage(db: DatabaseAdapter): void {
  db.prepare(`
    UPDATE provider_invocations
    SET
      input_tokens = CAST((prompt_chars + 3) / 4 AS INTEGER),
      cached_input_tokens = 0,
      output_tokens = CAST((transcript_chars + 3) / 4 AS INTEGER),
      reasoning_output_tokens = 0,
      total_tokens = CAST((prompt_chars + 3) / 4 AS INTEGER) + CAST((transcript_chars + 3) / 4 AS INTEGER),
      usage_source = 'estimated',
      raw_usage_json = COALESCE(raw_usage_json, ?),
      updated_at = STRFTIME('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE provider IN ('gemini', 'codex', 'claude-code', 'qwen-code')
      AND execution_mode = 'DOCKER'
      AND usage_source = 'unavailable'
      AND status IN ('completed', 'failed')
      AND total_tokens = 0
      AND (prompt_chars > 0 OR transcript_chars > 0)
  `).run(JSON.stringify({
    source: "migration:estimated-docker-cli-usage",
    heuristic: "ceil(chars/4)",
  }));
}

export function runMigrations(db: DatabaseAdapter): void {
  // We can group future schema changes here.
  // The current phase 1 approach calls schema definitions directly, but these ensure*
  // helpers allow progressive column additions safely.

  ensureColumn(db, "sprints", "showcase_pinned", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "sprints", "original_prompt", "TEXT");
  ensureColumn(db, "tasks", "executor_type", "TEXT NOT NULL DEFAULT 'auto'");

  db.exec(`
    CREATE TABLE IF NOT EXISTS sprint_linked_issues (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      sprint_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      host_domain TEXT NOT NULL,
      repository TEXT NOT NULL,
      issue_number INTEGER NOT NULL,
      issue_key TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      state TEXT NOT NULL DEFAULT 'open',
      labels_json TEXT NOT NULL DEFAULT '[]',
      assignees_json TEXT NOT NULL DEFAULT '[]',
      imported_at TEXT NOT NULL,
      closed_at TEXT,
      close_state TEXT NOT NULL DEFAULT 'open',
      close_error TEXT,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE
    )
  `);

  ensureColumn(db, "task_runs", "sprint_run_id", "TEXT");
  ensureColumn(db, "task_runs", "dispatch_id", "TEXT");

  ensureColumn(db, "task_run_events", "source_event_key", "TEXT");

  ensureColumn(db, "agent_presets", "source_path", "TEXT");
  ensureColumn(db, "agent_presets", "source_scope", "TEXT");
  ensureColumn(db, "agent_presets", "source_updated_at", "TEXT");
  ensureColumn(db, "agent_presets", "source_imported_at", "TEXT");
  ensureColumn(db, "agent_presets", "avatar_config_json", "TEXT");
  ensureColumn(db, "agent_presets", "memory_template_override_enabled", "INTEGER NOT NULL DEFAULT 0");
  ensureColumn(db, "agent_presets", "memory_template_markdown", "TEXT");

  ensureColumn(db, "connection_project_bindings", "last_attention_cursor", "TEXT");
  ensureColumn(db, "connection_project_bindings", "last_assignment_cursor", "TEXT");

  ensureColumn(db, "dashboard_realtime_events", "is_replayable", "INTEGER NOT NULL DEFAULT 1");
  ensureColumn(db, "conversation_threads", "runtime_state_json", "TEXT");
  ensureColumn(db, "conversation_messages", "metadata_json", "TEXT");
  ensureColumn(db, "execution_invocation_messages", "metadata_json", "TEXT");

  ensureColumn(db, "execution_invocations", "last_error_category", "TEXT");
  ensureColumn(db, "execution_invocations", "last_error_message", "TEXT");
  ensureColumn(db, "execution_invocations", "last_retry_after_iso", "TEXT");

  ensureUniqueIndex(db, "idx_tasks_sprint_key", "tasks", "sprint_id, task_key");
  ensureUniqueIndex(db, "idx_sprint_linked_issues_unique", "sprint_linked_issues", "sprint_id, provider, host_domain, repository, issue_number");
  ensureIndex(db, "idx_sprint_linked_issues_sprint", "sprint_linked_issues", "project_id, sprint_id, close_state");
  ensureIndex(db, "idx_sprint_runs_project_sprint", "sprint_runs", "project_id, sprint_id, created_at DESC");
  ensureIndex(db, "idx_tasks_project_sprint_sort", "tasks", "project_id, sprint_id, sort_order ASC, created_at ASC, task_key ASC");
  ensureIndex(db, "idx_task_runs_project_started", "task_runs", "project_id, started_at DESC");
  ensureIndex(db, "idx_task_runs_dispatch", "task_runs", "dispatch_id");
  ensureIndex(db, "idx_task_runs_task_session_id", "task_runs", "task_id, session_id");
  ensureIndex(db, "idx_task_runs_task_session_name", "task_runs", "task_id, session_name");
  ensureIndex(db, "idx_task_runs_task_finished", "task_runs", "task_id, finished_at");
  ensureIndex(db, "idx_task_runs_sprint_run_started", "task_runs", "sprint_run_id, started_at DESC");
  ensureColumn(db, "provider_invocations", "execution_mode", "TEXT");
  ensureIndex(db, "idx_provider_invocations_project_started", "provider_invocations", "project_id, started_at DESC");
  ensureIndex(db, "idx_provider_invocations_sprint_started", "provider_invocations", "sprint_id, started_at DESC");
  ensureIndex(db, "idx_provider_invocations_task_started", "provider_invocations", "task_id, started_at DESC");
  ensureIndex(db, "idx_provider_invocations_task_run", "provider_invocations", "task_run_id, started_at DESC");
  ensureIndex(db, "idx_provider_invocations_attention", "provider_invocations", "attention_item_id, started_at DESC");
  ensureIndex(db, "idx_provider_invocations_session", "provider_invocations", "session_id, started_at DESC");
  ensureIndex(db, "idx_qa_review_runs_task_started", "qa_review_runs", "task_id, started_at DESC");
  ensureIndex(db, "idx_qa_review_runs_sprint_started", "qa_review_runs", "sprint_id, started_at DESC");
  ensureIndex(db, "idx_qa_review_runs_run_status", "qa_review_runs", "status, started_at DESC");
  ensureIndex(db, "idx_task_dispatches_sprint_run", "task_dispatches", "sprint_run_id, status, queued_at ASC");
  ensureIndex(db, "idx_task_dispatches_project_status", "task_dispatches", "project_id, status, priority DESC, queued_at ASC");
  ensureIndex(db, "idx_task_dispatches_task", "task_dispatches", "task_id, created_at DESC");
  ensureIndex(db, "idx_execution_leases_scope", "execution_leases", "scope_type, scope_id");
  ensureIndex(db, "idx_task_run_events_task_run_created", "task_run_events", "task_run_id, created_at DESC");
  ensureUniqueIndex(db, "idx_task_run_events_source_event", "task_run_events", "task_run_id, source_event_key");
  ensureIndex(db, "idx_sprint_run_events_sprint_run_created", "sprint_run_events", "sprint_run_id, created_at DESC");
  ensureUniqueIndex(db, "idx_sprint_run_events_source_event", "sprint_run_events", "sprint_run_id, source_event_key");
  ensureIndex(db, "idx_execution_invocations_project_started", "execution_invocations", "project_id, started_at DESC");
  ensureIndex(db, "idx_execution_invocations_sprint_started", "execution_invocations", "sprint_id, started_at DESC");
  ensureIndex(db, "idx_execution_invocations_task_started", "execution_invocations", "task_id, started_at DESC");
  ensureIndex(db, "idx_execution_invocations_sprint_run_started", "execution_invocations", "sprint_run_id, started_at DESC");
  ensureIndex(db, "idx_execution_invocations_task_run_started", "execution_invocations", "task_run_id, started_at DESC");
  ensureIndex(db, "idx_execution_invocation_messages_invocation_created", "execution_invocation_messages", "invocation_id, created_at ASC");
  ensureIndex(db, "idx_dashboard_realtime_events_scope_sequence", "dashboard_realtime_events", "scope_type, scope_id, is_replayable, sequence DESC");
  ensureIndex(db, "idx_conversation_threads_project_updated", "conversation_threads", "project_id, updated_at DESC");
  ensureIndex(db, "idx_conversation_messages_thread_created", "conversation_messages", "thread_id, created_at ASC");
  ensureIndex(db, "idx_memories_project_scope", "memories", "project_id, scope, updated_at DESC");
  ensureIndex(db, "idx_memories_project_sprint", "memories", "project_id, sprint_id, created_at DESC");
  ensureIndex(db, "idx_memories_project_agent", "memories", "project_id, agent_preset_id, created_at DESC");
  ensureIndex(db, "idx_memories_scope_category", "memories", "scope, category, strength DESC");
  ensureIndex(db, "idx_memories_promoted_from", "memories", "promoted_from_id");
  ensureIndex(db, "idx_memories_embedding_model", "memories", "embedding_model, project_id");
  ensureIndex(db, "idx_agent_presets_project_updated", "agent_presets", "project_id, updated_at DESC");
  ensureIndex(db, "idx_agent_presets_project_name", "agent_presets", "project_id, name");
  ensureUniqueIndex(db, "idx_worker_endpoints_connection", "worker_endpoints", "connection_id");
  ensureIndex(db, "idx_worker_endpoints_type_status", "worker_endpoints", "endpoint_type, status, updated_at DESC");
  ensureIndex(db, "idx_connection_project_bindings_connection_active", "connection_project_bindings", "connection_id, is_active DESC, project_id ASC");
  ensureIndex(db, "idx_task_dispatches_connection_executor", "task_dispatches", "connection_id, executor_type");
  ensureIndex(db, "idx_project_worker_assignments_project_status", "project_worker_assignments", "project_id, status, assignment_role, last_affinity_at DESC");
  ensureIndex(db, "idx_project_worker_assignments_worker_status", "project_worker_assignments", "worker_endpoint_id, status, last_affinity_at DESC");
  ensureIndex(db, "idx_project_attention_items_project_status", "project_attention_items", "project_id, status, opened_at DESC");
  ensureIndex(db, "idx_project_attention_items_project_status_updated", "project_attention_items", "project_id, status, updated_at DESC");
  ensureIndex(db, "idx_project_attention_items_sprint_run_status", "project_attention_items", "sprint_run_id, status, opened_at DESC");
  ensureIndex(db, "idx_project_attention_items_sprint_run_status_updated", "project_attention_items", "sprint_run_id, status, updated_at DESC");
  ensureIndex(db, "idx_project_attention_items_dispatch_status", "project_attention_items", "dispatch_id, status, opened_at DESC");
  ensureIndex(db, "idx_sprint_preview_sessions_project_updated", "sprint_preview_sessions", "project_id, updated_at DESC");
  ensureIndex(db, "idx_sprint_preview_sessions_sprint", "sprint_preview_sessions", "sprint_id, updated_at DESC");

  backfillEstimatedDockerCliUsage(db);
}
