export const TOOL_DEFINITIONS = [
  {
    name: "get_source",
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
    description: "Executes a single specific task on a codebase via the configured provider workflow with injected engineering standards.",
    inputSchema: {
      type: "object",
      properties: {
        prompt: { type: "string", description: "The specific task to perform." },
        source_id: { type: "string", description: "Optional Jules source ID override (e.g., 'sources/123'). Auto-resolved from repo path when omitted." },
        title: { type: "string", description: "Optional title for the session." },
        branch: { type: "string", description: "Optional starting branch." },
        wait: { type: "boolean", description: "Whether to wait for the task to reach a terminal state (COMPLETED/FAILED).", default: false }
      },
      required: ["prompt"],
    },
  },
  {
    name: "start_listen",
    description: "Register an MCP connection as a dashboard listener for a project and return any pending dashboard messages.",
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
    description: "Poll the dashboard inbox for pending messages for a registered MCP connection.",
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
