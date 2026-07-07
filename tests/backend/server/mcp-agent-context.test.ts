import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import {
  runWithMcpAgentContext,
  getCurrentMcpAgentId,
  getCurrentMcpInvocationId,
} from "../../../src/server/mcp-agent-context.js";
import { bootMcpHttpTransport, type McpHttpTransportHandle } from "../../../src/app/lifecycle/mcp-lifecycle-service.js";

const handles: McpHttpTransportHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  while (handles.length > 0) {
    await handles.pop()?.close();
  }
});

function createLogger() {
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: () => logger,
  };
  return logger as any;
}

describe("mcp-agent-context", () => {
  it("returns null outside any context", () => {
    expect(getCurrentMcpAgentId()).toBeNull();
    expect(getCurrentMcpInvocationId()).toBeNull();
  });

  it("exposes the agent and invocation ids within the context and across awaits", async () => {
    await runWithMcpAgentContext("agent-42", async () => {
      expect(getCurrentMcpAgentId()).toBe("agent-42");
      expect(getCurrentMcpInvocationId()).toBe("invocation-42");
      await Promise.resolve();
      expect(getCurrentMcpAgentId()).toBe("agent-42");
      expect(getCurrentMcpInvocationId()).toBe("invocation-42");
    }, "invocation-42");
    expect(getCurrentMcpAgentId()).toBeNull();
    expect(getCurrentMcpInvocationId()).toBeNull();
  });

  it("supports null ids (no headers)", () => {
    runWithMcpAgentContext(null, () => {
      expect(getCurrentMcpAgentId()).toBeNull();
      expect(getCurrentMcpInvocationId()).toBeNull();
    });
  });

  it("parses MCP HTTP agent and invocation headers into request context", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: null,
      logger: createLogger(),
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
      createServer: () => {
        const server = new Server(
          { name: "context-test-server", version: "1.0.0" },
          { capabilities: { tools: {} } },
        );
        server.setRequestHandler(ListToolsRequestSchema, async () => ({
          tools: [{
            name: `${getCurrentMcpAgentId()}:${getCurrentMcpInvocationId()}`,
            description: "request context",
            inputSchema: { type: "object", properties: {} },
          }],
        }));
        return server;
      },
    });
    handles.push(handle!);

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle!.port}${handle!.path}`),
      {
        requestInit: {
          headers: {
            "X-Code-Ux-Agent": "agent-42",
            "X-Code-Ux-Invocation": "invocation-42",
          },
        },
      },
    );
    const client = new Client({ name: "context-test-client", version: "1.0.0" });
    await client.connect(transport);

    const result = await client.request({ method: "tools/list", params: {} }, ListToolsResultSchema);

    expect(result.tools[0]?.name).toBe("agent-42:invocation-42");
    await transport.close();
  });
});
