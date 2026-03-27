import fs from 'fs';
let content = fs.readFileSync('src/services/chat-thread-runtime-service.ts', 'utf8');

// The type is returned from listAssignmentsForProject. Let's see what that type is.
// Actually, it returns an array of McpConnectionWorkerAssignment
content = content.replace('ProjectWorkerAssignmentRecord', 'ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>[0]');

content = content.replace('getThread(', 'requireThread(');

fs.writeFileSync('src/services/chat-thread-runtime-service.ts', content);
