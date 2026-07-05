import { describe, expect, it, vi } from "vitest";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { registerMcpRequestHandlers } from "../../../src/server/mcp-request-router.js";
import type { McpRequestRouterArgs } from "../../../src/server/mcp-request-router.js";
import type { ManagementToolHandler } from "../../../src/mcp/management-tool-handler.js";
import type { Logger, LogMetadata } from "../../../src/shared/logging/logger.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";
import { McpApprovalTracker } from "../../../src/services/mcp-approval-tracker.js";
import { runWithCorrelationId } from "../../../src/shared/logging/correlation-id.js";

type ToolCallHandler = (request: {
  id?: string | number;
  params: {
    name: string;
    arguments?: unknown;
    _meta?: Record<string, unknown>;
  };
}) => Promise<unknown>;

interface CapturedLog {
  message: string;
  metadata?: LogMetadata;
}

const createLogger = () => {
  const logs: Record<"debug" | "info" | "warn" | "error", CapturedLog[]> = {
    debug: [],
    info: [],
    warn: [],
    error: [],
  };
  const logger: Logger = {
    debug: vi.fn((message: string, metadata?: LogMetadata) => logs.debug.push({ message, metadata })),
    info: vi.fn((message: string, metadata?: LogMetadata) => logs.info.push({ message, metadata })),
    warn: vi.fn((message: string, metadata?: LogMetadata) => logs.warn.push({ message, metadata })),
    error: vi.fn((message: string, metadata?: LogMetadata) => logs.error.push({ message, metadata })),
    child: vi.fn(() => logger),
  };
  return { logger, logs };
};

const createManagementToolHandler = (): ManagementToolHandler => ({
  handleManageCodeUx: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageProjects: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageSprints: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageTasks: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageQuicksprints: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageScheduler: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageAgents: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageMemory: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageSettings: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManagePreview: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleManageTelemetry: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
  handleSearchKnowledge: vi.fn(async () => ({ content: [{ type: "text", text: JSON.stringify({ ok: true }) }] })),
} as unknown as ManagementToolHandler);

const createCallToolHarness = (overrides: Partial<McpRequestRouterArgs> = {}) => {
  const handlers: ToolCallHandler[] = [];
  const server = {
    setRequestHandler: (_schema: unknown, handler: ToolCallHandler) => {
      handlers.push(handler);
    },
  };
  const { logger, logs } = createLogger();
  const managementToolHandler = createManagementToolHandler();

  registerMcpRequestHandlers({
    server: server as unknown as Server,
    managementToolHandler,
    getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    getRuntimeRole: () => "project_manager",
    formatError: (error: unknown) => ({
      content: [{ type: "text", text: `Error: ${error instanceof Error ? error.message : "Internal Server Error"}` }],
      isError: true,
    }),
    logger,
    ...overrides,
  });

  const callTool = handlers[3];
  if (!callTool) {
    throw new Error("MCP call_tool handler was not registered");
  }

  return { callTool, logger, logs, managementToolHandler };
};

const expectMcpErrorCode = async (operation: Promise<unknown>, code: ErrorCode): Promise<McpError> => {
  try {
    await operation;
    throw new Error("Expected MCP handler to throw");
  } catch (error) {
    expect(error).toBeInstanceOf(McpError);
    expect((error as McpError).code).toBe(code);
    return error as McpError;
  }
};

