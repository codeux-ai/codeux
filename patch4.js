import fs from 'fs';
let content = fs.readFileSync('src/services/chat-thread-runtime-service.ts', 'utf8');

// replace requireThread with listThreads finding the thread
content = content.replace('const thread = this.deps.connectionChatRepository.requireThread(userMessage.threadId);', 'const thread = this.deps.connectionChatRepository.listThreads(projectId).find((t) => t.id === userMessage.threadId);\n    if (!thread) throw new Error("Thread not found");');

// replace ExecutionAssignedWorkerSummary with ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>[0]
content = content.replace('private resolveLiveWorkerAssignment(projectId: string): ExecutionAssignedWorkerSummary | null', 'private resolveLiveWorkerAssignment(projectId: string): ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>[0] | null');

fs.writeFileSync('src/services/chat-thread-runtime-service.ts', content);
