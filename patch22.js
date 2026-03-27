import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

content = content.replace('quicksprintService: deps.quicksprintService,', 'quicksprintService: deps.quicksprintService,\n      chatThreadRuntimeService: deps.chatThreadRuntimeService,');

fs.writeFileSync('src/server/jules-agent-server.ts', content);

let idx = fs.readFileSync('src/index.ts', 'utf8');
idx = idx.replace('quicksprintService: dashboardDeps.quicksprintService,', 'quicksprintService: dashboardDeps.quicksprintService,\n      chatThreadRuntimeService: dashboardDeps.chatThreadRuntimeService,');
fs.writeFileSync('src/index.ts', idx);
