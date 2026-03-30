const fs = require('fs');

const pathHeader = 'dashboard/src/v2/components/StatsHeader.tsx';
let hContent = fs.readFileSync(pathHeader, 'utf8');

// DashboardStats is imported from types.js, not status.js
hContent = hContent.replace(
    'import type { DashboardStats } from "../../lib/status.js";',
    '' // I'll just remove it and add it to the first import
);
hContent = hContent.replace(
    'import type { DashboardStatus } from "../../types.js";',
    'import type { DashboardStatus, DashboardStats, ExecutionSprintRunSummary, DashboardHumanIntervention, PreviewSessionInfo } from "../../types.js";'
);
fs.writeFileSync(pathHeader, hContent, 'utf8');
