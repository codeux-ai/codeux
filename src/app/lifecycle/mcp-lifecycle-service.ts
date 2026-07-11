import express from "express";
import * as fs from "node:fs";
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from "http";
import type { AddressInfo } from "net";
import type { Socket } from "node:net";
import { randomUUID, timingSafeEqual, createHash } from "crypto";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import type { Server as McpServer } from "@modelcontextprotocol/sdk/server/index.js";
import type { Logger } from "../../shared/logging/logger.js";
import { CODE_UX_DISPLAY_NAME, CODE_UX_VERSION } from "../../shared/config/code-ux-paths.js";
import type { RuntimeStartupRecoveryService } from "../../services/runtime-startup-recovery-service.js";
import { runWithMcpAgentContext } from "../../server/mcp-agent-context.js";
import { createHttpRateLimiter } from "../../shared/http/rate-limit.js";
import type { ReadinessProbeStatus } from "../../contracts/app-types.js";

export interface BootMcpTransportDeps {
  server: McpServer;
  logger: Logger;
}

interface StdinLike {
  fd?: number;
  isTTY?: boolean;
}

export interface BootMcpHttpTransportDeps {
  enabled: boolean;
  host: string;
  port: number | null;
  path: string;
  authToken: string | null;
  getAuthToken?: () => string | null;
  requireAuth?: boolean;
  getReady?: () => ReadinessProbeStatus;
  maxSessions?: number;
  sessionTimeoutMs?: number;
  rateLimit?: {
    windowMs?: number;
    max?: number;
  };
  logger: Logger;
  createServer: () => McpServer;
  recoveryService: RuntimeStartupRecoveryService;
  onRecovered?: (recoveredSprintRunIds: string[]) => void;
  runStartupRecovery?: boolean;
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

const DEFAULT_MAX_SESSIONS = 100;
const DEFAULT_SESSION_TIMEOUT_MS = 60 * 60 * 1000;
const MIN_SERVER_MODE_AUTH_TOKEN_LENGTH = 32;
const MAX_AUTHORIZATION_HEADER_LENGTH = 4096;
const BEARER_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+={0,2}$/;
const IDENTIFIER_PATTERN = /^[a-zA-Z0-9-]+$/;

function isLoopbackHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "127.0.0.1"
    || normalized === "localhost"
    || normalized === "::1";
}

function headerCount(req: IncomingMessage, name: string): number {
  const normalizedName = name.toLowerCase();
  let count = 0;
  for (let index = 0; index < req.rawHeaders.length; index += 2) {
    if (req.rawHeaders[index]?.toLowerCase() === normalizedName) {
      count += 1;
    }
  }
  return count;
}

