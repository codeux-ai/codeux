import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import type { CreateAgentPresetInput, UpdateAgentPresetInput } from "../contracts/agent-preset-types.js";

export function registerAgentPresetRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/agent-presets", asyncRoute(async (req, res) => {
    res.json(await deps.listAgentPresets(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.post("/api/projects/:projectId/agent-presets", asyncRoute(async (req, res) => {
    res.status(201).json(await deps.createAgentPreset(requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateAgentPresetInput));
  }));

  router.patch("/api/agent-presets/:agentPresetId", asyncRoute(async (req, res) => {
    res.json(await deps.updateAgentPreset(requireTrimmedString(req.params.agentPresetId, "agentPresetId"), req.body as UpdateAgentPresetInput));
  }));

  router.delete("/api/agent-presets/:agentPresetId", asyncRoute(async (req, res) => {
    await deps.deleteAgentPreset(requireTrimmedString(req.params.agentPresetId, "agentPresetId"));
    res.json({ ok: true });
  }));

  router.post("/api/agent-presets/:agentPresetId/import-markdown", asyncRoute(async (req, res) => {
    if (!deps.importAgentPresetFromMarkdown) {
      res.status(404).json({ error: "Markdown import is not enabled for agents." });
      return;
    }
    res.json(await deps.importAgentPresetFromMarkdown(requireTrimmedString(req.params.agentPresetId, "agentPresetId")));
  }));

  router.post("/api/projects/:projectId/agent-presets/sync-markdown", asyncRoute(async (req, res) => {
    if (!deps.syncAllAgentPresetsFromMarkdown) {
      res.status(404).json({ error: "Bulk markdown sync is not enabled for agents." });
      return;
    }
    res.json(await deps.syncAllAgentPresetsFromMarkdown(requireTrimmedString(req.params.projectId, "projectId")));
  }));
}
