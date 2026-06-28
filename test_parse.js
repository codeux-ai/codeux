const fs = require('fs');
const content = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf-8');
const lines = content.split('\n');
console.log(lines.slice(540, 560).join('\n'));
