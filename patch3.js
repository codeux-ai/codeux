import fs from 'fs';
let content = fs.readFileSync('src/services/chat-thread-runtime-service.ts', 'utf8');

// replace the weird type import
content = content.replace('import type { DashboardSettings, ProviderId, Subtask, ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>[0] } from "../contracts/app-types.js";', 'import type { DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";');

content = content.replace('private resolveLiveWorkerAssignment(projectId: string): ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>[0] | null', 'private resolveLiveWorkerAssignment(projectId: string): ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>[0] | null');

content = content.replace('const thread = this.deps.connectionChatRepository.requireThread(userMessage.threadId);\n    if (!thread) throw new Error("Thread not found");', 'const thread = this.deps.connectionChatRepository.requireThread(userMessage.threadId);');

fs.writeFileSync('src/services/chat-thread-runtime-service.ts', content);
