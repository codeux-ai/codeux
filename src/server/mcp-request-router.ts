import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { McpToolRegistry, type McpToolHandlerMap } from "../api/mcp/tool-registry.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { AgentToolHandler } from "../mcp/agent-tool-handler.js";
import type { CoreToolHandler } from "../mcp/core-tool-handler.js";
import { getEnabledToolDefinitions, isToolEnabled } from "../mcp/mcp-tool-availability.js";

export interface McpRequestRouterArgs {
  server: Server;
  coreToolHandler: CoreToolHandler;
  agentToolHandler: AgentToolHandler;
  getDashboardSettings: () => DashboardSettings;
  formatError: (error: unknown) => CallToolResult;
}

export const registerMcpRequestHandlers = (args: McpRequestRouterArgs): void => {
  const registry = new McpToolRegistry();
  const handlers: McpToolHandlerMap = {
    get_source: (input) => args.coreToolHandler.handleGetSource(input),
    list_sources: (input) => args.coreToolHandler.handleListSources(input),
    list_all_sources: (input) => args.coreToolHandler.handleListAllSources(input),
    create_session: (input) => args.coreToolHandler.handleCreateSession(input),
    get_session: (input) => args.coreToolHandler.handleGetSession(input),
    list_sessions: (input) => args.coreToolHandler.handleListSessions(input),
    approve_session_plan: (input) => args.coreToolHandler.handleApproveSessionPlan(input),
    send_session_message: (input) => args.coreToolHandler.handleSendSessionMessage(input),
    wait_for_session_completion: (input) => args.coreToolHandler.handleWaitForSessionCompletion(input),
    get_activity: (input) => args.coreToolHandler.handleGetActivity(input),
    list_activities: (input) => args.coreToolHandler.handleListActivities(input),
    list_all_activities: (input) => args.coreToolHandler.handleListAllActivities(input),
    sprint_agent: (input) => args.agentToolHandler.handleSprintAgent(input),
    task_agent: (input) => args.agentToolHandler.handleTaskAgent(input),
  };
  registry.registerMany(handlers);

  args.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getEnabledToolDefinitions(args.getDashboardSettings()) as any,
  }));

  args.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: toolArgs } = request.params;
    if (!isToolEnabled(args.getDashboardSettings(), name)) {
      throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
    }

    try {
      return (await registry.dispatch(name, toolArgs)) as CallToolResult;
    } catch (error: unknown) {
      if (error instanceof Error && error.message.startsWith("Tool not found:")) {
        throw new McpError(ErrorCode.MethodNotFound, error.message);
      }
      return args.formatError(error);
    }
  });
};
