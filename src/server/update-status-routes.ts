import { type Express } from "express";
import { type DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";

export function registerUpdateStatusRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/system/update-status", asyncRoute(async (_req, res) => {
    res.json(await deps.getUpdateStatus());
  }));
}
