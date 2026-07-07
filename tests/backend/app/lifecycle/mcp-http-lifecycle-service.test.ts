import { afterEach, describe, expect, it, vi } from "vitest";
import { createConnection } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ListToolsRequestSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { bootMcpHttpTransport, type McpHttpTransportHandle } from "../../../../src/app/lifecycle/mcp-lifecycle-service.js";

const handles: McpHttpTransportHandle[] = [];
const STRONG_TOKEN = "cux_test_abcdefghijklmnopqrstuvwxyz123456";

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

function rawHttpRequest(options: {
  port: number;
  path: string;
  method: string;
  headers: string[];
  body?: string;
}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const body = options.body ?? "";
    const socket = createConnection({ host: "127.0.0.1", port: options.port }, () => {
      const headerLines: string[] = [
        `${options.method} ${options.path} HTTP/1.1`,
        "Host: 127.0.0.1",
        "Connection: close",
        `Content-Length: ${Buffer.byteLength(body)}`,
      ];
      for (let index = 0; index < options.headers.length; index += 2) {
        headerLines.push(`${options.headers[index]}: ${options.headers[index + 1]}`);
      }
      socket.write(`${headerLines.join("\r\n")}\r\n\r\n${body}`);
    });
    let raw = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      raw += chunk;
    });
    socket.on("error", reject);
    socket.on("end", () => {
      const status = Number.parseInt(raw.match(/^HTTP\/1\.1 (\d+)/)?.[1] ?? "0", 10);
      const [, responseBody = ""] = raw.split("\r\n\r\n");
      resolve({ status, body: responseBody });
    });
  });
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
    })).rejects.toThrow("MCP HTTP auth token is required");
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

  it("requires auth on loopback when explicit auth is required", async () => {
    await expect(bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: null,
      requireAuth: true,
      logger: createLogger(),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    })).rejects.toThrow("MCP HTTP auth token is required for server mode");
  });

  it("rejects weak server-mode auth tokens at startup", async () => {
    await expect(bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: "short-token",
      requireAuth: true,
      logger: createLogger(),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    })).rejects.toThrow("at least 32 bearer-safe characters");
  });

  it("serves headless health and readiness probes from the MCP HTTP transport", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: STRONG_TOKEN,
      requireAuth: true,
      getReady: () => ({
        status: "READY",
        components: {
          settingsDb: "UP",
          dashboardBind: "UP",
          mcpService: "UP",
        },
      }),
      logger: createLogger(),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    });
    handles.push(handle!);

    const health = await fetch(`http://127.0.0.1:${handle!.port}/health`);
    const ready = await fetch(`http://127.0.0.1:${handle!.port}/ready`);

    expect(health.status).toBe(200);
    await expect(health.json()).resolves.toEqual({ status: "UP" });
    expect(ready.status).toBe(200);
    await expect(ready.json()).resolves.toMatchObject({ status: "READY" });
  });

  it("returns 503 when MCP HTTP readiness callback reports not ready", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: STRONG_TOKEN,
      requireAuth: true,
      getReady: () => ({ status: "NOT_READY" }),
      logger: createLogger(),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    });
    handles.push(handle!);

    const ready = await fetch(`http://127.0.0.1:${handle!.port}/ready`);

    expect(ready.status).toBe(503);
    await expect(ready.json()).resolves.toEqual({ status: "NOT_READY" });
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
      authToken: STRONG_TOKEN,
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
      authToken: STRONG_TOKEN,
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
      authToken: STRONG_TOKEN,
      maxSessions: 2,
      logger: createLogger({ warn }),
      createServer: createTestServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
    });
    handles.push(handle!);

    const clients = [];
    for (let i = 0; i < 2; i++) {
      const { client, transport } = createAuthClient(handle!, STRONG_TOKEN);
      await client.connect(transport);
      clients.push({ client, transport });
    }

    const { client: clientOver, transport: transportOver } = createAuthClient(handle!, STRONG_TOKEN);
    await expect(clientOver.connect(transportOver)).rejects.toThrow();
    expect(JSON.stringify(warn.mock.calls)).toContain("MCP HTTP session cap reached");
    expect(JSON.stringify(warn.mock.calls)).not.toContain(STRONG_TOKEN);
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
      logger: createLogger({ info: vi.fn() }),
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
      authToken: STRONG_TOKEN,
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
    expect(logs).toContain("Unauthorized MCP HTTP request");
    expect(logs).not.toContain("wrong-token");
    expect(logs).not.toContain(STRONG_TOKEN);
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
    const createServer = vi.fn(createTestServer);
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: STRONG_TOKEN,
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
      createServer,
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
    expect(createServer).not.toHaveBeenCalled();
  });

  it("rejects duplicate security headers before session lookup", async () => {
    const warn = vi.fn();
    const createServer = vi.fn(createTestServer);
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: STRONG_TOKEN,
      logger: createLogger({ warn }),
      createServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    });
    handles.push(handle!);

    const response = await rawHttpRequest({
      port: handle!.port,
      path: handle!.path,
      method: "POST",
      headers: [
        "Content-Type", "application/json",
        "Authorization", `Bearer ${STRONG_TOKEN}`,
        "Authorization", `Bearer ${STRONG_TOKEN}`,
        "mcp-session-id", "session-that-must-not-be-probed",
      ],
      body: "{}",
    });

    expect(response.status).toBe(401);
    expect(JSON.parse(response.body)).toMatchObject({ error: { message: "Unauthorized" } });
    expect(createServer).not.toHaveBeenCalled();
    const logs = JSON.stringify(warn.mock.calls);
    expect(logs).toContain("invalid security headers");
    expect(logs).not.toContain(STRONG_TOKEN);
    expect(logs).not.toContain("session-that-must-not-be-probed");
  });

  it("rate limits before JSON parsing and never creates sessions for oversized unauthenticated traffic", async () => {
    const warn = vi.fn();
    const createServer = vi.fn(createTestServer);
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: STRONG_TOKEN,
      rateLimit: { windowMs: 60_000, max: 1 },
      logger: createLogger({ warn }),
      createServer,
      recoveryService: { recover: async () => ({ resumedSprintRunIds: [] }) } as any,
      runStartupRecovery: false,
    });
    handles.push(handle!);

    const oversizedBody = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "oversized-client", version: "1.0.0" },
        padding: "x".repeat(1024 * 1024),
      },
    });
    const first = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody,
    });
    const second = await fetch(`http://127.0.0.1:${handle!.port}${handle!.path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: oversizedBody,
    });

    expect(first.status).toBe(413);
    expect(second.status).toBe(429);
    await expect(second.json()).resolves.toMatchObject({ error: { message: "Too many requests" } });
    expect(createServer).not.toHaveBeenCalled();
    expect(JSON.stringify(warn.mock.calls)).toContain("Rate limited MCP HTTP request");
  });

  it("accepts authorized streamable HTTP MCP clients", async () => {
    const handle = await bootMcpHttpTransport({
      enabled: true,
      host: "127.0.0.1",
      port: 0,
      path: "/mcp",
      authToken: STRONG_TOKEN,
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
            Authorization: `Bearer ${STRONG_TOKEN}`,
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
