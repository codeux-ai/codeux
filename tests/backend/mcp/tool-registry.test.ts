import { describe, expect, it, vi } from "vitest";
import { ToolRegistry, type McpToolArgsByName } from "../../../src/api/mcp/tool-registry.js";

describe("ToolRegistry", () => {
  it("dispatches a registered tool handler", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["get_source"]) => `source:${args.source_id}`);

    registry.register("get_source", handler);

    const result = await registry.dispatch("get_source", { source_id: "abc" });
    expect(result).toBe("source:abc");
    expect(handler).toHaveBeenCalledWith({ source_id: "abc" });
  });

  it("supports runtime string dispatch for known tools", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    registry.register("task_agent", async (args) => args.prompt);

    const toolName: string = "task_agent";
    const result = await registry.dispatch(toolName, { prompt: "run task" });
    expect(result).toBe("run task");
  });

  it("throws when dispatching an unknown tool", async () => {
    const registry = new ToolRegistry<McpToolArgsByName>();
    await expect(registry.dispatch("unknown_tool", {})).rejects.toThrow("Tool not found: unknown_tool");
  });
});

const compileTimeTypeChecks = (): void => {
  const registry = new ToolRegistry<McpToolArgsByName, unknown>();
  registry.register("create_session", async (_args) => ({ ok: true }));

  // @ts-expect-error unknown tools cannot be registered
  registry.register("unknown_tool", async (_args) => ({ ok: true }));

  // @ts-expect-error create_session requires both prompt and source
  registry.dispatch("create_session", { prompt: "missing source" });

  // @ts-expect-error get_source requires source_id as string
  registry.dispatch("get_source", { source_id: 123 });
};

void compileTimeTypeChecks;
