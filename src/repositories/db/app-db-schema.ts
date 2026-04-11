export const APP_DB_SCHEMA_TABLES = `
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
        original_prompt TEXT,
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

CREATE TABLE IF NOT EXISTS provider_invocations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT,
        task_id TEXT,
        sprint_run_id TEXT,
        dispatch_id TEXT,
        task_run_id TEXT,
        attention_item_id TEXT,
        session_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        purpose TEXT NOT NULL,
        status TEXT NOT NULL,
        model TEXT,
        execution_mode TEXT,
        native_session_id TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        prompt_chars INTEGER NOT NULL DEFAULT 0,
        transcript_chars INTEGER NOT NULL DEFAULT 0,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        cached_input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        reasoning_output_tokens INTEGER NOT NULL DEFAULT 0,
        total_tokens INTEGER NOT NULL DEFAULT 0,
        usage_source TEXT NOT NULL DEFAULT 'unavailable',
        raw_usage_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_run_id) REFERENCES sprint_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (dispatch_id) REFERENCES task_dispatches(id) ON DELETE CASCADE,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (attention_item_id) REFERENCES project_attention_items(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS qa_review_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        sprint_run_id TEXT,
        task_id TEXT,
        task_run_id TEXT,
        trigger_type TEXT NOT NULL,
        status TEXT NOT NULL,
        outcome TEXT,
        run_index INTEGER NOT NULL DEFAULT 1,
        agent_preset_id TEXT,
        agent_name TEXT,
        target_task_key TEXT,
        target_session_id TEXT,
        target_provider TEXT,
        summary_markdown TEXT,
        fix_instructions TEXT,
        payload_json TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_run_id) REFERENCES sprint_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE SET NULL
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
        runtime_state_json TEXT,
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
        metadata_json TEXT,
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
        avatar_config_json TEXT,
        memory_template_override_enabled INTEGER NOT NULL DEFAULT 0,
        memory_template_markdown TEXT,
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

CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        scope TEXT NOT NULL,
        sprint_id TEXT,
        agent_preset_id TEXT,
        content TEXT NOT NULL,
        category TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 0.5,
        source_json TEXT NOT NULL DEFAULT '{}',
        embedding_model TEXT,
        embedding_dimension INTEGER,
        embedding_blob BLOB,
        promoted_from_id TEXT,
        promotion_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE SET NULL,
        FOREIGN KEY (promoted_from_id) REFERENCES memories(id) ON DELETE SET NULL
      );

CREATE TABLE IF NOT EXISTS embedding_models (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'not_downloaded',
        download_progress REAL NOT NULL DEFAULT 0,
        local_path TEXT,
        error_message TEXT,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS execution_invocations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT,
        task_id TEXT,
        sprint_run_id TEXT,
        dispatch_id TEXT,
        task_run_id TEXT,
        attention_item_id TEXT,
        provider_invocation_id TEXT,
        type TEXT NOT NULL,
        status TEXT NOT NULL,
        provider TEXT,
        model TEXT,
        system_prompt TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        error_message TEXT,
        last_error_category TEXT,
        last_error_message TEXT,
        last_retry_after_iso TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_run_id) REFERENCES sprint_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (dispatch_id) REFERENCES task_dispatches(id) ON DELETE CASCADE,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (attention_item_id) REFERENCES project_attention_items(id) ON DELETE CASCADE,
        FOREIGN KEY (provider_invocation_id) REFERENCES provider_invocations(id) ON DELETE SET NULL
      );

CREATE TABLE IF NOT EXISTS execution_invocation_messages (
        id TEXT PRIMARY KEY,
        invocation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content_markdown TEXT NOT NULL,
        tool_calls_json TEXT,
        metadata_json TEXT,
        created_at TEXT NOT NULL,
        FOREIGN KEY (invocation_id) REFERENCES execution_invocations(id) ON DELETE CASCADE
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
        is_replayable INTEGER NOT NULL DEFAULT 1,
        payload_json TEXT,
        created_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS sprint_preview_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        status TEXT NOT NULL,
        host_port INTEGER,
        container_app_port INTEGER NOT NULL,
        container_id TEXT,
        container_name TEXT,
        worktree_path TEXT,
        feature_branch TEXT,
        startup_script_path TEXT NOT NULL,
        startup_mode TEXT NOT NULL,
        install_command TEXT,
        build_command TEXT,
        run_command TEXT,
        last_completed_task_count INTEGER NOT NULL DEFAULT 0,
        last_seen_sprint_status TEXT,
        last_known_path TEXT,
        health_status TEXT NOT NULL DEFAULT 'unknown',
        last_error TEXT,
        last_build_at TEXT,
        last_started_at TEXT,
        last_stopped_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        UNIQUE (project_id, sprint_id)
      );
`;
