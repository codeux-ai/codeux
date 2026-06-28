const fs = require('fs');
const code = fs.readFileSync('dashboard/src/v2/ChatPage.tsx', 'utf-8');
const lines = code.split('\n');
for (let i = 243; i <= 308; i++) {
  console.log(`${i+1}: ${lines[i]}`);
}
