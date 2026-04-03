const fs = require('fs');
let code = fs.readFileSync('src/app/live/project-live-snapshot.ts', 'utf8');

code = code.replace(
  /  const executionItemCount =\n    execution.sprintRuns.length \+\n    execution.taskDispatches.length \+\n    execution.connections.length \+\n    execution.attentionItems.length \+\n    execution.recentEvents.length;\n  const statusSubtaskCount = status.subtasks.length;/g,
  `  const executionItemCount =
    (execution.sprintRuns?.length || 0) +
    (execution.taskDispatches?.length || 0) +
    (execution.connections?.length || 0) +
    (execution.attentionItems?.length || 0) +
    (execution.recentEvents?.length || 0);
  const statusSubtaskCount = status.subtasks?.length || 0;`
);

fs.writeFileSync('src/app/live/project-live-snapshot.ts', code);
