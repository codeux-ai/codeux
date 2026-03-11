export type McpRuntimeRole = "project_manager" | "worker_host" | "worker_gateway";

export const TOOL_DEFINITIONS = [
  {
    name: "get_source",
    runtimeRoles: ["project_manager"],
    description: "Retrieve comprehensive details for a specific code source (e.g., a GitHub repository).",
    inputSchema: {
      type: "object",
      properties: {
        source_id: { type: "string", description: "The unique identifier for the source." },
      },
      required: ["source_id"],
    },
  },
  {
    name: "list_sources",
    runtimeRoles: ["project_manager"],
    description: "Enumerate available code sources with filtering and pagination capabilities.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string" },
        page_size: { type: "number" },
        page_token: { type: "string" },
      },
    },
  },
  {
    name: "list_all_sources",
    runtimeRoles: ["project_manager"],
    description: "Retrieve the complete list of available sources by automatically handling multi-page results.",
    inputSchema: {
      type: "object",
      properties: {
        filter: { type: "string" },
      },
    },
  },
  {
    name: "create_session",
    runtimeRoles: ["project_manager"],
    description: "Initiate a new agent session to perform tasks on a specific codebase.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        source: { type: "string" },
        starting_branch: { type: "string" },
        title: { type: "string" },
        require_plan_approval: { type: "boolean" },
        automation_mode: { type: "string", enum: ["AUTO_CREATE_PR"] },
      },
      required: ["prompt", "source"],
    },
  },
  {
    name: "get_session",
    runtimeRoles: ["project_manager", "worker_host"],
    description: "Get the current status, state, and outputs of an active or historical session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "list_sessions",
    runtimeRoles: ["project_manager"],
    description: "List recent agent sessions with pagination.",
    inputSchema: {
      type: "object",
      properties: {
        page_size: { type: "number" },
        page_token: { type: "string" },
      },
    },
  },
  {
    name: "approve_session_plan",
    runtimeRoles: ["project_manager"],
    description: "Authorize the agent to proceed with the proposed plan.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "send_session_message",
    runtimeRoles: ["project_manager"],
    description: "Provide additional feedback, instructions, or corrections to the agent.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        prompt: { type: "string" },
      },
      required: ["session_id", "prompt"],
    },
  },
  {
    name: "wait_for_session_completion",
    runtimeRoles: ["project_manager"],
    description: "Monitor a session until it reaches a terminal state or a PR is generated.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        poll_interval: { type: "number", default: 10 },
        timeout: { type: "number", default: 900 },
      },
      required: ["session_id"],
    },
  },
  {
    name: "get_activity",
    runtimeRoles: ["project_manager"],
    description: "Retrieve detailed information about a specific interaction step.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        activity_id: { type: "string" },
      },
      required: ["session_id", "activity_id"],
    },
  },
  {
    name: "list_activities",
    runtimeRoles: ["project_manager"],
    description: "Fetch a chronologically ordered list of activities for a session.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
        page_size: { type: "number" },
        page_token: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "list_all_activities",
    runtimeRoles: ["project_manager"],
    description: "Retrieve all activities for a session automatically.",
    inputSchema: {
      type: "object",
      properties: {
        session_id: { type: "string" },
      },
      required: ["session_id"],
    },
  },
  {
    name: "sprint_agent",
    runtimeRoles: ["project_manager"],
    description: "Intelligent agent that orchestrates sprints by delegating subtasks to configured providers (Jules/Gemini/Codex).",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Optional Sprint OS project id. When omitted, the selected dashboard project is used." },
        sprint_id: { type: "string", description: "Optional Sprint OS sprint id. Prefer this for precise project-scoped execution." },
        sprint_number: { type: "number", description: "Optional sprint number within the resolved project scope." },
        source_id: { type: "string", description: "Optional Jules source ID override. If omitted, it is auto-resolved from repo git remote when Jules is used." },
        feature_branch: { type: "string", description: "The main feature branch for this sprint." },
        action: {
          type: "string",
          enum: ["status", "orchestrate", "plan"],
          description: "Action to perform: 'status', 'orchestrate', 'plan'."
        },
        wait: { type: "boolean", description: "Whether to wait and watch for all tasks to complete (poll interval is configurable in dashboard settings, default 120s). Defaults to true for 'status' and 'orchestrate'.", default: true },
        retry_failed: { type: "boolean", description: "Whether to automatically retry failed tasks. Defaults to true.", default: true },
      },
      required: ["action"],
    },
  },
  {
    name: "task_agent",
    runtimeRoles: ["project_manager"],
    description: "Executes a single specific task on a codebase via the configured provider workflow with injected engineering standards.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The specific task to perform." },
        source_id: { type: "string", description: "Optional Jules source ID override (e.g., 'sources/123'). Auto-resolved from repo path when omitted." },
        repo_path: { type: "string", description: "Optional explicit repo path. When omitted, the current working directory is used." },
        title: { type: "string", description: "Optional title for the session." },
        branch: { type: "string", description: "Optional starting branch." },
        wait: { type: "boolean", description: "Whether to wait for the task to reach a terminal state (COMPLETED/FAILED).", default: false }
      },
      required: ["prompt"],
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
    runtimeRoles: ["worker_host"],
    description: "Generate a non-coding dashboard reply for a worker/listener connection using the local provider stack.",
    inputSchema: {
      type: "object",
      properties: {
        project_id: { type: "string", description: "Sprint OS project id for repo and settings context." },
        thread_id: { type: "string", description: "Dashboard conversation thread id." },
        thread_title: { type: "string", description: "Optional thread title for prompt context." },
        body_markdown: { type: "string", description: "The dashboard-authored message to answer." },
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
        transport: { type: "string", description: "Transport type used by the MCP connection." },
        capabilities: { type: "object", additionalProperties: true },
        include_task_dispatch: { type: "boolean", description: "When true, worker-capable listeners may claim and receive the next queued worker dispatch during the same listen call." },
        timeout_seconds: { type: "number", description: "Optional long-poll timeout. Defaults to the dashboard watch-loop output interval." },
        poll_interval_ms: { type: "number", description: "Optional internal poll interval while waiting for the next actionable event.", default: 1000 },
      },
      required: ["connection_key"],
    },
  },
  {
    name: "start_listen",
    runtimeRoles: ["worker_host"],
    description: "Low-level compatibility tool that registers an MCP listener connection and returns pending dashboard messages immediately.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string", description: "Stable unique key for the connected MCP client." },
        display_name: { type: "string", description: "Human-readable name for the connected MCP client." },
        role: { type: "string", enum: ["project_manager", "worker", "listener"] },
        project_id: { type: "string", description: "Optional project id to bind as the active listening project." },
        transport: { type: "string", description: "Transport type used by the MCP connection." },
        capabilities: { type: "object", additionalProperties: true },
        max_messages: { type: "number", default: 10 },
      },
      required: ["connection_key"],
    },
  },
  {
    name: "pull_inbox",
    runtimeRoles: ["worker_host"],
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
      },
      required: ["connection_key", "thread_id", "body_markdown"],
    },
  },
  {
    name: "pull_task_dispatch",
    runtimeRoles: ["worker_host"],
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
    runtimeRoles: ["worker_host", "worker_gateway"],
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
    name: "update_sprint_preflight_job",
    runtimeRoles: ["worker_host", "worker_gateway"],
    description: "Heartbeat, complete, fail, or block a claimed sprint preflight job and persist the result back into Sprint OS.",
    inputSchema: {
      type: "object",
      properties: {
        connection_key: { type: "string" },
        job_id: { type: "string" },
        lease_token: { type: "string" },
        state: { type: "string", enum: ["RUNNING", "COMPLETED", "FAILED", "BLOCKED"] },
        summary_markdown: { type: "string" },
        error_message: { type: "string" },
      },
      required: ["connection_key", "job_id", "lease_token", "state"],
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
