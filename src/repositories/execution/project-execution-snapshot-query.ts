import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { queryExecutionSprintRuns } from "./execution-sprint-runs-query.js";
import { queryExecutionTaskDispatches } from "./execution-task-dispatches-query.js";
import { queryExecutionRuntimeEvents } from "./execution-runtime-events-query.js";
import { buildHumanInterventionSummaryBySprintRun, listActiveAttentionRowsForProject } from "./execution-human-intervention-query.js";
import { getUsageTotalsBySprintRunIds, getUsageTotalsByTaskIds, withWallTime } from "./execution-usage-query.js";
import { getWallTimeTotalsBySprintRunIds, getWallTimeTotalsByTaskIds } from "./execution-wall-time-query.js";
import {
  ExecutionDashboardSnapshot,
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  ExecutionRuntimeEventSummary,
  ExecutionHumanInterventionSummary,
  ExecutionUsageTotals,
} from "../../contracts/app-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { toNumber, parsePayloadJson } from "./execution-utils.js";
import { ExecutionSprintRunSummaryRow, ExecutionTaskDispatchSummaryRow, ExecutionRuntimeEventSummaryRow } from "./execution-repository-types.js";
import { ProviderInvocationUsageRow } from "./execution-repository-types.js";

export function mapProviderInvocationUsageRow(row: ProviderInvocationUsageRow): ProviderInvocationUsageRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sessionId: row.session_id,
    sprintId: row.sprint_id,
    sprintRunId: row.sprint_run_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    taskRunId: row.task_run_id,
    attentionItemId: row.attention_item_id,
    connectionId: row.connection_id || null,
    provider: row.provider,
    purpose: row.purpose as any,
    status: row.status as any,
    model: row.model,
    nativeSessionId: row.native_session_id,
    usageSource: row.usage_source as any,
    promptChars: toNumber(row.prompt_chars),
    transcriptChars: toNumber(row.transcript_chars),
    inputTokens: toNumber(row.input_tokens),
    cachedInputTokens: toNumber(row.cached_input_tokens),
    outputTokens: toNumber(row.output_tokens),
    reasoningOutputTokens: toNumber(row.reasoning_output_tokens),
    totalTokens: toNumber(row.total_tokens),
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    durationMs: row.duration_ms !== null ? toNumber(row.duration_ms) : null,
    costCents: row.cost_cents !== null && row.cost_cents !== undefined ? toNumber(row.cost_cents) : null,
    createdAt: row.created_at,
    updatedAt: (row as any).updated_at || row.created_at,
    rawUsageJson: (row as any).raw_usage_json ? parsePayloadJson((row as any).raw_usage_json) : null,
  };
}

export function mapExecutionSprintRunSummaryRow(
  row: ExecutionSprintRunSummaryRow,
  humanIntervention: ExecutionHumanInterventionSummary | null,
  usage: ExecutionUsageTotals,
): ExecutionSprintRunSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    sprintId: row.sprint_id,
    sprintName: row.sprint_name,
    sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
    status: row.status as ExecutionSprintRunSummary["status"],
    triggerType: row.trigger_type as ExecutionSprintRunSummary["triggerType"],
    triggeredBy: row.triggered_by,
    executorMode: row.executor_mode as ExecutionSprintRunSummary["executorMode"],
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    createdAt: row.created_at,
    activeLeaseOwnerKey: row.active_lease_owner_key,
    activeLeaseExpiresAt: row.active_lease_expires_at,
    humanIntervention,
    usage,
  };
}

export function mapExecutionTaskDispatchSummaryRow(
  row: ExecutionTaskDispatchSummaryRow,
  usage: ExecutionUsageTotals,
): ExecutionTaskDispatchSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    sprintId: row.sprint_id,
    sprintRunId: row.sprint_run_id,
    sprintName: row.sprint_name,
    sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
    taskId: row.task_id,
    taskKey: row.task_key,
    taskTitle: row.task_title,
    status: row.status as ExecutionTaskDispatchSummary["status"],
    executorType: row.executor_type as ExecutionTaskDispatchSummary["executorType"],
    priority: toNumber(row.priority),
    connectionId: row.connection_id,
    connectionDisplayName: row.connection_display_name,
    connectionRole: row.connection_role,
    taskRunId: row.task_run_id,
    taskRunState: row.task_run_state,
    provider: row.provider,
    sessionId: row.session_id,
    sessionName: row.session_name,
    workerBranch: row.worker_branch,
    prUrl: row.pr_url,
    queuedAt: row.queued_at,
    claimedAt: row.claimed_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastHeartbeatAt: row.last_heartbeat_at,
    errorMessage: row.error_message,
    activeLeaseOwnerKey: row.active_lease_owner_key,
    activeLeaseExpiresAt: row.active_lease_expires_at,
    usage,
  };
}

export function mapExecutionRuntimeEventSummaryRow(row: ExecutionRuntimeEventSummaryRow): ExecutionRuntimeEventSummary {
  return {
    id: row.id,
    scopeType: row.scope_type === "sprint_run" ? "sprint_run" : "task_run",
    taskRunId: row.task_run_id,
    sprintRunId: row.sprint_run_id,
    dispatchId: row.dispatch_id,
    projectId: row.project_id,
    sprintId: row.sprint_id,
    sprintName: row.sprint_name,
    sprintNumber: row.sprint_number === null ? null : toNumber(row.sprint_number),
    sprintRunStatus: row.sprint_run_status,
    taskId: row.task_id,
    taskKey: row.task_key,
    taskTitle: row.task_title,
    taskRunState: row.task_run_state,
    eventType: row.event_type as ExecutionRuntimeEventSummary["eventType"],
    originator: row.originator as ExecutionRuntimeEventSummary["originator"],
    sourceEventKey: row.source_event_key,
    provider: row.provider,
    sessionId: row.session_id,
    sessionName: row.session_name,
    workerBranch: row.worker_branch,
    prUrl: row.pr_url,
    connectionId: row.connection_id,
    connectionDisplayName: row.connection_display_name,
    connectionRole: row.connection_role,
    createdAt: row.created_at,
    payload: parsePayloadJson(row.payload_json),
  };
}

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
