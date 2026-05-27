import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, toErrorResponse, syncRoute, requireTrimmedString, parseTrimmedString } from "./route-utils.js";
import type { CreateProjectInput, ProjectSetupRequestInput, UpdateProjectInput } from "../contracts/project-management-types.js";
import type { ProjectSettingsOverride } from "../contracts/settings-scope-types.js";

export function registerProjectRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects", syncRoute((req, res) => {
    res.json(deps.listProjects());
  }));

  router.post("/api/projects", asyncRoute(async (req, res) => {
    try {
      const input = req.body as CreateProjectInput;
      const project = await deps.createProject(input);
      if (input.setup?.enabled === true && deps.setupProject) {
        const setup = await deps.setupProject(project.id, input.setup);
        res.status(201).json({ ...project, setup });
        return;
      }
      res.status(201).json(project);
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to create project"));
    }
  }));

  router.post("/api/projects/:projectId/setup", asyncRoute(async (req, res) => {
    try {
      if (!deps.setupProject) {
        res.status(501).json({ error: "Project setup service is not enabled." });
        return;
      }
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      res.json(await deps.setupProject(projectId, req.body as ProjectSetupRequestInput));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to setup project"));
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
