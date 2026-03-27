import fs from 'fs';
let content = fs.readFileSync('src/app/dependency-factory/dashboard-factory.ts', 'utf8');

// Add projectWorkerAssignmentRepository to destructuring of coreDeps
content = content.replace('connectionChatRepository,\n    projectAttentionService', 'connectionChatRepository,\n    projectWorkerAssignmentRepository,\n    projectAttentionService');

fs.writeFileSync('src/app/dependency-factory/dashboard-factory.ts', content);
