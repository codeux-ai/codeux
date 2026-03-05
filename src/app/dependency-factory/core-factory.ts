import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import * as path from "path";
import { AppConfig } from "../../config/app-config.js";
import { JulesApiClient } from "../../integrations/jules-api-client.js";
import { GuideRepository } from "../../repositories/guide-repository.js";
import { SubtaskFileRepository } from "../../infrastructure/repositories/subtask-file-repository.js";
import { SettingsRepository } from "../../repositories/settings-repository.js";
import { InstructionService } from "../../instructions/instruction-template-service.js";
import { SessionTrackingRepository } from "../../repositories/session-tracking-repository.js";
import { ActivitySummaryService } from "../../domain/sessions/activity-summary.js";
import { JulesSourceResolver } from "../../services/jules-source-resolver.js";
import { DashboardSettings, ExternalSettingsHints } from "../../contracts/app-types.js";
import { loadExternalSettingsHints } from "../../config/external-settings.js";
import { createLogger, type Logger } from "../../shared/logging/logger.js";
import { ServerContext } from "../dependency-factory.js";

export interface CoreDependencies {
  logger: Logger;
  server: Server;
  julesApi: JulesApiClient;
  guideRepository: GuideRepository;
  subtaskRepository: SubtaskFileRepository;
  instructionService: InstructionService;
  sessionTracking: SessionTrackingRepository;
  julesSourceResolver: JulesSourceResolver;
  activitySummary: ActivitySummaryService;
  settingsRepository: SettingsRepository;
  externalSettingsHints: ExternalSettingsHints;
  dashboardSettings: DashboardSettings;
}

export function createCoreDependencies(
  options: { projectRoot: string; appConfig: AppConfig },
  context: ServerContext
): CoreDependencies {
  const externalSettingsHints = loadExternalSettingsHints(options.projectRoot);
  const settingsRepository = new SettingsRepository(undefined, externalSettingsHints);
  const dashboardSettings = settingsRepository.getSettings();
  context.runtimeContext.dashboardSettings = dashboardSettings;

  const logFilePath = dashboardSettings.enableDebugLogFile
    ? path.join(options.projectRoot, ".jules-subagents", "debug.log")
    : undefined;

  const logger = createLogger({
    bindings: { service: "jules-subagents" },
    logFilePath,
  });

  const server = new Server(
    {
      name: "jules-subagents",
      version: "1.2.0",
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {},
      },
    }
  );

  const julesApi = new JulesApiClient({
    apiKey: context.getEffectiveJulesApiKey(),
    baseUrl: options.appConfig.baseUrl,
  });

  const guideRepository = new GuideRepository(options.projectRoot);
  const subtaskRepository = new SubtaskFileRepository();
  const instructionService = new InstructionService(options.projectRoot);
  const sessionTracking = new SessionTrackingRepository();
  const julesSourceResolver = new JulesSourceResolver(julesApi);
  const activitySummary = new ActivitySummaryService();

  return {
    logger,
    server,
    julesApi,
    guideRepository,
    subtaskRepository,
    instructionService,
    sessionTracking,
    julesSourceResolver,
    activitySummary,
    settingsRepository,
    externalSettingsHints,
    dashboardSettings,
  };
}
