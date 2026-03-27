import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

// The class JulesAgentServer needs chatThreadRuntimeService
// We should expose it from deps.dashboardDeps
content = content.replace('private readonly quicksprintService: QuicksprintService;', 'private readonly quicksprintService: QuicksprintService;\n  private readonly chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;');

content = content.replace('this.quicksprintService = deps.dashboardDeps.quicksprintService;', 'this.quicksprintService = deps.dashboardDeps.quicksprintService;\n    this.chatThreadRuntimeService = deps.dashboardDeps.chatThreadRuntimeService;');

fs.writeFileSync('src/server/jules-agent-server.ts', content);
