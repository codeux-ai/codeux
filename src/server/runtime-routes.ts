import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import { parseProjectStatsQuery, parseTrimmedString, requireTrimmedString, parsePreferredWorkerAssignment, parseClaimAttentionItemPayload, parseResolveAttentionItemPayload } from "./request-parsers.js";
import type { ProjectStatsQuery, ProjectStatsWindow } from "../contracts/app-types.js";

export function registerRuntimeRoutes(app: Express, options: DashboardDependencies): void {
  app.get("/api/status", syncRoute((req, res) => {
    res.json(options.getStatus());
  }));

  app.get("/api/execution", syncRoute((req, res) => {
    res.json(options.getExecutionSnapshot());
  }));

  // Combined endpoint — single HTTP call for live page initial load
  app.get("/api/live", asyncRoute(async (req, res) => {
    const requestedProjectId = parseTrimmedString(req.query.projectId);
    res.json(await options.getLiveSnapshot(requestedProjectId || null));
  }));

  app.get("/api/telemetry/overview", syncRoute((req, res) => {
    res.json(options.getOverviewTelemetrySnapshot());
  }));

  app.get("/api/projects/:projectId/execution", syncRoute((req, res) => {
    res.json(options.getProjectExecutionSnapshot(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  app.get("/api/projects/:projectId/stats", syncRoute((req, res) => {
    const query = parseProjectStatsQuery(req.query as Record<string, unknown>);
    res.json(options.getProjectStatsSnapshot(requireTrimmedString(req.params.projectId, "projectId"), query));
  }));

  app.put("/api/projects/:projectId/preferred-worker", syncRoute((req, res) => {
    if (!options.setPreferredWorker) {
      res.status(501).json({ error: "Preferred worker assignment is not enabled." });
      return;
    }

    res.json(options.setPreferredWorker(
      requireTrimmedString(req.params.projectId, "projectId"),
        parsePreferredWorkerAssignment(req.body)
    ));
  }));

  app.post("/api/projects/:projectId/attention-items/:attentionItemId/claim", syncRoute((req, res) => {
    if (!options.claimAttentionItem) {
      res.status(501).json({ error: "Attention item claim is not enabled." });
      return;
    }

    res.json(options.claimAttentionItem(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.attentionItemId, "attentionItemId"),
        parseClaimAttentionItemPayload(req.body)
    ));
  }));

  app.post("/api/projects/:projectId/attention-items/:attentionItemId/resolve", syncRoute((req, res) => {
    if (!options.resolveAttentionItem) {
      res.status(501).json({ error: "Attention item resolution is not enabled." });
      return;
    }

    res.json(options.resolveAttentionItem(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.attentionItemId, "attentionItemId"),
        parseResolveAttentionItemPayload(req.body)
    ));
  }));
}
