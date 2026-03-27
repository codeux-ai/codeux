import fs from 'fs';
let content = fs.readFileSync('src/services/chat-thread-runtime-service.ts', 'utf8');

content = content.replace('this.deps.connectionChatRepository.requireThread(userMessage.threadId)', 'this.deps.connectionChatRepository.getThread(userMessage.threadId)');
content = content.replace('const thread = this.deps.connectionChatRepository.getThread(userMessage.threadId);', 'const thread = this.deps.connectionChatRepository.getThread(userMessage.threadId);\n    if (!thread) throw new Error("Thread not found");');

content = content.replace('ExecutionAssignedWorkerSummary', 'ProjectWorkerAssignmentRecord');
content = content.replace('import type { DashboardSettings, ProviderId, Subtask, ExecutionAssignedWorkerSummary } from "../contracts/app-types.js";', 'import type { DashboardSettings, ProviderId, Subtask } from "../contracts/app-types.js";\nimport type { ProjectWorkerAssignmentRecord } from "../contracts/connection-chat-types.js";');

fs.writeFileSync('src/services/chat-thread-runtime-service.ts', content);
