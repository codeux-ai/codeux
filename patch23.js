import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

// The file has multiple matches, let's replace carefully by finding the exact string indexes

content = content.replace('quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n}', 'quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n  chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;\n}');

content = content.replace('private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n  private runtimeCleanupService:', 'private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n  private chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;\n  private runtimeCleanupService:');

content = content.replace('this.quicksprintService = deps.quicksprintService;\n    this.runtimeCleanupService =', 'this.quicksprintService = deps.quicksprintService;\n    this.chatThreadRuntimeService = deps.chatThreadRuntimeService;\n    this.runtimeCleanupService =');

content = content.replace('quicksprintService: this.quicksprintService,\n        dashboardRealtimeService:', 'quicksprintService: this.quicksprintService,\n        chatThreadRuntimeService: this.chatThreadRuntimeService,\n        dashboardRealtimeService:');

fs.writeFileSync('src/server/jules-agent-server.ts', content);

let idx = fs.readFileSync('src/index.ts', 'utf8');
idx = idx.replace('quicksprintService: dashboardDeps.quicksprintService,\n      runtimeCleanupService:', 'quicksprintService: dashboardDeps.quicksprintService,\n      chatThreadRuntimeService: dashboardDeps.chatThreadRuntimeService,\n      runtimeCleanupService:');
fs.writeFileSync('src/index.ts', idx);
