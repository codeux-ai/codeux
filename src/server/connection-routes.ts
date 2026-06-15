import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { syncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import type { UpdateMcpConnectionInput } from "../contracts/connection-chat-types.js";

export function registerConnectionRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/connections", syncRoute((req, res) => {
    res.json(deps.listConnections(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.patch("/api/connections/:connectionId", syncRoute((req, res) => {
    res.json(deps.updateConnection(requireTrimmedString(req.params.connectionId, "connectionId"), req.body as UpdateMcpConnectionInput));
  }));
}
