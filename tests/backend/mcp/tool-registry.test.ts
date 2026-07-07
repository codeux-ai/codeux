import { describe, expect, it, vi } from "vitest";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ToolRegistry, type McpToolArgsByName } from "../../../src/api/mcp/tool-registry.js";
import { registerMcpRequestHandlers } from "../../../src/server/mcp-request-router.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";
import type { AgentCodeUxToolAccess } from "../../../src/mcp/mcp-tool-availability.js";

type RouterHandlers = Record<"listTools" | "callTool", (request?: unknown) => Promise<unknown>>;

const createRouterHarness = (resolveAgentMcpToolAccess?: (agentId: string) => AgentCodeUxToolAccess | null) => {
  const handlers = {} as RouterHandlers;
  const managementToolHandler = {
    handleManageProjects: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
  };

  registerMcpRequestHandlers({
    server: {
      setRequestHandler: vi.fn((schema, handler) => {
        if (schema === ListToolsRequestSchema) {
          handlers.listTools = handler;
        }
        if (schema === CallToolRequestSchema) {
          handlers.callTool = handler;
        }
      }),
    } as any,
    managementToolHandler: managementToolHandler as any,
    getDashboardSettings: () => DEFAULT_DASHBOARD_SETTINGS,
    getRuntimeRole: () => "project_manager",
    resolveAgentMcpToolAccess,
    formatError: () => ({ content: [], isError: true }),
  });

  return { handlers, managementToolHandler };
};

const listToolNames = async (handlers: RouterHandlers): Promise<string[]> => {
  const response = await handlers.listTools();
  return (response as { tools: Array<{ name: string }> }).tools.map((tool) => tool.name);
};

const callManageProjects = async (handlers: RouterHandlers): Promise<unknown> =>
  handlers.callTool({
    params: {
      name: "manage_projects",
      arguments: { action: "list" },
    },
  });

describe("ToolRegistry", () => {
  it("dispatches a registered tool handler", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["manage_tasks"]) => `task:${args.action}`);

    registry.register("manage_tasks", handler);

    const result = await registry.dispatch("manage_tasks", {
      action: "list",
      projectId: "proj-1",
    });
    expect(result).toBe("task:list");
    expect(handler).toHaveBeenCalledWith({
      action: "list",
      projectId: "proj-1",
    });
  });

  it("supports runtime string dispatch for known tools", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    registry.register("manage_projects", async (args) => args.action);

    const toolName: string = "manage_projects";
    const result = await registry.dispatch(toolName, { action: "list" });
    expect(result).toBe("list");
  });

  it("throws when dispatching an unknown tool", async () => {
    const registry = new ToolRegistry<McpToolArgsByName>();
    await expect(registry.dispatch("unknown_tool", {})).rejects.toThrow("Tool not found: unknown_tool");
  });

  it("can register and dispatch manage_code_ux", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["manage_code_ux"]) => `manage:${args.domain}:${args.action}`);

    registry.register("manage_code_ux", handler);

    const result = await registry.dispatch("manage_code_ux", {
      domain: "system",
      action: "restart",
      payload: {},
    });
    expect(result).toBe("manage:system:restart");
    expect(handler).toHaveBeenCalledWith({
      domain: "system",
      action: "restart",
      payload: {},
    });
  });

  it("can register and dispatch manage_projects", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["manage_projects"]) => `manage_projects:${args.action}`);

    registry.register("manage_projects", handler);

    const result = await registry.dispatch("manage_projects", {
      action: "list",
    });
    expect(result).toBe("manage_projects:list");
    expect(handler).toHaveBeenCalledWith({
      action: "list",
    });
  });
});

describe("MCP router per-agent Code UX access", () => {
  it("uses system tool toggles when no agent header is present", async () => {
    const { handlers, managementToolHandler } = createRouterHarness(() => null);

    await runWithMcpAgentContext(null, async () => {
      await expect(listToolNames(handlers)).resolves.toContain("manage_projects");
      await expect(callManageProjects(handlers)).resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
    });

    expect(managementToolHandler.handleManageProjects).toHaveBeenCalledTimes(1);
  });

  it("omits and rejects tools restricted by a known agent policy", async () => {
    const { handlers, managementToolHandler } = createRouterHarness((agentId) =>
      agentId === "agent-restricted"
        ? {
            codeUxEnabled: true,
            codeUxToolToggles: [{ name: "manage_projects", enabled: false, isInternal: true }],
          }
        : null,
    );

    await runWithMcpAgentContext("agent-restricted", async () => {
      await expect(listToolNames(handlers)).resolves.not.toContain("manage_projects");
      await expect(callManageProjects(handlers)).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    });

    expect(managementToolHandler.handleManageProjects).not.toHaveBeenCalled();
  });

  it("omits and rejects every Code UX tool when a known agent disables Code UX", async () => {
    const { handlers, managementToolHandler } = createRouterHarness((agentId) =>
      agentId === "agent-disabled" ? { codeUxEnabled: false, codeUxToolToggles: [] } : null,
    );

    await runWithMcpAgentContext("agent-disabled", async () => {
      expect(await listToolNames(handlers)).toEqual([]);
      await expect(callManageProjects(handlers)).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    });

    expect(managementToolHandler.handleManageProjects).not.toHaveBeenCalled();
  });

  it("fails closed for a malformed advertised agent header value", async () => {
    const { handlers } = createRouterHarness(() => null);

    await runWithMcpAgentContext("invalid/chars", async () => {
      expect(await listToolNames(handlers)).toEqual([]);
      await expect(callManageProjects(handlers)).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    });
  });

  it("fails closed for an unknown advertised agent header value", async () => {
    const { handlers } = createRouterHarness((agentId) =>
      agentId === "known-agent" ? { codeUxEnabled: true, codeUxToolToggles: [] } : null,
    );

    await runWithMcpAgentContext("unknown-agent", async () => {
      expect(await listToolNames(handlers)).toEqual([]);
      await expect(callManageProjects(handlers)).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    });
  });
});

const compileTimeTypeChecks = (): void => {
  const registry = new ToolRegistry<McpToolArgsByName, unknown>();
  registry.register("manage_projects", async (_args) => ({ ok: true }));

  // @ts-expect-error unknown tools cannot be registered
  registry.register("unknown_tool", async (_args) => ({ ok: true }));

  // @ts-expect-error manage_projects requires a valid action value
  registry.dispatch("manage_projects", { action: "not_a_real_action" });

  // @ts-expect-error manage_tasks action must be a string enum, not a number
  registry.dispatch("manage_tasks", { action: 123 });
};

void compileTimeTypeChecks;
