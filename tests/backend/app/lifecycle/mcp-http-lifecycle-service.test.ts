import { afterEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { bootMcpHttpTransport, type McpHttpTransportHandle } from "../../../../src/app/lifecycle/mcp-lifecycle-service.js";

const handles: McpHttpTransportHandle[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
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

function createLogger(overrides: Partial<{
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
}> = {}) {
  const logger = {
    info: overrides.info ?? vi.fn(),
    warn: overrides.warn ?? vi.fn(),
    error: overrides.error ?? vi.fn(),
    debug: overrides.debug ?? vi.fn(),
    child: () => logger,
  };
  return logger as any;
}

function createAuthClient(handle: McpHttpTransportHandle, authToken?: string): { client: Client; transport: StreamableHTTPClientTransport } {
  const transport = new StreamableHTTPClientTransport(
    new URL(`http://127.0.0.1:${handle.port}${handle.path}`),
    authToken
      ? {
          requestInit: {
            headers: {
              Authorization: `Bearer ${authToken}`,
            },
          },
        }
      : undefined,
  );
  const client = new Client({ name: "test", version: "1.0.0" });
  return { client, transport };
}

describe("bootMcpHttpTransport", () => {
  it.each(["0.0.0.0", "::", "192.168.1.10"])("fails startup on non-loopback host %s without auth", async (host) => {
    await expect(bootMcpHttpTransport({
      enabled: true,
      host,
      port: 0,
      path: "/mcp",
      authToken: null,
      logger: createLogger(),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    })).rejects.toThrow("MCP HTTPS auth token is required");
  });

  it.each(["127.0.0.1", "localhost", "::1"])("preserves unauthenticated loopback startup on %s", async (host) => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host,
      port: 0,
      path: "/mcp",
      authToken: null,
      logger: createLogger(),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    });
    handles.push(handle!);

    expect(handle).not.toBeNull();
  });

  it("can bind without awaiting startup recovery", async () => {
    const recover = vi.fn().mockResolvedValue({ resumedSprintRunIds: [] });
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
      recoveryService: { recover } as any,
      runStartupRecovery: false,
    });
    handles.push(handle!);

    expect(handle).not.toBeNull();
    expect(recover).not.toHaveBeenCalled();
  });

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
    const warn = vi.fn();
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: "secret-token",
      maxSessions: 2,
      logger: createLogger({ warn }),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const clients = [];
    for (let i = 0; i < 2; i++) {
      const { client, transport } = createAuthClient(handle!, "secret-token");
      await client.connect(transport);
      clients.push({ client, transport });
    }

    const { client: clientOver, transport: transportOver } = createAuthClient(handle!, "secret-token");
    await expect(clientOver.connect(transportOver)).rejects.toThrow();
    expect(JSON.stringify(warn.mock.calls)).toContain("MCP HTTPS session cap reached");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Bearer");

    for (const c of clients) {
      await c.transport.close();
    }
  });

  it("closes stale sessions before accepting a new initialize request", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: null,
      maxSessions: 2,
      sessionTimeoutMs: 1_000,
      logger: createLogger(),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const clients = [];
    for (let i = 0; i < 2; i++) {
      const { client, transport } = createAuthClient(handle!);
      await client.connect(transport);
      clients.push({ client, transport });
    }

    now += 1_001;
    const { client: freshClient, transport: freshTransport } = createAuthClient(handle!);
    await expect(freshClient.connect(freshTransport)).resolves.toBeUndefined();
    const tools = await freshClient.request({
      method: "tools/list",
      params: {},
    }, ListToolsResultSchema);

    expect(tools.tools[0]?.name).toBe("listen");
    await freshTransport.close();
    for (const c of clients) {
      await c.transport.close().catch(() => undefined);
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
    await expect(res1.json()).resolves.toMatchObject({
      error: {
        message: "Bad Request: Invalid identifier",
      },
    });

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

  it("rejects malformed authorization without leaking session state or bearer values", async () => {
    const warn = vi.fn();
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: "secret-token",
      logger: createLogger({ warn }),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const response = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Bearer wrong-token",
        "mcp-session-id": "session-that-must-not-be-probed",
      },
      body: "{}",
    });

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Unauthorized",
      },
    });
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).toContain("Unauthorized MCP HTTPS request");
    expect(logs).not.toContain("wrong-token");
    expect(logs).not.toContain("secret-token");
    expect(logs).not.toContain("session-that-must-not-be-probed");
    expect(logs).not.toContain("Unknown MCP session id");
  });

  it("returns a generic bad request for inactive sessions", async () => {
    const warn = vi.fn();
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: null,
      logger: createLogger({ warn }),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const response = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "mcp-session-id": "inactive-session-id",
      },
      body: "{}",
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        message: "Bad Request: Invalid MCP session",
      },
    });
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).not.toContain("inactive-session-id");
    expect(logs).not.toContain("Unknown MCP session id");
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
