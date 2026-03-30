const fs = require('fs');

const pathHeader = 'dashboard/src/v2/components/StatsHeader.tsx';
let hContent = fs.readFileSync(pathHeader, 'utf8');

hContent = hContent.replace(
    'import type { DashboardStatus, ExecutionSprintRunSummary, DashboardHumanIntervention, PreviewSessionInfo } from "../../types.js";',
    'import type { DashboardStatus } from "../../types.js";'
);
hContent = hContent.replace(
    'import type { RuntimeStats } from "../../lib/status.js";',
    'import type { DashboardStats } from "../../lib/status.js";'
);
hContent = hContent.replace(
    'visibleStats: RuntimeStats;',
    'visibleStats: DashboardStats;'
);

fs.writeFileSync(pathHeader, hContent, 'utf8');
