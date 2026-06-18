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
  it("rejects unauthorized missing token", async () => {
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
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
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

  it("rejects wrong token", async () => {
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
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const response = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer wrong-token"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "wrong-client", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it("rejects wrong-length token securely", async () => {
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
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const response = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer secret"
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-03-26",
          capabilities: {},
          clientInfo: { name: "wrong-len-client", version: "1.0.0" },
        },
      }),
    });

    expect(response.status).toBe(401);
  });

  it("enforces active-session cap", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: null, // Allow no auth for easy loop
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
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const clients = [];
    for (let i = 0; i < 100; i++) {
      const transport = new StreamableHTTPClientTransport(
        new URL(`http://127.0.0.1:${handle!.port}${handle!.path}`)
      );
      const client = new Client({ name: "test", version: "1.0.0" });
      await client.connect(transport);
      clients.push({ client, transport });
    }

    const transportOver = new StreamableHTTPClientTransport(
      new URL(`http://127.0.0.1:${handle!.port}${handle!.path}`)
    );
    const clientOver = new Client({ name: "test", version: "1.0.0" });
    await expect(clientOver.connect(transportOver)).rejects.toThrow();

    for (const c of clients) {
      await c.transport.close();
    }
  });

  it("rejects invalid session/agent headers", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: null,
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
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    // Oversized
    const oversized = "a".repeat(101);
    const res1 = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "mcp-session-id": oversized
      },
      body: "{}"
    });
    expect(res1.status).toBe(400);

    // Bad chars
    const res2 = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-code-ux-agent": "invalid/chars"
      },
      body: "{}"
    });
    expect(res2.status).toBe(400);
  });

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
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
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
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
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
