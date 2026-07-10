import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import type { OnboardingDependencyInstallMode } from "../contracts/app-types.js";
import type { SystemSettings } from "../contracts/settings-scope-types.js";
import { registerUserOnboardingRoutes } from "./routes/user/onboarding.js";
import { getModelCatalog, getModelCatalogProviders } from "../domain/model-catalog/model-catalog-loader.js";
import type { LocalMcpCliProvider } from "../services/local-mcp-cli-config-service.js";
import { getActiveProviderTypes, providerToolManager } from "../services/provider-tool-manager.js";

const LOCAL_MCP_PROVIDERS = new Set<LocalMcpCliProvider>([
  "claude-code",
  "gemini",
  "codex",
  "qwen-code",
  "opencode",
  "antigravity",
]);

const ONBOARDING_DEPENDENCY_INSTALL_MODES = new Set<OnboardingDependencyInstallMode>([
  "docker-desktop-git",
  "docker-engine-git",
]);

const parseOnboardingDependencyInstallMode = (value: unknown): OnboardingDependencyInstallMode | null => {
  if (typeof value !== "string") {
    return null;
  }
  const mode = value.trim();
  return ONBOARDING_DEPENDENCY_INSTALL_MODES.has(mode as OnboardingDependencyInstallMode)
    ? mode as OnboardingDependencyInstallMode
    : null;
};

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
    const saved = deps.saveSystemSettings(req.body as SystemSettings);
    const tools = deps.providerToolManager ?? providerToolManager;
    void tools.checkActiveProviders(
      getActiveProviderTypes(saved),
      saved.defaults.cliWorkflow,
      deps.logger,
    );
    res.json(saved);
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

  router.post("/api/onboarding/dependencies/install", asyncRoute(async (req, res) => {
    if (!deps.installOnboardingDependencies) {
      res.status(404).json({ error: "Onboarding dependency installation is not available." });
      return;
    }

    const mode = parseOnboardingDependencyInstallMode(req.body?.mode);
    if (!mode) {
      res.status(400).json({ error: "Unsupported onboarding dependency installer mode." });
      return;
    }
    if (req.body?.confirmInstall !== true) {
      res.status(400).json({ error: "Dependency installation requires explicit confirmation." });
      return;
    }

    deps.logger?.info("Onboarding dependency installation started", {
      logPurpose: "settings",
      mode,
    });
    const result = await deps.installOnboardingDependencies(mode);
    deps.logger?.info("Onboarding dependency installation completed", {
      logPurpose: "settings",
      mode,
      platform: result.platform,
      outcome: result.status,
      commandLabels: result.commands.map((command) => command.label),
    });
    res.json(result);
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
