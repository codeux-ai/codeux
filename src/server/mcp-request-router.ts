import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, ListResourcesRequestSchema, ListPromptsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { McpToolArgsByName, McpToolResponse } from "../api/mcp/tool-registry.js";
import { ToolRegistry } from "../api/mcp/tool-registry.js";
import type { DashboardSettings } from "../contracts/app-types.js";
import type { AgentToolHandler } from "../mcp/agent-tool-handler.js";
import { validateToolArguments } from "../api/mcp/validators/tool-validators.js";
import type { CoreToolHandler } from "../mcp/core-tool-handler.js";
import { getEnabledToolDefinitions, isToolEnabled } from "../mcp/mcp-tool-availability.js";
import type { SprintAgentArgs } from "../sprint/sprint-orchestrator.js";
import type { Logger } from "../shared/logging/logger.js";
import type { McpRuntimeRole } from "../contracts/mcp-tool-definitions.js";

export interface McpRequestRouterArgs {
  server: Server;
  coreToolHandler: CoreToolHandler;
  agentToolHandler: AgentToolHandler;
  getDashboardSettings: () => DashboardSettings;
  getRuntimeRole: () => McpRuntimeRole;
  formatError: (error: unknown) => { content: Array<{ type: string; text: string }>; isError: true };
  logger?: Logger;
  withCorrelationContext?: <T>(request: unknown, operation: () => Promise<T>) => Promise<T>;
}

export const registerMcpRequestHandlers = (args: McpRequestRouterArgs): void => {
  const logger = args.logger;
  const toolRegistry = new ToolRegistry<McpToolArgsByName, McpToolResponse>()
    .register("get_source", (input) => args.coreToolHandler.handleGetSource(input))
    .register("list_sources", (input) => args.coreToolHandler.handleListSources(input))
    .register("list_all_sources", (input) => args.coreToolHandler.handleListAllSources(input))
    .register("create_session", (input) => args.coreToolHandler.handleCreateSession(input))
    .register("get_session", (input) => args.coreToolHandler.handleGetSession(input))
    .register("list_sessions", (input) => args.coreToolHandler.handleListSessions(input))
    .register("approve_session_plan", (input) => args.coreToolHandler.handleApproveSessionPlan(input))
    .register("send_session_message", (input) => args.coreToolHandler.handleSendSessionMessage(input))
    .register("wait_for_session_completion", async (input) => (await args.coreToolHandler.handleWaitForSessionCompletion(input)) as McpToolResponse)
    .register("get_activity", (input) => args.coreToolHandler.handleGetActivity(input))
    .register("list_activities", (input) => args.coreToolHandler.handleListActivities(input))
    .register("list_all_activities", (input) => args.coreToolHandler.handleListAllActivities(input))
    .register("listen", (input) => args.coreToolHandler.handleListen(input))
    .register("start_listen", (input) => args.coreToolHandler.handleStartListen(input))
    .register("pull_inbox", (input) => args.coreToolHandler.handlePullInbox(input))
    .register("post_listen_reply", (input) => args.coreToolHandler.handlePostListenReply(input))
    .register("pull_task_dispatch", (input) => args.coreToolHandler.handlePullTaskDispatch(input))
    .register("update_task_dispatch", (input) => args.coreToolHandler.handleUpdateTaskDispatch(input))
    .register("sprint_agent", async (input) => (await args.agentToolHandler.handleSprintAgent(input)) as McpToolResponse)
    .register("task_agent", async (input) => (await args.agentToolHandler.handleTaskAgent(input)) as McpToolResponse)
    .register("execute_worker_dispatch", async (input) => (await args.agentToolHandler.handleExecuteWorkerDispatch(input)) as McpToolResponse)
    .register("cancel_local_dispatch", async (input) => (await args.agentToolHandler.handleCancelLocalDispatch(input)) as McpToolResponse)
    .register("generate_dashboard_reply", async (input) => (await args.agentToolHandler.handleGenerateDashboardReply(input)) as McpToolResponse);

  args.server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger?.debug("MCP list_tools request received");
    return {
      tools: getEnabledToolDefinitions(args.getDashboardSettings(), args.getRuntimeRole()),
    };
  });

  args.server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return { resources: [] };
  });

  args.server.setRequestHandler(ListPromptsRequestSchema, async () => {
    return { prompts: [] };
  });

  args.server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const execute = async () => {
      const { name, arguments: toolArgs } = request.params;
      logger?.debug("MCP tool request received", { toolName: name });

      if (!isToolEnabled(args.getDashboardSettings(), name, args.getRuntimeRole())) {
        logger?.warn("MCP tool request rejected because tool is disabled", { toolName: name });
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
      }

      try {
        validateToolArguments(name, toolArgs);

        const response = await toolRegistry.dispatch(name, toolArgs);
        logger?.info("MCP tool request succeeded", { toolName: name });
        return response;
      } catch (error: unknown) {
        logger?.error("MCP tool request failed", {
          toolName: name,
          error,
        });

        if (error instanceof Error && error.message.startsWith("Tool not found:")) {
          throw new McpError(ErrorCode.MethodNotFound, error.message);
        }
        return args.formatError(error);
      }
    };

    if (args.withCorrelationContext) {
      return await args.withCorrelationContext(request, execute);
    }
    return await execute();
  });
};
