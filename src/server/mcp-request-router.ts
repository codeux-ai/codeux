import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, ListResourcesRequestSchema, ListPromptsRequestSchema, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { McpToolArgsByName, McpToolResponse } from "../api/mcp/tool-registry.js";
import { ToolRegistry } from "../api/mcp/tool-registry.js";
import type { DashboardSettings, McpToolToggle } from "../contracts/app-types.js";
import { validateToolArguments } from "../api/mcp/validators/tool-validators.js";
import type { ManagementToolHandler } from "../mcp/management-tool-handler.js";
import { getEnabledToolDefinitions, isToolEnabled } from "../mcp/mcp-tool-availability.js";
import { getCurrentMcpAgentId } from "./mcp-agent-context.js";
import type { Logger } from "../shared/logging/logger.js";
import type { McpRuntimeRole } from "../contracts/mcp-tool-definitions.js";
import { getCorrelationId } from "../shared/logging/correlation-id.js";
import type { ManagementErrorKind } from "../mcp/management/payload-parsers.js";
import { sanitizeManagementErrorMessage } from "../mcp/management/payload-parsers.js";

export interface McpRequestRouterArgs {
  server: Server;
  managementToolHandler: ManagementToolHandler;
  getDashboardSettings: () => DashboardSettings;
  getRuntimeRole: () => McpRuntimeRole;
  /** Resolve per-agent code_ux tool toggles for the agent advertised on the current request, if any. */
  resolveAgentMcpToolToggles?: (agentId: string) => McpToolToggle[] | null;
  formatError: (error: unknown) => { content: Array<{ type: string; text: string }>; isError: true };
  logger?: Logger;
  withCorrelationContext?: <T>(request: unknown, operation: () => Promise<T>) => Promise<T>;
  getMcpApprovalTracker?: () => import("../services/mcp-approval-tracker.js").McpApprovalTracker;
}

