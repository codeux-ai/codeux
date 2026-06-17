import express from "express";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { randomUUID, timingSafeEqual, createHash } from "crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { Logger } from "../../shared/logging/logger.js";
import { CODE_UX_DISPLAY_NAME, CODE_UX_VERSION } from "../../shared/config/code-ux-paths.js";
import type { RuntimeStartupRecoveryService } from "../../services/runtime-startup-recovery-service.js";
import { runWithMcpAgentContext } from "../../server/mcp-agent-context.js";

export interface BootMcpTransportDeps {
  server: McpServer;
  logger: Logger;
}

export interface BootMcpHttpTransportDeps {
  enabled: boolean;
  host: string;
  port: number | null;
  path: string;
  authToken: string | null;
  logger: Logger;
  createServer: () => McpServer;
  recoveryService: RuntimeStartupRecoveryService;
  onRecovered?: (recoveredSprintRunIds: string[]) => void;
}

export interface McpHttpTransportHandle {
  host: string;
  port: number;
  path: string;
  close: () => Promise<void>;
}

interface McpHttpSessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  lastAccessed: number;
}

function readSessionIdHeader(req: IncomingMessage): string | null {
  const header = req.headers["mcp-session-id"];
  let value: string | null = null;
  if (Array.isArray(header)) {
    value = header[0]?.trim() || null;
  } else if (typeof header === "string") {
    value = header.trim() || null;
  }
  if (value) {
    if (value.length > 100 || !/^[a-zA-Z0-9-]+$/.test(value)) {
      throw new Error("Invalid mcp-session-id");
    }
  }
  return value;
}

function readAgentIdHeader(req: IncomingMessage): string | null {
  const header = req.headers["x-code-ux-agent"];
  let value: string | null = null;
  if (Array.isArray(header)) {
    value = header[0]?.trim() || null;
  } else if (typeof header === "string") {
    value = header.trim() || null;
  }
  if (value) {
    if (value.length > 100 || !/^[a-zA-Z0-9-]+$/.test(value)) {
      throw new Error("Invalid x-code-ux-agent");
    }
  }
  return value;
}

function isAuthorizedRequest(req: IncomingMessage, authToken: string | null): boolean {
  if (!authToken) {
    return true;
  }

  const header = req.headers.authorization;
  if (typeof header !== "string") {
    return false;
  }

  const expected = `Bearer ${authToken}`;
  const actualStr = header.trim();

  const expectedHash = createHash("sha256").update(expected).digest();
  const actualHash = createHash("sha256").update(actualStr).digest();

  return timingSafeEqual(expectedHash, actualHash);
}

function respondUnauthorized(res: ServerResponse): void {
  res.statusCode = 401;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32001,
      message: "Unauthorized",
    },
    id: null,
  }));
}

function respondBadRequest(res: ServerResponse, message: string): void {
  res.statusCode = 400;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    jsonrpc: "2.0",
    error: {
      code: -32000,
      message,
    },
    id: null,
  }));
}

export async function bootMcpTransport(deps: BootMcpTransportDeps): Promise<void> {
  if (process.env.CODE_UX_DISABLE_MCP_STDIO === "1") {
    deps.logger.info(`${CODE_UX_DISPLAY_NAME} MCP stdio transport disabled by environment`);
    return;
  }

  if (process.stdin.isTTY) {
    deps.logger.info(`${CODE_UX_DISPLAY_NAME} running in standalone mode (stdin is a TTY) — MCP stdio transport disabled`);
    return;
  }

  const transport = new StdioServerTransport();
  await deps.server.connect(transport);
  deps.logger.info(`${CODE_UX_DISPLAY_NAME} MCP server running on stdio`, { version: CODE_UX_VERSION });
}

