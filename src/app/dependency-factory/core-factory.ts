import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AppConfig } from "../../config/app-config.js";
import { JulesApiClient } from "../../integrations/jules-api-client.js";
import { GuideRepository } from "../../repositories/guide-repository.js";
import { SubtaskFileRepository } from "../../infrastructure/repositories/subtask-file-repository.js";
import { SettingsRepository } from "../../repositories/settings-repository.js";
import { InstructionService } from "../../instructions/instruction-template-service.js";
import { SessionTrackingRepository } from "../../repositories/session-tracking-repository.js";
import { AppDbStorage } from "../../repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../../repositories/project-runtime-repository.js";
import { ConnectionChatRepository } from "../../repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../repositories/execution-repository.js";
import { ActivitySummaryService } from "../../domain/sessions/activity-summary.js";
import { JulesSourceResolver } from "../../services/jules-source-resolver.js";
import { SprintMarkdownService } from "../../services/sprint-markdown-service.js";
import { ActiveDispatchRegistry } from "../../services/active-dispatch-registry.js";
import { DashboardSettings, ExternalSettingsHints } from "../../contracts/app-types.js";
import { loadExternalSettingsHints } from "../../config/external-settings.js";
import { createLogger, type Logger } from "../../shared/logging/logger.js";
import { ServerContext } from "../dependency-factory.js";
import { getRepoDebugLogPath, SPRINT_OS_SERVICE_NAME } from "../../shared/config/sprint-os-paths.js";

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
  appDbStorage: AppDbStorage;
  projectManagementRepository: ProjectManagementRepository;
  projectRuntimeRepository: ProjectRuntimeRepository;
  connectionChatRepository: ConnectionChatRepository;
  executionRepository: ExecutionRepository;
  sprintMarkdownService: SprintMarkdownService;
  activeDispatchRegistry: ActiveDispatchRegistry;
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
    ? getRepoDebugLogPath(options.projectRoot)
    : undefined;

  const logger = createLogger({
    bindings: { service: SPRINT_OS_SERVICE_NAME },
    logFilePath,
  });

  const server = new Server(
    {
      name: SPRINT_OS_SERVICE_NAME,
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
  const appDbStorage = new AppDbStorage();
  const projectManagementRepository = new ProjectManagementRepository(appDbStorage);
  const projectRuntimeRepository = new ProjectRuntimeRepository(appDbStorage);
  const connectionChatRepository = new ConnectionChatRepository(appDbStorage);
  const executionRepository = new ExecutionRepository(appDbStorage);
  const sprintMarkdownService = new SprintMarkdownService(projectManagementRepository);
  const activeDispatchRegistry = new ActiveDispatchRegistry();
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
    appDbStorage,
    projectManagementRepository,
    projectRuntimeRepository,
    connectionChatRepository,
    executionRepository,
    sprintMarkdownService,
    activeDispatchRegistry,
    externalSettingsHints,
    dashboardSettings,
  };
}
