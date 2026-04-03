import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { toErrorMessage } from "./dashboard-server.js";
import type { CreateProjectInput, UpdateProjectInput } from "../contracts/project-management-types.js";
import type { ProjectSettingsOverride } from "../contracts/settings-scope-types.js";

export function registerProjectRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects", (req, res) => {
    res.json(deps.listProjects());
  });

  router.post("/api/projects", (req, res) => {
    try {
      res.status(201).json(deps.createProject(req.body as CreateProjectInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create project") });
    }
  });

  router.get("/api/projects/:projectId", (req, res) => {
    const projectId = String(req.params.projectId || "").trim();
    const project = deps.getProject(projectId);
    if (!project) {
      res.status(404).json({ error: `Project not found: ${projectId}` });
      return;
    }
    res.json(project);
  });

  router.get("/api/projects/:projectId/settings", (req, res) => {
    try {
      res.json(deps.getProjectSettings(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load project settings") });
    }
  });

  router.put("/api/projects/:projectId/settings", (req, res) => {
    try {
      res.json(deps.saveProjectSettings(String(req.params.projectId || "").trim(), req.body as ProjectSettingsOverride));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to save project settings") });
    }
  });

  router.delete("/api/projects/:projectId/settings", (req, res) => {
    try {
      deps.resetProjectSettings(String(req.params.projectId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to reset project settings") });
    }
  });

  router.get("/api/projects/:projectId/settings/effective", (req, res) => {
    try {
      res.json(deps.getProjectEffectiveSettings(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load effective project settings") });
    }
  });

  router.patch("/api/projects/:projectId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      res.json(deps.updateProject(projectId, req.body as UpdateProjectInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update project") });
    }
  });

  router.delete("/api/projects/:projectId", (req, res) => {
    try {
      deps.deleteProject(String(req.params.projectId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete project") });
    }
  });

  router.put("/api/projects/:projectId/select", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      res.json({ selectedProjectId: deps.selectProject(projectId || null) });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to select project") });
    }
  });

  router.put("/api/projects/:projectId/selected-sprint", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const sprintId = typeof req.body?.sprintId === "string" && req.body.sprintId.trim()
        ? req.body.sprintId.trim()
        : null;
      res.json({ selectedSprintId: deps.selectSprint(projectId, sprintId) });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to select sprint") });
    }
  });
}
