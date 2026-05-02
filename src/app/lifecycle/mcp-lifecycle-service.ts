import express from "express";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { Logger } from "../../shared/logging/logger.js";
import { SPRINT_OS_DISPLAY_NAME } from "../../shared/config/sprint-os-paths.js";
import type { RuntimeStartupRecoveryService } from "../../services/runtime-startup-recovery-service.js";

export interface BootMcpTransportDeps {
  server: McpServer;
  logger: Logger;
  isJulesApiConfigured: () => boolean;
  getMissingJulesApiKeyInstruction: () => string;
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
}

function readSessionIdHeader(req: IncomingMessage): string | null {
  const header = req.headers["mcp-session-id"];
  if (Array.isArray(header)) {
    return header[0]?.trim() || null;
  }
  return typeof header === "string" ? header.trim() || null : null;
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
  return header.trim() === expected;
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
  if (!deps.isJulesApiConfigured()) {
    deps.logger.warn("Jules API key is not set. Jules-native tools are disabled; Gemini/Codex CLI providers can still run.");
    deps.logger.warn(deps.getMissingJulesApiKeyInstruction());
  }

  if (process.stdin.isTTY) {
    deps.logger.info(`${SPRINT_OS_DISPLAY_NAME} running in standalone mode (stdin is a TTY) — MCP stdio transport disabled`);
    return;
  }

  const transport = new StdioServerTransport();
  await deps.server.connect(transport);
  deps.logger.info(`${SPRINT_OS_DISPLAY_NAME} MCP server running on stdio`, { version: "1.2.0" });
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
      respondUnauthorized(res);
      return;
    }

    try {
      const sessionId = readSessionIdHeader(req);
      let entry = sessionId ? sessions.get(sessionId) : undefined;

      if (!entry) {
        if (sessionId) {
          respondBadRequest(res, "Bad Request: Unknown MCP session id");
          return;
        }

        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          respondBadRequest(res, "Bad Request: No valid MCP session is active and request is not an initialize call");
          return;
        }

        const server = deps.createServer();
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (initializedSessionId) => {
            sessions.set(initializedSessionId, { server, transport });
          },
        });
        transport.onclose = () => {
          const currentSessionId = transport.sessionId;
          if (currentSessionId) {
            sessions.delete(currentSessionId);
          }
        };
        await server.connect(transport);
        entry = { server, transport };
      }

      await entry.transport.handleRequest(req, res, req.body);

      if (req.method === "DELETE") {
        const activeSessionId = readSessionIdHeader(req);
        if (activeSessionId) {
          await closeSession(activeSessionId);
        }
      }
    } catch (error) {
      deps.logger.error("MCP HTTP request failed", { error, path: req.path, method: req.method });
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

  deps.logger.info(`${SPRINT_OS_DISPLAY_NAME} MCP HTTP server running`, {
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
