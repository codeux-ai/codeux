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
import { GuardrailRepository } from "../../repositories/guardrail-repository.js";
import { GuardrailService } from "../../services/guardrail-service.js";
import { AgentPresetRepository } from "../../repositories/agent-preset-repository.js";
import { DashboardRealtimeEventRepository } from "../../repositories/dashboard-realtime-event-repository.js";
import { WorkerEndpointRepository } from "../../repositories/worker-endpoint-repository.js";
import { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import { QaReviewRepository } from "../../repositories/qa-review-repository.js";
import { ProjectWorkerAssignmentService } from "../../domain/workers/project-worker-assignment-service.js";
import { ProjectAttentionRepository } from "../../repositories/project-attention-repository.js";
import { ProjectAttentionService } from "../../domain/workers/project-attention-service.js";
import { WorkerAttentionOutcomeService } from "../../domain/workers/worker-attention-outcome-service.js";
import { AgentPresetSyncService } from "../../services/agent-preset-sync-service.js";
import { ActivitySummaryService } from "../../domain/sessions/activity-summary.js";
import { JulesSourceResolver } from "../../services/jules-source-resolver.js";
import { JulesUsageService } from "../../domain/jules/jules-usage-service.js";
import { SprintMarkdownService } from "../../services/sprint-markdown-service.js";
import { SprintIssueService } from "../../services/sprint-issue-service.js";
import { ActiveDispatchRegistry } from "../../services/active-dispatch-registry.js";
import { RuntimeCleanupService } from "../../services/runtime-cleanup-service.js";
import { DockerRuntimePruneService } from "../../services/docker-runtime-prune-service.js";
import { DashboardRealtimeService } from "../../services/dashboard-realtime-service.js";
import { MemoryRepository } from "../../repositories/memory-repository.js";
import { SchedulerRepository } from "../../repositories/scheduler-repository.js";
import { EmbeddingService } from "../../services/embedding-service.js";
import { EmbeddingModelManager } from "../../services/embedding-model-manager.js";
import { MemoryService } from "../../services/memory-service.js";
import { MemoryPromotionService } from "../../services/memory-promotion-service.js";
import { KnowledgeRepository } from "../../repositories/knowledge-repository.js";
import { KnowledgeIngestionService } from "../../services/knowledge-ingestion-service.js";
import { KnowledgeService } from "../../services/knowledge-service.js";
import { ProviderConcurrencyService } from "../../services/provider-concurrency-service.js";
import { DashboardSettings, ExternalSettingsHints } from "../../contracts/app-types.js";
import { loadExternalSettingsHints } from "../../config/external-settings.js";
import { createLogger, type Logger } from "../../shared/logging/logger.js";
import { ServerContext } from "../dependency-factory.js";
import { getRepoDebugLogPath, CODE_UX_SERVICE_NAME, CODE_UX_VERSION } from "../../shared/config/code-ux-paths.js";

import { ProviderRunner } from "../../infrastructure/providers/cli/provider-runner.js";
import { DockerRunner } from "../../infrastructure/providers/cli/docker-runner.js";
import type { IProviderRunner } from "../../infrastructure/providers/cli/provider-runner.js";
import { resolveEffectiveDashboardSettings } from "../../services/settings-resolution-service.js";
import * as jiraApiClient from "../../services/jira-api-client.js";
import { SprintPreviewService } from "../../services/sprint-preview-service.js";
import { SprintPreviewRepository } from "../../repositories/sprint-preview-repository.js";
import { SprintFileBrowserService } from "../../services/sprint-file-browser-service.js";
import { SprintFileBrowserRepository } from "../../repositories/sprint-file-browser-repository.js";
import { DockerService } from "../../services/docker-service.js";

export interface CoreDependencies {
  providerRunner: IProviderRunner;
  logger: Logger;
  server: Server;
  julesApi: JulesApiClient;
  subtaskRepository: SubtaskFileRepository;
  instructionService: InstructionService;
  sessionTracking: SessionTrackingRepository;
  julesSourceResolver: JulesSourceResolver;
  julesUsage: JulesUsageService;
  activitySummary: ActivitySummaryService;
  settingsRepository: SettingsRepository;
  appDbStorage: AppDbStorage;
  projectManagementRepository: ProjectManagementRepository;
  projectRuntimeRepository: ProjectRuntimeRepository;
  connectionChatRepository: ConnectionChatRepository;
  workerEndpointRepository: WorkerEndpointRepository;
  projectWorkerAssignmentRepository: ProjectWorkerAssignmentRepository;
  qaReviewRepository: QaReviewRepository;
  projectWorkerAssignmentService: ProjectWorkerAssignmentService;
  projectAttentionRepository: ProjectAttentionRepository;
  projectAttentionService: ProjectAttentionService;
  workerAttentionOutcomeService: WorkerAttentionOutcomeService;
  agentPresetRepository: AgentPresetRepository;
  agentPresetSyncService: AgentPresetSyncService;
  executionRepository: ExecutionRepository;
  guardrailRepository: GuardrailRepository;
  guardrailService: GuardrailService;
  dashboardRealtimeEventRepository: DashboardRealtimeEventRepository;
  dashboardRealtimeService: DashboardRealtimeService;
  sprintMarkdownService: SprintMarkdownService;
  sprintIssueService: SprintIssueService;
  activeDispatchRegistry: ActiveDispatchRegistry;
  runtimeCleanupService: RuntimeCleanupService;
  externalSettingsHints: ExternalSettingsHints;
  dashboardSettings: DashboardSettings;
  memoryRepository: MemoryRepository;
  schedulerRepository: SchedulerRepository;
  embeddingService: EmbeddingService;
  embeddingModelManager: EmbeddingModelManager;
  memoryService: MemoryService;
  memoryPromotionService: MemoryPromotionService;
  knowledgeRepository: KnowledgeRepository;
  knowledgeService: KnowledgeService;
  providerConcurrencyService: ProviderConcurrencyService;
  sprintPreviewService: SprintPreviewService;
  sprintPreviewRepository: SprintPreviewRepository;
  sprintFileBrowserService: SprintFileBrowserService;
  sprintFileBrowserRepository: SprintFileBrowserRepository;
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
    resolveEffectiveDashboardSettings(settingsRepository, projectId, sprintId).settings.workers.executionMode
  );

  const logger = createLogger({
    bindings: { service: CODE_UX_SERVICE_NAME },
    getConsoleLogLevel: () => context.runtimeContext.dashboardSettings?.consoleLogLevel,
    getDebugLogFileLevel: () => context.runtimeContext.dashboardSettings?.debugLogFileLevel,
    getConsoleLogMode: () => context.runtimeContext.dashboardSettings?.consoleLogMode,
    logFilePath: getRepoDebugLogPath(options.projectRoot),
  });

  const server = new Server(
    {
      name: CODE_UX_SERVICE_NAME,
      version: CODE_UX_VERSION,
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
  const qaReviewRepository = new QaReviewRepository(appDbStorage);
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
  const executionRepository = new ExecutionRepository(appDbStorage, dashboardRealtimeService);
  const guardrailRepository = new GuardrailRepository(appDbStorage);
  const guardrailService = new GuardrailService(
    guardrailRepository,
    (scope) => resolveEffectiveDashboardSettings(settingsRepository, scope.projectId, scope.sprintId).settings.guardrails,
    logger.child({ component: "guardrail-service" }),
  );
  const providerConcurrencyService = new ProviderConcurrencyService({
    executionRepository,
    logger: logger.child({ component: "provider-concurrency-service" }),
    dockerService: new DockerService(),
  });
  const sprintPreviewRepository = new SprintPreviewRepository(appDbStorage);
  const sprintPreviewService = new SprintPreviewService({
    sprintPreviewRepository,
    projectManagementRepository,
    executionRepository,
    settingsRepository,
    logger: logger.child({ component: "sprint-preview-service" }),
  });
  const sprintFileBrowserRepository = new SprintFileBrowserRepository(appDbStorage);
  const sprintFileBrowserService = new SprintFileBrowserService({
    sprintFileBrowserRepository,
    projectManagementRepository,
    settingsRepository,
    logger: logger.child({ component: "sprint-file-browser-service" }),
  });
  const sprintMarkdownService = new SprintMarkdownService(projectManagementRepository);
  const sprintIssueService = new SprintIssueService({
    projectManagementRepository,
    getDashboardSettings: (scope) => scope?.projectId
      ? resolveEffectiveDashboardSettings(settingsRepository, scope.projectId, scope.sprintId).settings
      : settingsRepository.getDefaultDashboardSettings(),
    logger: logger.child({ component: "sprint-issue-service" }),
    jiraApiClient,
  });
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
  const providerRunner = new ProviderRunner(new DockerRunner());
  const julesSourceResolver = new JulesSourceResolver(julesApi);
  const julesUsage = new JulesUsageService(
    julesApi,
    executionRepository,
    logger.child({ component: "jules-usage-service" })
  );
  const activitySummary = new ActivitySummaryService();
  const memoryRepository = new MemoryRepository(appDbStorage);
  const schedulerRepository = new SchedulerRepository(appDbStorage, dashboardRealtimeService);
  const embeddingService = new EmbeddingService();
  const embeddingModelManager = new EmbeddingModelManager(
    embeddingService,
    memoryRepository,
    logger.child({ component: "embedding-model-manager" }),
  );

  const memoryService = new MemoryService(
    memoryRepository,
    embeddingService,
    logger.child({ component: "memory-service" }),
  );
  const memoryPromotionService = new MemoryPromotionService(
    memoryService,
    memoryRepository,
    logger.child({ component: "memory-promotion-service" }),
  );
  const knowledgeRepository = new KnowledgeRepository(appDbStorage);
  const knowledgeService = new KnowledgeService(
    knowledgeRepository,
    new KnowledgeIngestionService(logger.child({ component: "knowledge-ingestion-service" })),
    embeddingService,
    logger.child({ component: "knowledge-service" }),
  );
  const agentPresetSyncService = new AgentPresetSyncService({
    projectManagementRepository,
    agentPresetRepository,
    settingsRepository,
    projectRoot: options.projectRoot,
    logger: logger.child({ component: "agent-preset-sync-service" }),
    knowledgeService,
  });
  const instructionService = new InstructionService({
    settingsRepository,
    projectManagementRepository,
  });

  return {
    providerRunner,
    logger,
    server,
    julesApi,
    subtaskRepository,
    instructionService,
    sessionTracking,
    julesSourceResolver,
    julesUsage,
    activitySummary,
    settingsRepository,
    appDbStorage,
    projectManagementRepository,
    projectRuntimeRepository,
    connectionChatRepository,
    workerEndpointRepository,
    projectWorkerAssignmentRepository,
    qaReviewRepository,
    projectWorkerAssignmentService,
    projectAttentionRepository,
    projectAttentionService,
    workerAttentionOutcomeService,
    agentPresetRepository,
    agentPresetSyncService,
    executionRepository,
    guardrailRepository,
    guardrailService,
    dashboardRealtimeEventRepository,
    dashboardRealtimeService,
    sprintMarkdownService,
    sprintIssueService,
    activeDispatchRegistry,
    runtimeCleanupService,
    externalSettingsHints,
    dashboardSettings,
    memoryRepository,
    schedulerRepository,
    embeddingService,
    embeddingModelManager,
    memoryService,
    memoryPromotionService,
    knowledgeRepository,
    knowledgeService,
    providerConcurrencyService,
    sprintPreviewService,
    sprintPreviewRepository,
    sprintFileBrowserService,
    sprintFileBrowserRepository,
  };
}
