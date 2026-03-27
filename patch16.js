import fs from 'fs';
let content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');

content = content.replace('quicksprintService: this.quicksprintService,', 'quicksprintService: this.quicksprintService,\n        chatThreadRuntimeService: this.chatThreadRuntimeService,');

fs.writeFileSync('src/server/jules-agent-server.ts', content);
