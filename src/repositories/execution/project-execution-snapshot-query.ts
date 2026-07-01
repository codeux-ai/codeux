import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { queryExecutionSprintRuns } from "./execution-sprint-runs-query.js";
import { queryExecutionTaskDispatches } from "./execution-task-dispatches-query.js";
import { queryExecutionInvocations } from "./execution-invocations-query.js";
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
  const recentInvocations = queryExecutionInvocations(db, { projectId, limit: 24 });

  const activeAttentionItems = listActiveAttentionRowsForProject(db, projectId);
  const humanInterventionBySprintRunId = buildHumanInterventionSummaryBySprintRun(
    sprintRuns,
    activeAttentionItems,
    runtimeEvents,
  );

  const uniqueSprintRunIds = Array.from(new Set(sprintRuns.map((row) => row.id)));
  const uniqueTaskIds = Array.from(new Set(taskDispatches.map((row) => row.task_id)));

  const nowIso = new Date().toISOString();

  const usageBySprintRunId = uniqueSprintRunIds.length > 0
    ? deps.getUsageTotalsBySprintRunIds(projectId, uniqueSprintRunIds)
    : new Map<string, ExecutionUsageTotals>();

  const usageByTaskId = uniqueTaskIds.length > 0
    ? deps.getUsageTotalsByTaskIds(projectId, uniqueTaskIds)
    : new Map<string, ExecutionUsageTotals>();

  const wallTimeBySprintRunId = uniqueSprintRunIds.length > 0
    ? deps.getWallTimeTotalsBySprintRunIds(projectId, uniqueSprintRunIds, nowIso)
    : new Map<string, number>();

  const wallTimeByTaskId = uniqueTaskIds.length > 0
    ? deps.getWallTimeTotalsByTaskIds(projectId, uniqueTaskIds, nowIso)
    : new Map<string, number>();

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
    recentInvocations,
    updatedAt: nowIso,
  };
}
