import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { toErrorResponse, syncRoute, requireTrimmedString, parseTrimmedString } from "./route-utils.js";
import type {
  CreateSprintInput,
  SprintMarkdownImportInput,
  UpdateSprintInput,
} from "../contracts/project-management-types.js";
import type { SprintSettingsOverride } from "../contracts/settings-scope-types.js";

export function registerSprintRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/sprints", syncRoute((req, res) => {
    try {
      res.json(deps.listSprints(requireTrimmedString(req.params.projectId, "projectId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list sprints"));
    }
  }));

  router.post("/api/projects/:projectId/sprints", syncRoute((req, res) => {
    try {
      res.status(201).json(deps.createSprint(requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateSprintInput));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to create sprint"));
    }
  }));

  router.post("/api/projects/:projectId/sprints/import", syncRoute((req, res) => {
    try {
      res.status(201).json(
        deps.importSprintFromMarkdown(requireTrimmedString(req.params.projectId, "projectId"), req.body as SprintMarkdownImportInput)
      );
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to import sprint markdown"));
    }
  }));

  router.get("/api/projects/:projectId/sprints/:sprintId/export", syncRoute((req, res) => {
    try {
      res.json(deps.exportSprintToMarkdown(requireTrimmedString(req.params.projectId, "projectId"), requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to export sprint markdown"));
    }
  }));

  router.patch("/api/sprints/:sprintId", syncRoute((req, res) => {
    try {
      res.json(deps.updateSprint(requireTrimmedString(req.params.sprintId, "sprintId"), req.body as UpdateSprintInput));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update sprint"));
    }
  }));

  router.get("/api/sprints/:sprintId/settings", syncRoute((req, res) => {
    try {
      res.json(deps.getSprintSettings(requireTrimmedString(req.params.sprintId, "sprintId")));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to load sprint settings"));
    }
  }));

  router.put("/api/sprints/:sprintId/settings", syncRoute((req, res) => {
    const projectId = parseTrimmedString(req.body?.projectId);
    if (!projectId) {
      res.status(400).json({ error: "projectId is required when saving sprint settings." });
      return;
    }

    try {
      const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
      const payload = { ...(req.body as Record<string, unknown>) };
      delete payload.projectId;
      res.json(deps.saveSprintSettings(projectId, sprintId, payload as SprintSettingsOverride));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to save sprint settings"));
    }
  }));

  router.delete("/api/sprints/:sprintId/settings", syncRoute((req, res) => {
    try {
      deps.resetSprintSettings(requireTrimmedString(req.params.sprintId, "sprintId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to reset sprint settings"));
    }
  }));

  router.get("/api/projects/:projectId/sprints/:sprintId/settings/effective", syncRoute((req, res) => {
    try {
      res.json(deps.getSprintEffectiveSettings(
        requireTrimmedString(req.params.projectId, "projectId"),
        requireTrimmedString(req.params.sprintId, "sprintId"),
      ));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to load effective sprint settings"));
    }
  }));

  router.delete("/api/sprints/:sprintId", syncRoute((req, res) => {
    try {
      deps.deleteSprint(requireTrimmedString(req.params.sprintId, "sprintId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to delete sprint"));
    }
  }));
}
