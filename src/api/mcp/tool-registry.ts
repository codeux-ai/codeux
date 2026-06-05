import type { ToolName as ContractToolName } from "../../contracts/mcp-tool-definitions.js";
import type { ManageCodeUxArgs, ManageProjectsArgs, ManageSprintsArgs, ManageTasksArgs, ManageAgentsArgs, ManageMemoryArgs, ManageSettingsArgs, ManagePreviewArgs, ManageTelemetryArgs, SearchKnowledgeArgs } from "../../contracts/internal-management-types.js";

export interface McpToolArgsByName {
  manage_code_ux: ManageCodeUxArgs;
  manage_projects: ManageProjectsArgs;
  manage_sprints: ManageSprintsArgs;
  manage_tasks: ManageTasksArgs;
  manage_agents: ManageAgentsArgs;
  manage_memory: ManageMemoryArgs;
  manage_settings: ManageSettingsArgs;
  manage_preview: ManagePreviewArgs;
  manage_telemetry: ManageTelemetryArgs;
  search_knowledge: SearchKnowledgeArgs;
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
