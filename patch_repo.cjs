const fs = require('fs');
let file = fs.readFileSync('src/repositories/execution-repository.ts', 'utf8');

const startIdx = file.indexOf('  getProjectExecutionSnapshot(projectId: string): ExecutionDashboardSnapshot {');
const endIdx = file.indexOf('  getProjectStatsSnapshot(', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  const methodBody = file.slice(startIdx, endIdx);
  fs.writeFileSync('method_body.txt', methodBody);
  console.log("Saved method body to method_body.txt");
} else {
  console.error("Could not find getProjectExecutionSnapshot in execution-repository.ts");
}
