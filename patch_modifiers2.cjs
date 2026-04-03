const fs = require('fs');

let repoContent = fs.readFileSync('src/repositories/execution-repository.ts', 'utf8');

repoContent = repoContent.replace('private listActiveAttentionRowsForProject(', 'listActiveAttentionRowsForProject(');
repoContent = repoContent.replace('private getUsageTotalsBySprintRunIds(', 'getUsageTotalsBySprintRunIds(');
repoContent = repoContent.replace('private getUsageTotalsByTaskIds(', 'getUsageTotalsByTaskIds(');
repoContent = repoContent.replace('private getWallTimeTotalsBySprintRunIds(', 'getWallTimeTotalsBySprintRunIds(');
repoContent = repoContent.replace('private getWallTimeTotalsByTaskIds(', 'getWallTimeTotalsByTaskIds(');
repoContent = repoContent.replace('private withWallTime(', 'withWallTime(');

const startIdx = repoContent.indexOf('  getProjectExecutionSnapshot(projectId: string): ExecutionDashboardSnapshot {');
const endIdx = repoContent.indexOf('  getProjectStatsSnapshot(', startIdx);

if (startIdx !== -1 && endIdx !== -1) {
  repoContent = repoContent.slice(0, startIdx) +
    `  getProjectExecutionSnapshot(projectId: string): ExecutionDashboardSnapshot {
    return getProjectExecutionSnapshotQuery(this.db, this.storage, this, projectId);
  }\n\n` + repoContent.slice(endIdx);
}

fs.writeFileSync('src/repositories/execution-repository.ts', repoContent);

let queryContent = fs.readFileSync('src/repositories/execution/project-execution-snapshot-query.ts', 'utf8');

queryContent = queryContent.replace('const activeAttentionItems = repository.listActiveAttentionRowsForProject.bind(repository)(projectId);',
  'const activeAttentionItems = repository.listActiveAttentionRowsForProject(projectId);');

queryContent = queryContent.replace('const usageBySprintRunId = repository.getUsageTotalsBySprintRunIds.bind(repository)(projectId, sprintRuns.map((row) => row.id));',
  'const usageBySprintRunId = repository.getUsageTotalsBySprintRunIds(projectId, sprintRuns.map((row) => row.id));');

queryContent = queryContent.replace('const usageByTaskId = repository.getUsageTotalsByTaskIds.bind(repository)(projectId, taskDispatches.map((row) => row.task_id));',
  'const usageByTaskId = repository.getUsageTotalsByTaskIds(projectId, taskDispatches.map((row) => row.task_id));');

queryContent = queryContent.replace('const wallTimeBySprintRunId = repository.getWallTimeTotalsBySprintRunIds.bind(repository)(sprintRuns.map((row) => row.id), nowIso);',
  'const wallTimeBySprintRunId = repository.getWallTimeTotalsBySprintRunIds(sprintRuns.map((row) => row.id), nowIso);');

queryContent = queryContent.replace('const wallTimeByTaskId = repository.getWallTimeTotalsByTaskIds.bind(repository)(taskDispatches.map((row) => row.task_id), nowIso);',
  'const wallTimeByTaskId = repository.getWallTimeTotalsByTaskIds(taskDispatches.map((row) => row.task_id), nowIso);');

queryContent = queryContent.replace('repository.withWallTime.bind(repository)(usageBySprintRunId.get(row.id)',
  'repository.withWallTime(usageBySprintRunId.get(row.id)');

queryContent = queryContent.replace('repository.withWallTime.bind(repository)(usageByTaskId.get(row.task_id)',
  'repository.withWallTime(usageByTaskId.get(row.task_id)');

fs.writeFileSync('src/repositories/execution/project-execution-snapshot-query.ts', queryContent);
