import { describe, expect, it, vi } from "vitest";
import { CoreToolHandler } from "../../../src/mcp/core-tool-handler.js";
import { registerMcpRequestHandlers } from "../../../src/server/mcp-request-router.js";
import { CallToolRequestSchema, ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import { buildDeps } from "./core-tool-handler.setup.js";

describe("CoreToolHandler validation", () => {
  it("rejects malformed payloads with ErrorCode.InvalidParams before handler dispatch", async () => {
    const { deps, getSession } = buildDeps();
    const handler = new CoreToolHandler(deps as any);

    // Track if handler is called
    let handlerCalled = false;
    deps.julesApi.getSession = vi.fn().mockImplementation(async () => {
      handlerCalled = true;
      return {};
    });

    const mockServer = {
      setRequestHandler: vi.fn(),
    };

    registerMcpRequestHandlers({
      server: mockServer as any,
      coreToolHandler: handler,
      agentToolHandler: {} as any,
      getDashboardSettings: () => ({ mcpTools: [{ name: "get_session", enabled: true }] }) as any,
      formatError: (e) => {
        if (e instanceof McpError) throw e;
        return { content: [{ type: "text", text: "err" }], isError: true };
      },
    });

    // Find the CallToolRequestSchema handler
    const callHandlerArgs = mockServer.setRequestHandler.mock.calls.find(
      (args) => args[0] === CallToolRequestSchema
    );
    expect(callHandlerArgs).toBeDefined();

    const callHandler = callHandlerArgs![1];

    // Missing required 'session_id'
    try {
      await callHandler({
        method: "tools/call",
        params: {
          name: "get_session",
          arguments: { wrong_field: "123" }
        }
      }, {} as any);
      expect.fail("Expected McpError to be thrown");
    } catch (e: any) {
      if (!(e instanceof McpError)) {
        console.error(e);
      }
      expect(e).toBeInstanceOf(McpError);
      expect(e.code).toBe(ErrorCode.InvalidParams);
      expect(e.message).toContain("must have required property 'session_id'");
    }

    // Assert that the underlying handler was never executed
    expect(handlerCalled).toBe(false);
  });
});
