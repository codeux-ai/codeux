import { describe, expect, it, vi } from "vitest";
import { ToolRegistry, type McpToolArgsByName } from "../../../src/api/mcp/tool-registry.js";

describe("ToolRegistry", () => {
  it("dispatches a registered tool handler", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["post_listen_reply"]) => `reply:${args.thread_id}`);

    registry.register("post_listen_reply", handler);

    const result = await registry.dispatch("post_listen_reply", {
      connection_key: "conn-1",
      thread_id: "thread-1",
      body_markdown: "done",
    });
    expect(result).toBe("reply:thread-1");
    expect(handler).toHaveBeenCalledWith({
      connection_key: "conn-1",
      thread_id: "thread-1",
      body_markdown: "done",
    });
  });

  it("supports runtime string dispatch for known tools", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    registry.register("listen", async (args) => args.connection_key);

    const toolName: string = "listen";
    const result = await registry.dispatch(toolName, { connection_key: "worker-1" });
    expect(result).toBe("worker-1");
  });

  it("throws when dispatching an unknown tool", async () => {
    const registry = new ToolRegistry<McpToolArgsByName>();
    await expect(registry.dispatch("unknown_tool", {})).rejects.toThrow("Tool not found: unknown_tool");
  });

  it("can register and dispatch manage_sprint_os", async () => {
    const registry = new ToolRegistry<McpToolArgsByName, string>();
    const handler = vi.fn(async (args: McpToolArgsByName["manage_sprint_os"]) => `manage:${args.domain}:${args.action}`);

    registry.register("manage_sprint_os", handler);

    const result = await registry.dispatch("manage_sprint_os", {
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
});

const compileTimeTypeChecks = (): void => {
  const registry = new ToolRegistry<McpToolArgsByName, unknown>();
  registry.register("listen", async (_args) => ({ ok: true }));

  // @ts-expect-error unknown tools cannot be registered
  registry.register("unknown_tool", async (_args) => ({ ok: true }));

  // @ts-expect-error listen requires connection_key
  registry.dispatch("listen", { timeout_seconds: 3 });

  // @ts-expect-error post_listen_reply requires thread_id as string
  registry.dispatch("post_listen_reply", { connection_key: "worker-1", thread_id: 123, body_markdown: "hi" });
};

void compileTimeTypeChecks;