const TOOL_ERROR_CONTEXT: Record<string, { domain: string; defaultAction: string }> = {
  manage_code_ux: { domain: "system", defaultAction: "unknown" },
  manage_projects: { domain: "projects", defaultAction: "unknown" },
  manage_sprints: { domain: "sprints", defaultAction: "unknown" },
  manage_tasks: { domain: "tasks", defaultAction: "unknown" },
  manage_quicksprints: { domain: "quicksprints", defaultAction: "unknown" },
  manage_scheduler: { domain: "scheduler", defaultAction: "unknown" },
  manage_agents: { domain: "agents", defaultAction: "unknown" },
  manage_memory: { domain: "memory", defaultAction: "unknown" },
  manage_settings: { domain: "settings", defaultAction: "unknown" },
  manage_preview: { domain: "preview", defaultAction: "unknown" },
  manage_telemetry: { domain: "telemetry", defaultAction: "unknown" },
  search_knowledge: { domain: "knowledge", defaultAction: "search" },
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readActionForEnvelope = (
  toolName: string,
  toolArgs: unknown,
  defaultAction: string,
): string => {
  if (toolName === "manage_code_ux" && isRecord(toolArgs)) {
    const domain = typeof toolArgs.domain === "string" && toolArgs.domain.trim() ? toolArgs.domain.trim() : null;
    if (domain) {
      return typeof toolArgs.action === "string" && toolArgs.action.trim() ? toolArgs.action.trim() : defaultAction;
    }
  }
  if (isRecord(toolArgs) && typeof toolArgs.action === "string" && toolArgs.action.trim()) {
    return toolArgs.action.trim();
  }
  return defaultAction;
};

const readDomainForEnvelope = (toolName: string, toolArgs: unknown, defaultDomain: string): string => {
  if (toolName === "manage_code_ux" && isRecord(toolArgs) && typeof toolArgs.domain === "string" && toolArgs.domain.trim()) {
    return toolArgs.domain.trim();
  }
  return defaultDomain;
};

const readErrorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

const isInvalidParamsError = (error: unknown): boolean =>
  error instanceof McpError && error.code === ErrorCode.InvalidParams;

const formatToolErrorEnvelope = (
  toolName: string,
  toolArgs: unknown,
  error: unknown,
): { content: Array<{ type: string; text: string }>; isError: true } | null => {
  const context = TOOL_ERROR_CONTEXT[toolName];
  if (!context) {
    return null;
  }

  const errorType: ManagementErrorKind = isInvalidParamsError(error) ? "validation" : "runtime";
  const envelope = {
    result: {
      status: "error",
      domain: readDomainForEnvelope(toolName, toolArgs, context.domain),
      action: readActionForEnvelope(toolName, toolArgs, context.defaultAction),
      message: sanitizeManagementErrorMessage(readErrorMessage(error)),
      errorType,
    },
  };

  return {
    content: [{ type: "text", text: JSON.stringify(envelope, null, 2) }],
    isError: true,
  };
};

export const registerMcpRequestHandlers = (args: McpRequestRouterArgs): void => {
  const logger = args.logger;
  const toolRegistry = new ToolRegistry<McpToolArgsByName, McpToolResponse>()
    .register("manage_code_ux", async (input) => (await args.managementToolHandler.handleManageCodeUx(input)) as McpToolResponse)
    .register("manage_projects", async (input) => (await args.managementToolHandler.handleManageProjects(input)) as McpToolResponse)
    .register("manage_sprints", async (input) => (await args.managementToolHandler.handleManageSprints(input)) as McpToolResponse)
    .register("manage_tasks", async (input) => (await args.managementToolHandler.handleManageTasks(input)) as McpToolResponse)
    .register("manage_quicksprints", async (input) => (await args.managementToolHandler.handleManageQuicksprints(input)) as McpToolResponse)
    .register("manage_scheduler", async (input) => (await args.managementToolHandler.handleManageScheduler(input)) as McpToolResponse)
    .register("manage_agents", async (input) => (await args.managementToolHandler.handleManageAgents(input)) as McpToolResponse)
    .register("manage_memory", async (input) => (await args.managementToolHandler.handleManageMemory(input)) as McpToolResponse)
    .register("manage_settings", async (input) => (await args.managementToolHandler.handleManageSettings(input)) as McpToolResponse)
    .register("manage_preview", async (input) => (await args.managementToolHandler.handleManagePreview(input)) as McpToolResponse)
    .register("manage_telemetry", async (input) => (await args.managementToolHandler.handleManageTelemetry(input)) as McpToolResponse)
    .register("search_knowledge", async (input) => (await args.managementToolHandler.handleSearchKnowledge(input)) as McpToolResponse);

  const resolveAgentToggles = (): McpToolToggle[] | null => {
    const agentId = getCurrentMcpAgentId();
    if (!agentId || !args.resolveAgentMcpToolToggles) {
      return null;
    }
    return args.resolveAgentMcpToolToggles(agentId);
  };

  args.server.setRequestHandler(ListToolsRequestSchema, async () => {
    logger?.debug("MCP list_tools request received");
    return {
      tools: getEnabledToolDefinitions(args.getDashboardSettings(), args.getRuntimeRole(), resolveAgentToggles()),
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

      if (!isToolEnabled(args.getDashboardSettings(), name, args.getRuntimeRole(), resolveAgentToggles())) {
        logger?.warn("MCP tool request rejected because tool is disabled", { toolName: name });
        throw new McpError(ErrorCode.MethodNotFound, `Tool not found: ${name}`);
      }

      try {
        validateToolArguments(name, toolArgs);

        const response = await toolRegistry.dispatch(name, toolArgs);

        if (name === "manage_code_ux" && Array.isArray(response.content) && response.content[0]?.type === "text") {
          try {
            const parsed = JSON.parse(response.content[0].text);
            if (parsed && parsed.approvalRequired) {
              const req = request as { id?: string | number };
              const correlationId = getCorrelationId() ?? String(req.id || Date.now());
              args.getMcpApprovalTracker?.()?.setPending(correlationId, {
                action: toolArgs as any,
                approvalMessage: parsed.approvalMessage || "Action requires approval",
                proposedAt: new Date().toISOString()
              });
            }
          } catch (e) {
            // ignore parsing errors for tracking
          }
        }

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
        return formatToolErrorEnvelope(name, toolArgs, error) ?? args.formatError(error);
      }
    };

    if (args.withCorrelationContext) {
      return await args.withCorrelationContext(request, execute);
    }
    return await execute();
  });
};
