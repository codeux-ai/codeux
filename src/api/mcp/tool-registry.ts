import type { ToolName as ContractToolName } from "../../contracts/mcp-tool-definitions.js";
import type { McpConnectionCapabilities, McpConnectionRole } from "../../contracts/connection-chat-types.js";
import type { ManageCodeUxArgs, ManageProjectsArgs, ManageSprintsArgs, ManageTasksArgs, ManageAgentsArgs, ManageMemoryArgs, ManageSettingsArgs, ManagePreviewArgs, ManageTelemetryArgs } from "../../contracts/internal-management-types.js";

export interface GetSessionArgs {
  session_id: string;
}

export interface GenerateDashboardReplyArgs {
  project_id: string;
  thread_id: string;
  thread_title?: string;
  body_markdown: string;
  mode?: "reply" | "compact_thread";
}

export interface StartListenArgs {
  connection_key: string;
  display_name?: string;
  role?: McpConnectionRole;
  project_id?: string;
  project_ids?: string[];
  active_project_ids?: string[];
  transport?: string;
  capabilities?: McpConnectionCapabilities;
  max_messages?: number;
}

export interface ListenArgs {
  connection_key: string;
  display_name?: string;
  role?: McpConnectionRole;
  project_id?: string;
  project_ids?: string[];
  active_project_ids?: string[];
  transport?: string;
  capabilities?: McpConnectionCapabilities;
  include_task_dispatch?: boolean;
  include_attention_items?: boolean;
  timeout_seconds?: number;
  poll_interval_ms?: number;
}

export interface PullInboxArgs {
  connection_key: string;
  project_id?: string;
  max_messages?: number;
}

export interface PostListenReplyArgs {
  connection_key: string;
  thread_id: string;
  body_markdown: string;
  reply_to_message_id?: string;
  metadata?: Record<string, unknown> | null;
}

export interface McpToolArgsByName {
  get_session: GetSessionArgs;
  generate_dashboard_reply: GenerateDashboardReplyArgs;
  listen: ListenArgs;
  start_listen: StartListenArgs;
  pull_inbox: PullInboxArgs;
  post_listen_reply: PostListenReplyArgs;
  manage_code_ux: ManageCodeUxArgs;
  manage_projects: ManageProjectsArgs;
  manage_sprints: ManageSprintsArgs;
  manage_tasks: ManageTasksArgs;
  manage_agents: ManageAgentsArgs;
  manage_memory: ManageMemoryArgs;
  manage_settings: ManageSettingsArgs;
  manage_preview: ManagePreviewArgs;
  manage_telemetry: ManageTelemetryArgs;
}

export type McpToolName = keyof McpToolArgsByName;

type Assert<T extends true> = T;
type _RegistryMatchesContractTools = Assert<
  Exclude<ContractToolName, McpToolName> extends never
    ? Exclude<McpToolName, ContractToolName> extends never
      ? true
      : false
    : false
>;

import { type ToolHandlerMap, dispatchTool } from "../../contracts/mcp-tool-definitions.js";

export type ToolHandler<TArgs, TResult = unknown> = (args: TArgs) => Promise<TResult> | TResult;

type ToolKey<T> = Extract<keyof T, string>;

export interface McpToolResponse {
  [key: string]: unknown;
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}

export class ToolRegistry<ToolArgsByName extends object, TResult = unknown> {
  private readonly handlers: ToolHandlerMap<ToolArgsByName> = {};

  register<K extends ToolKey<ToolArgsByName>>(
    name: K,
    handler: ToolHandler<ToolArgsByName[K], TResult>,
  ): this {
    this.handlers[name] = handler as ToolHandlerMap<ToolArgsByName>[K];
    return this;
  }

  has(name: string): name is ToolKey<ToolArgsByName> {
    return name in this.handlers;
  }

  async dispatch<K extends ToolKey<ToolArgsByName>>(name: K, args: ToolArgsByName[K]): Promise<TResult>;
  async dispatch(name: string, args: unknown): Promise<TResult>;
  async dispatch(name: string, args: unknown): Promise<TResult> {
    return await dispatchTool<ToolArgsByName, Extract<keyof ToolArgsByName, string>>(
      name,
      args,
      this.handlers
    ) as TResult;
  }
}
