const fs = require('fs');

const pathHeader = 'dashboard/src/v2/components/StatsHeader.tsx';
let hContent = fs.readFileSync(pathHeader, 'utf8');

// Ah, wait. I got those types from LiveSessionHeaderProps when it was inside dashboard/src/v2/components/live-session/LiveSessionHeader.tsx
// Let's see what LiveSessionPage uses.
const lp = fs.readFileSync('dashboard/src/v2/LiveSessionPage.tsx', 'utf8');
const lpImports = lp.match(/import type.*?from/g);
console.log(lpImports);
