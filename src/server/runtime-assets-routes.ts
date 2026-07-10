import type { Express } from "express";
import type { ProviderId, RuntimeAssetsStatus } from "../contracts/app-types.js";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import { managedRuntimeService } from "../services/managed-runtime-service.js";
import { PROVIDER_TOOL_IDS, providerToolManager } from "../services/provider-tool-manager.js";
import { playwrightBrowserManager } from "../services/playwright-browser-manager.js";

const supportedProviders = new Set<string>(PROVIDER_TOOL_IDS);

export function registerRuntimeAssetsRoutes(app: Express, deps: DashboardDependencies): void {
  app.get("/api/runtime-assets/status", syncRoute((_req, res) => {
    const runtime = deps.managedRuntimeService ?? managedRuntimeService;
    const tools = deps.providerToolManager ?? providerToolManager;
    const browser = deps.playwrightBrowserManager ?? playwrightBrowserManager;
    const status: RuntimeAssetsStatus = {
      managedRuntime: runtime.getStatus(),
      playwrightBrowser: browser.getStatus(),
      providers: tools.getStatuses(),
    };
    res.json(status);
  }));

  app.post("/api/provider-tools/:provider/prepare", asyncRoute(async (req, res) => {
    const provider = String(req.params.provider || "").trim();
    if (!supportedProviders.has(provider)) {
      res.status(400).json({ error: "Unsupported managed provider CLI." });
      return;
    }
    const settings = deps.getSystemSettings();
    const tools = deps.providerToolManager ?? providerToolManager;
    deps.logger?.info("Provider CLI preparation requested.", {
      logPurpose: "runtime",
      provider,
    });
    void tools.prepare(provider as ProviderId, settings.defaults.cliWorkflow, {
      logger: deps.logger,
      checkForUpdate: true,
    }).catch(() => undefined);
    res.status(202).json(tools.getStatus(provider));
  }));

  app.post("/api/playwright-browser/prepare", asyncRoute(async (_req, res) => {
    const settings = deps.getSystemSettings();
    if (settings.defaults.cliWorkflow.containerImageMode === "custom") {
      res.status(400).json({ error: "Custom images manage their own Playwright browser installation." });
      return;
    }
    const browser = deps.playwrightBrowserManager ?? playwrightBrowserManager;
    deps.logger?.info("Playwright browser preparation requested.", { logPurpose: "runtime" });
    void browser.prepare(settings.defaults.cliWorkflow, { logger: deps.logger }).catch(() => undefined);
    res.status(202).json(browser.getStatus());
  }));
}
