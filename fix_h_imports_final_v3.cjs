const fs = require('fs');

const pathHeader = 'dashboard/src/v2/components/StatsHeader.tsx';
let hContent = fs.readFileSync(pathHeader, 'utf8');

// I will just remove the imports for DashboardHumanIntervention and PreviewSessionInfo entirely from StatsHeader.tsx
// since they are not used as props anymore
hContent = hContent.replace(
    'import type { DashboardStatus, DashboardStats, ExecutionSprintRunSummary, DashboardHumanIntervention, PreviewSessionInfo } from "../../types.js";',
    'import type { DashboardStatus, DashboardStats, ExecutionSprintRunSummary } from "../../types.js";'
);
fs.writeFileSync(pathHeader, hContent, 'utf8');
