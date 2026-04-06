import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { syncRoute, requireTrimmedString } from "./route-utils.js";

export function registerExecutionInvocationRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/execution/invocations", syncRoute((req, res) => {
    res.json(deps.listProjectInvocations(requireTrimmedString(req.params.projectId, "projectId")));
  }));

  router.get("/api/execution/invocations/:invocationId/messages", syncRoute((req, res) => {
    res.json(deps.listInvocationMessages(requireTrimmedString(req.params.invocationId, "invocationId")));
  }));
}
