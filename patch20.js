import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

content = content.replace('quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;', 'quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n  chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;');

content = content.replace('private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;', 'private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n  private chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;');

content = content.replace('this.quicksprintService = deps.quicksprintService;', 'this.quicksprintService = deps.quicksprintService;\n    this.chatThreadRuntimeService = deps.chatThreadRuntimeService;');

content = content.replace('quicksprintService: this.quicksprintService,', 'quicksprintService: this.quicksprintService,\n        chatThreadRuntimeService: this.chatThreadRuntimeService,');

fs.writeFileSync('src/server/jules-agent-server.ts', content);

let mainContent = fs.readFileSync('src/index.ts', 'utf8');
mainContent = mainContent.replace('quicksprintService: dashboardDeps.quicksprintService,', 'quicksprintService: dashboardDeps.quicksprintService,\n      chatThreadRuntimeService: dashboardDeps.chatThreadRuntimeService,');
fs.writeFileSync('src/index.ts', mainContent);
