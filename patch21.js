import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

// The file has multiple matches, let's replace carefully

let newContent = "";
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  newContent += lines[i] + '\n';
  if (lines[i].includes('quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;') && lines[i].trim().startsWith('quicksprintService:')) {
    newContent += '  chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;\n';
  } else if (lines[i].includes('private quicksprintService: import("../services/quicksprint-service.js").QuicksprintService;') && lines[i].trim().startsWith('private quicksprintService:')) {
    newContent += '  private chatThreadRuntimeService: import("../services/chat-thread-runtime-service.js").ChatThreadRuntimeService;\n';
  } else if (lines[i].includes('this.quicksprintService = deps.quicksprintService;') && lines[i].trim().startsWith('this.quicksprintService')) {
    newContent += '    this.chatThreadRuntimeService = deps.chatThreadRuntimeService;\n';
  } else if (lines[i].includes('quicksprintService: this.quicksprintService,') && lines[i].trim().startsWith('quicksprintService:')) {
    newContent += '        chatThreadRuntimeService: this.chatThreadRuntimeService,\n';
  }
}

fs.writeFileSync('src/server/jules-agent-server.ts', newContent);

let mainContent = fs.readFileSync('src/index.ts', 'utf8');
const mainLines = mainContent.split('\n');
let newMain = "";
for (let i = 0; i < mainLines.length; i++) {
  newMain += mainLines[i] + '\n';
  if (mainLines[i].includes('quicksprintService: dashboardDeps.quicksprintService,') && mainLines[i].trim().startsWith('quicksprintService:')) {
    newMain += '      chatThreadRuntimeService: dashboardDeps.chatThreadRuntimeService,\n';
  }
}
fs.writeFileSync('src/index.ts', newMain);
