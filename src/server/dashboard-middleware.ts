import express, { type ErrorRequestHandler, type Express, type RequestHandler } from "express";
import * as fs from "fs";
import * as path from "path";
import type { IncomingMessage } from "http";
import type { Logger } from "../shared/logging/logger.js";
import { correlationIdMiddleware } from "../shared/logging/correlation-id.js";
import {
  applyDashboardSecurityHeaders,
  isHostileBrowserOrigin,
  isTrustedDashboardHost,
  isTrustedDashboardPreviewHost,
} from "./dashboard-security.js";
import { createPreviewHostMiddleware } from "./preview-host-middleware.js";
import { parsePreviewSessionIdFromHost } from "./preview-host-utils.js";
import { createHttpRateLimiter } from "../shared/http/rate-limit.js";
import { getCorrelationId } from "../shared/logging/correlation-id.js";
import { HeadlessAuthenticationError, HeadlessAuthService } from "../services/headless-auth-service.js";
import type { DashboardServerOptions } from "./dashboard-server.js";
import {
  DASHBOARD_DEFAULT_JSON_BODY_LIMIT,
  DASHBOARD_LARGE_SETTINGS_JSON_BODY_LIMIT,
  type DashboardJsonBodyLimit,
  getDashboardJsonBodyLimit,
  isSupportedDashboardJsonContentType,
} from "./request-parsers.js";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export const applyDashboardPreRouteMiddleware = (
  app: Express,
  options: DashboardServerOptions,
  dashboardLogger: Logger
): void => {
  app.use(correlationIdMiddleware());
  app.use((req, res, next) => {
    // Preview-host requests proxy a locally-running app that the dashboard renders inside
    // a cross-origin iframe (preview-<id>.localhost). Stamping the dashboard hardening
    // headers — notably X-Frame-Options: SAMEORIGIN and a restrictive Permissions-Policy —
    // onto those proxied responses makes the browser refuse to frame the preview and
    // disables browser features (camera/mic/geolocation) inside it. Previews are local,
    // trusted content, so skip the hardening headers and let them render in full.
    if (parsePreviewSessionIdFromHost(req.headers.host) === null) {
      applyDashboardSecurityHeaders(res);
    }

    const requestPath = req.path.toLowerCase();
    const isRuntimeDataPath = requestPath.startsWith("/api/")
      || requestPath === "/health"
      || requestPath === "/ready";
    if (isRuntimeDataPath) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
    }
    next();
  });

  const authService = options.headlessAuthService ?? new HeadlessAuthService();
  app.use("/api", createHttpRateLimiter({
    windowMs: 60_000,
    max: 600,
    onLimited: (req) => dashboardLogger.warn("Dashboard API request rate limit exceeded", {
      logPurpose: "security",
      method: req.method,
      path: req.path,
    }),
  }));
  app.use("/api", (req, res, next) => {
    const requestPath = req.path.toLowerCase();
    if (requestPath.startsWith("/webhooks/") || /(?:^|\/)ingress(?:\/|$)/.test(requestPath)) {
      next();
      return;
    }
    const startedAt = Date.now();
    try {
      const principal = authService.authenticate(req);
      authService.authorize(req, principal, resolveNodeFlowProjectId(req.path, options));
      res.locals.codeUxPrincipal = principal;
      res.on("finish", () => {
        options.automationSloService?.observeManagementRequest(Date.now() - startedAt, res.statusCode);
        options.automationAuditService?.record({
          correlationId: getCorrelationId() ?? String(res.getHeader("x-correlation-id") ?? "unknown"),
          principal,
          action: `${req.method} ${req.path}`,
          resourceType: "dashboard_api",
          projectId: extractProjectId(req.path),
          outcome: res.statusCode < 400 ? "succeeded" : res.statusCode === 401 || res.statusCode === 403 ? "denied" : "failed",
          metadata: { statusCode: res.statusCode, durationMs: Date.now() - startedAt },
        });
      });
      next();
    } catch (error) {
      const authenticationError = error instanceof HeadlessAuthenticationError
        ? error
        : new HeadlessAuthenticationError("Authentication configuration is invalid.", 403);
      dashboardLogger.warn("Dashboard API access denied", {
        logPurpose: "security",
        method: req.method,
        path: req.path,
        statusCode: authenticationError.statusCode,
        reason: authenticationError.message,
      });
      options.automationSloService?.observeManagementRequest(Date.now() - startedAt, authenticationError.statusCode);
      options.automationAuditService?.record({
        correlationId: getCorrelationId() ?? String(res.getHeader("x-correlation-id") ?? "unknown"),
        principal: {
          id: "unauthenticated",
          displayName: "Unauthenticated request",
          kind: "user",
          roles: [],
          projectIds: [],
          authenticatedAt: new Date().toISOString(),
          authenticationMethod: "service_token",
        },
        action: `${req.method} ${req.path}`,
        resourceType: "dashboard_api",
        projectId: extractProjectId(req.path),
        outcome: "denied",
        metadata: { statusCode: authenticationError.statusCode, reason: authenticationError.message },
      });
      res.status(authenticationError.statusCode).json({ error: authenticationError.message });
    }
  });
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      dashboardLogger.info("Dashboard request completed", {
        logPurpose: "request",
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  app.use((req, res, next) => {
    const requestPath = req.path.toLowerCase();
    const isRuntimeDataPath = requestPath.startsWith("/api/")
      || requestPath === "/health"
      || requestPath === "/ready";

    if (isRuntimeDataPath && !isTrustedDashboardHost(req.headers.host, req.headers["x-forwarded-host"])) {
      dashboardLogger.warn("Blocked runtime request with untrusted Host header", {
        logPurpose: "security",
        method: req.method,
        path: req.originalUrl,
        reason: "untrusted_host",
      });
      res.status(403).json({ error: "Forbidden: Untrusted host." });
      return;
    }

    if (isRuntimeDataPath && !isTrustedDashboardPreviewHost(req.headers.host) && isHostileBrowserOrigin(req)) {
      dashboardLogger.warn("Blocked hostile cross-site browser request", {
        logPurpose: "security",
        method: req.method,
        path: req.originalUrl,
        reason: "hostile_browser_origin",
      });
      res.status(403).json({ error: "Forbidden: Cross-site requests are not allowed." });
      return;
    }
    next();
  });

  app.use(createPreviewHostMiddleware(options));
  app.use(createDashboardJsonContentTypeGuard(dashboardLogger));
  // Settings payloads can embed a base64 background-image data URL, which the
  // dashboard warns about past ~5MB. base64 inflates bytes by ~33%, so allow
  // generous headroom only for settings save routes while keeping other API
  // mutations on a much smaller parser budget.
  app.use(express.json({
    limit: DASHBOARD_LARGE_SETTINGS_JSON_BODY_LIMIT,
    type: (req) => shouldParseDashboardJsonBody(req, "large"),
    verify: captureRawJsonBody,
  }));
  app.use(express.json({
    limit: DASHBOARD_DEFAULT_JSON_BODY_LIMIT,
    type: (req) => shouldParseDashboardJsonBody(req, "default"),
    verify: captureRawJsonBody,
  }));
  app.use(createDashboardJsonBodyErrorHandler(dashboardLogger));
};

function extractProjectId(pathname: string): string | null {
  const match = pathname.match(/^\/projects\/([^/]+)/i);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

function resolveNodeFlowProjectId(pathname: string, options: DashboardServerOptions): string | null | undefined {
  const runMatch = pathname.match(/^\/node-flow-runs\/([^/]+)(?:\/|$)/i);
  if (runMatch?.[1]) {
    return options.nodeFlowService?.resolveRunProjectId(decodeURIComponent(runMatch[1])) ?? null;
  }

  const flowMatch = pathname.match(/^\/(?:node-flow-drafts|node-flows)\/([^/]+)(?:\/|$)/i);
  if (flowMatch?.[1]) {
    return options.nodeFlowService?.resolveFlowProjectId(decodeURIComponent(flowMatch[1])) ?? null;
  }

  const approvalMatch = pathname.match(/^\/automation-approvals\/([^/]+)(?:\/|$)/i);
  if (approvalMatch?.[1]) {
    return options.approvalService?.resolveProjectId(decodeURIComponent(approvalMatch[1])) ?? null;
  }

  return undefined;
}

function captureRawJsonBody(req: IncomingMessage, _res: unknown, buf: Buffer): void {
  (req as IncomingMessage & { rawBody?: string }).rawBody = buf.toString("utf8");
}

function createDashboardJsonContentTypeGuard(dashboardLogger: Logger): RequestHandler {
  return (req, res, next) => {
    const pathname = getRequestPathname(req);
    if (getDashboardJsonBodyLimit(req.method, pathname) === null) {
      next();
      return;
    }

    const contentType = String(req.headers["content-type"] || "");
    const contentLength = Number(req.headers["content-length"] || 0);
    const hasRequestBody = contentLength > 0 || req.headers["transfer-encoding"] !== undefined;
    if (!contentType && !hasRequestBody) {
      req.body = {};
      next();
      return;
    }

    if (isSupportedDashboardJsonContentType(contentType)) {
      next();
      return;
    }

    dashboardLogger.warn("Rejected dashboard JSON request with unsupported content type", {
      logPurpose: "security",
      method: req.method,
      path: req.originalUrl,
      statusCode: 415,
      reason: "unsupported_content_type",
      contentType: contentType.split(";")[0] || "none",
    });
    res.status(415).json({ error: "Unsupported Content-Type. Use application/json." });
  };
}

export function createDashboardJsonBodyErrorHandler(dashboardLogger: Logger): ErrorRequestHandler {
  return (error, req, res, next) => {
    const isSyntaxError = error instanceof SyntaxError;
    const status = typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : undefined;
    const bodyType = typeof (error as { type?: unknown }).type === "string"
      ? (error as { type: string }).type
      : "";

    if (status === 400 && (isSyntaxError || bodyType === "entity.parse.failed")) {
      dashboardLogger.warn("Rejected malformed dashboard JSON request body", {
        logPurpose: "request",
        method: req.method,
        path: req.originalUrl,
        statusCode: 400,
        reason: "malformed_json",
      });
      res.status(400).json({ error: "Invalid JSON request body." });
      return;
    }

    if (status === 413 || bodyType === "entity.too.large") {
      dashboardLogger.warn("Rejected oversized dashboard JSON request body", {
        logPurpose: "security",
        method: req.method,
        path: req.originalUrl,
        statusCode: 413,
        reason: "json_body_too_large",
      });
      res.status(413).json({ error: "JSON request body exceeds maximum allowed size." });
      return;
    }

    next(error);
  };
}

export function shouldParseDashboardJsonBody(req: IncomingMessage, limit?: DashboardJsonBodyLimit): boolean {
  const pathname = getRequestPathname(req);
  const bodyLimit = getDashboardJsonBodyLimit(req.method, pathname);
  if (bodyLimit === null || (limit !== undefined && bodyLimit !== limit)) {
    return false;
  }

  return isSupportedDashboardJsonContentType(String(req.headers["content-type"] || ""));
}

function getRequestPathname(req: IncomingMessage): string {
  try {
    return new URL(req.url || "/", "http://localhost").pathname;
  } catch {
    return "/";
  }
}

export const applyDashboardPostRouteMiddleware = (
  app: Express,
  dashboardDir: string
): void => {
  app.get("/favicon.ico", (req, res) => res.status(204).end());

  const builtDashboardDir = path.join(path.resolve(dashboardDir), "dist");
  const staticDir = fs.existsSync(builtDashboardDir) ? builtDashboardDir : path.resolve(dashboardDir);

  // Rate-limit the static asset + SPA-fallback handlers below. These perform
  // filesystem reads (express.static / res.sendFile) on every request; the
  // limiter caps abusive floods while staying well above any real page load.
  app.use(createHttpRateLimiter());
  app.use(express.static(staticDir, {
    setHeaders: (res, filePath) => {
      // Vite emits content-hashed, immutable bundles under /assets (e.g. index-3f9a2c1b.js).
      // A new build produces a new filename, so these can be cached forever — this removes the
      // per-asset revalidation round-trips that otherwise run on every load. index.html (and any
      // other non-hashed entry) must stay revalidated so a new build is picked up immediately.
      const isHashedAsset = path.join(path.resolve(staticDir), "assets") === path.dirname(filePath);
      if (isHashedAsset) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));
  app.use((req, res, next) => {
    const isGet = req.method === "GET";
    const isApi = req.path.startsWith("/api/") || req.path.startsWith("/health") || req.path.startsWith("/ready");
    const isExtensionless = path.extname(req.path) === "";
    const isPreviewHost = parsePreviewSessionIdFromHost(req.headers.host) !== null;

    if (isGet && !isApi && isExtensionless && !isPreviewHost) {
      const indexPath = path.join(path.resolve(staticDir), "index.html");
      res.sendFile(indexPath, (err: unknown) => {
        if (err) {
          const isEnoent = isErrnoException(err) && err.code === "ENOENT";
          const is404 = typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 404;

          if (isEnoent || is404) {
            next();
          } else {
            next(err);
          }
        }
      });
      return;
    }
    next();
  });
};
