import fs from 'fs';
let content = fs.readFileSync('src/server/dashboard-server.ts', 'utf8');

content = content.replace('postConversationMessage: (projectId: string, input: CreateDashboardConversationMessageInput) => ConversationMessageRecord;', 'postConversationMessage: (projectId: string, input: CreateDashboardConversationMessageInput) => Promise<ConversationMessageRecord> | ConversationMessageRecord;');

fs.writeFileSync('src/server/dashboard-server.ts', content);

let julesContent = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');
julesContent = julesContent.replace('quicksprintService: deps.dashboardDeps.quicksprintService,', 'quicksprintService: deps.dashboardDeps.quicksprintService,\n      chatThreadRuntimeService: deps.dashboardDeps.chatThreadRuntimeService,');
fs.writeFileSync('src/server/jules-agent-server.ts', julesContent);
