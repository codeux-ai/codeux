import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { queryExecutionSprintRuns } from "./execution-sprint-runs-query.js";
import { queryExecutionTaskDispatches } from "./execution-task-dispatches-query.js";
import { queryExecutionInvocations } from "./execution-invocations-query.js";
import { queryExecutionRuntimeEvents } from "./execution-runtime-events-query.js";
import { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForProject } from "./execution-human-intervention-query.js";
import { withWallTime } from "./execution-usage-query.js";

import { ExecutionDashboardSnapshot, ExecutionUsageTotals } from "../../contracts/app-types.js";
import { ExecutionInvocationRecord } from "../../contracts/invocation-types.js";
import {
  mapProviderInvocationUsageRow,
  mapExecutionSprintRunSummaryRow,
  mapExecutionTaskDispatchSummaryRow,
  mapExecutionRuntimeEventSummaryRow,
} from "./execution-read-model-mappers.js";

export interface ProjectExecutionSnapshotOptions {
  selectedSprintId?: string | null;
}

function invocationTime(record: ExecutionInvocationRecord): number {
  const primary = Date.parse(record.startedAt || record.createdAt || record.updatedAt || "");
  return Number.isFinite(primary) ? primary : 0;
}

function mergeInvocations(invocationGroups: ExecutionInvocationRecord[][]): ExecutionInvocationRecord[] {
  const merged = new Map<string, ExecutionInvocationRecord>();
  for (const group of invocationGroups) {
    for (const invocation of group) {
      merged.set(invocation.id, invocation);
    }
  }
  return Array.from(merged.values()).sort((left, right) => {
    const timeDelta = invocationTime(right) - invocationTime(left);
    return timeDelta !== 0 ? timeDelta : right.id.localeCompare(left.id);
  });
}

export function queryProjectExecutionSnapshot(
  db: Database,
  storage: AppDbStorage,
  projectId: string,
  deps: {
    getWallTimeTotalsByTaskIds: (projectId: string, taskIds: string[], nowIso: string) => Map<string, number>,
    getWallTimeTotalsBySprintRunIds: (projectId: string, sprintRunIds: string[], nowIso: string) => Map<string, number>,
    getUsageTotalsByTaskIds: (projectId: string, taskIds: string[]) => Map<string, ExecutionUsageTotals>,
    getUsageTotalsBySprintRunIds: (projectId: string, sprintRunIds: string[]) => Map<string, ExecutionUsageTotals>
  },
  options: ProjectExecutionSnapshotOptions = {},
): ExecutionDashboardSnapshot {
  const projectRow = db.prepare(`
    SELECT id, name
    FROM projects
    WHERE id = ?
  `).get(projectId) as { id: string; name: string } | undefined;

  const selectedSprintId = options.selectedSprintId || null;
  const { sprintRuns, expandedSprintRunIds } = queryExecutionSprintRuns(db, projectId, selectedSprintId);
  const taskDispatches = queryExecutionTaskDispatches(db, storage, projectId, expandedSprintRunIds, selectedSprintId);
  const runtimeEvents = queryExecutionRuntimeEvents(db, storage, projectId, expandedSprintRunIds, selectedSprintId);
  const recentInvocations = mergeInvocations([
    queryExecutionInvocations(db, { projectId, limit: 24 }),
    expandedSprintRunIds.length > 0
      ? queryExecutionInvocations(db, { projectId, sprintRunIds: expandedSprintRunIds, limit: null })
      : [],
    selectedSprintId
      ? queryExecutionInvocations(db, { projectId, sprintId: selectedSprintId, limit: null })
      : [],
  ]);

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
