const fs = require('fs');

const pathHeader = 'dashboard/src/v2/components/StatsHeader.tsx';
let hContent = fs.readFileSync(pathHeader, 'utf8');

// DashboardHumanIntervention and PreviewSessionInfo were definitely imported in LiveSessionPage.tsx. Let's see where they come from.
const lp = fs.readFileSync('dashboard/src/v2/LiveSessionPage.tsx', 'utf8');
const lpImports = lp.match(/import type.*?from.*?;/g);
console.log(lpImports);
