export const APP_DB_SCHEMA_TABLES = `
CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS maintenance_migration_state (
        key TEXT PRIMARY KEY,
        cursor_rowid INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
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
        initialization_mode TEXT NOT NULL DEFAULT 'existing',
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
        is_generated_name INTEGER NOT NULL DEFAULT 0,
        original_prompt TEXT,
        goal TEXT,
        status TEXT NOT NULL DEFAULT 'idle',
        showcase_pinned INTEGER NOT NULL DEFAULT 0,
        start_date TEXT,
        end_date TEXT,
        feature_branch TEXT,
        base_commit_sha TEXT,
        kind TEXT NOT NULL DEFAULT 'standard',
        rollback_source_sprint_id TEXT,
        rollback_mode TEXT,
        rollback_instructions TEXT,
        rollback_safety_reason TEXT,
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
        agent_preset_id TEXT,
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_independent INTEGER NOT NULL DEFAULT 0,
        is_merged INTEGER NOT NULL DEFAULT 0,
        merge_indicator TEXT,
        source_type TEXT,
        source_path TEXT,
        model TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE SET NULL
      );

CREATE TABLE IF NOT EXISTS sprint_linked_issues (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        provider TEXT NOT NULL,
        host_domain TEXT NOT NULL,
        project_key TEXT,
        repository TEXT NOT NULL,
        issue_number INTEGER,
        external_id TEXT,
        source_kind TEXT,
        issue_key TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT 'open',
        labels_json TEXT NOT NULL DEFAULT '[]',
        assignees_json TEXT NOT NULL DEFAULT '[]',
        issue_body_markdown TEXT,
        issue_conversation_markdown TEXT,
        include_conversation INTEGER,
        issue_author TEXT,
        issue_created_at TEXT,
        issue_updated_at TEXT,
        metadata_json TEXT,
        imported_at TEXT NOT NULL,
        closed_at TEXT,
        close_state TEXT NOT NULL DEFAULT 'open',
        close_error TEXT,
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

CREATE TABLE IF NOT EXISTS chat_provider_connections (
        id TEXT PRIMARY KEY,
        provider_kind TEXT NOT NULL,
        display_name TEXT NOT NULL,
        bridge_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        setup_json TEXT NOT NULL DEFAULT '{}',
        secret_json TEXT,
        verification_status TEXT NOT NULL DEFAULT 'unverified',
        verification_details_json TEXT,
        verified_at TEXT,
        secret_version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS chat_provider_connection_secrets (
        provider_connection_id TEXT PRIMARY KEY,
        ciphertext BLOB NOT NULL,
        nonce BLOB NOT NULL,
        auth_tag BLOB NOT NULL,
        wrapped_data_key BLOB NOT NULL,
        wrap_nonce BLOB NOT NULL,
        wrap_auth_tag BLOB NOT NULL,
        key_id TEXT NOT NULL,
        key_version INTEGER NOT NULL,
        secret_keys_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_connection_id) REFERENCES chat_provider_connections(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS chat_provider_channel_bindings (
        id TEXT PRIMARY KEY,
        provider_connection_id TEXT NOT NULL,
        external_channel_id TEXT NOT NULL,
        external_channel_name TEXT NOT NULL,
        external_channel_metadata_json TEXT,
        project_id TEXT NOT NULL,
        agent_preset_id TEXT,
        routing_hints_json TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        inbound_enabled INTEGER NOT NULL DEFAULT 1,
        outbound_enabled INTEGER NOT NULL DEFAULT 1,
        suppress_rich_widgets INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_connection_id) REFERENCES chat_provider_connections(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE SET NULL,
        UNIQUE (provider_connection_id, external_channel_id, project_id)
      );

CREATE TABLE IF NOT EXISTS chat_provider_message_deliveries (
        id TEXT PRIMARY KEY,
        provider_connection_id TEXT NOT NULL,
        channel_binding_id TEXT,
        external_channel_id TEXT NOT NULL,
        external_message_id TEXT,
        direction TEXT NOT NULL,
        status TEXT NOT NULL,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        conversation_thread_id TEXT,
        conversation_message_id TEXT,
        payload_json TEXT,
        next_attempt_at TEXT,
        lease_owner TEXT,
        lease_expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_connection_id) REFERENCES chat_provider_connections(id) ON DELETE CASCADE,
        FOREIGN KEY (channel_binding_id) REFERENCES chat_provider_channel_bindings(id) ON DELETE SET NULL,
        FOREIGN KEY (conversation_thread_id) REFERENCES conversation_threads(id) ON DELETE SET NULL,
        FOREIGN KEY (conversation_message_id) REFERENCES conversation_messages(id) ON DELETE SET NULL
      );

CREATE TABLE IF NOT EXISTS chat_provider_ingress_replay_receipts (
        id TEXT PRIMARY KEY,
        provider_connection_id TEXT NOT NULL,
        receipt_key TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (provider_connection_id) REFERENCES chat_provider_connections(id) ON DELETE CASCADE,
        UNIQUE (provider_connection_id, receipt_key)
      );

CREATE TABLE IF NOT EXISTS chat_provider_sessions (
        id TEXT PRIMARY KEY,
        provider_connection_id TEXT NOT NULL,
        channel_binding_id TEXT,
        external_channel_id TEXT NOT NULL,
        session_key TEXT NOT NULL,
        state_json TEXT NOT NULL DEFAULT '{}',
        version INTEGER NOT NULL DEFAULT 1,
        expires_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (provider_connection_id) REFERENCES chat_provider_connections(id) ON DELETE CASCADE,
        FOREIGN KEY (channel_binding_id) REFERENCES chat_provider_channel_bindings(id) ON DELETE CASCADE,
        UNIQUE (provider_connection_id, session_key)
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

CREATE TABLE IF NOT EXISTS task_self_reflection_ratings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        source_task_run_id TEXT NOT NULL UNIQUE,
        overall_rating REAL NOT NULL CHECK (overall_rating >= 0 AND overall_rating <= 5),
        sections_json TEXT NOT NULL DEFAULT '[]',
        captured_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (source_task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS task_run_events (
        id TEXT PRIMARY KEY,
        task_run_id TEXT NOT NULL,
        project_id TEXT,
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
        token_accounting_version INTEGER NOT NULL DEFAULT 2,
        tool_call_count INTEGER NOT NULL DEFAULT 0,
        jules_tokens INTEGER NOT NULL DEFAULT 0,
        usage_source TEXT NOT NULL DEFAULT 'unavailable',
        invocation_source TEXT NOT NULL DEFAULT 'internal',
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

CREATE TABLE IF NOT EXISTS conversation_drafts (
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        context_key TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (user_id, project_id, context_key),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS conversation_message_history (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        body_markdown TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(user_id, project_id, body_markdown),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS agent_presets (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        instruction_markdown TEXT NOT NULL DEFAULT '',
        labels_json TEXT,
        source_path TEXT,
        source_scope TEXT,
        source_updated_at TEXT,
        source_imported_at TEXT,
        avatar_config_json TEXT,
        provider_config_id TEXT,
        model TEXT,
        container_run_as_root INTEGER,
        memory_template_override_enabled INTEGER NOT NULL DEFAULT 0,
        memory_template_markdown TEXT,
        persistent_skill_storage_enabled INTEGER NOT NULL DEFAULT 0,
        mcp_access_json TEXT,
        memory_config_json TEXT,
        base_instruction_state_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS skill_storages (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        storage_kind TEXT NOT NULL DEFAULT 'project',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (project_id, name)
      );

CREATE TABLE IF NOT EXISTS skills (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        storage_id TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        content_markdown TEXT NOT NULL DEFAULT '',
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_ref TEXT,
        content_hash TEXT NOT NULL,
        tags_json TEXT NOT NULL DEFAULT '[]',
        applies_to_json TEXT NOT NULL DEFAULT '[]',
        version TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (storage_id) REFERENCES skill_storages(id) ON DELETE CASCADE,
        UNIQUE (storage_id, name)
      );

CREATE TABLE IF NOT EXISTS skill_embeddings (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        storage_id TEXT NOT NULL,
        skill_id TEXT NOT NULL,
        embedding_model TEXT NOT NULL,
        embedding_dimension INTEGER NOT NULL,
        chunk_index INTEGER NOT NULL DEFAULT 0,
        content_hash TEXT NOT NULL,
        embedding_blob BLOB,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (storage_id) REFERENCES skill_storages(id) ON DELETE CASCADE,
        FOREIGN KEY (skill_id) REFERENCES skills(id) ON DELETE CASCADE,
        UNIQUE (skill_id, embedding_model, chunk_index)
      );

CREATE TABLE IF NOT EXISTS agent_skill_storage_bindings (
        agent_preset_id TEXT NOT NULL,
        storage_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (agent_preset_id, storage_id),
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE CASCADE,
        FOREIGN KEY (storage_id) REFERENCES skill_storages(id) ON DELETE CASCADE,
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

CREATE TABLE IF NOT EXISTS memory_claims (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        claim TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        category TEXT NOT NULL,
        confidence REAL NOT NULL DEFAULT 0.5,
        durability REAL NOT NULL DEFAULT 0.5,
        status TEXT NOT NULL DEFAULT 'active',
        tags_json TEXT NOT NULL DEFAULT '[]',
        applies_to_paths_json TEXT NOT NULL DEFAULT '[]',
        source_type TEXT NOT NULL DEFAULT 'promotion',
        source_memory_id TEXT,
        supersedes_claim_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (source_memory_id) REFERENCES memories(id) ON DELETE SET NULL,
        FOREIGN KEY (supersedes_claim_id) REFERENCES memory_claims(id) ON DELETE SET NULL
      );

CREATE TABLE IF NOT EXISTS memory_claim_evidence (
        claim_id TEXT NOT NULL,
        memory_id TEXT NOT NULL,
        support_type TEXT NOT NULL DEFAULT 'supports',
        weight REAL NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        PRIMARY KEY (claim_id, memory_id),
        FOREIGN KEY (claim_id) REFERENCES memory_claims(id) ON DELETE CASCADE,
        FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS embedding_models (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL DEFAULT 'not_downloaded',
        download_progress REAL NOT NULL DEFAULT 0,
        local_path TEXT,
        error_message TEXT,
        updated_at TEXT NOT NULL
      );

CREATE TABLE IF NOT EXISTS knowledge_documents (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_ref TEXT,
        mime_type TEXT,
        byte_size INTEGER NOT NULL DEFAULT 0,
        char_count INTEGER NOT NULL DEFAULT 0,
        token_count INTEGER NOT NULL DEFAULT 0,
        summary TEXT NOT NULL DEFAULT '',
        content_text TEXT NOT NULL DEFAULT '',
        content_hash TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        embedding_model TEXT,
        chunk_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        content TEXT NOT NULL,
        token_count INTEGER NOT NULL DEFAULT 0,
        heading TEXT,
        embedding_model TEXT,
        embedding_dimension INTEGER,
        embedding_blob BLOB,
        created_at TEXT NOT NULL,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS agent_knowledge_subscriptions (
        agent_preset_id TEXT NOT NULL,
        document_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (agent_preset_id, document_id),
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE CASCADE,
        FOREIGN KEY (document_id) REFERENCES knowledge_documents(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS node_flows (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        graph_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS node_flow_versions (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        graph_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES node_flows(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (flow_id, version)
      );

CREATE TABLE IF NOT EXISTS node_flow_agent_skills (
        flow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_preset_id TEXT NOT NULL,
        skill_name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (flow_id, agent_preset_id),
        FOREIGN KEY (flow_id) REFERENCES node_flows(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS node_flow_runs (
        id TEXT PRIMARY KEY,
        flow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        status TEXT NOT NULL,
        execution_invocation_id TEXT,
        trigger_type TEXT NOT NULL DEFAULT 'manual',
        trigger_payload_json TEXT,
        input_json TEXT,
        output_json TEXT,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (flow_id) REFERENCES node_flows(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (execution_invocation_id) REFERENCES execution_invocations(id) ON DELETE SET NULL
      );

CREATE TABLE IF NOT EXISTS node_flow_node_runs (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        flow_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        node_id TEXT NOT NULL,
        logical_item TEXT NOT NULL DEFAULT 'default',
        status TEXT NOT NULL,
        execution_invocation_id TEXT,
        input_json TEXT,
        output_json TEXT,
        error_message TEXT,
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (run_id) REFERENCES node_flow_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (flow_id) REFERENCES node_flows(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (execution_invocation_id) REFERENCES execution_invocations(id) ON DELETE SET NULL
      );

CREATE TABLE IF NOT EXISTS custom_dashboards (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'draft',
        manifest_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        source_node_graph_json TEXT NOT NULL,
        styleguide_json TEXT NOT NULL DEFAULT '{}',
        runtime_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS custom_dashboard_revisions (
        id TEXT PRIMARY KEY,
        dashboard_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        revision_number INTEGER NOT NULL,
        manifest_json TEXT NOT NULL,
        files_json TEXT NOT NULL,
        source_node_graph_json TEXT NOT NULL,
        styleguide_json TEXT NOT NULL DEFAULT '{}',
        validation_status TEXT,
        validation_report_json TEXT,
        runtime_metadata_json TEXT NOT NULL DEFAULT '{}',
        validated_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (dashboard_id) REFERENCES custom_dashboards(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        UNIQUE (dashboard_id, revision_number)
      );

CREATE TABLE IF NOT EXISTS custom_dashboard_validation_sessions (
        id TEXT PRIMARY KEY,
        dashboard_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        status TEXT NOT NULL,
        validation_report_json TEXT,
        runtime_metadata_json TEXT NOT NULL DEFAULT '{}',
        started_at TEXT,
        finished_at TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (dashboard_id) REFERENCES custom_dashboards(id) ON DELETE CASCADE,
        FOREIGN KEY (revision_id) REFERENCES custom_dashboard_revisions(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

CREATE TABLE IF NOT EXISTS custom_dashboard_publications (
        dashboard_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        revision_id TEXT NOT NULL,
        published_at TEXT NOT NULL,
        runtime_metadata_json TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (dashboard_id) REFERENCES custom_dashboards(id) ON DELETE CASCADE,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (revision_id) REFERENCES custom_dashboard_revisions(id) ON DELETE CASCADE
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
        preserved_at TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        last_message_at TEXT,
        invocation_source TEXT NOT NULL DEFAULT 'internal',
        agent_preset_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_id) REFERENCES sprints(id) ON DELETE CASCADE,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
        FOREIGN KEY (sprint_run_id) REFERENCES sprint_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (dispatch_id) REFERENCES task_dispatches(id) ON DELETE CASCADE,
        FOREIGN KEY (task_run_id) REFERENCES task_runs(id) ON DELETE CASCADE,
        FOREIGN KEY (attention_item_id) REFERENCES project_attention_items(id) ON DELETE CASCADE,
        FOREIGN KEY (provider_invocation_id) REFERENCES provider_invocations(id) ON DELETE SET NULL,
        FOREIGN KEY (agent_preset_id) REFERENCES agent_presets(id) ON DELETE SET NULL
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
        port_mappings_json TEXT,
        container_id TEXT,
        container_name TEXT,
        worktree_path TEXT,
        feature_branch TEXT,
        startup_script_path TEXT NOT NULL,
        startup_mode TEXT NOT NULL,
        install_command TEXT,
        build_command TEXT,
        run_command TEXT,
        startup_command_override TEXT,
        docker_access_override INTEGER,
        environment_overrides_json TEXT,
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

CREATE TABLE IF NOT EXISTS sprint_file_browser_sessions (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        sprint_id TEXT NOT NULL,
        status TEXT NOT NULL,
        container_id TEXT,
        container_name TEXT,
        workspace_path TEXT,
        feature_branch TEXT,
        default_branch TEXT,
        last_completed_task_count INTEGER NOT NULL DEFAULT 0,
        last_seen_sprint_status TEXT,
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

CREATE TABLE IF NOT EXISTS scheduler_entries (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT NOT NULL,
        target_type TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'scheduled',
        scheduled_for TEXT NOT NULL,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        recurrence_json TEXT NOT NULL,
        target_json TEXT NOT NULL,
        next_run_at TEXT,
        last_run_at TEXT,
        run_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

`;

