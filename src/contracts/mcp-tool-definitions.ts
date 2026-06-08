export type McpRuntimeRole = "project_manager";

export type McpToolCategory = "orchestration" | "agents_memory" | "platform" | "advanced";

export const TOOL_DEFINITIONS = [
  {
    name: "manage_code_ux",
    runtimeRoles: ["project_manager"],
    category: "advanced",
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
    category: "orchestration",
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
    category: "orchestration",
    description: "Manage Code UX sprints. Used to list, get, create, update, delete, start, pause, cancel, force_cancel, inspect_run, import_issues, and plan. Destructive actions require approval.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "start", "pause", "cancel", "force_cancel", "inspect_run", "import_issues", "plan"], description: "The sprint action to perform." },
        projectId: { type: "string", description: "Required for list, create, start, inspect_run." },
        sprintId: { type: "string", description: "Required for get, update, delete, start, inspect_run." },
        sprintRunId: { type: "string", description: "Required for pause, cancel, force_cancel. Optional for inspect_run." },
        name: { type: "string", description: "Required for create unless title is provided. Optional for update." },
        title: { type: "string", description: "Alias for name. Required for create unless name is provided. Optional for update." },
        goal: { type: "string", description: "Optional for create and update." },
        goalMarkdown: { type: "string", description: "Alias for goal. Optional for create and update." },
        originalPrompt: { type: "string", description: "Optional source prompt for create and update." },
        status: { type: "string", enum: ["running", "paused", "completed", "failed", "cancelled", "idle"], description: "Optional sprint status for create and update." },
        showcasePinned: { type: "boolean", description: "Optional for create and update." },
        agentPresetId: { type: "string", description: "Optional for create and update." },
        planningAgentPresetId: { type: "string", description: "Optional for plan." },
        autoStart: { type: "boolean", description: "Optional for plan." },
        replan: { type: "boolean", description: "Optional for plan." },
        search: { type: "string", description: "Optional search query for import_issues." },
        provider: { type: "string", enum: ["github", "gitlab", "jira"], description: "Optional issue provider for import_issues." },
        limit: { type: "number", description: "Optional issue result limit for import_issues." },
        overrides: { type: "object", additionalProperties: true, description: "Optional planning overrides for plan." },
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
    category: "orchestration",
    description: "Manage Code UX tasks. Used to list, get, create, update, delete, start, stop, force_stop, pause, and inspect_run.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "get", "create", "update", "delete", "start", "stop", "force_stop", "pause", "inspect_run"], description: "The task action to perform." },
        projectId: { type: "string", description: "Required for list and create." },
        sprintId: { type: "string", description: "Required for create. Optional filter for list." },
        taskId: { type: "string", description: "Required for get, update, delete, start, stop, force_stop, pause, inspect_run." },
        taskKey: { type: "string", description: "Optional stable task key for create." },
        name: { type: "string", description: "Alias for title on create and update." },
        title: { type: "string", description: "Optional for create, update." },
        promptMarkdown: { type: "string", description: "Optional for create, update." },
        description: { type: "string", description: "Optional for create, update." },
        status: { type: "string", enum: ["pending", "in_progress", "coding_completed", "completed", "QA_REVIEW_FAILED"], description: "Optional for create, update." },
        priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Optional for create, update." },
        executorType: { type: "string", enum: ["auto", "docker_cli", "jules"], description: "Optional for create, update." },
        agentPresetId: { type: ["string", "null"], description: "Optional for create, update." },
        model: { type: ["string", "null"], description: "Optional for create, update." },
        sortOrder: { type: "number", description: "Optional for create, update." },
        dependsOnTaskIds: { type: "array", items: { type: "string" }, description: "Optional for create, update." },
        isIndependent: { type: "boolean", description: "Optional for create, update." },
        isMerged: { type: "boolean", description: "Optional for create, update." },
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
    name: "manage_quicksprints",
    runtimeRoles: ["project_manager"],
    category: "orchestration",
    description: "Manage Code UX quicksprints. Used to list, get, create, update, delete templates, and execute or start quicksprints. Deleting custom templates requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list_templates", "get_template", "create_template", "update_template", "delete_template", "execute", "start"], description: "The quicksprint action to perform. Use start to plan and start immediately." },
        projectId: { type: "string", description: "Required for every action." },
        templateId: { type: "string", description: "Required for get_template, update_template, delete_template, execute, and start." },
        name: { type: "string", description: "Required for create_template. Optional for update_template." },
        description: { type: "string", description: "Required for create_template. Optional for update_template." },
        icon: { type: "string", description: "Required for create_template. Optional for update_template." },
        category: { type: "string", description: "Required for create_template. Optional for update_template." },
        categoryColor: { type: "string", description: "Optional template category color." },
        agentInstructionMarkdown: { type: "string", description: "Required for create_template. Optional for update_template." },
        defaultTaskCount: { type: ["number", "string"], description: "Optional default task count for a custom template." },
        taskCount: { type: ["number", "string"], description: "Optional task count for execute/start; defaults to 5." },
        submitMode: { type: "string", enum: ["plan_only", "plan_and_start"], description: "Optional execution mode. start defaults to plan_and_start; execute defaults to plan_only." },
        routeOverride: { type: "string", description: "Optional route override for execution." },
        modelOverride: { type: "string", description: "Optional model override for planning." },
        planningOverrides: { type: "object", additionalProperties: true, description: "Optional planning overrides." },
        agentPresetId: { type: "string", description: "Optional agent preset override." },
        additionalPrompt: { type: "string", description: "Optional additional planning instructions." },
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
    name: "manage_scheduler",
    runtimeRoles: ["project_manager"],
    category: "orchestration",
    description: "Manage Code UX scheduler entries. Used to list, create, schedule_sprint, schedule_quicksprint, schedule_chat, update, delete, and run_due. Scheduled chat entries post messages through the chat runtime when due. Deleting entries requires approval.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["list", "create", "schedule_sprint", "schedule_quicksprint", "schedule_chat", "update", "delete", "run_due"], description: "The scheduler action to perform." },
        projectId: { type: "string", description: "Required for list and create/schedule actions." },
        entryId: { type: "string", description: "Required for update and delete." },
        from: { type: "string", description: "Optional ISO start for list window." },
        to: { type: "string", description: "Optional ISO end for list window." },
        title: { type: "string", description: "Optional scheduler entry title. For schedule_chat this can also become the chat thread title." },
        targetType: { type: "string", enum: ["sprint", "quicksprint", "chat"], description: "Required for generic create. schedule_* actions infer this." },
        status: { type: "string", enum: ["scheduled", "paused", "completed", "failed", "cancelled"], description: "Optional for update." },
        scheduledFor: { type: "string", description: "Required ISO date for create/schedule actions. Optional for update." },
        timezone: { type: "string", description: "Optional timezone identifier; defaults to UTC." },
        recurrence: { type: "object", additionalProperties: true, description: "Optional recurrence rule with frequency, interval, endMode, count, and until." },
        sprintTarget: { type: "object", additionalProperties: true, description: "Nested sprint target. Requires sprintId." },
        quicksprintTarget: { type: "object", additionalProperties: true, description: "Nested quicksprint target. Requires templateId; supports taskCount, submitMode, additionalPrompt, agentPresetId, planningOverrides." },
        chatTarget: { type: "object", additionalProperties: true, description: "Nested chat target. Requires bodyMarkdown; supports threadId, title, and connectionId." },
        sprintId: { type: "string", description: "Flattened sprint target id for schedule_sprint/create/update." },
        templateId: { type: "string", description: "Flattened quicksprint template id for schedule_quicksprint/create/update." },
        taskCount: { type: ["number", "string"], description: "Flattened quicksprint task count; defaults to 5." },
        submitMode: { type: "string", enum: ["plan_only", "plan_and_start"], description: "Flattened quicksprint submit mode; defaults to plan_and_start." },
        additionalPrompt: { type: "string", description: "Flattened quicksprint additional prompt." },
        agentPresetId: { type: "string", description: "Flattened quicksprint agent preset override." },
        planningOverrides: { type: "object", additionalProperties: true, description: "Flattened quicksprint planning overrides." },
        bodyMarkdown: { type: "string", description: "Flattened chat message body for schedule_chat/create/update." },
        threadId: { type: ["string", "null"], description: "Optional existing chat thread id for scheduled chat messages." },
        connectionId: { type: ["string", "null"], description: "Optional chat connection id for scheduled chat messages." },
        now: { type: "string", description: "Optional ISO override for run_due evaluation." },
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
    category: "agents_memory",
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
    category: "agents_memory",
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
    name: "search_knowledge",
    runtimeRoles: ["project_manager"],
    category: "agents_memory",
    description: "Search your attached knowledge base. Returns the most relevant passages from the documents subscribed to you. Use a focused natural-language query to pull exact content before answering, instead of guessing. Scope is your own subscriptions — no project id needed.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Natural-language search query describing what you need to find." },
        limit: { type: "number", description: "Maximum number of passages to return (default 5)." },
        minSimilarity: { type: "number", description: "Optional minimum cosine similarity threshold (0-1)." },
      },
      required: ["query"],
    },
  },
  {
    name: "manage_settings",
    runtimeRoles: ["project_manager"],
    category: "platform",
    description: "Manage Code UX settings. Used to get, resolve, patch, replace, and reset system, project, and sprint settings. Mutating settings actions always require a first human-confirmation response; only the same action and payload may execute once with approval.confirmed: true within 15 minutes.",
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["get_system", "get_project_override", "resolve_project_effective", "get_sprint_override", "resolve_sprint_effective", "replace_system_settings", "patch_system_setting", "replace_project_settings", "patch_project_setting", "reset_project_settings", "replace_sprint_settings", "patch_sprint_setting", "reset_sprint_settings"], description: "The settings action to perform." },
        projectId: { type: "string", description: "Required for project and sprint actions." },
        sprintId: { type: "string", description: "Required for sprint actions." },
        path: { type: "string", description: "Required for patch actions." },
        value: { description: "Required for patch actions. May be any JSON value." },
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
    category: "platform",
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
    category: "platform",
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
