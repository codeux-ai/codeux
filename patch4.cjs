const fs = require('fs');
let code = fs.readFileSync('src/app/live/project-live-snapshot.ts', 'utf8');

// The replacement escaped the backticks in the jsdoc somehow.
code = code.replace(/\\\`projectId\\\`/g, '\`projectId\`')
  .replace(/\\\`ProjectManagementRepository\\\`/g, '\`ProjectManagementRepository\`')
  .replace(/\\\`selectedSprintId\\\`/g, '\`selectedSprintId\`')
  .replace(/\\\`status\\\`/g, '\`status\`')
  .replace(/\\\`ProjectRuntimeRepository\\\`/g, '\`ProjectRuntimeRepository\`')
  .replace(/\\\`execution\\\`/g, '\`execution\`')
  .replace(/\\\`ExecutionRepository\\\`/g, '\`ExecutionRepository\`')
  .replace(/\\\`getProjectExecutionSnapshot\\\`/g, '\`getProjectExecutionSnapshot\`')
  .replace(/\\\`gitStatus\\\`/g, '\`gitStatus\`')
  .replace(/\\\`gitStatusError\\\`/g, '\`gitStatusError\`')
  .replace(/\\\`updatedAt\\\`/g, '\`updatedAt\`');

fs.writeFileSync('src/app/live/project-live-snapshot.ts', code);
