import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import { HttpRouteError } from "./http-errors.js";

export function registerPreviewRoutes(app: Express, deps: DashboardDependencies): void {
  app.get("/api/projects/:projectId/preview/sessions", asyncRoute(async (req, res) => {
    if (!deps.listSprintPreviewSessions) {
      res.json([]);
      return;
    }
    res.json(await deps.listSprintPreviewSessions(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.post("/api/projects/:projectId/sprints/:sprintId/preview/start", asyncRoute(async (req, res) => {
    if (!deps.startSprintPreviewSession) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.startSprintPreviewSession(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
    ));
  }));

  app.post("/api/browser/sessions/:sessionId/rebuild", asyncRoute(async (req, res) => {
    if (!deps.rebuildSprintPreviewSession) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.rebuildSprintPreviewSession(requireTrimmedString(req.params.sessionId, "sessionId")));
  }));

  app.post("/api/browser/sessions/:sessionId/stop", asyncRoute(async (req, res) => {
    if (!deps.stopSprintPreviewSession) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.stopSprintPreviewSession(requireTrimmedString(req.params.sessionId, "sessionId")));
  }));

  app.delete("/api/browser/sessions/:sessionId", asyncRoute(async (req, res) => {
    if (!deps.removeSprintPreviewSession) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    await deps.removeSprintPreviewSession(requireTrimmedString(req.params.sessionId, "sessionId"));
    res.status(204).end();
  }));

  app.get("/api/projects/:projectId/sprints/:sprintId/preview/script", asyncRoute(async (req, res) => {
    if (!deps.getSprintPreviewScript) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.getSprintPreviewScript(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
    ));
  }));

  app.put("/api/projects/:projectId/sprints/:sprintId/preview/script", asyncRoute(async (req, res) => {
    if (!deps.saveSprintPreviewScript) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.saveSprintPreviewScript(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
      typeof req.body?.content === "string" ? req.body.content : "",
    ));
  }));

  app.get("/api/browser/sessions/:sessionId/logs", asyncRoute(async (req, res) => {
    if (!deps.getSprintPreviewLogs) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const tail = typeof req.query.tail === "string" ? Number(req.query.tail) : undefined;
    res.json(await deps.getSprintPreviewLogs(requireTrimmedString(req.params.sessionId, "sessionId"), tail));
  }));

  app.all("/api/browser/sessions/:sessionId/proxy{*rest}", asyncRoute(async (req, res) => {
    if (!deps.proxySprintPreviewRequest) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const sessionId = requireTrimmedString(req.params.sessionId, "sessionId");
    const prefix = `/api/browser/sessions/${sessionId}/proxy`;
    const pathWithQuery = req.originalUrl.startsWith(prefix)
      ? req.originalUrl.slice(prefix.length) || "/"
      : "/";
    const { path: proxiedPath, selectedPort } = parsePreviewProxyPath(pathWithQuery, req.headers["x-code-ux-preview-port"]);
    const body = req.body
      ? Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body))
      : undefined;
    if (body && body.byteLength > 5 * 1024 * 1024) {
      throw new HttpRouteError(413, "Request body exceeds maximum allowed size for proxied preview");
    }
    const proxied = await deps.proxySprintPreviewRequest({
      sessionId,
      method: req.method,
      path: proxiedPath,
      headers: buildDashboardPreviewProxyRequestHeaders(req.headers),
      body,
      selectedPort,
    });
    for (const [key, value] of Object.entries(sanitizeDashboardPreviewProxyResponseHeaders(proxied.headers))) {
      res.setHeader(key, value);
    }
    res.status(proxied.status).send(proxied.body);
  }));
}

const DASHBOARD_PREVIEW_PROXY_STRIPPED_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "host",
  "connection",
  "upgrade",
  "transfer-encoding",
  "content-length",
  "accept-encoding",
]);

const DASHBOARD_PREVIEW_PROXY_STRIPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "content-security-policy",
  "content-security-policy-report-only",
  "x-frame-options",
]);

function buildDashboardPreviewProxyRequestHeaders(
  headers: Record<string, string | string[] | undefined>,
): Record<string, string | undefined> {
  const next: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(headers)) {
    const normalized = key.toLowerCase();
    if (
      DASHBOARD_PREVIEW_PROXY_STRIPPED_HEADERS.has(normalized)
      || normalized.startsWith("proxy-")
      || normalized.startsWith("x-code-ux-")
    ) {
      continue;
    }
    next[key] = Array.isArray(value) ? value.join(", ") : value;
  }
  return next;
}

function sanitizeDashboardPreviewProxyResponseHeaders(headers: Record<string, string>): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (DASHBOARD_PREVIEW_PROXY_STRIPPED_RESPONSE_HEADERS.has(key.toLowerCase())) {
      continue;
    }
    next[key] = value;
  }
  return next;
}

function parsePreviewProxyPath(
  pathWithQuery: string,
  headerValue: string | string[] | undefined,
): { path: string; selectedPort: string | null } {
  const normalizedPath = pathWithQuery.startsWith("/") ? pathWithQuery : `/${pathWithQuery}`;
  const url = new URL(normalizedPath, "http://preview.local");
  const querySelectedPort = url.searchParams.get("previewPort")
    ?? url.searchParams.get("containerPort")
    ?? url.searchParams.get("hostPort");
  url.searchParams.delete("previewPort");
  url.searchParams.delete("containerPort");
  url.searchParams.delete("hostPort");
  const headerSelectedPort = Array.isArray(headerValue) ? headerValue[0] : headerValue;
  const selectedPort = querySelectedPort ?? headerSelectedPort ?? null;
  const query = url.searchParams.toString();
  return {
    path: `${url.pathname}${query ? `?${query}` : ""}`,
    selectedPort,
  };
}
