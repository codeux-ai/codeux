const fs = require('fs');
let queryContent = fs.readFileSync('src/repositories/execution/project-execution-snapshot-query.ts', 'utf8');

queryContent = queryContent.replace(
  'const humanInterventionBySprintRunId = this.buildHumanInterventionSummaryBySprintRun(',
  'const humanInterventionBySprintRunId = buildHumanInterventionSummaryBySprintRun('
);

fs.writeFileSync('src/repositories/execution/project-execution-snapshot-query.ts', queryContent);