function readSingleHeader(req: IncomingMessage, name: string): string | null {
  const header = req.headers[name.toLowerCase()];
  if (typeof header === "undefined") {
    return null;
  }
  if (Array.isArray(header) || headerCount(req, name) > 1) {
    throw new Error(`Invalid ${name}`);
  }
  if (typeof header !== "string") {
    throw new Error(`Invalid ${name}`);
  }
  const value = header.trim();
  if (value.length === 0) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function readIdentifierHeader(req: IncomingMessage, name: string): string | null {
  const value = readSingleHeader(req, name);
  if (!value) {
    return null;
  }
  if (value.length > 100 || !IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${name}`);
  }
  return value;
}

function readSessionIdHeader(req: IncomingMessage): string | null {
  return readIdentifierHeader(req, "mcp-session-id");
}

function readAgentIdHeader(req: IncomingMessage): string | null {
  return readIdentifierHeader(req, "x-code-ux-agent");
}

function readThreadIdHeader(req: IncomingMessage): string | null {
  return readIdentifierHeader(req, "x-code-ux-thread");
}

function readAuthorizationHeader(req: IncomingMessage): string | null {
  const value = readSingleHeader(req, "authorization");
  if (!value) {
    return null;
  }
  if (value.length > MAX_AUTHORIZATION_HEADER_LENGTH || !/^Bearer [^\s]+$/.test(value)) {
    throw new Error("Invalid authorization");
  }
  return value;
}

function validateServerModeAuthToken(authToken: string): void {
  if (authToken.length < MIN_SERVER_MODE_AUTH_TOKEN_LENGTH || !BEARER_TOKEN_PATTERN.test(authToken)) {
    throw new Error("MCP HTTP auth token for server mode must contain at least 32 bearer-safe characters.");
  }
}

function isAuthorizedRequest(req: IncomingMessage, authToken: string | null): boolean {
  const header = readAuthorizationHeader(req);
  if (!authToken) {
    return true;
  }

  if (!header) {
    return false;
  }

  const expected = `Bearer ${authToken}`;

  const expectedHash = createHash("sha256").update(expected).digest();
  const actualHash = createHash("sha256").update(header).digest();

  return timingSafeEqual(expectedHash, actualHash);
}

interface ValidatedMcpHttpRequestHeaders {
  sessionId: string | null;
  agentId: string | null;
  threadId: string | null;
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
  const stdioMode = resolveMcpStdioMode(process.stdin, process.env);
  if (stdioMode.enabled === false) {
    deps.logger.info(`${CODE_UX_DISPLAY_NAME} MCP stdio transport disabled by environment`);
    return;
  }

  if (stdioMode.enabled === null) {
    deps.logger.info(`${CODE_UX_DISPLAY_NAME} running in standalone mode (${stdioMode.reason}) — MCP stdio transport disabled`);
    return;
  }

  const transport = new StdioServerTransport();
  await deps.server.connect(transport);
  deps.logger.info(`${CODE_UX_DISPLAY_NAME} MCP server running on stdio`, { version: CODE_UX_VERSION });
}

export function resolveMcpStdioMode(
  stdin: StdinLike,
  env: NodeJS.ProcessEnv,
  fstat: (fd: number) => fs.Stats = fs.fstatSync,
): { enabled: true; reason: string } | { enabled: false; reason: string } | { enabled: null; reason: string } {
  if (env.CODE_UX_DISABLE_MCP_STDIO === "1") {
    return { enabled: false, reason: "disabled_by_environment" };
  }
  if (env.CODE_UX_ENABLE_MCP_STDIO === "1") {
    return { enabled: true, reason: "enabled_by_environment" };
  }
  if (stdin.isTTY) {
    return { enabled: null, reason: "stdin is a TTY" };
  }

  const fd = typeof stdin.fd === "number" ? stdin.fd : 0;
  try {
    const stats = fstat(fd);
    if (stats.isFIFO() || stats.isSocket()) {
      return { enabled: true, reason: "stdin is a pipe/socket" };
    }
    return { enabled: null, reason: "stdin is not an MCP pipe" };
  } catch {
    return { enabled: null, reason: "stdin cannot be inspected" };
  }
}

export async function bootMcpHttpTransport(deps: BootMcpHttpTransportDeps): Promise<McpHttpTransportHandle | null> {
  const runStartupRecovery = deps.runStartupRecovery ?? true;
  if (!deps.enabled || deps.port === null) {
    if (runStartupRecovery) {
      try {
        const recoveryResult = await deps.recoveryService.recover();
        deps.logger.info("Recovery routine completed");
        deps.onRecovered?.(recoveryResult.resumedSprintRunIds);
      } catch (error) {
        deps.logger.error("Failed to recover runtime state on startup", { error });
      }
    }
    return null;
  }

  const readAuthToken = (): string | null => deps.getAuthToken?.() ?? deps.authToken;

  const startupAuthToken = readAuthToken()?.trim() ?? "";

  if ((deps.requireAuth || !isLoopbackHost(deps.host)) && !startupAuthToken) {
    throw new Error(deps.requireAuth
      ? "MCP HTTP auth token is required for server mode."
      : "MCP HTTP auth token is required when binding the MCP HTTP server to a non-loopback host.");
  }
  if (deps.requireAuth && startupAuthToken) {
    validateServerModeAuthToken(startupAuthToken);
  }

  const app = express();
  // This gateway is network-exposed (HTTPS worker transport), so rate-limit it
  // in front of the auth check to blunt token brute-forcing and request floods.
  // The cap is well above a busy worker host's normal request rate.
  app.use(createHttpRateLimiter({
    ...deps.rateLimit,
    jsonRpc: true,
    onLimited: (req) => {
      deps.logger.warn("Rate limited MCP HTTP request", {
        path: req.path,
        method: req.method,
      });
    },
  }));
  app.use(express.json({ limit: "1mb" }));

  const sessions = new Map<string, McpHttpSessionEntry>();
  const maxSessions = Number.isInteger(deps.maxSessions) && (deps.maxSessions ?? 0) > 0
    ? deps.maxSessions!
    : DEFAULT_MAX_SESSIONS;
  const sessionTimeoutMs = Number.isInteger(deps.sessionTimeoutMs) && (deps.sessionTimeoutMs ?? 0) > 0
    ? deps.sessionTimeoutMs!
    : DEFAULT_SESSION_TIMEOUT_MS;

  const closeSession = async (sessionId: string): Promise<void> => {
    const entry = sessions.get(sessionId);
    if (!entry) {
      return;
    }
    sessions.delete(sessionId);
    await entry.transport.close().catch(() => undefined);
  };

  const cleanupIdleSessions = async (): Promise<void> => {
    const now = Date.now();
    const staleSessionIds = [...sessions.entries()]
      .filter(([, session]) => now - session.lastAccessed > sessionTimeoutMs)
      .map(([id]) => id);
    if (staleSessionIds.length > 0) {
      deps.logger.info("Closing idle MCP HTTP sessions", {
        staleSessions: staleSessionIds.length,
        activeSessions: sessions.size,
        sessionTimeoutMs,
      });
    }
    await Promise.all(staleSessionIds.map((sessionId) => closeSession(sessionId)));
  };

  app.all(deps.path, async (req, res) => {
    let headers: ValidatedMcpHttpRequestHeaders;
    try {
      const authToken = readAuthToken();
      if (!isAuthorizedRequest(req, authToken)) {
        deps.logger.warn("Unauthorized MCP HTTP request", {
          path: req.path,
          method: req.method,
          authRequired: !!authToken,
        });
        respondUnauthorized(res);
        return;
      }
    } catch {
      deps.logger.warn("Rejected MCP HTTP request with invalid security headers", {
        path: req.path,
        method: req.method,
        authRequired: !!readAuthToken(),
      });
      respondUnauthorized(res);
      return;
    }
    try {
      headers = {
        sessionId: readSessionIdHeader(req),
        agentId: readAgentIdHeader(req),
        threadId: readThreadIdHeader(req),
      };
    } catch {
      deps.logger.warn("Rejected MCP HTTP request with invalid identifiers", {
        path: req.path,
        method: req.method,
      });
      respondBadRequest(res, "Bad Request: Invalid identifier");
      return;
    }

    try {
      let entry = headers.sessionId ? sessions.get(headers.sessionId) : undefined;

      if (headers.sessionId && !entry) {
        deps.logger.warn("Rejected MCP HTTP request with inactive session", { path: req.path, method: req.method });
        respondBadRequest(res, "Bad Request: Invalid MCP session");
        return;
      }

      if (!entry) {
        if (req.method !== "POST" || !isInitializeRequest(req.body)) {
          respondBadRequest(res, "Bad Request: No valid MCP session is active and request is not an initialize call");
          return;
        }

        await cleanupIdleSessions();

        if (sessions.size >= maxSessions) {
          deps.logger.warn("MCP HTTP session cap reached", {
            path: req.path,
            method: req.method,
            maxSessions,
            activeSessions: sessions.size,
          });
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
      await runWithMcpAgentContext(
        headers.agentId,
        headers.threadId,
        () => entry!.transport.handleRequest(req, res, req.body),
      );

      if (req.method === "DELETE") {
        if (headers.sessionId) {
          await closeSession(headers.sessionId);
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

  app.get("/ready", (req, res) => {
    const ready = deps.getReady ? deps.getReady() : { status: "READY" as const };
    if (ready.status === "READY" || ready.status === "UP") {
      res.json(ready);
    } else {
      res.status(503).json(ready);
    }
  });

  const server = await new Promise<HttpServer>((resolve, reject) => {
    const httpServer = createServer(app);
    httpServer.listen(deps.port!, deps.host, () => resolve(httpServer));
    httpServer.on("error", reject);
  });
  const sockets = new Set<Socket>();
  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });
  const address = server.address() as AddressInfo | null;
  const resolvedPort = address?.port ?? deps.port;

  if (runStartupRecovery) {
    try {
      const recoveryResult = await deps.recoveryService.recover();
      deps.logger.info("Recovery routine completed");
      deps.onRecovered?.(recoveryResult.resumedSprintRunIds);
    } catch (error) {
      deps.logger.error("Failed to recover runtime state on startup", { error });
    }
  }

  deps.logger.info(`${CODE_UX_DISPLAY_NAME} MCP HTTP server running`, {
    mode: deps.requireAuth ? "server" : "standard",
    host: deps.host,
    port: resolvedPort,
    path: deps.path,
    authRequired: !!readAuthToken(),
    maxSessions,
    sessionTimeoutMs,
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
        server.closeIdleConnections?.();
        for (const socket of sockets) {
          socket.destroy();
        }
        server.closeAllConnections?.();
      });
    },
  };
}
