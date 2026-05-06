import { afterEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { bootMcpHttpTransport, type McpHttpTransportHandle } from "../../../../src/app/lifecycle/mcp-lifecycle-service.js";

const handles: McpHttpTransportHandle[] = [];

afterEach(async () => {
  while (handles.length > 0) {
    const handle = handles.pop();
    if (handle) {
      await handle.close();
    }
  }
});

function createTestServer(): Server {
  const server = new Server(
    {
      name: "test-mcp-http-server",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: "listen",
        description: "Listen for Code UX work",
        inputSchema: {
          type: "object",
          properties: {},
        },
      },
    ],
  }));

  return server;
}

describe("bootMcpHttpTransport", () => {
  it("rejects unauthorized requests before MCP session setup", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: "secret-token",
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        child: () => ({
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          debug: () => undefined,
          child: () => undefined as never,
        }),
      } as any,
      createServer: createTestServer,
    });
    expect(handle).not.toBeNull();
    handles.push(handle!);

    const response = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "unauthorized-client", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it("accepts authorized streamable HTTP MCP clients", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: "secret-token",
      logger: {
        info: () => undefined,
        warn: () => undefined,
        error: () => undefined,
        debug: () => undefined,
        child: () => ({
          info: () => undefined,
          warn: () => undefined,
          error: () => undefined,
          debug: () => undefined,
          child: () => undefined as never,
        }),
      } as any,
      createServer: createTestServer,
    });
    expect(handle).not.toBeNull();
    handles.push(handle!);

    const transport = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle!.port}${handle!.path}`),
      {
        requestInit: {
          headers: {
            Authorization: "Bearer secret-token",
          },
        },
      },
    );
    const client = new Client({
      name: "authorized-client",
      version: "1.0.0",
    });

    await client.connect(transport);
    const tools = await client.request({
      method: "tools/list",
      params: {},
    }, ListToolsResultSchema);

    expect(tools.tools[0]?.name).toBe("listen");
    await transport.close();
  });
});
