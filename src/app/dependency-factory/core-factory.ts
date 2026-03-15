import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { AppConfig } from "../../config/app-config.js";
import { JulesApiClient } from "../../integrations/jules-api-client.js";
import { SubtaskFileRepository } from "../../infrastructure/repositories/subtask-file-repository.js";
import { SettingsRepository } from "../../repositories/settings-repository.js";
import { InstructionService } from "../../instructions/instruction-template-service.js";
import { SessionTrackingRepository } from "../../repositories/session-tracking-repository.js";
import { AppDbStorage } from "../../repositories/app-db-storage.js";
import { ProjectManagementRepository } from "../../repositories/project-management-repository.js";
import { ProjectRuntimeRepository } from "../../repositories/project-runtime-repository.js";
import { ConnectionChatRepository } from "../../repositories/connection-chat-repository.js";
import { ExecutionRepository } from "../../repositories/execution-repository.js";
import { AgentPresetRepository } from "../../repositories/agent-preset-repository.js";
import { DashboardRealtimeEventRepository } from "../../repositories/dashboard-realtime-event-repository.js";
import { WorkerEndpointRepository } from "../../repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import { ProjectWorkerAssignmentService } from "../../domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionRepository } from "../../repositories/project-attention-repository.js";
import { ProjectAttentionService } from "../../domain/workers/project-attention-service.js";
import { WorkerAttentionOutcomeService } from "../../domain/workers/worker-attention-outcome-service.js";
import { AgentPresetSyncService } from "../../services/agent-preset-sync-service.js";
import { ActivitySummaryService } from "../../domain/sessions/activity-summary.js";
import { JulesSourceResolver } from "../../services/jules-source-resolver.js";
import { SprintMarkdownService } from "../../services/sprint-markdown-service.js";
import { ActiveDispatchRegistry } from "../../services/active-dispatch-registry.js";
import { RuntimeCleanupService } from "../../services/runtime-cleanup-service.js";
import { DockerRuntimePruneService } from "../../services/docker-runtime-prune-service.js";
import { DashboardRealtimeService } from "../../services/dashboard-realtime-service.js";
import { DashboardSettings, ExternalSettingsHints } from "../../contracts/app-types.js";
import { loadExternalSettingsHints } from "../../config/external-settings.js";
import { createLogger, type Logger } from "../../shared/logging/logger.js";
import { ServerContext } from "../dependency-factory.js";
import { getRepoDebugLogPath, SPRINT_OS_SERVICE_NAME } from "../../shared/config/sprint-os-paths.js";

export interface CoreDependencies {
  logger: Logger;
  server: Server;
  julesApi: JulesApiClient;
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
  workerEndpointRepository: WorkerEndpointRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  projectAttentionRepository: ProjectAttentionRepository;
  projectAttentionService: ProjectAttentionService;
  workerAttentionOutcomeService: WorkerAttentionOutcomeService;
  agentPresetRepository: AgentPresetRepository;
  agentPresetSyncService: AgentPresetSyncService;
  executionRepository: ExecutionRepository;
  dashboardRealtimeEventRepository: DashboardRealtimeEventRepository;
  dashboardRealtimeService: DashboardRealtimeService;
  sprintMarkdownService: SprintMarkdownService;
  activeDispatchRegistry: ActiveDispatchRegistry;
  runtimeCleanupService: RuntimeCleanupService;
  externalSettingsHints: ExternalSettingsHints;
  dashboardSettings: DashboardSettings;
}

export function createCoreDependencies(
  options: { projectRoot: string; appConfig: AppConfig },
  context: ServerContext
): CoreDependencies {
  const externalSettingsHints = loadExternalSettingsHints(options.projectRoot);
  const settingsRepository = new SettingsRepository(undefined, externalSettingsHints);
  const dashboardSettings = settingsRepository.getDefaultDashboardSettings();
  context.runtimeContext.dashboardSettings = dashboardSettings;
  const resolveWorkerExecutionMode = (projectId: string, sprintId?: string | null) => (
    sprintId
      ? settingsRepository.resolveSprintDashboardSettings(projectId, sprintId).settings.workers.executionMode
      : settingsRepository.resolveProjectDashboardSettings(projectId).settings.workers.executionMode
  );

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

  const subtaskRepository = new SubtaskFileRepository();
  const sessionTracking = new SessionTrackingRepository();
  const appDbStorage = new AppDbStorage();
  const dashboardRealtimeEventRepository = new DashboardRealtimeEventRepository(appDbStorage);
  const dashboardRealtimeService = new DashboardRealtimeService(
    dashboardRealtimeEventRepository,
    logger.child({ component: "dashboard-realtime-service" }),
  );
  const projectManagementRepository = new ProjectManagementRepository(appDbStorage, dashboardRealtimeService);
  const projectRuntimeRepository = new ProjectRuntimeRepository(appDbStorage, dashboardRealtimeService);
  const workerEndpointRepository = new WorkerEndpointRepository(appDbStorage);
  const projectWorkerAssignmentRepository = new ProjectWorkerAssignmentRepository(appDbStorage);
  const projectWorkerAssignmentService = new ProjectWorkerAssignmentService(
    projectWorkerAssignmentRepository,
    workerEndpointRepository,
  );
  const projectAttentionRepository = new ProjectAttentionRepository(appDbStorage, dashboardRealtimeService);
  const projectAttentionService = new ProjectAttentionService(
    projectAttentionRepository,
    projectWorkerAssignmentRepository,
    resolveWorkerExecutionMode,
  );
  const connectionChatRepository = new ConnectionChatRepository(
    appDbStorage,
    dashboardRealtimeService,
    workerEndpointRepository,
  );
  const workerAttentionOutcomeService = new WorkerAttentionOutcomeService(
    projectAttentionService,
    connectionChatRepository,
  );
  const agentPresetRepository = new AgentPresetRepository(appDbStorage);
  const agentPresetSyncService = new AgentPresetSyncService({
    projectManagementRepository,
    agentPresetRepository,
    settingsRepository,
    projectRoot: options.projectRoot,
    logger: logger.child({ component: "agent-preset-sync-service" }),
  });
  const executionRepository = new ExecutionRepository(appDbStorage, dashboardRealtimeService);
  const sprintMarkdownService = new SprintMarkdownService(projectManagementRepository);
  const activeDispatchRegistry = new ActiveDispatchRegistry();
  const dockerRuntimePruneService = new DockerRuntimePruneService(
    sessionTracking,
    logger.child({ component: "docker-runtime-prune-service" }),
  );
  const runtimeCleanupService = new RuntimeCleanupService(
    connectionChatRepository,
    executionRepository,
    projectManagementRepository,
    projectAttentionService,
    dockerRuntimePruneService,
    logger.child({ component: "runtime-cleanup-service" }),
  );
  const julesSourceResolver = new JulesSourceResolver(julesApi);
  const activitySummary = new ActivitySummaryService();
  const instructionService = new InstructionService({
    settingsRepository,
    projectManagementRepository,
  });

  return {
    logger,
    server,
    julesApi,
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
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    projectWorkerAssignmentService,
    projectAttentionRepository,
    projectAttentionService,
    workerAttentionOutcomeService,
    agentPresetRepository,
    agentPresetSyncService,
    executionRepository,
    dashboardRealtimeEventRepository,
    dashboardRealtimeService,
    sprintMarkdownService,
    activeDispatchRegistry,
    runtimeCleanupService,
    externalSettingsHints,
    dashboardSettings,
  };
}