describe("mcp-request-router validation", () => {
  it("rejects disabled tools with MethodNotFound and logs only tool metadata", async () => {
    const settings = {
      ...DEFAULT_DASHBOARD_SETTINGS,
      mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => (
        tool.name === "manage_tasks" ? { ...tool, enabled: false } : { ...tool }
      )),
    };
    const { callTool, logs } = createCallToolHarness({
      getDashboardSettings: () => settings,
    });

    const error = await expectMcpErrorCode(
      callTool({
        params: {
          name: "manage_tasks",
          arguments: { action: "list", apiKey: "raw-secret-value" },
        },
      }),
      ErrorCode.MethodNotFound,
    );

    expect(error.message).toContain("Tool not found: manage_tasks");
    expect(logs.warn.at(-1)?.metadata).toEqual({ toolName: "manage_tasks" });
    expect(JSON.stringify(logs.warn)).not.toContain("raw-secret-value");
  });

  it("rejects unknown tools with MethodNotFound and logs only tool metadata", async () => {
    const { callTool, logs } = createCallToolHarness();

    const error = await expectMcpErrorCode(
      callTool({
        params: {
          name: "unknown_tool",
          arguments: { token: "raw-secret-value" },
        },
      }),
      ErrorCode.MethodNotFound,
    );

    expect(error.message).toContain("Tool not found: unknown_tool");
    expect(logs.warn.at(-1)?.metadata).toEqual({ toolName: "unknown_tool" });
    expect(JSON.stringify(logs.warn)).not.toContain("raw-secret-value");
  });

  it("rejects invalid arguments with InvalidParams and sanitized failure metadata", async () => {
    const { callTool, logs, managementToolHandler } = createCallToolHarness();

    const error = await expectMcpErrorCode(
      callTool({
        params: {
          name: "manage_projects",
          arguments: { action: "destroy", apiKey: "raw-secret-value" },
        },
      }),
      ErrorCode.InvalidParams,
    );

    expect(error.message).toContain("Invalid arguments for tool manage_projects");
    expect(managementToolHandler.handleManageProjects).not.toHaveBeenCalled();
    expect(logs.error.at(-1)?.metadata).toMatchObject({
      toolName: "manage_projects",
      errorName: "McpError",
      errorCode: ErrorCode.InvalidParams,
    });
    expect(JSON.stringify(logs.error)).not.toContain("raw-secret-value");
    expect(JSON.stringify(logs.error)).not.toContain("destroy");
  });

  it("tracks approval-required management responses under the active correlation ID", async () => {
    const tracker = new McpApprovalTracker();
    const { callTool, managementToolHandler } = createCallToolHarness({
      getMcpApprovalTracker: () => tracker,
    });
    vi.mocked(managementToolHandler.handleManageCodeUx).mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          approvalRequired: true,
          approvalMessage: "Deletion requires approval.",
        }),
      }],
    });
    const action = { domain: "projects", action: "delete_project", payload: { projectId: "p1" } };

    await runWithCorrelationId("corr-active", () => callTool({
      params: {
        name: "manage_code_ux",
        arguments: action,
      },
    }));

    expect(tracker.takePending("corr-active")).toMatchObject({
      action,
      approvalMessage: "Deletion requires approval.",
    });
  });

  it("generates an approval correlation ID when request metadata is missing", async () => {
    const tracker = new McpApprovalTracker();
    const setPendingSpy = vi.spyOn(tracker, "setPending");
    const { callTool, managementToolHandler } = createCallToolHarness({
      getMcpApprovalTracker: () => tracker,
    });
    vi.mocked(managementToolHandler.handleManageCodeUx).mockResolvedValueOnce({
      content: [{
        type: "text",
        text: JSON.stringify({
          approvalRequired: true,
          approvalMessage: "Reset requires approval.",
        }),
      }],
    });
    const action = { domain: "settings", action: "reset_defaults", payload: {} };

    await callTool({
      params: {
        name: "manage_code_ux",
        arguments: action,
      },
    });

    expect(setPendingSpy).toHaveBeenCalledTimes(1);
    const [generatedCorrelationId] = setPendingSpy.mock.calls[0]!;
    expect(generatedCorrelationId).toEqual(expect.any(String));
    expect(generatedCorrelationId).not.toBe("");
    expect(generatedCorrelationId).not.toBe("undefined");
    expect(tracker.takePending(generatedCorrelationId)).toMatchObject({
      action,
      approvalMessage: "Reset requires approval.",
    });
  });

  it("returns a safe error response with correlation ID for unexpected failures", async () => {
    const { callTool, logs, managementToolHandler } = createCallToolHarness();
    vi.mocked(managementToolHandler.handleManageProjects).mockRejectedValueOnce(new Error("database password leaked"));

    const result = await runWithCorrelationId("corr-failure", () => callTool({
      params: {
        name: "manage_projects",
        arguments: { action: "list" },
      },
    }));

    expect(result).toEqual({
      content: [{ type: "text", text: "Error: Internal Server Error (correlationId: corr-failure)" }],
      isError: true,
    });
    expect(JSON.stringify(result)).not.toContain("database password leaked");
    expect(logs.error.at(-1)?.metadata).toMatchObject({
      toolName: "manage_projects",
      errorName: "Error",
    });
    expect(JSON.stringify(logs.error)).not.toContain("database password leaked");
  });
});
