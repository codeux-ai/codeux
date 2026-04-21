import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import axios from "axios";
import type { AxiosError } from "axios";
import { registerMcpRequestHandlers } from "./mcp-request-router.js";
import { SPRINT_OS_SERVICE_NAME } from "../shared/config/sprint-os-paths.js";
import { generateCorrelationId, runWithCorrelationId } from "../shared/logging/correlation-id.js";
import type { Logger } from "../shared/logging/logger.js";
import type { CoreToolHandler } from "../mcp/core-tool-handler.js";
import type { AgentToolHandler } from "../mcp/agent-tool-handler.js";
import type { ManagementToolHandler } from "../mcp/management-tool-handler.js";
import type { DashboardSettings } from "../contracts/app-types.js";

export interface McpServerConfigurerOptions {
  coreToolHandler: CoreToolHandler;
  agentToolHandler: AgentToolHandler;
  managementToolHandler: ManagementToolHandler;
  getDashboardSettings: () => DashboardSettings;
  logger: Logger;
}

export class McpServerConfigurer {
  constructor(private readonly options: McpServerConfigurerOptions) {}

  configure(server: Server, runtimeRole: "project_manager"): void {
    registerMcpRequestHandlers({
      server,
      coreToolHandler: this.options.coreToolHandler,
      agentToolHandler: this.options.agentToolHandler,
      managementToolHandler: this.options.managementToolHandler,
      getDashboardSettings: this.options.getDashboardSettings,
      getRuntimeRole: () => runtimeRole,
      formatError: (error: unknown) => this.formatError(error),
      logger: this.options.logger.child({ component: "mcp-request-router", runtimeRole }),
      withCorrelationContext: (request, operation) => this.runWithMcpCorrelationContext(request, operation),
    });

    server.onerror = (error) => {
      this.options.logger.error("MCP server error", { error, runtimeRole });
    };
  }

  createInstance(runtimeRole: "project_manager"): Server {
    const server = new Server(
      {
        name: SPRINT_OS_SERVICE_NAME,
        version: "1.2.0",
      },
      {
        capabilities: {
          tools: {},
          resources: {},
          prompts: {},
        },
      },
    );
    this.configure(server, runtimeRole);
    return server;
  }

  private runWithMcpCorrelationContext<T>(request: unknown, operation: () => Promise<T>): Promise<T> {
    const correlationId = this.extractMcpCorrelationId(request) ?? generateCorrelationId();
    return runWithCorrelationId(correlationId, operation);
  }

  private extractMcpCorrelationId(request: unknown): string | undefined {
    const requestRecord = request as { id?: unknown; params?: Record<string, unknown> };
    const params = requestRecord.params && typeof requestRecord.params === "object"
      ? requestRecord.params
      : undefined;
    const meta = params?._meta && typeof params._meta === "object"
      ? (params._meta as Record<string, unknown>)
      : undefined;
    const argumentsRecord = params?.arguments && typeof params.arguments === "object"
      ? (params.arguments as Record<string, unknown>)
      : undefined;

    const candidates: unknown[] = [
      meta?.correlationId,
      meta?.["x-correlation-id"],
      meta?.requestId,
      argumentsRecord?.correlationId,
      requestRecord.id,
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string") {
        const trimmed = candidate.trim();
        if (trimmed.length > 0) {
          return trimmed;
        }
      }
      if (typeof candidate === "number" && Number.isFinite(candidate)) {
        return `mcp-${candidate}`;
      }
    }

    return undefined;
  }

  public formatError(error: unknown): { content: Array<{ type: string; text: string }>; isError: true } {
    const maybeError = error as { message?: string };
    let message = maybeError?.message || "An unknown error occurred";
    if (axios.isAxiosError(error)) {
      const axiosError = error as AxiosError<{ error?: { message?: string } }>;
      message = axiosError.response?.data?.error?.message || axiosError.message;
    }
    return {
      content: [{ type: "text", text: `Error: ${message}` }],
      isError: true,
    };
  }
}
