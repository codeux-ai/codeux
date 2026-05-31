import type { Express } from "express";
import type { DashboardDependencies } from "../dashboard-server.js";
import { asyncRoute, requireTrimmedString } from "../route-utils.js";
import { fetchProjectPlanningMetrics } from "../../domain/planning/invocation-metrics.js";
import { PlanningEtaEstimator } from "../../domain/sprint/composer/eta-estimator.js";

export function registerSprintComposerRoutes(app: Express, deps: DashboardDependencies): void {
  const estimator = new PlanningEtaEstimator();

  app.get("/api/projects/:projectId/sprints/composer/eta", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    
    // Scoped to project, last 10 planning invocations
    const metrics = fetchProjectPlanningMetrics(deps.listProjectInvocations, projectId, 10);
    const estimate = estimator.estimate(metrics.durationsMs);

    res.json(estimate);
  }));
}
