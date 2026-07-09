import type { Express, Request, Response } from "express";
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

  app.post("/api/projects/:projectId/sprints/:sprintId/preview/sessions/:sessionId/rebuild", asyncRoute(async (req, res) => {
    if (!deps.rebuildSprintPreviewSessionForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.rebuildSprintPreviewSessionForProjectSprint(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
      requireTrimmedString(req.params.sessionId, "sessionId"),
    ));
  }));

  app.post("/api/browser/sessions/:sessionId/rebuild", asyncRoute(async (req, res) => {
    if (!deps.rebuildSprintPreviewSessionForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const scope = requirePreviewScope(req);
    res.json(await deps.rebuildSprintPreviewSessionForProjectSprint(
      scope.projectId,
      scope.sprintId,
      requireTrimmedString(req.params.sessionId, "sessionId"),
    ));
  }));

  app.post("/api/projects/:projectId/sprints/:sprintId/preview/sessions/:sessionId/stop", asyncRoute(async (req, res) => {
    if (!deps.stopSprintPreviewSessionForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.stopSprintPreviewSessionForProjectSprint(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
      requireTrimmedString(req.params.sessionId, "sessionId"),
    ));
  }));

  app.post("/api/browser/sessions/:sessionId/stop", asyncRoute(async (req, res) => {
    if (!deps.stopSprintPreviewSessionForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const scope = requirePreviewScope(req);
    res.json(await deps.stopSprintPreviewSessionForProjectSprint(
      scope.projectId,
      scope.sprintId,
      requireTrimmedString(req.params.sessionId, "sessionId"),
    ));
  }));

  app.delete("/api/projects/:projectId/sprints/:sprintId/preview/sessions/:sessionId", asyncRoute(async (req, res) => {
    if (!deps.removeSprintPreviewSessionForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    await deps.removeSprintPreviewSessionForProjectSprint(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
      requireTrimmedString(req.params.sessionId, "sessionId"),
    );
    res.status(204).end();
  }));

  app.delete("/api/browser/sessions/:sessionId", asyncRoute(async (req, res) => {
    if (!deps.removeSprintPreviewSessionForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const scope = requirePreviewScope(req);
    await deps.removeSprintPreviewSessionForProjectSprint(
      scope.projectId,
      scope.sprintId,
      requireTrimmedString(req.params.sessionId, "sessionId"),
    );
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

  app.put("/api/projects/:projectId/sprints/:sprintId/preview/sessions/:sessionId/environment", asyncRoute(async (req, res) => {
    if (!deps.updateSprintPreviewEnvironmentOverrides) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    res.json(await deps.updateSprintPreviewEnvironmentOverrides(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
      requireTrimmedString(req.params.sessionId, "sessionId"),
      Array.isArray(req.body?.environmentOverrides) ? req.body.environmentOverrides : [],
    ));
  }));

  app.get("/api/projects/:projectId/sprints/:sprintId/preview/sessions/:sessionId/logs", asyncRoute(async (req, res) => {
    if (!deps.getSprintPreviewLogsForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const tail = typeof req.query.tail === "string" ? Number(req.query.tail) : undefined;
    res.json(await deps.getSprintPreviewLogsForProjectSprint(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
      requireTrimmedString(req.params.sessionId, "sessionId"),
      tail,
    ));
  }));

  app.get("/api/browser/sessions/:sessionId/logs", asyncRoute(async (req, res) => {
    if (!deps.getSprintPreviewLogsForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const scope = requirePreviewScope(req);
    const tail = typeof req.query.tail === "string" ? Number(req.query.tail) : undefined;
    res.json(await deps.getSprintPreviewLogsForProjectSprint(
      scope.projectId,
      scope.sprintId,
      requireTrimmedString(req.params.sessionId, "sessionId"),
      tail,
    ));
  }));

  app.all("/api/projects/:projectId/sprints/:sprintId/preview/sessions/:sessionId/proxy{*rest}", asyncRoute(async (req, res) => {
    if (!deps.proxySprintPreviewRequestForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const sessionId = requireTrimmedString(req.params.sessionId, "sessionId");
    const proxied = await deps.proxySprintPreviewRequestForProjectSprint(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
      buildProxyRequestArgs(req, sessionId, `/api/projects/${req.params.projectId}/sprints/${req.params.sprintId}/preview/sessions/${sessionId}/proxy`),
    );
    sendProxiedResponse(res, proxied);
  }));

  app.all("/api/browser/sessions/:sessionId/proxy{*rest}", asyncRoute(async (req, res) => {
    if (!deps.proxySprintPreviewRequestForProjectSprint) {
      throw new Error("Sprint preview runtime is unavailable.");
    }
    const scope = requirePreviewScope(req);
    const sessionId = requireTrimmedString(req.params.sessionId, "sessionId");
    const proxied = await deps.proxySprintPreviewRequestForProjectSprint(
      scope.projectId,
      scope.sprintId,
      buildProxyRequestArgs(req, sessionId, `/api/browser/sessions/${sessionId}/proxy`),
    );
    sendProxiedResponse(res, proxied);
  }));
}

function requirePreviewScope(req: { query: Record<string, unknown> }): { projectId: string; sprintId: string } {
  return {
    projectId: requireTrimmedString(req.query.projectId, "projectId"),
    sprintId: requireTrimmedString(req.query.sprintId, "sprintId"),
  };
}

function buildProxyRequestArgs(
  req: Request,
  sessionId: string,
  prefix: string,
): {
  sessionId: string;
  method: string;
  path: string;
  headers: Record<string, string | undefined>;
  body?: Buffer;
  selectedPort: string | null;
} {
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
  return {
    sessionId,
    method: req.method,
    path: proxiedPath,
    headers: Object.fromEntries(
      Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
    ) as Record<string, string | undefined>,
    body,
    selectedPort,
  };
}

function sendProxiedResponse(
  res: Response,
  proxied: { status: number; headers: Record<string, string>; body: Buffer },
): void {
  for (const [key, value] of Object.entries(proxied.headers)) {
    res.setHeader(key, value);
  }
  res.status(proxied.status).send(proxied.body);
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
