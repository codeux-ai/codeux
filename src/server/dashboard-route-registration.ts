import type { Express } from "express";
import type { DashboardDependencies, DashboardServerOptions } from "./dashboard-server.js";
import { CODE_UX_VERSION } from "../shared/config/code-ux-paths.js";
import { buildUpdateDownloadTargets } from "../services/update-checker-service.js";

import { registerProjectRoutes } from "./project-routes.js";
import { registerSprintRoutes } from "./sprint-routes.js";
import { registerTaskRoutes } from "./task-routes.js";
import { registerLiveTaskRoutes } from "./routes/live-tasks.js";
import { registerConversationRoutes } from "./conversation-routes.js";
import { registerPlanningRoutes } from "./planning-routes.js";
import { registerPreviewRoutes } from "./preview-routes.js";
import { registerFileBrowserRoutes } from "./file-browser-routes.js";
import { registerRuntimeRoutes } from "./runtime-routes.js";
import { registerRuntimeAssetsRoutes } from "./runtime-assets-routes.js";
import { registerExecutionControlRoutes } from "./execution-control-routes.js";
import { registerSettingsRoutes } from "./settings-routes.js";
import { registerConnectionRoutes } from "./connection-routes.js";
import { registerAgentPresetRoutes } from "./agent-preset-routes.js";
import { registerInstructionFileRoutes } from "./instruction-file-routes.js";
import { registerExecutionInvocationRoutes } from "./execution-invocation-routes.js";
import { registerQuicksprintRoutes } from "./quicksprint-routes.js";
import { registerLocalDirectoryRoutes } from "./local-directory-routes.js";
import { registerSchedulerRoutes } from "./scheduler-routes.js";
import { registerTerminalRoutes } from "./terminal-routes.js";
import { registerSprintComposerRoutes } from "./routes/sprint-composer.js";
import { registerGitProviderRoutes } from "./git-provider-routes.js";
import { registerUpdateStatusRoutes } from "./update-status-routes.js";
import { registerMemoryRoutes } from "./memory-routes.js";
import { registerKnowledgeRoutes } from "./knowledge-routes.js";
import { registerDocsWebRoutes } from "./docs-web-routes.js";
import { registerChatProviderRoutes } from "./chat-provider-routes.js";
import { registerChatProviderIngressRoutes } from "./chat-provider-ingress-routes.js";
import { registerSpeechRoutes } from "./speech-routes.js";
import { registerNodeFlowRoutes } from "./node-flow-routes.js";
import { registerCustomDashboardRoutes } from "./custom-dashboard-routes.js";

export interface DashboardRouteRegistrationOptions {
  app: Express;
  deps: DashboardDependencies;
  liveActivityCacheMs: number;
}

export const createDashboardRouteDependencies = (options: DashboardServerOptions): DashboardDependencies => {
  const {
    app: _app,
    dashboardDir: _dashboardDir,
    port: _port,
    liveActivityCacheMs: _liveActivityCacheMs,
    getUpdateStatus,
    ...routeDependencies
  } = options;

  return {
    ...routeDependencies,
    getUpdateStatus: getUpdateStatus ?? (async () => ({
      currentVersion: CODE_UX_VERSION,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: "https://github.com/codeux-ai/codeux/releases",
      downloadTargets: buildUpdateDownloadTargets(null),
      checkedAt: new Date().toISOString(),
    })),
    getLocalMcpSetup: routeDependencies.getLocalMcpSetup ?? (() => ({
      enabled: false,
      url: null,
      authToken: null,
      providers: [],
    })),
    regenerateLocalMcpAuthToken: routeDependencies.regenerateLocalMcpAuthToken ?? (() => ({
      enabled: false,
      url: null,
      authToken: null,
      providers: [],
    })),
    installLocalMcpProvider: routeDependencies.installLocalMcpProvider ?? (async () => {
      throw new Error("Local MCP CLI installation is not available.");
    }),
  };
};

const registerProjectRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  registerProjectRoutes(app, deps);
};

const registerSprintRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  registerSprintRoutes(app, deps);
  registerSprintComposerRoutes(app, deps);
  registerTaskRoutes(app, deps);
  registerLiveTaskRoutes(app, deps);
  registerConversationRoutes(app, deps);
  registerPlanningRoutes(app, deps);
};

const registerRuntimeRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  registerRuntimeRoutes(app, deps);
  registerRuntimeAssetsRoutes(app, deps);
  registerLocalDirectoryRoutes(app);
  registerExecutionControlRoutes(app, deps);
};

const registerPreviewRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  registerPreviewRoutes(app, deps);
  registerFileBrowserRoutes(app, deps);
};

const registerSettingsRouteGroup = (app: Express, deps: DashboardDependencies, liveActivityCacheMs: number): void => {
  registerSettingsRoutes(app, deps, liveActivityCacheMs);
  registerChatProviderRoutes(app, deps);
  registerChatProviderIngressRoutes(app, deps);
};

const registerProjectConfigurationRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  registerConnectionRoutes(app, deps);
  registerAgentPresetRoutes(app, deps);
  registerInstructionFileRoutes(app, deps);
  registerNodeFlowRoutes(app, deps);
  registerCustomDashboardRoutes(app, deps);
};

const registerExecutionRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  registerExecutionInvocationRoutes(app, deps);
  registerQuicksprintRoutes(app, deps);
  registerSchedulerRoutes(app, deps);
  registerTerminalRoutes(app, deps);
};

const registerSystemIntegrationRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  registerGitProviderRoutes(app, deps);
  registerUpdateStatusRoutes(app, deps);
  registerDocsWebRoutes(app);
};

const registerSpeechRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  if (deps.speechTranscriptionService) {
    registerSpeechRoutes(app, { speechTranscriptionService: deps.speechTranscriptionService });
  }
};

const registerOptionalKnowledgeRouteGroup = (app: Express, deps: DashboardDependencies): void => {
  if (
    deps.memoryService &&
    deps.memoryPromotionService &&
    deps.embeddingModelManager &&
    deps.embeddingService &&
    deps.memoryRepository &&
    deps.settingsRepository
  ) {
    registerMemoryRoutes(app, {
      memoryService: deps.memoryService,
      memoryPromotionService: deps.memoryPromotionService,
      embeddingModelManager: deps.embeddingModelManager,
      embeddingService: deps.embeddingService,
      memoryRepository: deps.memoryRepository,
      settingsRepository: deps.settingsRepository,
    });
  }
  if (
    deps.knowledgeService &&
    deps.agentPresetRepository &&
    deps.projectManagementRepository
  ) {
    registerKnowledgeRoutes(app, {
      knowledgeService: deps.knowledgeService,
      agentPresetRepository: deps.agentPresetRepository,
      projectManagementRepository: deps.projectManagementRepository,
    });
  }
};

export const registerDashboardRoutes = ({
  app,
  deps,
  liveActivityCacheMs,
}: DashboardRouteRegistrationOptions): void => {
  registerProjectRouteGroup(app, deps);
  registerSprintRouteGroup(app, deps);
  registerPreviewRouteGroup(app, deps);
  registerRuntimeRouteGroup(app, deps);
  registerSettingsRouteGroup(app, deps, liveActivityCacheMs);
  registerProjectConfigurationRouteGroup(app, deps);
  registerExecutionRouteGroup(app, deps);
  registerSystemIntegrationRouteGroup(app, deps);
  registerSpeechRouteGroup(app, deps);
  registerOptionalKnowledgeRouteGroup(app, deps);
};
