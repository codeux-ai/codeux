const fs = require('fs');
const data = JSON.parse(fs.readFileSync('coverage/coverage-final.json', 'utf8'));

for (const [file, info] of Object.entries(data)) {
    if (file.includes('use-focus-trap.ts') || file.includes('BrowserSessionsMenu.tsx')) {
        let uncoveredLines = [];
        for (const [statementId, count] of Object.entries(info.s)) {
            if (count === 0) {
                uncoveredLines.push(info.statementMap[statementId].start.line);
            }
        }
        console.log(`\nUncovered lines in ${file}:`);
        console.log(uncoveredLines.sort((a,b) => a-b).join(', '));
    }
}
