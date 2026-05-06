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
    description: "Manage internal Code UX state. Used for configuration and destructive actions. Destructive actions require approval confirmation.",
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
