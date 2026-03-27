import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

// The file might not have the import or the properties exactly. Let's see what's near quicksprintService
content = content.replace('private readonly quicksprintService: QuicksprintService;', 'private readonly quicksprintService: QuicksprintService;\n  private readonly chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;');
content = content.replace('this.quicksprintService = deps.dashboardDeps.quicksprintService;', 'this.quicksprintService = deps.dashboardDeps.quicksprintService;\n    this.chatThreadRuntimeService = deps.dashboardDeps.chatThreadRuntimeService;');

fs.writeFileSync('src/server/jules-agent-server.ts', content);