/**
 * Read-performance indexes are deliberately separate from table creation. Existing databases can
 * defer missing indexes until after service startup; unique correctness indexes remain owned by
 * runMigrations and are always installed synchronously.
 */
export const APP_DB_SCHEMA_READ_INDEXES = `
CREATE INDEX IF NOT EXISTS idx_provider_invocations_provider_status ON provider_invocations (provider, status);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_started ON provider_invocations (started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_updated ON provider_invocations (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_project_started ON provider_invocations (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_project_sprint_started ON provider_invocations (project_id, sprint_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_project_sprint_run_started ON provider_invocations (project_id, sprint_run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_sprint_started ON provider_invocations (sprint_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_sprint_run_started ON provider_invocations (sprint_run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_task_run ON provider_invocations (task_run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_invocations_session_owner ON provider_invocations (session_id, project_id, sprint_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_dispatches_project_executor_status_priority ON task_dispatches (project_id, executor_type, status, priority);
CREATE INDEX IF NOT EXISTS idx_sprint_runs_project_status_recency ON sprint_runs (project_id, status, last_heartbeat_at DESC, updated_at DESC, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sprint_runs_project_sprint ON sprint_runs (project_id, sprint_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_dispatches_project_task_recency ON task_dispatches (project_id, task_id, last_heartbeat_at DESC, started_at DESC, claimed_at DESC, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_dispatches_project_sprint_run_recency ON task_dispatches (project_id, sprint_run_id, last_heartbeat_at DESC, started_at DESC, claimed_at DESC, queued_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_runs_dispatch ON task_runs (dispatch_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_task_sprint_session ON task_runs (task_id, sprint_run_id, session_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_session_id_owner ON task_runs (session_id, project_id, sprint_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_session_name_owner ON task_runs (session_name, project_id, sprint_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_pr_url_owner ON task_runs (pr_url, project_id, sprint_id, task_id);
CREATE INDEX IF NOT EXISTS idx_task_runs_project_sprint_lookup ON task_runs (project_id, sprint_id, sprint_run_id, id);
CREATE INDEX IF NOT EXISTS idx_task_runs_project_sprint_run_lookup ON task_runs (project_id, sprint_run_id, id);
CREATE INDEX IF NOT EXISTS idx_task_self_reflection_ratings_task_latest ON task_self_reflection_ratings (task_id, captured_at DESC, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_self_reflection_ratings_project_task_latest ON task_self_reflection_ratings (project_id, task_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS idx_task_run_events_project_created ON task_run_events (project_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_task_run_events_task_run_created_id ON task_run_events (task_run_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_task_run_events_task_run_type_created_id ON task_run_events (task_run_id, event_type, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_task_run_events_provider_activity_run_created ON task_run_events (task_run_id, created_at DESC, id DESC) WHERE event_type = 'provider_activity';
CREATE INDEX IF NOT EXISTS idx_task_run_events_provider_activity_project_created ON task_run_events (project_id, created_at DESC, id DESC) WHERE event_type = 'provider_activity';
CREATE INDEX IF NOT EXISTS idx_project_attention_items_project_owner_status ON project_attention_items (project_id, owner_type, status);
CREATE INDEX IF NOT EXISTS idx_project_attention_items_project_status_updated ON project_attention_items (project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_attention_items_project_status_updated_opened ON project_attention_items (project_id, status, updated_at DESC, opened_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_project_attention_items_sprint_run_status_updated_opened ON project_attention_items (sprint_run_id, status, updated_at DESC, opened_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sprint_run_events_sprint_run_created_id ON sprint_run_events (sprint_run_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_sprint_runs_project_lookup ON sprint_runs (project_id, id, sprint_id, status);
CREATE INDEX IF NOT EXISTS idx_execution_invocations_project_started ON execution_invocations (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_invocations_project_sprint_started ON execution_invocations (project_id, sprint_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_invocations_project_sprint_run_started ON execution_invocations (project_id, sprint_run_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_invocations_status_started ON execution_invocations (status, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_execution_invocations_provider_invocation ON execution_invocations (provider_invocation_id);
CREATE INDEX IF NOT EXISTS idx_skill_storages_project ON skill_storages (project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skills_project_storage ON skills (project_id, storage_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_skill_embeddings_skill ON skill_embeddings (skill_id, embedding_model, chunk_index);
CREATE INDEX IF NOT EXISTS idx_skill_embeddings_storage ON skill_embeddings (project_id, storage_id, embedding_model);
CREATE INDEX IF NOT EXISTS idx_agent_skill_storage_bindings_agent ON agent_skill_storage_bindings (agent_preset_id);
CREATE INDEX IF NOT EXISTS idx_agent_skill_storage_bindings_storage ON agent_skill_storage_bindings (project_id, storage_id);
CREATE INDEX IF NOT EXISTS idx_node_flows_project_updated ON node_flows (project_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_flow_versions_flow_version ON node_flow_versions (flow_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_node_flow_agent_skills_agent ON node_flow_agent_skills (project_id, agent_preset_id);
CREATE INDEX IF NOT EXISTS idx_node_flow_runs_flow_created ON node_flow_runs (flow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_flow_runs_project_created ON node_flow_runs (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_node_flow_node_runs_run_created ON node_flow_node_runs (run_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_custom_dashboards_project_status ON custom_dashboards (project_id, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_dashboard_revisions_dashboard_revision ON custom_dashboard_revisions (dashboard_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_custom_dashboard_revisions_project ON custom_dashboard_revisions (project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_dashboard_validation_sessions_revision ON custom_dashboard_validation_sessions (revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_dashboard_validation_sessions_dashboard ON custom_dashboard_validation_sessions (dashboard_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_custom_dashboard_publications_project ON custom_dashboard_publications (project_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_provider_connections_kind ON chat_provider_connections (provider_kind, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_provider_connections_enabled ON chat_provider_connections (enabled, status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_provider_channel_bindings_project ON chat_provider_channel_bindings (project_id, enabled, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_provider_channel_bindings_provider_channel ON chat_provider_channel_bindings (provider_connection_id, external_channel_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_provider_message_deliveries_inbound_dedupe ON chat_provider_message_deliveries (provider_connection_id, external_message_id) WHERE direction = 'inbound' AND external_message_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_provider_message_deliveries_outbound_message ON chat_provider_message_deliveries (provider_connection_id, conversation_message_id) WHERE direction = 'outbound' AND conversation_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_chat_provider_message_deliveries_pending_outbound ON chat_provider_message_deliveries (status, next_attempt_at, lease_expires_at, updated_at ASC) WHERE direction = 'outbound' AND status IN ('pending', 'sending', 'retryable_failure');
CREATE INDEX IF NOT EXISTS idx_chat_provider_ingress_replay_expiry ON chat_provider_ingress_replay_receipts (expires_at ASC);
CREATE INDEX IF NOT EXISTS idx_chat_provider_sessions_connection ON chat_provider_sessions (provider_connection_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_provider_sessions_expiry ON chat_provider_sessions (expires_at ASC) WHERE expires_at IS NOT NULL;
`;
