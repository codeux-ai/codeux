import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, parseTrimmedString, requireTrimmedString, syncRoute } from "./route-utils.js";
import type { ProjectStatsQuery, ProjectStatsWindow } from "../contracts/app-types.js";

export function parseProjectStatsQuery(query: Record<string, unknown>): ProjectStatsQuery {
  const requestedWindow = typeof query.window === "string" ? query.window.trim() : "";
  const window: ProjectStatsWindow = (
    requestedWindow === "24h"
    || requestedWindow === "7d"
    || requestedWindow === "30d"
    || requestedWindow === "all"
    || requestedWindow === "custom"
  )
    ? requestedWindow as ProjectStatsWindow
    : "7d";

  const from = typeof query.from === "string" && query.from.trim().length > 0 ? query.from.trim() : undefined;
  const to = typeof query.to === "string" && query.to.trim().length > 0 ? query.to.trim() : undefined;

  if (window === "custom" && (!from || !to)) {
    throw new Error("Custom stats windows require both from and to query parameters.");
  }

  return {
    window,
    from,
    to,
  };
}

export function parseNullableTrimmedString(value: unknown): string | null | undefined {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

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
      {
        workerConnectionId: parseNullableTrimmedString(req.body?.workerConnectionId),
        workerEndpointId: parseNullableTrimmedString(req.body?.workerEndpointId),
        workerEndpointKey: parseNullableTrimmedString(req.body?.workerEndpointKey),
      },
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
      {
        workerEndpointId: typeof req.body?.workerEndpointId === "string" ? req.body.workerEndpointId.trim() : undefined,
        claimReason: typeof req.body?.claimReason === "string" ? req.body.claimReason.trim() : undefined,
      },
    ));
  }));

  app.post("/api/projects/:projectId/attention-items/:attentionItemId/resolve", syncRoute((req, res) => {
    if (!options.resolveAttentionItem) {
      res.status(501).json({ error: "Attention item resolution is not enabled." });
      return;
    }

    const requestedStatus = typeof req.body?.status === "string" ? req.body.status.trim() : undefined;
    res.json(options.resolveAttentionItem(
      requireTrimmedString(req.params.projectId, "projectId"),
      requireTrimmedString(req.params.attentionItemId, "attentionItemId"),
      {
        status: requestedStatus === "dismissed" ? "dismissed" : "resolved",
        reason: typeof req.body?.reason === "string" ? req.body.reason.trim() : undefined,
        resolutionSummaryMarkdown: typeof req.body?.resolutionSummaryMarkdown === "string"
          ? req.body.resolutionSummaryMarkdown
          : undefined,
      },
    ));
  }));
}
