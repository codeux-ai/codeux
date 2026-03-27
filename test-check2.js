import fs from 'fs';
const content = fs.readFileSync('src/server/jules-agent-server.ts', 'utf8');
const lines = content.split('\n');
for (let i = 0; i < lines.length; i++) {
  if (lines[i].includes('chatThreadRuntimeService')) {
    console.log(`${i+1}: ${lines[i]}`);
  }
}
