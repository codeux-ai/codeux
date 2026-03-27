import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

// The field is private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;
content = content.replace('private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;', 'private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n  private chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;');

// The assignment is this.quicksprintService = deps.quicksprintService;
content = content.replace('this.quicksprintService = deps.quicksprintService;', 'this.quicksprintService = deps.quicksprintService;\n    this.chatThreadRuntimeService = deps.chatThreadRuntimeService;');

// We also need to add it to the JulesAgentServerOptions interface
content = content.replace('quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;', 'quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;\n  chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;');

fs.writeFileSync('src/server/jules-agent-server.ts', content);

// And we need to make sure index.ts passes it?
