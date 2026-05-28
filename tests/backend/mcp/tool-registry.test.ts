import { describe, expect, it, vi } from "vitest";
import { ToolRegistry, type McpToolArgsByName } from "../../../src/api/mcp/tool-registry.js";

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
