import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import type { SystemSettings } from "../contracts/settings-scope-types.js";
import { registerUserOnboardingRoutes } from "./routes/user/onboarding.js";
import { getModelCatalog, getModelCatalogProviders } from "../domain/model-catalog/model-catalog-loader.js";
import type { LocalMcpCliProvider } from "../services/local-mcp-cli-config-service.js";

const LOCAL_MCP_PROVIDERS = new Set<LocalMcpCliProvider>([
  "claude-code",
  "gemini",
  "codex",
  "qwen-code",
  "opencode",
  "antigravity",
]);

// Note: liveActivityCacheMs is needed but excluded from DashboardDependencies,
// so we pass it explicitly.
export function registerSettingsRoutes(router: Express, deps: DashboardDependencies, liveActivityCacheMs: number): void {
  registerUserOnboardingRoutes(router, deps);

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

  router.get("/api/settings/local-mcp", syncRoute((req, res) => {
    res.json(deps.getLocalMcpSetup());
  }));

  router.post("/api/settings/local-mcp/regenerate-token", syncRoute((req, res) => {
    res.json(deps.regenerateLocalMcpAuthToken());
  }));

  router.post("/api/settings/local-mcp/install", asyncRoute(async (req, res) => {
    const provider = typeof req.body?.provider === "string" ? req.body.provider.trim() : "";
    if (!LOCAL_MCP_PROVIDERS.has(provider as LocalMcpCliProvider)) {
      res.status(400).json({ error: "Unsupported local MCP provider." });
      return;
    }
    res.json(await deps.installLocalMcpProvider(provider as LocalMcpCliProvider));
  }));

  router.get("/api/model-catalog", syncRoute((req, res) => {
    res.json(getModelCatalog());
  }));

  router.get("/api/model-catalog/providers", syncRoute((req, res) => {
    res.json(getModelCatalogProviders());
  }));

  router.get("/api/onboarding/readiness", asyncRoute(async (req, res) => {
    if (!deps.getOnboardingRuntimeReadiness) {
      res.status(404).json({ error: "Onboarding readiness checks are not available." });
      return;
    }
    res.json(await deps.getOnboardingRuntimeReadiness());
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
