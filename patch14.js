import fs from 'fs';
let content = fs.readFileSync('src/app/lifecycle/dashboard-lifecycle-service.ts', 'utf8');

content = content.replace('import type { PlanningAgentService } from "../../services/planning-agent-service.js";', 'import type { PlanningAgentService } from "../../services/planning-agent-service.js";\nimport type { ChatThreadRuntimeService } from "../../services/chat-thread-runtime-service.js";');

content = content.replace('dashboardRealtimeService: DashboardRealtimeService;\n  logger: Logger;', 'chatThreadRuntimeService: ChatThreadRuntimeService;\n  dashboardRealtimeService: DashboardRealtimeService;\n  logger: Logger;');

content = content.replace('postConversationMessage: (projectId, input) => deps.connectionChatRepository.postDashboardMessage(projectId, input),', 'postConversationMessage: (projectId, input) => deps.chatThreadRuntimeService.postMessage(projectId, input),');

fs.writeFileSync('src/app/lifecycle/dashboard-lifecycle-service.ts', content);
