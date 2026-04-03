const fs = require('fs');

let repoContent = fs.readFileSync('src/repositories/execution-repository.ts', 'utf8');

const importStatement = `import {
  getProjectExecutionSnapshotQuery,
} from "./execution/project-execution-snapshot-query.js";\n`;

// insert near the top after imports
if (!repoContent.includes('getProjectExecutionSnapshotQuery')) {
  repoContent = repoContent.replace(
    'import { AppDbStorage } from "./app-db-storage.js";',
    'import { AppDbStorage } from "./app-db-storage.js";\n' + importStatement
  );
  fs.writeFileSync('src/repositories/execution-repository.ts', repoContent);
}
