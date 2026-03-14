import type { ToolName as ContractToolName } from "../../contracts/mcp-tool-definitions.js";
import type { McpConnectionCapabilities, McpConnectionRole } from "../../contracts/connection-chat-types.js";
import type { TaskRunState } from "../../contracts/execution-types.js";
import type { WorkerAttentionOutcome } from "../../contracts/project-attention-types.js";

export interface GetSessionArgs {
  session_id: string;
}

export interface ExecuteWorkerDispatchArgs {
  dispatch_id: string;
}

export interface CancelLocalDispatchArgs {
  dispatch_id: string;
  reason?: string;
}

export interface GenerateDashboardReplyArgs {
  project_id: string;
  thread_id: string;
  thread_title?: string;
  body_markdown: string;
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
}

export interface PullTaskDispatchArgs {
  connection_key: string;
  project_id?: string;
  sprint_id?: string;
}

export interface UpdateTaskDispatchArgs {
  connection_key: string;
  dispatch_id: string;
  lease_token: string;
  state: Extract<TaskRunState, "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED">;
  provider?: string;
  session_id?: string;
  session_name?: string;
  worker_branch?: string;
  pr_url?: string;
  summary_markdown?: string;
  error_message?: string;
}

export interface ClaimAttentionItemArgs {
  connection_key: string;
  attention_item_id: string;
  claim_reason?: string;
}

export interface ResolveAttentionItemArgs {
  connection_key: string;
  attention_item_id: string;
  resolution_status?: "resolved" | "dismissed";
  resolution_reason?: string;
  resolution_summary_markdown?: string;
}

export interface ReportAttentionOutcomeArgs {
  connection_key: string;
  attention_item_id: string;
  outcome: WorkerAttentionOutcome;
  summary_markdown: string;
  resolution_reason?: string;
  thread_title?: string;
}

export interface McpToolArgsByName {
  get_session: GetSessionArgs;
  execute_worker_dispatch: ExecuteWorkerDispatchArgs;
  cancel_local_dispatch: CancelLocalDispatchArgs;
  generate_dashboard_reply: GenerateDashboardReplyArgs;
  listen: ListenArgs;
  start_listen: StartListenArgs;
  pull_inbox: PullInboxArgs;
  post_listen_reply: PostListenReplyArgs;
  pull_task_dispatch: PullTaskDispatchArgs;
  update_task_dispatch: UpdateTaskDispatchArgs;
  claim_attention_item: ClaimAttentionItemArgs;
  resolve_attention_item: ResolveAttentionItemArgs;
  report_attention_outcome: ReportAttentionOutcomeArgs;
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
