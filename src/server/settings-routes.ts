import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import type { SystemSettings } from "../contracts/settings-scope-types.js";

// Note: liveActivityCacheMs is needed but excluded from DashboardDependencies,
// so we pass it explicitly.
export function registerSettingsRoutes(router: Express, deps: DashboardDependencies, liveActivityCacheMs: number): void {
  router.get("/api/docker/containers", asyncRoute(async (req, res) => {
    try {
      const containers = await deps.listDockerContainers();
      res.json(containers);
    } catch (error) {
      res.json([]);
    }
  }));

  router.get("/api/live-activities", asyncRoute(async (req, res) => {
    try {
      const activitiesBySession = await deps.getLiveActivities();
      res.json({
        activitiesBySession,
        polledAt: new Date().toISOString(),
        cacheTtlMs: liveActivityCacheMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Failed to fetch live activities: ${message}` });
    }
  }));

  router.get("/api/system-settings", syncRoute((req, res) => {
    res.json(deps.getSystemSettings());
  }));

  router.put("/api/system-settings", syncRoute((req, res) => {
    res.json(deps.saveSystemSettings(req.body as SystemSettings));
  }));

  router.post("/api/system/reset-database", asyncRoute(async (req, res) => {
    await deps.resetDatabase();
    res.json({ ok: true });
  }));

  router.get("/api/settings/import-sources", syncRoute((req, res) => {
    res.json(deps.getExternalSettingsHints());
  }));

  router.get("/api/git-status", asyncRoute(async (req, res) => {
    try {
      const status = await deps.getGitStatus();
      res.json(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Failed to fetch git status: ${message}` });
    }
  }));
}
