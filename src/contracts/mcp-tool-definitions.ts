export type McpRuntimeRole = "project_manager";

export const TOOL_DEFINITIONS = [
  {
    name: "get_session",
    runtimeRoles: ["project_manager"],
    description: "Get the current status, state, and outputs of a tracked or active execution session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "generate_dashboard_reply",
    runtimeRoles: ["project_manager"],
    description: "Generate a non-coding dashboard reply for a worker/listener connection using the local provider stack.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Code UX project id for repo and settings context." },
        thread_id: { type: "string", description: "Dashboard conversation thread id." },
        thread_title: { type: "string", description: "Optional thread title for prompt context." },
        body_markdown: { type: "string", description: "The dashboard-authored message to answer." },
        mode: { type: "string", enum: ["reply", "compact_thread"], description: "Optional reply mode. compact_thread treats body_markdown as a prepared compaction prompt." },
      },
      required: ["project_id", "thread_id", "body_markdown"],
    },
  },
  {
    name: "listen",
    runtimeRoles: ["project_manager"],
    description: "Enter Code UX listening mode. This call blocks until one actionable dashboard message is available, or until timeout expires.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string", description: "Stable unique key for the connected MCP client." },
        display_name: { type: "string", description: "Human-readable name for the connected MCP client." },
        role: { type: "string", enum: ["project_manager", "worker", "listener"] },
        project_id: { type: "string", description: "Optional project id to bind as the active listening project." },
        project_ids: { type: "array", items: { type: "string" }, description: "Optional project ids that the listener should stay bound to." },
        active_project_ids: { type: "array", items: { type: "string" }, description: "Optional active subset of bound projects for the current listen loop." },
        transport: { type: "string", description: "Transport type used by the MCP connection." },
        capabilities: { type: "object", additionalProperties: true },
        include_task_dispatch: { type: "boolean", description: "Deprecated compatibility field. Task dispatch events are no longer exposed through MCP listen." },
        include_attention_items: { type: "boolean", description: "Deprecated compatibility field. Worker attention events are no longer exposed through MCP listen." },
        timeout_seconds: { type: "number", description: "Optional long-poll timeout. Defaults to the dashboard watch-loop output interval." },
        poll_interval_ms: { type: "number", description: "Optional internal poll interval while waiting for the next actionable event.", default: 1000 },
      },
      required: ["connection_key"],
    },
  },
  {
    name: "start_listen",
    runtimeRoles: ["project_manager"],
    description: "Low-level compatibility tool that registers an MCP listener connection and returns pending dashboard messages immediately.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string", description: "Stable unique key for the connected MCP client." },
        display_name: { type: "string", description: "Human-readable name for the connected MCP client." },
        role: { type: "string", enum: ["project_manager", "worker", "listener"] },
        project_id: { type: "string", description: "Optional project id to bind as the active listening project." },
        project_ids: { type: "array", items: { type: "string" }, description: "Optional project ids that the listener should stay bound to." },
        active_project_ids: { type: "array", items: { type: "string" }, description: "Optional active subset of bound projects for the current listen loop." },
        transport: { type: "string", description: "Transport type used by the MCP connection." },
        capabilities: { type: "object", additionalProperties: true },
        max_messages: { type: "number", default: 10 },
      },
      required: ["connection_key"],
    },
  },
  {
    name: "pull_inbox",
    runtimeRoles: ["project_manager"],
    description: "Low-level compatibility tool that polls the dashboard inbox for pending messages for a registered MCP connection.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        project_id: { type: "string" },
        max_messages: { type: "number", default: 10 },
      },
      required: ["connection_key"],
    },
  },
  {
    name: "post_listen_reply",
    runtimeRoles: ["project_manager"],
    description: "Post a listener reply back to the dashboard conversation thread and mark the message as handled.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        thread_id: { type: "string" },
        body_markdown: { type: "string" },
        reply_to_message_id: { type: "string" },
        metadata: { type: "object", additionalProperties: true },
      },
      required: ["connection_key", "thread_id", "body_markdown"],
    },
  },
  {
    name: "manage_code_ux",
    runtimeRoles: ["project_manager"],
    description: "(Deprecated) Manage internal Code UX state. Used for configuration and destructive actions. Destructive actions require approval confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        domain: { type: "string", description: "The management domain (e.g., 'system', 'projects', 'settings')." },
        action: { type: "string", description: "The specific management action to perform." },
        payload: { type: "object", additionalProperties: true, description: "Action-specific parameters." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean", description: "Set to true to confirm a destructive action after reviewing the approval requirement." },
          },
        },
      },
      required: ["domain", "action", "payload"],
    },
  },
  {
    name: "manage_projects",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX projects. Used to list, get, create, update, select, setup, and delete projects. Destructive actions require approval confirmation.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "select", "setup", "delete"], description: "The project action to perform." },
        projectId: { type: "string", description: "Required for get, update, select, setup, delete." },
        name: { type: "string", description: "Required for create. Optional for update." },
        description: { type: "string", description: "Optional for create and update." },
        setup: { type: "object", additionalProperties: true, description: "Optional setup request with enabled and options flags." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean", description: "Set to true to confirm a destructive action." },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_sprints",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX sprints. Used to list, get, create, update, delete, start, pause, cancel, force_cancel, and inspect_run. Destructive actions require approval.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "start", "pause", "cancel", "force_cancel", "inspect_run"], description: "The sprint action to perform." },
        projectId: { type: "string", description: "Required for list, create, start, inspect_run." },
        sprintId: { type: "string", description: "Required for get, update, delete, start, inspect_run." },
        sprintRunId: { type: "string", description: "Required for pause, cancel, force_cancel. Optional for inspect_run." },
        title: { type: "string", description: "Required for create. Optional for update." },
        goalMarkdown: { type: "string", description: "Optional for create and update." },
        agentPresetId: { type: "string", description: "Optional for create and update." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_tasks",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX tasks. Used to list, get, create, update, delete, start, stop, force_stop, pause, and inspect_run.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "start", "stop", "force_stop", "pause", "inspect_run"], description: "The task action to perform." },
        projectId: { type: "string", description: "Required for list, create." },
        sprintId: { type: "string", description: "Required for list, create." },
        taskId: { type: "string", description: "Required for get, update, delete, start, stop, force_stop, pause, inspect_run." },
        title: { type: "string", description: "Optional for create, update." },
        promptMarkdown: { type: "string", description: "Optional for create, update." },
        description: { type: "string", description: "Optional for create, update." },
        priority: { type: "string", description: "Optional for create, update." },
        dependsOnTaskIds: { type: "array", items: { type: "string" }, description: "Optional for create, update." },
        provider: { type: "string", description: "Optional for start (rerun)." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_agents",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX agents. Used to list, get, sync, create, update, and delete agent presets.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "sync", "create", "update", "delete"], description: "The agent action to perform." },
        projectId: { type: "string", description: "Required for list, get, sync, create, update, delete." },
        presetId: { type: "string", description: "Required for get, update, delete." },
        name: { type: "string", description: "Required for create, optional for update." },
        instructionMarkdown: { type: "string", description: "Optional for create, update." },
        labels: { type: "array", items: { type: "string" }, description: "Optional for create, update." },
        avatarConfig: { type: "object", additionalProperties: true, description: "Optional for create, update." },
        memoryTemplateOverrideEnabled: { type: "boolean", description: "Optional for create, update." },
        memoryTemplateMarkdown: { type: "string", description: "Optional for create, update." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_memory",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX memory. Used to search, list, get, create, update, delete, promote, start_reembed, get_map, count, and model_status.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["search", "list", "get", "create", "update", "delete", "promote", "start_reembed", "get_map", "count", "model_status"], description: "The memory action to perform." },
        projectId: { type: "string", description: "Required for search, list, create, promote, start_reembed, get_map, count." },
        memoryId: { type: "string", description: "Required for get, update, delete." },
        query: { type: "string", description: "Required for search." },
        scope: { type: "string", description: "Optional for search, list, create, get_map. Required for count." },
        sprintId: { type: "string", description: "Optional for search, list, create, get_map." },
        agentPresetId: { type: "string", description: "Optional for search, list, create, get_map." },
        limit: { type: "number", description: "Optional for search, list." },
        minSimilarity: { type: "number", description: "Optional for search." },
        content: { type: "string", description: "Required for create. Optional for update." },
        category: { type: "string", description: "Optional for create, update." },
        strength: { type: "number", description: "Optional for create, update." },
        memoryIds: { type: "array", items: { type: "string" }, description: "Required for promote." },
        reason: { type: "string", description: "Optional for promote." },
        topKPerNode: { type: "number", description: "Optional for get_map." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_settings",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX settings. Used to get, resolve, patch, replace, and reset system, project, and sprint settings.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get_system", "get_project_override", "resolve_project_effective", "get_sprint_override", "resolve_sprint_effective", "replace_system_settings", "patch_system_setting", "replace_project_settings", "patch_project_setting", "reset_project_settings", "replace_sprint_settings", "patch_sprint_setting", "reset_sprint_settings"], description: "The settings action to perform." },
        projectId: { type: "string", description: "Required for project and sprint actions." },
        sprintId: { type: "string", description: "Required for sprint actions." },
        path: { type: "string", description: "Required for patch actions." },
        value: { type: "object", additionalProperties: true, description: "Required for patch actions." },
        settings: { type: "object", additionalProperties: true, description: "Required for replace actions." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_preview",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX sprint previews. Used to list, start, rebuild, stop, remove sessions, get script, get logs, and get url.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_sessions", "start_session", "rebuild_session", "stop_session", "remove_session", "get_script", "get_logs", "get_url"], description: "The preview action to perform." },
        projectId: { type: "string", description: "Required for list_sessions, start_session, get_script." },
        sprintId: { type: "string", description: "Required for start_session, get_script." },
        sessionId: { type: "string", description: "Required for rebuild, stop, remove, get_logs, get_url." },
        path: { type: "string", description: "Optional for get_url." },
        approval: {
          type: "object",
          properties: {
            confirmed: { type: "boolean" },
          },
        },
      },
      required: ["action"],
    },
  },
  {
    name: "manage_telemetry",
    runtimeRoles: ["project_manager"],
    description: "Manage Code UX telemetry. Used to get execution and stats snapshots, and list runs, dispatches, and invocations.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get_project_execution_snapshot", "get_project_stats_snapshot", "list_sprint_runs", "list_task_dispatches", "list_execution_invocations", "list_execution_invocation_messages"], description: "The telemetry action to perform." },
        projectId: { type: "string", description: "Required for get_project_execution_snapshot, get_project_stats_snapshot, list_sprint_runs, list_task_dispatches, list_execution_invocations." },
        sprintId: { type: "string", description: "Required for list_sprint_runs, list_task_dispatches." },
        taskId: { type: "string", description: "Required for list_task_dispatches. Optional for list_execution_invocations." },
        invocationId: { type: "string", description: "Required for list_execution_invocation_messages." },
        type: { type: "string", description: "Optional for list_execution_invocations." },
      },
      required: ["action"],
    },
  },
] as const;

export type ToolName = (typeof TOOL_DEFINITIONS)[number]["name"];

export type ToolHandlerMap<TMap extends object> = {
  [K in keyof TMap]?: (args: TMap[K]) => Promise<unknown> | unknown;
};

export const dispatchTool = async <TMap extends object, K extends Extract<keyof TMap, string>>(
  name: string,
  args: unknown,
  handlers: ToolHandlerMap<TMap>
): Promise<unknown> => {
  const handler = handlers[name as keyof TMap];
  if (!handler) {
    throw new Error(`Tool not found: ${name}`);
  }
  return await handler(args as TMap[keyof TMap]);
};
