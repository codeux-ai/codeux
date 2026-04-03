const fs = require('fs');

let repoContent = fs.readFileSync('src/repositories/execution-repository.ts', 'utf8');

const importStatement = `import {
  getProjectExecutionSnapshotQuery,
} from "./execution/project-execution-snapshot-query.js";\n`;

// insert near the top after imports
repoContent = repoContent.replace(
  'import { AppDbStorage } from "./app-db-storage.js";',
  'import { AppDbStorage } from "./app-db-storage.js";\n' + importStatement
);
fs.writeFileSync('src/repositories/execution-repository.ts', repoContent);

let queryContent = fs.readFileSync('src/repositories/execution/project-execution-snapshot-query.ts', 'utf8');
queryContent = queryContent.replace(
  'const activeAttentionItems = repository.listActiveAttentionRowsForProject(projectId);',
  'const activeAttentionItems = repository.listActiveAttentionRowsForProject(projectId);'
);
queryContent = queryContent.replace(
  /this\.isOperatorInterventionAttentionRow/g,
  'isOperatorInterventionAttentionRow'
);
queryContent = queryContent.replace(
  /this\.buildHumanInterventionSummaryFromEvents/g,
  'buildHumanInterventionSummaryFromEvents'
);
queryContent = queryContent.replace(
  /this\.buildHumanInterventionSummaryFromAttentionRows/g,
  'buildHumanInterventionSummaryFromAttentionRows'
);

fs.writeFileSync('src/repositories/execution/project-execution-snapshot-query.ts', queryContent);
