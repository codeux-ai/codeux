import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/dashboard-factory.ts', 'utf8');

content = content.replace('export interface DashboardDependencies {', 'import { ChatThreadRuntimeService } from "../../services/chat-thread-runtime-service.js";\n\nexport interface DashboardDependencies {\n  chatThreadRuntimeService: ChatThreadRuntimeService;');

content = content.replace('activeDispatchRegistry,\n  } = coreDeps;', 'activeDispatchRegistry,\n    providerRunner,\n    taskService,\n  } = coreDeps;');

// We don't have taskService in coreDeps. Where is it? In sprintDeps.
content = content.replace('providerRunner,\n    taskService,\n  } = coreDeps;', 'providerRunner,\n  } = coreDeps;');
content = content.replace('const { sprintTaskDispatchService, sprintOrchestrator } = sprintDeps;', 'const { sprintTaskDispatchService, sprintOrchestrator, taskService } = sprintDeps;');

// instantiate chatThreadRuntimeService
let chatThreadRuntimeService = `  const chatThreadRuntimeService = new ChatThreadRuntimeService({
    connectionChatRepository,
    projectWorkerAssignmentRepository,
    executionRepository,
    taskService,
    getDashboardSettings: () => settingsRepository.getDefaultDashboardSettings(),
    getGithubToken: () => context.getEffectiveGithubToken(),
    agentPresetSyncService,
    projectManagementRepository,
    providerRunner,
    logger: logger.child({ component: "chat-thread-runtime-service" }),
  });\n\n`;

content = content.replace('const activityCacheService = new ActivityCacheService(', chatThreadRuntimeService + '  const activityCacheService = new ActivityCacheService(');

content = content.replace('  return {\n    activityCacheService,', '  return {\n    chatThreadRuntimeService,\n    activityCacheService,');

fs.writeFileSync('src/app/dependency-factory/dashboard-factory.ts', content);
