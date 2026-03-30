const fs = require('fs');

const file = 'dashboard/src/v2/pages/stats/components/StatsShared.tsx';
let content = fs.readFileSync(file, 'utf-8');

// I exported InteractiveUsageChart for external use, BUT it's used natively inside `StatsShared.tsx` in `TrendStudio`!
// Which means I need to IMPORT it as well.
content = content.replace('export { InteractiveUsageChart } from "./InteractiveUsageChart.js";',
'import { InteractiveUsageChart } from "./InteractiveUsageChart.js";\nexport { InteractiveUsageChart };');

fs.writeFileSync(file, content);
console.log("Imported and Exported InteractiveUsageChart");
