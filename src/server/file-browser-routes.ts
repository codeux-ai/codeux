import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, requireTrimmedString } from "./route-utils.js";

export function registerFileBrowserRoutes(app: Express, deps: DashboardDependencies): void {
  app.get("/api/projects/:projectId/file-browser/sessions", asyncRoute(async (req, res) => {
    if (!deps.listFileBrowserSessions) {
      res.json([]);
      return;
    }
    res.json(await deps.listFileBrowserSessions(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.post("/api/projects/:projectId/sprints/:sprintId/file-browser/start", asyncRoute(async (req, res) => {
    if (!deps.startFileBrowserSession) {
      throw new Error("File browser runtime is unavailable.");
    }
    res.json(await deps.startFileBrowserSession(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.sprintId, "sprintId"),
    ));
  }));

  app.post("/api/file-browser/sessions/:sessionId/rebuild", asyncRoute(async (req, res) => {
    if (!deps.rebuildFileBrowserSession) {
      throw new Error("File browser runtime is unavailable.");
    }
    res.json(await deps.rebuildFileBrowserSession(requireTrimmedString(req.params.sessionId, "sessionId")));
  }));

  app.post("/api/file-browser/sessions/:sessionId/stop", asyncRoute(async (req, res) => {
    if (!deps.stopFileBrowserSession) {
      throw new Error("File browser runtime is unavailable.");
    }
    res.json(await deps.stopFileBrowserSession(requireTrimmedString(req.params.sessionId, "sessionId")));
  }));

  app.delete("/api/file-browser/sessions/:sessionId", asyncRoute(async (req, res) => {
    if (!deps.removeFileBrowserSession) {
      throw new Error("File browser runtime is unavailable.");
    }
    await deps.removeFileBrowserSession(requireTrimmedString(req.params.sessionId, "sessionId"));
    res.status(204).end();
  }));

  app.get("/api/file-browser/sessions/:sessionId/tree", asyncRoute(async (req, res) => {
    if (!deps.getFileBrowserTree) {
      throw new Error("File browser runtime is unavailable.");
    }
    res.json(await deps.getFileBrowserTree(requireTrimmedString(req.params.sessionId, "sessionId")));
  }));

  app.get("/api/file-browser/sessions/:sessionId/file", asyncRoute(async (req, res) => {
    if (!deps.readFileBrowserFile) {
      throw new Error("File browser runtime is unavailable.");
    }
    res.json(await deps.readFileBrowserFile(
      requireTrimmedString(req.params.sessionId, "sessionId"),
      requireTrimmedString(req.query.path, "path"),
    ));
  }));

  app.get("/api/file-browser/sessions/:sessionId/changes", asyncRoute(async (req, res) => {
    if (!deps.getFileBrowserChanges) {
      throw new Error("File browser runtime is unavailable.");
    }
    res.json(await deps.getFileBrowserChanges(requireTrimmedString(req.params.sessionId, "sessionId")));
  }));

  app.get("/api/file-browser/sessions/:sessionId/diff", asyncRoute(async (req, res) => {
    if (!deps.getFileBrowserDiff) {
      throw new Error("File browser runtime is unavailable.");
    }
    res.json(await deps.getFileBrowserDiff(
      requireTrimmedString(req.params.sessionId, "sessionId"),
      requireTrimmedString(req.query.path, "path"),
    ));
  }));
}
