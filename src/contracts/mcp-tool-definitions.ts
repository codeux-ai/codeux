export type McpRuntimeRole = "project_manager" | "worker_host" | "worker_gateway";

export const TOOL_DEFINITIONS = [
  {
    name: "get_session",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
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
    name: "execute_worker_dispatch",
    runtimeRoles: ["worker_host"],
    description: "Start local execution for a claimed worker dispatch on a Sprint OS worker host.",
    inputSchema: {
      type: "object",
      properties: {
        dispatch_id: { type: "string", description: "The claimed worker dispatch id to execute locally." },
      },
      required: ["dispatch_id"],
    },
  },
  {
    name: "cancel_local_dispatch",
    runtimeRoles: ["worker_host"],
    description: "Request cancellation for an active local worker dispatch on the current Sprint OS worker host.",
    inputSchema: {
      type: "object",
      properties: {
        dispatch_id: { type: "string", description: "The local worker dispatch id to stop." },
        reason: { type: "string", description: "Optional cancellation reason for logs and provider feedback." },
      },
      required: ["dispatch_id"],
    },
  },
  {
    name: "generate_dashboard_reply",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
    description: "Generate a non-coding dashboard reply for a worker/listener connection using the local provider stack.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Sprint OS project id for repo and settings context." },
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
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
    description: "Enter Sprint OS listening mode. This call blocks until one actionable dashboard message or worker dispatch is available, or until timeout expires.",
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
        include_task_dispatch: { type: "boolean", description: "When true, worker-capable listeners may claim and receive the next queued worker dispatch during the same listen call." },
        include_attention_items: { type: "boolean", description: "When true, worker-capable listeners may receive assignment and attention events during the same listen call." },
        timeout_seconds: { type: "number", description: "Optional long-poll timeout. Defaults to the dashboard watch-loop output interval." },
        poll_interval_ms: { type: "number", description: "Optional internal poll interval while waiting for the next actionable event.", default: 1000 },
      },
      required: ["connection_key"],
    },
  },
  {
    name: "start_listen",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
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
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
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
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
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
    name: "pull_task_dispatch",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
    description: "Claim the next queued worker task dispatch for a registered MCP worker connection.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        project_id: { type: "string" },
        sprint_id: { type: "string" },
      },
      required: ["connection_key"],
    },
  },
  {
    name: "update_task_dispatch",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
    description: "Heartbeat, complete, fail, or block a claimed worker task dispatch and persist the result back into Sprint OS.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        dispatch_id: { type: "string" },
        lease_token: { type: "string" },
        state: { type: "string", enum: ["RUNNING", "COMPLETED", "FAILED", "BLOCKED"] },
        provider: { type: "string" },
        session_id: { type: "string" },
        session_name: { type: "string" },
        worker_branch: { type: "string" },
        pr_url: { type: "string" },
        summary_markdown: { type: "string" },
        error_message: { type: "string" },
      },
      required: ["connection_key", "dispatch_id", "lease_token", "state"],
    },
  },
  {
    name: "claim_attention_item",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
    description: "Claim an open worker attention item so Sprint OS knows which worker is actively handling it.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        attention_item_id: { type: "string" },
        claim_reason: { type: "string" },
      },
      required: ["connection_key", "attention_item_id"],
    },
  },
  {
    name: "resolve_attention_item",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
    description: "Resolve or dismiss an attention item after the blocker has been handled.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        attention_item_id: { type: "string" },
        resolution_status: { type: "string", enum: ["resolved", "dismissed"] },
        resolution_reason: { type: "string" },
        resolution_summary_markdown: { type: "string" },
      },
      required: ["connection_key", "attention_item_id"],
    },
  },
  {
    name: "report_attention_outcome",
    runtimeRoles: ["project_manager", "worker_host", "worker_gateway"],
    description: "Report the worker's supervision outcome for a claimed attention item and hand it off cleanly when operator follow-up is required.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        attention_item_id: { type: "string" },
        outcome: { type: "string", enum: ["handled_locally", "needs_dashboard_reply", "needs_human_escalation"] },
        summary_markdown: { type: "string" },
        resolution_reason: { type: "string" },
        thread_title: { type: "string" },
      },
      required: ["connection_key", "attention_item_id", "outcome", "summary_markdown"],
    },
  },
  {
    name: "manage_sprint_os",
    runtimeRoles: ["project_manager", "worker_gateway"],
    description: "Manage internal Sprint OS state. Used for configuration and destructive actions. Destructive actions require approval confirmation.",
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
