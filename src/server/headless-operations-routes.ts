import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";

export function registerHeadlessOperationsRoutes(app: Express, deps: DashboardDependencies): void {
  if (deps.automationAuditService) {
    app.get("/api/admin/audit/export", (req, res) => {
      const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() || undefined : undefined;
      const since = typeof req.query.since === "string" ? req.query.since.trim() || undefined : undefined;
      const limitValue = typeof req.query.limit === "string" ? Number.parseInt(req.query.limit, 10) : undefined;
      const principalProjectIds = Array.isArray(res.locals.codeUxPrincipal?.projectIds)
        ? res.locals.codeUxPrincipal.projectIds as string[]
        : [];
      if (!projectId && !principalProjectIds.includes("*")) {
        res.status(403).json({ error: "A projectId is required for project-scoped audit export." });
        return;
      }
      if (projectId && !principalProjectIds.includes("*") && !principalProjectIds.includes(projectId)) {
        res.status(403).json({ error: "The authenticated principal is not authorized for this project." });
        return;
      }
      res.type("application/x-ndjson").send(deps.automationAuditService!.exportNdjson({
        projectId,
        since,
        limit: Number.isFinite(limitValue) ? limitValue : undefined,
      }));
    });
  }
  if (deps.headlessReadinessService) {
    app.get("/api/admin/readiness", asyncRoute(async (_req, res) => {
      const readiness = await deps.headlessReadinessService!.refresh();
      res.status(readiness.status === "READY" ? 200 : 503).json(readiness);
    }));
  }
  if (deps.automationSloService) {
    app.get("/api/admin/metrics/slo", (_req, res) => {
      res.json(deps.automationSloService!.snapshot());
    });
  }
}
