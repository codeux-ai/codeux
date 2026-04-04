import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { toErrorResponse, syncRoute, requireTrimmedString, parseTrimmedString } from "./route-utils.js";
import type { CreateProjectInput, UpdateProjectInput } from "../contracts/project-management-types.js";
import type { ProjectSettingsOverride } from "../contracts/settings-scope-types.js";

export function registerProjectRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects", syncRoute((req, res) => {
    res.json(deps.listProjects());
  }));

  router.post("/api/projects", syncRoute((req, res) => {
    try {
      res.status(201).json(deps.createProject(req.body as CreateProjectInput));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to create project"));
    }
  }));

  router.get("/api/projects/:projectId", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const project = deps.getProject(projectId);
    if (!project) {
      res.status(404).json({ error: `Project not found: ${projectId}` });
      return;
    }
    res.json(project);
  }));

  router.get("/api/projects/:projectId/settings", syncRoute((req, res) => {
    try {
      res.json(deps.getProjectSettings(requireTrimmedString(req.params.projectId, "projectId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to load project settings"));
    }
  }));

  router.put("/api/projects/:projectId/settings", syncRoute((req, res) => {
    try {
      res.json(deps.saveProjectSettings(requireTrimmedString(req.params.projectId, "projectId"), req.body as ProjectSettingsOverride));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to save project settings"));
    }
  }));

  router.delete("/api/projects/:projectId/settings", syncRoute((req, res) => {
    try {
      deps.resetProjectSettings(requireTrimmedString(req.params.projectId, "projectId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to reset project settings"));
    }
  }));

  router.get("/api/projects/:projectId/settings/effective", syncRoute((req, res) => {
    try {
      res.json(deps.getProjectEffectiveSettings(requireTrimmedString(req.params.projectId, "projectId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to load effective project settings"));
    }
  }));

  router.patch("/api/projects/:projectId", syncRoute((req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      res.json(deps.updateProject(projectId, req.body as UpdateProjectInput));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update project"));
    }
  }));

  router.delete("/api/projects/:projectId", syncRoute((req, res) => {
    try {
      deps.deleteProject(requireTrimmedString(req.params.projectId, "projectId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to delete project"));
    }
  }));

  router.put("/api/projects/:projectId/select", syncRoute((req, res) => {
    try {
      const projectId = parseTrimmedString(req.params.projectId);
      res.json({ selectedProjectId: deps.selectProject(projectId || null) });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to select project"));
    }
  }));

  router.put("/api/projects/:projectId/selected-sprint", syncRoute((req, res) => {
    try {
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      const sprintId = parseTrimmedString(req.body?.sprintId) || null;
      res.json({ selectedSprintId: deps.selectSprint(projectId, sprintId) });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to select sprint"));
    }
  }));
}
