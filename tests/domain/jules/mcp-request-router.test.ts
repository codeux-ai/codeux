import { describe, it, expect, vi, beforeEach } from "vitest";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { registerMcpRequestHandlers } from "../../../src/server/mcp-request-router.js";
import { ToolRegistry } from "../../../src/api/mcp/tool-registry.js";
import { isToolEnabled } from "../../../src/mcp/mcp-tool-availability.js";
import { validateToolArguments } from "../../../src/api/mcp/validators/tool-validators.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";

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
  MockToolRegistry.prototype.dispatch = vi.fn().mockResolvedValue({ content: [] });
  return {
    ToolRegistry: MockToolRegistry,
  };
});

describe("McpRequestRouter", () => {
  let executionRepository: any;
  let server: any;
  let handlers: Record<string, any>;

  beforeEach(() => {
    handlers = {};
    server = {
      setRequestHandler: vi.fn((schema, handler) => {
        handlers[schema.method] = handler;
      }),
    };
    executionRepository = {
      createProviderInvocationUsage: vi.fn(),
    };

    registerMcpRequestHandlers({
      server: server as any,
      coreToolHandler: {} as any,
      agentToolHandler: {} as any,
      managementToolHandler: {} as any,
      getDashboardSettings: () => ({ mcpTools: [{ name: "google_web_search", enabled: true }, { name: "read_file", enabled: true }, { name: "manage_code_ux", enabled: true }] }) as any,
      getRuntimeRole: () => "project_manager",
      formatError: () => ({ content: [], isError: true }),
      executionRepository: executionRepository as any,
    });
  });

  it("should log invocation as EXTERNAL_API for google_web_search tool", async () => {
    const handler = handlers[CallToolRequestSchema.method];

    await handler({
      params: {
        name: "google_web_search",
        arguments: {
          projectId: "proj-1",
          sessionId: "sess-1",
          provider: "claude",
          purpose: "task_coding",
        },
      },
    }, {} as any);

    expect(executionRepository.createProviderInvocationUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationSource: "EXTERNAL_API",
      })
    );
  });

  it("should log invocation as internal for read_file tool", async () => {
    const handler = handlers[CallToolRequestSchema.method];

    await handler({
      params: {
        name: "read_file",
        arguments: {
          projectId: "proj-1",
          sessionId: "sess-1",
          provider: "claude",
          purpose: "task_coding",
        },
      },
    }, {} as any);

    expect(executionRepository.createProviderInvocationUsage).toHaveBeenCalledWith(
      expect.objectContaining({
        invocationSource: "internal",
      })
    );
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
      executionRepository: executionRepository as any,
    });
    const handler = localHandlers[CallToolRequestSchema.method];

    vi.mocked(isToolEnabled).mockClear();
    await runWithMcpAgentContext("agent-1", () =>
      handler({ params: { name: "manage_projects", arguments: {} } }, {} as any),
    );

    expect(isToolEnabled).toHaveBeenCalledWith(expect.anything(), "manage_projects", "project_manager", agentToggles);
  });
});
