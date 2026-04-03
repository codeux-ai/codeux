const fs = require('fs');

const methodBody = fs.readFileSync('method_body.txt', 'utf8');

// Convert method body into a standalone function
let functionBody = methodBody.replace('  getProjectExecutionSnapshot(projectId: string): ExecutionDashboardSnapshot {',
  `export function getProjectExecutionSnapshotQuery(
  db: DatabaseAdapter,
  storage: AppDbStorage,
  repository: ExecutionRepository,
  projectId: string,
): ExecutionDashboardSnapshot {`);

functionBody = functionBody.replace(/this\.db/g, 'db');
functionBody = functionBody.replace(/this\.storage/g, 'storage');
functionBody = functionBody.replace(/this\.compareExecutionTaskDispatchSummaryRows/g, 'compareExecutionTaskDispatchSummaryRows');
functionBody = functionBody.replace(/this\.compareExecutionRuntimeEventSummaryRows/g, 'compareExecutionRuntimeEventSummaryRows');

// Fix the usages of repository methods inside the function
functionBody = functionBody.replace(/this\.listActiveAttentionRowsForProject/g, 'repository.listActiveAttentionRowsForProject.bind(repository)');
functionBody = functionBody.replace(/this\.getUsageTotalsBySprintRunIds/g, 'repository.getUsageTotalsBySprintRunIds.bind(repository)');
functionBody = functionBody.replace(/this\.getUsageTotalsByTaskIds/g, 'repository.getUsageTotalsByTaskIds.bind(repository)');
functionBody = functionBody.replace(/this\.getWallTimeTotalsBySprintRunIds/g, 'repository.getWallTimeTotalsBySprintRunIds.bind(repository)');
functionBody = functionBody.replace(/this\.getWallTimeTotalsByTaskIds/g, 'repository.getWallTimeTotalsByTaskIds.bind(repository)');
functionBody = functionBody.replace(/this\.withWallTime/g, 'repository.withWallTime.bind(repository)');

const template = `import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { AppDbStorage } from "../app-db-storage.js";
import type {
  ExecutionDashboardSnapshot,
  ExecutionUsageTotals,
} from "../../contracts/app-types.js";
import {
  mapExecutionSprintRunSummaryRow,
  mapExecutionTaskDispatchSummaryRow,
  mapExecutionRuntimeEventSummaryRow,
  toNumber,
  type ExecutionSprintRunSummaryRow,
  type ExecutionTaskDispatchSummaryRow,
  type ExecutionRuntimeEventSummaryRow,
} from "./execution-row-mappers.js";
import {
  buildHumanInterventionSummaryBySprintRun,
} from "./human-intervention-summary.js";
import { requireProject } from "./execution-scope-guards.js";
import type { ExecutionRepository, ProjectAttentionSummaryRow } from "../execution-repository.js";

function compareExecutionTaskDispatchSummaryRows(
  left: ExecutionTaskDispatchSummaryRow,
  right: ExecutionTaskDispatchSummaryRow,
): number {
  const leftRecency = left.last_heartbeat_at || left.started_at || left.claimed_at || left.queued_at;
  const rightRecency = right.last_heartbeat_at || right.started_at || right.claimed_at || right.queued_at;

  return executionTaskDispatchStatusRank(left.status) - executionTaskDispatchStatusRank(right.status)
    || toNumber(right.priority) - toNumber(left.priority)
    || rightRecency.localeCompare(leftRecency)
    || right.id.localeCompare(left.id);
}

function executionTaskDispatchStatusRank(status: string): number {
  switch (status) {
    case "running":
      return 0;
    case "cancel_requested":
      return 1;
    case "claimed":
      return 2;
    case "queued":
      return 3;
    case "blocked":
      return 4;
    case "failed":
      return 5;
    case "completed":
      return 6;
    default:
      return 7;
  }
}

function compareExecutionRuntimeEventSummaryRows(
  left: ExecutionRuntimeEventSummaryRow,
  right: ExecutionRuntimeEventSummaryRow,
): number {
  return right.created_at.localeCompare(left.created_at) || right.id.localeCompare(left.id);
}

${functionBody}
`;

fs.writeFileSync('src/repositories/execution/project-execution-snapshot-query.ts', template);
