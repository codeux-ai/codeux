import { describe, expect, it, vi } from "vitest";
import { McpToolRegistry, type McpToolArgsByName } from "../../../src/api/mcp/tool-registry.js";

const buildResponse = (text: string) => ({
  content: [{ type: "text", text }],
});

describe("McpToolRegistry", () => {
  it("dispatches registered handlers with validated arguments", async () => {
    const registry = new McpToolRegistry();
    const handler = vi.fn(async (args: McpToolArgsByName["create_session"]) =>
      buildResponse(`${args.prompt}:${args.source}`)
    );

    registry.register("create_session", handler);

    const response = await registry.dispatch("create_session", {
      prompt: "run task",
      source: "sources/123",
      title: "My title",
      require_plan_approval: true,
    });

    expect(handler).toHaveBeenCalledWith({
      prompt: "run task",
      source: "sources/123",
      title: "My title",
      require_plan_approval: true,
    });
    expect(response.content[0].text).toBe("run task:sources/123");
  });

  it("treats undefined optional-argument payload as empty object", async () => {
    const registry = new McpToolRegistry();
    const handler = vi.fn(async (_args: McpToolArgsByName["list_sessions"]) => buildResponse("ok"));

    registry.register("list_sessions", handler);

    await registry.dispatch("list_sessions", undefined);

    expect(handler).toHaveBeenCalledWith({});
  });

  it("rejects calls to unregistered tools", async () => {
    const registry = new McpToolRegistry();

    await expect(registry.dispatch("get_source", { source_id: "sources/1" })).rejects.toThrow(
      "Tool not found: get_source"
    );
  });

  it("rejects missing required fields", async () => {
    const registry = new McpToolRegistry();
    registry.register("get_source", async (_args) => buildResponse("ok"));

    await expect(registry.dispatch("get_source", {})).rejects.toThrow(
      "Invalid arguments for get_source: missing required field(s): source_id."
    );
  });

  it("rejects invalid primitive types", async () => {
    const registry = new McpToolRegistry();
    registry.register("wait_for_session_completion", async (_args) => buildResponse("ok"));

    await expect(
      registry.dispatch("wait_for_session_completion", {
        session_id: "sessions/1",
        poll_interval: "5",
      })
    ).rejects.toThrow('Invalid arguments for wait_for_session_completion: "poll_interval" must be a number.');
  });

  it("rejects enum values outside the schema", async () => {
    const registry = new McpToolRegistry();
    registry.register("create_session", async (_args) => buildResponse("ok"));

    await expect(
      registry.dispatch("create_session", {
        prompt: "run",
        source: "sources/1",
        automation_mode: "MANUAL",
      })
    ).rejects.toThrow(
      'Invalid arguments for create_session: "automation_mode" must be one of: AUTO_CREATE_PR.'
    );
  });
});
