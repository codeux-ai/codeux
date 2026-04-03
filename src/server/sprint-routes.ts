import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { toErrorMessage } from "./dashboard-server.js";
import type {
  CreateSprintInput,
  SprintMarkdownImportInput,
  UpdateSprintInput,
} from "../contracts/project-management-types.js";
import type { SprintSettingsOverride } from "../contracts/settings-scope-types.js";

export function registerSprintRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/sprints", (req, res) => {
    try {
      res.json(deps.listSprints(String(req.params.projectId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list sprints") });
    }
  });

  router.post("/api/projects/:projectId/sprints", (req, res) => {
    try {
      res.status(201).json(deps.createSprint(String(req.params.projectId || "").trim(), req.body as CreateSprintInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create sprint") });
    }
  });

  router.post("/api/projects/:projectId/sprints/import", (req, res) => {
    try {
      res.status(201).json(
        deps.importSprintFromMarkdown(String(req.params.projectId || "").trim(), req.body as SprintMarkdownImportInput)
      );
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to import sprint markdown") });
    }
  });

  router.get("/api/projects/:projectId/sprints/:sprintId/export", (req, res) => {
    try {
      res.json(deps.exportSprintToMarkdown(String(req.params.projectId || "").trim(), String(req.params.sprintId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to export sprint markdown") });
    }
  });

  router.patch("/api/sprints/:sprintId", (req, res) => {
    try {
      res.json(deps.updateSprint(String(req.params.sprintId || "").trim(), req.body as UpdateSprintInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update sprint") });
    }
  });

  router.get("/api/sprints/:sprintId/settings", (req, res) => {
    try {
      res.json(deps.getSprintSettings(String(req.params.sprintId || "").trim()));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load sprint settings") });
    }
  });

  router.put("/api/sprints/:sprintId/settings", (req, res) => {
    const projectId = typeof req.body?.projectId === "string" ? req.body.projectId.trim() : "";
    if (!projectId) {
      res.status(400).json({ error: "projectId is required when saving sprint settings." });
      return;
    }

    try {
      const sprintId = String(req.params.sprintId || "").trim();
      const payload = { ...(req.body as Record<string, unknown>) };
      delete payload.projectId;
      res.json(deps.saveSprintSettings(projectId, sprintId, payload as SprintSettingsOverride));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to save sprint settings") });
    }
  });

  router.delete("/api/sprints/:sprintId/settings", (req, res) => {
    try {
      deps.resetSprintSettings(String(req.params.sprintId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to reset sprint settings") });
    }
  });

  router.get("/api/projects/:projectId/sprints/:sprintId/settings/effective", (req, res) => {
    try {
      res.json(deps.getSprintEffectiveSettings(
        String(req.params.projectId || "").trim(),
        String(req.params.sprintId || "").trim(),
      ));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to load effective sprint settings") });
    }
  });

  router.delete("/api/sprints/:sprintId", (req, res) => {
    try {
      deps.deleteSprint(String(req.params.sprintId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete sprint") });
    }
  });
}
