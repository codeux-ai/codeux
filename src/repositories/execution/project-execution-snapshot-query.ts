import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { queryExecutionSprintRuns } from "./execution-sprint-runs-query.js";
import { queryExecutionTaskDispatches } from "./execution-task-dispatches-query.js";
import { queryExecutionRuntimeEvents } from "./execution-runtime-events-query.js";
import { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForProject } from "./execution-human-intervention-query.js";
import { getUsageTotalsBySprintRunIds, getUsageTotalsByTaskIds, withWallTime } from "./execution-usage-query.js";
import { getWallTimeTotalsBySprintRunIds, getWallTimeTotalsByTaskIds } from "./execution-wall-time-query.js";
import { ExecutionDashboardSnapshot } from "../../contracts/app-types.js";
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

  const usageBySprintRunId = getUsageTotalsBySprintRunIds(storage, projectId, sprintRuns.map((row) => row.id), mapProviderInvocationUsageRow);
  const nowIso = new Date().toISOString();
  const usageByTaskId = getUsageTotalsByTaskIds(storage, projectId, taskDispatches.map((row) => row.task_id), mapProviderInvocationUsageRow);
  const wallTimeBySprintRunId = getWallTimeTotalsBySprintRunIds(storage, sprintRuns.map((row) => row.id), nowIso);
  const wallTimeByTaskId = getWallTimeTotalsByTaskIds(storage, taskDispatches.map((row) => row.task_id), nowIso);

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
