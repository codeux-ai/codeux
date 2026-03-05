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
        sprint_number: { type: "number", description: "The sprint number (e.g., 34)." },
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
      required: ["sprint_number", "action"],
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
