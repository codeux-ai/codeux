import type { ToolName as ContractToolName } from "../../contracts/mcp-tool-definitions.js";
import type { SprintAgentArgs } from "../../sprint/sprint-types.js";

export interface GetSourceArgs {
  source_id: string;
}

export interface ListSourcesArgs {
  filter?: string;
  page_size?: number;
  page_token?: string;
}

export interface ListAllSourcesArgs {
  filter?: string;
}

export interface CreateSessionArgs {
  prompt: string;
  source: string;
  starting_branch?: string;
  title?: string;
  require_plan_approval?: boolean;
  automation_mode?: "AUTO_CREATE_PR";
}

export interface GetSessionArgs {
  session_id: string;
}

export interface ListSessionsArgs {
  page_size?: number;
  page_token?: string;
}

export interface ApproveSessionPlanArgs {
  session_id: string;
}

export interface SendSessionMessageArgs {
  session_id: string;
  prompt: string;
}

export interface WaitForSessionCompletionArgs {
  session_id: string;
  poll_interval?: number;
  timeout?: number;
}

export interface GetActivityArgs {
  session_id: string;
  activity_id: string;
}

export interface ListActivitiesArgs {
  session_id: string;
  page_size?: number;
  page_token?: string;
}

export interface ListAllActivitiesArgs {
  session_id: string;
}

export interface TaskAgentArgs {
  prompt: string;
  source_id?: string;
  title?: string;
  branch?: string;
  wait?: boolean;
}

export interface McpToolArgsByName {
  get_source: GetSourceArgs;
  list_sources: ListSourcesArgs;
  list_all_sources: ListAllSourcesArgs;
  create_session: CreateSessionArgs;
  get_session: GetSessionArgs;
  list_sessions: ListSessionsArgs;
  approve_session_plan: ApproveSessionPlanArgs;
  send_session_message: SendSessionMessageArgs;
  wait_for_session_completion: WaitForSessionCompletionArgs;
  get_activity: GetActivityArgs;
  list_activities: ListActivitiesArgs;
  list_all_activities: ListAllActivitiesArgs;
  sprint_agent: SprintAgentArgs;
  task_agent: TaskAgentArgs;
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
