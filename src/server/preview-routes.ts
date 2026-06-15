import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";

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
    const body = req.body
      ? Buffer.isBuffer(req.body)
        ? req.body
        : Buffer.from(JSON.stringify(req.body))
      : undefined;
    const proxied = await deps.proxySprintPreviewRequest({
      sessionId,
      method: req.method,
      path: pathWithQuery,
      headers: Object.fromEntries(
        Object.entries(req.headers).map(([key, value]) => [key, Array.isArray(value) ? value.join(", ") : value]),
      ),
      body,
    });
    for (const [key, value] of Object.entries(proxied.headers)) {
      res.setHeader(key, value);
    }
    res.status(proxied.status).send(proxied.body);
  }));
}
