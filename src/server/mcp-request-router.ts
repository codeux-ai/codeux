import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import { dispatchTool } from "../contracts/mcp-tool-definitions.js";
import type { AgentToolHandler } from "../mcp/agent-tool-handler.js";
import type { CoreToolHandler } from "../mcp/core-tool-handler.js";
import { getEnabledToolDefinitions, isToolEnabled } from "../mcp/mcp-tool-availability.js";
import type { SprintAgentArgs } from "../sprint/sprint-orchestrator.js";
import { createNoopLogger, type Logger } from "../shared/logging/logger.js";

export interface McpRequestRouterArgs {
  server: Server;
  coreToolHandler: CoreToolHandler;
  agentToolHandler: AgentToolHandler;
  getDashboardSettings: () => DashboardSettings;
  formatError: (error: unknown) => { content: Array<{ type: string; text: string }>; isError: true };
  logger?: Logger;
  withCorrelationContext?: <T>(request: unknown, operation: () => Promise<T>) => Promise<T>;
}

export const registerMcpRequestHandlers = (args: McpRequestRouterArgs): void => {
  const logger = args.logger ?? createNoopLogger();
  const runWithCorrelationContext = args.withCorrelationContext ?? (async <T>(request: unknown, operation: () => Promise<T>) => {
    void request;
    return await operation();
  });

  args.server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getEnabledToolDefinitions(args.getDashboardSettings()) as any,
  }));

  args.server.setRequestHandler(CallToolRequestSchema, async (request) =>
    runWithCorrelationContext(request, async () => {
      const { name, arguments: toolArgs } = request.params;
      logger.debug("MCP tool call received", { toolName: name });

      if (!isToolEnabled(args.getDashboardSettings(), name)) {
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
      }

      const handlers = {
        get_source: (input: { source_id: string }) => args.coreToolHandler.handleGetSource(input),
        list_sources: (input: { filter?: string; page_size?: number; page_token?: string }) => args.coreToolHandler.handleListSources(input),
        list_all_sources: (input: { filter?: string }) => args.coreToolHandler.handleListAllSources(input),
        create_session: (input: any) => args.coreToolHandler.handleCreateSession(input),
        get_session: (input: { session_id: string }) => args.coreToolHandler.handleGetSession(input),
        list_sessions: (input: { page_size?: number; page_token?: string }) => args.coreToolHandler.handleListSessions(input),
        approve_session_plan: (input: { session_id: string }) => args.coreToolHandler.handleApproveSessionPlan(input),
        send_session_message: (input: { session_id: string; prompt: string }) => args.coreToolHandler.handleSendSessionMessage(input),
        wait_for_session_completion: (input: { session_id: string; poll_interval?: number; timeout?: number }) =>
          args.coreToolHandler.handleWaitForSessionCompletion(input),
        get_activity: (input: { session_id: string; activity_id: string }) => args.coreToolHandler.handleGetActivity(input),
        list_activities: (input: { session_id: string; page_size?: number; page_token?: string }) => args.coreToolHandler.handleListActivities(input),
        list_all_activities: (input: { session_id: string }) => args.coreToolHandler.handleListAllActivities(input),
        sprint_agent: (input: SprintAgentArgs) => args.agentToolHandler.handleSprintAgent(input),
        task_agent: (input: any) => args.agentToolHandler.handleTaskAgent(input),
      };

      try {
        const result = await dispatchTool(name, toolArgs, handlers);
        logger.debug("MCP tool call completed", { toolName: name });
        return result;
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith("Tool not found:")) {
          throw new McpError(ErrorCode.MethodNotFound, error.message);
        }
        const message = error instanceof Error ? error.message : String(error);
        logger.warn("MCP tool call failed", {
          toolName: name,
          error: message,
        });
        return args.formatError(error);
      }
    })
  );
};
