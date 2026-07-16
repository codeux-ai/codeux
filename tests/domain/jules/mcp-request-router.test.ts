import { describe, it, expect, vi, beforeEach } from "vitest";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerMcpRequestHandlers } from "../../../src/server/mcp-request-router.js";
import { isToolEnabled } from "../../../src/mcp/mcp-tool-availability.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";

const dispatchMock = vi.hoisted(() => vi.fn().mockResolvedValue({ content: [] }));

vi.mock("../../../src/mcp/mcp-tool-availability.js", () => ({
  isToolEnabled: vi.fn().mockReturnValue(true),
  getEnabledToolDefinitions: vi.fn().mockReturnValue([]),
}));

vi.mock("../../../src/api/mcp/validators/tool-validators.js", () => ({
  validateToolArguments: vi.fn()
}));

vi.mock("../../../src/api/mcp/tool-registry.js", () => {
  const MockToolRegistry = vi.fn();
  MockToolRegistry.prototype.register = vi.fn().mockReturnThis();
  MockToolRegistry.prototype.dispatch = dispatchMock;
  return {
    ToolRegistry: MockToolRegistry,
  };
});

describe("McpRequestRouter", () => {
  let server: any;
  let handlers: Record<string, any>;

  beforeEach(() => {
    handlers = {};
    server = {
      setRequestHandler: vi.fn((schema, handler) => {
        handlers[schema.method] = handler;
      }),
    };
    dispatchMock.mockClear();

    registerMcpRequestHandlers({
      server: server as any,
      coreToolHandler: {} as any,
      agentToolHandler: {} as any,
      managementToolHandler: {} as any,
      getDashboardSettings: () => ({ mcpTools: [{ name: "google_web_search", enabled: true }, { name: "read_file", enabled: true }, { name: "manage_code_ux", enabled: true }] }) as any,
      getRuntimeRole: () => "project_manager",
      formatError: () => ({ content: [], isError: true }),
    });
  });

  it("dispatches external tools without synthesizing provider telemetry in the generic router", async () => {
    const handler = handlers[CallToolRequestSchema.method];
    const toolArgs = {
      projectId: "proj-1",
      sessionId: "sess-1",
      provider: "claude",
      purpose: "task_coding",
    };

    await handler({
      params: {
        name: "google_web_search",
        arguments: toolArgs,
      },
    }, {} as any);

    expect(dispatchMock).toHaveBeenCalledWith("google_web_search", toolArgs);
  });

  it("dispatches internal tools through the same provider-agnostic path", async () => {
    const handler = handlers[CallToolRequestSchema.method];
    const toolArgs = {
      projectId: "proj-1",
      sessionId: "sess-1",
      provider: "claude",
      purpose: "task_coding",
    };

    await handler({
      params: {
        name: "read_file",
        arguments: toolArgs,
      },
    }, {} as any);

    expect(dispatchMock).toHaveBeenCalledWith("read_file", toolArgs);
  });

  it("resolves per-agent code_ux toggles from the request agent context", async () => {
    const localHandlers: Record<string, any> = {};
    const localServer = {
      setRequestHandler: vi.fn((schema, handler) => {
        localHandlers[schema.method] = handler;
      }),
    };
    const agentToggles = [{ name: "manage_tasks", enabled: false, isInternal: true }];
    registerMcpRequestHandlers({
      server: localServer as any,
      managementToolHandler: {} as any,
      getDashboardSettings: () => ({ mcpTools: [] }) as any,
      getRuntimeRole: () => "project_manager",
      resolveAgentMcpToolToggles: (agentId: string) => (agentId === "agent-1" ? agentToggles : null),
      formatError: () => ({ content: [], isError: true }),
    });
    const handler = localHandlers[CallToolRequestSchema.method];

    vi.mocked(isToolEnabled).mockClear();
    await runWithMcpAgentContext("agent-1", () =>
      handler({ params: { name: "manage_projects", arguments: {} } }, {} as any),
    );

    expect(isToolEnabled).toHaveBeenCalledWith(expect.anything(), "manage_projects", "project_manager", agentToggles);
  });
});
