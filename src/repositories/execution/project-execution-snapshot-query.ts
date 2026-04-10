import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { queryExecutionSprintRuns } from "./execution-sprint-runs-query.js";
import { queryExecutionTaskDispatches } from "./execution-task-dispatches-query.js";
import { queryExecutionRuntimeEvents } from "./execution-runtime-events-query.js";
import { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForProject } from "./execution-human-intervention-query.js";
import { withWallTime } from "./execution-usage-query.js";

import { ExecutionDashboardSnapshot, ExecutionUsageTotals } from "../../contracts/app-types.js";
import {
  mapProviderInvocationUsageRow,
  mapExecutionSprintRunSummaryRow,
  mapExecutionTaskDispatchSummaryRow,
  mapExecutionRuntimeEventSummaryRow,
} from "./execution-read-model-mappers.js";

export function queryProjectExecutionSnapshot(
  db: Database,
  storage: AppDbStorage,
  projectId: string,
  deps: {
    getWallTimeTotalsByTaskIds: (projectId: string, taskIds: string[], nowIso: string) => Map<string, number>,
    getWallTimeTotalsBySprintRunIds: (projectId: string, sprintRunIds: string[], nowIso: string) => Map<string, number>,
    getUsageTotalsByTaskIds: (projectId: string, taskIds: string[]) => Map<string, ExecutionUsageTotals>,
    getUsageTotalsBySprintRunIds: (projectId: string, sprintRunIds: string[]) => Map<string, ExecutionUsageTotals>
  }
): ExecutionDashboardSnapshot {
  const projectRow = db.prepare(`
    SELECT id, name
    FROM projects
    WHERE id = ?
  `).get(projectId) as { id: string; name: string } | undefined;

  const { sprintRuns, expandedSprintRunIds } = queryExecutionSprintRuns(db, projectId);
  const taskDispatches = queryExecutionTaskDispatches(db, storage, projectId, expandedSprintRunIds);
  const runtimeEvents = queryExecutionRuntimeEvents(db, storage, projectId, expandedSprintRunIds);

  const activeAttentionItems = listActiveAttentionRowsForProject(db, projectId);
  const humanInterventionBySprintRunId = buildHumanInterventionSummaryBySprintRun(
    sprintRuns,
    activeAttentionItems,
    runtimeEvents,
  );

  const usageBySprintRunId = deps.getUsageTotalsBySprintRunIds(projectId, sprintRuns.map((row) => row.id));
  const nowIso = new Date().toISOString();
  const usageByTaskId = deps.getUsageTotalsByTaskIds(projectId, taskDispatches.map((row) => row.task_id));
  const wallTimeBySprintRunId = deps.getWallTimeTotalsBySprintRunIds(projectId, sprintRuns.map((row) => row.id), nowIso);
  const wallTimeByTaskId = deps.getWallTimeTotalsByTaskIds(projectId, taskDispatches.map((row) => row.task_id), nowIso);

  return {
    projectId: projectRow?.id || null,
    projectName: projectRow?.name || null,
    sprintRuns: sprintRuns.map((row) => mapExecutionSprintRunSummaryRow(
      row,
      humanInterventionBySprintRunId.get(row.id) || null,
      withWallTime(usageBySprintRunId.get(row.id), wallTimeBySprintRunId.get(row.id) || 0),
    )),
    taskDispatches: taskDispatches.map((row) => mapExecutionTaskDispatchSummaryRow(
      row,
      withWallTime(usageByTaskId.get(row.task_id), wallTimeByTaskId.get(row.task_id) || 0),
    )),
    connections: [],
    primaryAssignedWorker: null,
    overflowAssignedWorkers: [],
    attentionItems: [],
    recentEvents: runtimeEvents.map((row) => mapExecutionRuntimeEventSummaryRow(row)),
    updatedAt: new Date().toISOString(),
  };
}
