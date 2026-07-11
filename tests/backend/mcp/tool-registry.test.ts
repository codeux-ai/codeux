import { describe, expect, it, vi } from "vitest";
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { ToolRegistry, type McpToolArgsByName } from "../../../src/api/mcp/tool-registry.js";
import { registerMcpRequestHandlers } from "../../../src/server/mcp-request-router.js";
import { runWithMcpAgentContext } from "../../../src/server/mcp-agent-context.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-repository.js";
import type { AgentCodeUxToolAccess } from "../../../src/mcp/mcp-tool-availability.js";

type RouterHandlers = Record<"listTools" | "callTool", (request?: unknown) => Promise<unknown>>;

const createRouterHarness = (resolveAgentMcpToolAccess?: (
  agentId: string,
  request?: { toolName: string; arguments: unknown },
) => AgentCodeUxToolAccess | null) => {
  const handlers = {} as RouterHandlers;
  const managementToolHandler = {
    handleManageProjects: vi.fn(async () => ({ content: [{ type: "text", text: "ok" }] })),
    handleManageChatProviders: vi.fn(async () => ({ content: [{ type: "text", text: "chat-providers" }] })),
    handleManageCustomDashboards: vi.fn(async () => ({ content: [{ type: "text", text: "custom-dashboards" }] })),
    handleManageNodeFlows: vi.fn(async () => ({ content: [{ type: "text", text: "node-flows" }] })),
    handleScheduler: vi.fn(async () => ({ content: [{ type: "text", text: "scheduled" }] })),
    handleRequestClarification: vi.fn(async () => ({ content: [{ type: "text", text: "requested" }] })),
    handleReplyToClarification: vi.fn(async () => ({ content: [{ type: "text", text: "replied" }] })),
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
      name: "scheduler_code_ux",
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

const callManageNodeFlows = async (handlers: RouterHandlers): Promise<unknown> =>
  handlers.callTool({
    params: {
      name: "manage_node_flows",
      arguments: { action: "list", projectId: "project-1" },
    },
  });

const callManageCustomDashboards = async (handlers: RouterHandlers): Promise<unknown> =>
  handlers.callTool({
    params: {
      name: "manage_custom_dashboards",
      arguments: { action: "list", projectId: "project-1" },
    },
  });

const callClarificationTool = async (
  handlers: RouterHandlers,
  name: "request_clarification" | "reply_to_clarification",
  projectId = "project-1",
): Promise<unknown> => handlers.callTool({
  params: {
    name,
    arguments: name === "request_clarification"
      ? { projectId, questionMarkdown: "Which API?", deduplicationKey: "question-1" }
      : { projectId, clarificationId: "clarification-1", answerMarkdown: "Use the typed API." },
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

  it("can register and dispatch both typed clarification tools", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    registry.register("request_clarification", async (args) => args.questionMarkdown);
    registry.register("reply_to_clarification", async (args) => args.answerMarkdown);

    await expect(registry.dispatch("request_clarification", {
      projectId: "project-1",
      questionMarkdown: "Which API?",
      deduplicationKey: "question-1",
      taskId: "task-1",
    })).resolves.toBe("Which API?");
    await expect(registry.dispatch("reply_to_clarification", {
      projectId: "project-1",
      clarificationId: "clarification-1",
      answerMarkdown: "Use the typed API.",
    })).resolves.toBe("Use the typed API.");
  });

  it("can register and dispatch scheduler", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["scheduler_code_ux"]) => `scheduler:${args.action}`);

    registry.register("scheduler_code_ux", handler);

    const result = await registry.dispatch("scheduler_code_ux", {
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

  it("can register and dispatch manage_node_flows", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["manage_node_flows"]) => `manage_node_flows:${args.action}`);

    registry.register("manage_node_flows", handler);

    const result = await registry.dispatch("manage_node_flows", {
      action: "run",
      projectId: "proj-1",
      flowId: "flow-1",
      input: { prompt: "Ship" },
    });
    expect(result).toBe("manage_node_flows:run");
    expect(handler).toHaveBeenCalledWith({
      action: "run",
      projectId: "proj-1",
      flowId: "flow-1",
      input: { prompt: "Ship" },
    });
  });

  it("can register and dispatch manage_custom_dashboards", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["manage_custom_dashboards"]) => `manage_custom_dashboards:${args.action}`);

    registry.register("manage_custom_dashboards", handler);

    const result = await registry.dispatch("manage_custom_dashboards", {
      action: "publish_revision",
      dashboardId: "dashboard-1",
      revisionId: "revision-1",
    });
    expect(result).toBe("manage_custom_dashboards:publish_revision");
    expect(handler).toHaveBeenCalledWith({
      action: "publish_revision",
      dashboardId: "dashboard-1",
      revisionId: "revision-1",
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
            codeUxToolToggles: [{ name: "scheduler_code_ux", enabled: true, isInternal: true }],
          }
        : null,
    );

    await runWithMcpAgentContext("agent-scheduler", async () => {
      await expect(listToolNames(handlers)).resolves.toContain("scheduler_code_ux");
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

  it("lists and dispatches manage_node_flows when enabled by tool availability", async () => {
    const { handlers, managementToolHandler } = createRouterHarness(() => null);

    await runWithMcpAgentContext(null, async () => {
      await expect(listToolNames(handlers)).resolves.toContain("manage_node_flows");
      await expect(callManageNodeFlows(handlers)).resolves.toEqual({ content: [{ type: "text", text: "node-flows" }] });
    });

    expect(managementToolHandler.handleManageNodeFlows).toHaveBeenCalledTimes(1);
  });

  it("lists and dispatches manage_custom_dashboards when enabled by tool availability", async () => {
    const { handlers, managementToolHandler } = createRouterHarness(() => null);

    await runWithMcpAgentContext(null, async () => {
      await expect(listToolNames(handlers)).resolves.toContain("manage_custom_dashboards");
      await expect(callManageCustomDashboards(handlers)).resolves.toEqual({ content: [{ type: "text", text: "custom-dashboards" }] });
    });

    expect(managementToolHandler.handleManageCustomDashboards).toHaveBeenCalledTimes(1);
  });

  it("rejects scheduler calls when the tool is disabled", async () => {
    const { handlers, managementToolHandler } = createRouterHarness((agentId) =>
      agentId === "agent-no-scheduler"
        ? {
            codeUxEnabled: true,
            codeUxToolToggles: [{ name: "scheduler_code_ux", enabled: false, isInternal: true }],
          }
        : null,
    );

    await runWithMcpAgentContext("agent-no-scheduler", async () => {
      await expect(listToolNames(handlers)).resolves.not.toContain("scheduler_code_ux");
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

  it("lists and calls only the worker clarification request grant", async () => {
    const workerAccess: AgentCodeUxToolAccess = {
      codeUxEnabled: false,
      codeUxToolToggles: [],
      audiences: ["worker"],
      audienceToolNames: ["request_clarification"],
    };
    const { handlers, managementToolHandler } = createRouterHarness((agentId, request) => {
      if (agentId !== "worker-agent") return null;
      if (request && (request.arguments as { projectId?: string }).projectId !== "project-1") return null;
      return workerAccess;
    });

    await runWithMcpAgentContext("worker-agent", async () => {
      expect(await listToolNames(handlers)).toEqual(["request_clarification"]);
      await expect(callClarificationTool(handlers, "request_clarification")).resolves.toEqual({
        content: [{ type: "text", text: "requested" }],
      });
      await expect(callClarificationTool(handlers, "reply_to_clarification")).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
      await expect(callClarificationTool(handlers, "request_clarification", "other-project")).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
    });

    expect(managementToolHandler.handleRequestClarification).toHaveBeenCalledTimes(1);
    expect(managementToolHandler.handleReplyToClarification).not.toHaveBeenCalled();
  });

  it("allows scoped and unscoped project-manager clarification replies", async () => {
    const managerAccess: AgentCodeUxToolAccess = {
      codeUxEnabled: false,
      codeUxToolToggles: [],
      audiences: ["project_manager"],
      audienceToolNames: ["reply_to_clarification"],
    };
    const { handlers } = createRouterHarness((agentId) => agentId === "manager-agent" ? managerAccess : null);

    await runWithMcpAgentContext("manager-agent", async () => {
      expect(await listToolNames(handlers)).toEqual(["reply_to_clarification"]);
      await expect(callClarificationTool(handlers, "reply_to_clarification")).resolves.toEqual({
        content: [{ type: "text", text: "replied" }],
      });
    });
    await runWithMcpAgentContext(null, async () => {
      await expect(listToolNames(handlers)).resolves.toContain("reply_to_clarification");
      await expect(callClarificationTool(handlers, "reply_to_clarification")).resolves.toEqual({
        content: [{ type: "text", text: "replied" }],
      });
      await expect(callClarificationTool(handlers, "request_clarification")).rejects.toMatchObject({ code: ErrorCode.MethodNotFound });
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

  // @ts-expect-error manage_node_flows requires a valid action value
  registry.dispatch("manage_node_flows", { action: "execute" });

  // @ts-expect-error manage_custom_dashboards requires a valid action value
  registry.dispatch("manage_custom_dashboards", { action: "delete" });
};

void compileTimeTypeChecks;