export async function bootMcpHttpTransport(deps: BootMcpHttpTransportDeps): Promise<McpHttpTransportHandle | null> {
  if (!deps.enabled || deps.port === null) {
    try {
      const recoveryResult = await deps.recoveryService.recover();
      deps.logger.info("Recovery routine completed");
      deps.onRecovered?.(recoveryResult.resumedSprintRunIds);
    } catch (error) {
      deps.logger.error("Failed to recover runtime state on startup", { error });
    }
    return null;
  }

  const app = express();
  app.use(express.json({ limit: "1mb" }));

  const sessions = new Map<string, McpHttpSessionEntry>();
  const MAX_SESSIONS = 100;
  const SESSION_TIMEOUT_MS = 60 * 60 * 1000;

  const closeSession = async (sessionId: string): Promise<void> => {
    const entry = sessions.get(sessionId);
    if (!entry) {
      return;
    }
    sessions.delete(sessionId);
    await entry.transport.close().catch(() => undefined);
  };

  app.all(deps.path, async (req, res) => {
    if (!isAuthorizedRequest(req, deps.authToken)) {
      deps.logger.warn("Unauthorized MCP HTTPS request", { path: req.path, method: req.method });
      respondUnauthorized(res);
      return;
    }

    try {
      let sessionId: string | null = null;
      try {
        sessionId = readSessionIdHeader(req);
        // Also validate agent header early to catch errors
        readAgentIdHeader(req);
      } catch (err: any) {
        deps.logger.warn("Rejected request due to invalid identifier", { path: req.path, method: req.method });
        respondBadRequest(res, "Bad Request: Invalid identifier");
        return;
      }

      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (sessionId && !entry) {
        deps.logger.warn("Unknown MCP session id", { path: req.path, method: req.method });
        respondBadRequest(res, "Bad Request: Unknown MCP session id");
        return;
      }

      if (!entry) {
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          respondBadRequest(res, "Bad Request: No valid MCP session is active and request is not an initialize call");
          return;
        }

        // Cleanup idle sessions
        const now = Date.now();
        for (const [id, session] of sessions.entries()) {
          if (now - session.lastAccessed > SESSION_TIMEOUT_MS) {
            closeSession(id).catch(() => undefined);
          }
        }

        if (sessions.size >= MAX_SESSIONS) {
          deps.logger.warn("MCP HTTPS session cap reached", { path: req.path, method: req.method });
          respondBadRequest(res, "Bad Request: Too many active sessions");
          return;
        }

        const server = deps.createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, { server, transport, lastAccessed: Date.now() });
          },
        });
        transport.onclose = () => {
          const currentSessionId = transport.sessionId;
          if (currentSessionId) {
            sessions.delete(currentSessionId);
          }
        };
        await server.connect(transport);
        entry = { server, transport, lastAccessed: Date.now() };
      }

      entry.lastAccessed = Date.now();
      await runWithMcpAgentContext(readAgentIdHeader(req), () => entry!.transport.handleRequest(req, res, req.body));

      if (req.method === "DELETE") {
        const activeSessionId = readSessionIdHeader(req);
        if (activeSessionId) {
          await closeSession(activeSessionId);
        }
      }
    } catch (error) {
      deps.logger.error("MCP HTTPS request failed", { error, path: req.path, method: req.method });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  app.get("/health", (req, res) => {
    res.json({ status: "UP" });
  });

  const server = await new Promise<HttpServer>((resolve, reject) => {
    const httpServer = createServer(app);
    httpServer.listen(deps.port!, deps.host, () => resolve(httpServer));
    httpServer.on("error", reject);
  });
  const address = server.address() as AddressInfo | null;
  const resolvedPort = address?.port ?? deps.port;

  try {
    const recoveryResult = await deps.recoveryService.recover();
    deps.logger.info("Recovery routine completed");
    deps.onRecovered?.(recoveryResult.resumedSprintRunIds);
  } catch (error) {
    deps.logger.error("Failed to recover runtime state on startup", { error });
  }

  deps.logger.info(`${CODE_UX_DISPLAY_NAME} MCP HTTPS server running`, {
    host: deps.host,
    port: resolvedPort,
    path: deps.path,
    authRequired: !!deps.authToken,
  });

  return {
    host: deps.host,
    port: resolvedPort,
    path: deps.path,
    close: async () => {
      const sessionIds = [...sessions.keys()];
      await Promise.all(sessionIds.map((sessionId) => closeSession(sessionId)));
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error && error.message !== "Server is not running.") {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
}
