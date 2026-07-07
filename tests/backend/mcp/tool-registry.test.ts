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
    handleManageChatProviders: vi.fn(async () => ({ content: [{ type: "text", text: "chat-providers" }] })),
    handleScheduler: vi.fn(async () => ({ content: [{ type: "text", text: "scheduled" }] })),
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

const callScheduler = async (handlers: RouterHandlers): Promise<unknown> =>
  handlers.callTool({
    params: {
      name: "scheduler",
      arguments: { action: "list", projectId: "project-1" },
    },
  });

const callManageChatProviders = async (handlers: RouterHandlers): Promise<unknown> =>
  handlers.callTool({
    params: {
      name: "manage_chat_providers",
      arguments: { action: "list_provider_definitions" },
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

  it("can register and dispatch scheduler", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["scheduler"]) => `scheduler:${args.action}`);

    registry.register("scheduler", handler);

    const result = await registry.dispatch("scheduler", {
      action: "schedule_wakeup",
      projectId: "proj-1",
      delaySeconds: 30,
      bodyMarkdown: "Resume the review.",
    });
    expect(result).toBe("scheduler:schedule_wakeup");
    expect(handler).toHaveBeenCalledWith({
      action: "schedule_wakeup",
      projectId: "proj-1",
      delaySeconds: 30,
      bodyMarkdown: "Resume the review.",
    });
  });

  it("can register and dispatch manage_chat_providers", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["manage_chat_providers"]) => `manage_chat_providers:${args.action}`);

    registry.register("manage_chat_providers", handler);

    const result = await registry.dispatch("manage_chat_providers", {
      action: "list_provider_definitions",
      providerKind: "slack",
    });
    expect(result).toBe("manage_chat_providers:list_provider_definitions");
    expect(handler).toHaveBeenCalledWith({
      action: "list_provider_definitions",
      providerKind: "slack",
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

  it("lists and dispatches scheduler only when enabled by tool availability", async () => {
    const { handlers, managementToolHandler } = createRouterHarness((agentId) =>
      agentId === "agent-scheduler"
        ? {
            codeUxEnabled: true,
            codeUxToolToggles: [{ name: "scheduler", enabled: true, isInternal: true }],
          }
        : null,
    );

    await runWithMcpAgentContext("agent-scheduler", async () => {
      await expect(listToolNames(handlers)).resolves.toContain("scheduler");
      await expect(callScheduler(handlers)).resolves.toEqual({ content: [{ type: "text", text: "scheduled" }] });
    });

    expect(managementToolHandler.handleScheduler).toHaveBeenCalledTimes(1);
  });

  it("lists and dispatches manage_chat_providers when enabled by tool availability", async () => {
    const { handlers, managementToolHandler } = createRouterHarness(() => null);

    await runWithMcpAgentContext(null, async () => {
      await expect(listToolNames(handlers)).resolves.toContain("manage_chat_providers");
      await expect(callManageChatProviders(handlers)).resolves.toEqual({ content: [{ type: "text", text: "chat-providers" }] });
    });

    expect(managementToolHandler.handleManageChatProviders).toHaveBeenCalledTimes(1);
  });

  it("rejects scheduler calls when the tool is disabled", async () => {
    const { handlers, managementToolHandler } = createRouterHarness((agentId) =>
      agentId === "agent-no-scheduler"
        ? {
            codeUxEnabled: true,
            codeUxToolToggles: [{ name: "scheduler", enabled: false, isInternal: true }],
          }
        : null,
    );

    await runWithMcpAgentContext("agent-no-scheduler", async () => {
      await expect(listToolNames(handlers)).resolves.not.toContain("scheduler");
      await expect(callScheduler(handlers)).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    });

    expect(managementToolHandler.handleScheduler).not.toHaveBeenCalled();
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

  // @ts-expect-error manage_chat_providers requires a valid action value
  registry.dispatch("manage_chat_providers", { action: "route_inbound_message" });
};

void compileTimeTypeChecks;
