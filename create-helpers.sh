cat << 'INNER_EOF' > src/repositories/execution/execution-utils.ts
export function toNumber(value: string | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }
  return typeof value === "number" ? value : Number(value);
}

export function parsePayloadJson(value: string | null): Record<string, unknown> | null {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(value);
    return typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

export function stripMarkdown(value: string): string {
  return value.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").replace(/[`*~_]/g, "");
}
INNER_EOF

cat << 'INNER_EOF' > src/repositories/execution/execution-usage-query.ts
import { AppDbStorage } from "../app-db-storage.js";
import { ExecutionUsageTotals } from "../../contracts/app-types.js";
import { ProviderInvocationUsageRow } from "./execution-repository-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { createEmptyUsageTotals } from "./stats-buckets.js";

export function mergeUsageTotals(target: ExecutionUsageTotals, invocation: ProviderInvocationUsageRecord): void {
  target.invocationCount += 1;
  target.activeTimeMs += invocation.durationMs || 0;
  target.inputTokens += invocation.inputTokens;
  target.cachedInputTokens += invocation.cachedInputTokens;
  target.outputTokens += invocation.outputTokens;
  target.reasoningOutputTokens += invocation.reasoningOutputTokens;
  target.totalTokens += invocation.totalTokens;
  switch (invocation.usageSource) {
    case "reported":
      target.reportedInvocationCount += 1;
      break;
    case "estimated":
      target.estimatedInvocationCount += 1;
      break;
    case "unsupported":
      target.unsupportedInvocationCount += 1;
      break;
    default:
      target.unavailableInvocationCount += 1;
      break;
  }
}

export function withWallTime(usage: ExecutionUsageTotals | undefined, wallTimeMs: number): ExecutionUsageTotals {
  if (!usage) {
    return {
      ...createEmptyUsageTotals(),
      wallTimeMs,
    };
  }
  return {
    ...usage,
    wallTimeMs,
  };
}

export function groupUsageBy(
  rows: ProviderInvocationUsageRecord[],
  keySelector: (row: ProviderInvocationUsageRecord) => string | null,
): Map<string, ExecutionUsageTotals> {
  const map = new Map<string, ExecutionUsageTotals>();
  for (const row of rows) {
    const key = keySelector(row);
    if (!key) {
      continue;
    }
    const current = map.get(key) || createEmptyUsageTotals();
    mergeUsageTotals(current, row);
    map.set(key, current);
  }
  return map;
}

export function getUsageTotalsByTaskIds(
  storage: AppDbStorage,
  projectId: string,
  taskIds: string[],
  mapProviderInvocationUsageRow: (row: ProviderInvocationUsageRow) => ProviderInvocationUsageRecord,
): Map<string, ExecutionUsageTotals> {
  if (taskIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<ProviderInvocationUsageRow>({
    sqlPrefix: "SELECT * FROM provider_invocations WHERE project_id = ? AND task_id",
    items: taskIds,
    bindParamsBefore: [projectId],
  });
  return groupUsageBy(rows.map((row) => mapProviderInvocationUsageRow(row)), (row) => row.taskId);
}

export function getUsageTotalsBySprintRunIds(
  storage: AppDbStorage,
  projectId: string,
  sprintRunIds: string[],
  mapProviderInvocationUsageRow: (row: ProviderInvocationUsageRow) => ProviderInvocationUsageRecord,
): Map<string, ExecutionUsageTotals> {
  if (sprintRunIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<ProviderInvocationUsageRow>({
    sqlPrefix: "SELECT * FROM provider_invocations WHERE project_id = ? AND sprint_run_id",
    items: sprintRunIds,
    bindParamsBefore: [projectId],
  });
  return groupUsageBy(rows.map((row) => mapProviderInvocationUsageRow(row)), (row) => row.sprintRunId);
}
INNER_EOF

cat << 'INNER_EOF' > src/repositories/execution/execution-wall-time-query.ts
import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { toNumber } from "./execution-utils.js";

export function getWallTimeTotalsByTaskIds(storage: AppDbStorage, taskIds: string[], nowIso: string): Map<string, number> {
  if (taskIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<{ task_id: string; total_duration_ms: number | string }>({
    sqlPrefix: `
    SELECT
      task_id,
      SUM(
        CASE
          WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
          WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
          ELSE 0
        END
      ) AS total_duration_ms
    FROM task_runs
    WHERE task_id`,
    sqlSuffix: "GROUP BY task_id",
    items: taskIds,
    bindParamsBefore: [nowIso],
  });
  return new Map(rows.map((row) => [row.task_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
}

export function getWallTimeTotalsBySprintRunIds(storage: AppDbStorage, sprintRunIds: string[], nowIso: string): Map<string, number> {
  if (sprintRunIds.length === 0) {
    return new Map();
  }
  const rows = storage.executeChunkedInQuery<{ sprint_run_id: string; total_duration_ms: number | string }>({
    sqlPrefix: `
    SELECT
      sprint_run_id,
      SUM(
        CASE
          WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
          WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
          ELSE 0
        END
      ) AS total_duration_ms
    FROM task_runs
    WHERE sprint_run_id`,
    sqlSuffix: "GROUP BY sprint_run_id",
    items: sprintRunIds,
    bindParamsBefore: [nowIso],
  });
  return new Map(rows.map((row) => [row.sprint_run_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
}

export function getWallTimeTotalsByTaskIdsForRange(db: Database, projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT
      task_id,
      SUM(
        CASE
          WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
          WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
          ELSE 0
        END
      ) AS total_duration_ms
    FROM task_runs
    WHERE project_id = ?
      AND task_id IS NOT NULL
      AND COALESCE(finished_at, started_at) >= ?
      AND COALESCE(finished_at, started_at) < ?
    GROUP BY task_id
  `).all(nowIso, projectId, rangeStartIso, rangeEndIso) as unknown as Array<{ task_id: string; total_duration_ms: number | string }>;

  return new Map(rows.map((row) => [row.task_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
}

export function getWallTimeTotalsBySprintRunIdsForRange(db: Database, projectId: string, rangeStartIso: string, rangeEndIso: string, nowIso: string): Map<string, number> {
  const rows = db.prepare(`
    SELECT
      sprint_run_id,
      SUM(
        CASE
          WHEN duration_ms IS NOT NULL AND duration_ms > 0 THEN duration_ms
          WHEN started_at IS NOT NULL AND finished_at IS NULL THEN CAST((julianday(?) - julianday(started_at)) * 86400000 AS INTEGER)
          ELSE 0
        END
      ) AS total_duration_ms
    FROM task_runs
    WHERE project_id = ?
      AND sprint_run_id IS NOT NULL
      AND COALESCE(finished_at, started_at) >= ?
      AND COALESCE(finished_at, started_at) < ?
    GROUP BY sprint_run_id
  `).all(nowIso, projectId, rangeStartIso, rangeEndIso) as unknown as Array<{ sprint_run_id: string; total_duration_ms: number | string }>;

  return new Map(rows.map((row) => [row.sprint_run_id, Math.max(0, toNumber(row.total_duration_ms))] as const));
}
INNER_EOF

cat << 'INNER_EOF' > src/repositories/execution/execution-human-intervention-query.ts
import { DatabaseAdapter as Database } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import { asNonEmptyString, parsePayloadJson, stripMarkdown } from "./execution-utils.js";
import { ExecutionHumanInterventionSummary, ExecutionRuntimeEventSummary } from "../../contracts/app-types.js";
import { ProjectAttentionSummaryRow } from "./execution-repository-types.js";
import { ExecutionRuntimeEventSummaryRow } from "./execution-repository-types.js";

export function isOperatorInterventionAttentionRow(row: ProjectAttentionSummaryRow): boolean {
  return [
    "merge_required",
    "merge_conflict",
    "cli_intervention_required",
    "cli_error",
  ].includes(row.attention_type);
}

function getAttentionTypePriority(type: string): number {
  switch (type) {
    case "merge_conflict":
      return 1;
    case "merge_required":
      return 2;
    case "cli_intervention_required":
      return 3;
    case "cli_error":
      return 4;
    default:
      return 99;
  }
}

function compareAttentionPriority(left: ProjectAttentionSummaryRow, right: ProjectAttentionSummaryRow): number {
  const leftPriority = getAttentionTypePriority(left.attention_type);
  const rightPriority = getAttentionTypePriority(right.attention_type);
  if (leftPriority !== rightPriority) {
    return leftPriority - rightPriority;
  }
  return new Date(left.updated_at).getTime() - new Date(right.updated_at).getTime();
}

function createHumanInterventionSummary(
  row: ProjectAttentionSummaryRow | null,
  title: string,
  reason: string,
  instructions: string,
): ExecutionHumanInterventionSummary {
  return {
    title,
    reason,
    instructions,
    attentionType: row?.attention_type || null,
    severity: row?.severity || null,
    ownerType: row?.owner_type || null,
  };
}

function buildHumanInterventionSummaryFromAttentionRows(
  attentionRows: ProjectAttentionSummaryRow[],
): ExecutionHumanInterventionSummary | null {
  const bestRow = [...attentionRows].sort(compareAttentionPriority)[0];
  if (!bestRow) {
    return null;
  }

  const payload = parsePayloadJson(bestRow.payload_json);
  const title = bestRow.title.trim() || "Human intervention required";
  const reason = stripMarkdown(bestRow.summary_markdown || title) || title;

  switch (bestRow.attention_type) {
    case "merge_required": {
      const featureBranch = asNonEmptyString(payload?.featureBranch);
      const workerBranch = asNonEmptyString(payload?.workerBranch);
      const prUrl = asNonEmptyString(payload?.prUrl);
      const taskKey = asNonEmptyString(payload?.taskKey);
      const instructions = prUrl
        ? `Review and merge the completed task PR (${prUrl})${featureBranch ? \` into \${featureBranch}\` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`
        : `Merge${taskKey ? \` \${taskKey}\` : " the completed task"}${workerBranch ? \` from \${workerBranch}\` : ""}${featureBranch ? \` into \${featureBranch}\` : ""}, then resume the sprint. You can enable feature PR automerge later to avoid manual merges.`;
      return createHumanInterventionSummary(bestRow, title, reason, instructions);
    }
    case "merge_conflict": {
      const featureBranch = asNonEmptyString(payload?.featureBranch);
      const workerBranch = asNonEmptyString(payload?.workerBranch);
      const prUrl = asNonEmptyString(payload?.prUrl);
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        prUrl
          ? `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the PR is clean. (${prUrl})`
          : `Ask the connected worker to resolve the merge conflict on ${workerBranch || "the task branch"} against ${featureBranch || "the sprint feature branch"}, then resume the sprint after the branches merge cleanly.`,
      );
    }
    case "cli_intervention_required":
    case "cli_error": {
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "An unexpected error or intervention state occurred. Click below or inspect Jules outputs to resume work.",
      );
    }
    default:
      return createHumanInterventionSummary(
        bestRow,
        title,
        reason,
        "Human intervention or review is required.",
      );
  }
}

function buildHumanInterventionSummaryFromEvents(
  sprintRunStatus: string,
  events: ExecutionRuntimeEventSummaryRow[],
): ExecutionHumanInterventionSummary | null {
  if (sprintRunStatus !== "error" && sprintRunStatus !== "paused") {
    return null;
  }

  const errorEvents = [...events].filter((e) => e.event_type === "dispatch_error" || e.event_type === "sprint_run_error");
  errorEvents.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  for (const errorEvent of errorEvents) {
    const payload = parsePayloadJson(errorEvent.payload_json);
    if (!payload?.error) {
      continue;
    }
    const reason = typeof payload.error === "string" ? payload.error : (payload.error as any).message || "An unknown execution error occurred";
    const shortReason = reason.length > 500 ? reason.substring(0, 500) + "..." : reason;

    if (errorEvent.event_type === "dispatch_error") {
      const title = errorEvent.task_title ? `Task Error: ${errorEvent.task_title}` : "Task Dispatch Error";
      return createHumanInterventionSummary(
        null,
        title,
        shortReason,
        "A task dispatch failed. Review the task logs, perform any necessary cleanup, and resume the sprint.",
      );
    }

    if (errorEvent.event_type === "sprint_run_error") {
      return createHumanInterventionSummary(
        null,
        "Sprint Execution Error",
        shortReason,
        "A critical execution error occurred during the sprint. Review the sprint logs, perform any necessary cleanup, and resume the sprint.",
      );
    }
  }

  return null;
}

export function buildHumanInterventionSummaryBySprintRun(
  sprintRuns: Array<{ id: string; sprint_id: string; status: string }>,
  attentionRows: ProjectAttentionSummaryRow[],
  recentEvents: ExecutionRuntimeEventSummaryRow[],
): Map<string, ExecutionHumanInterventionSummary> {
  const bySprintRunId = new Map<string, ExecutionHumanInterventionSummary>();
  const attentionBySprintRunId = new Map<string, ProjectAttentionSummaryRow[]>();
  const eventsBySprintRunId = new Map<string, ExecutionRuntimeEventSummaryRow[]>();

  for (const row of attentionRows) {
    const sprintRunId = asNonEmptyString(row.sprint_run_id);
    if (!sprintRunId || !isOperatorInterventionAttentionRow(row)) {
      continue;
    }
    const existing = attentionBySprintRunId.get(sprintRunId) || [];
    existing.push(row);
    attentionBySprintRunId.set(sprintRunId, existing);
  }

  for (const event of recentEvents) {
    const sprintRunId = asNonEmptyString(event.sprint_run_id);
    if (!sprintRunId) {
      continue;
    }
    const existing = eventsBySprintRunId.get(sprintRunId) || [];
    existing.push(event);
    eventsBySprintRunId.set(sprintRunId, existing);
  }

  for (const sprintRun of sprintRuns) {
    const attentionSummary = buildHumanInterventionSummaryFromAttentionRows(
      attentionBySprintRunId.get(sprintRun.id) || [],
    );
    if (attentionSummary) {
      bySprintRunId.set(sprintRun.id, attentionSummary);
      continue;
    }
    const eventSummary = buildHumanInterventionSummaryFromEvents(
      sprintRun.status,
      eventsBySprintRunId.get(sprintRun.id) || [],
    );
    if (eventSummary) {
      bySprintRunId.set(sprintRun.id, eventSummary);
    }
  }

  return bySprintRunId;
}

export function listActiveAttentionRowsForProject(db: Database, projectId: string): ProjectAttentionSummaryRow[] {
  return db.prepare(`
    SELECT
      id,
      project_id,
      sprint_id,
      sprint_run_id,
      attention_type,
      severity,
      owner_type,
      status,
      title,
      summary_markdown,
      payload_json,
      updated_at
    FROM project_attention_items
    WHERE project_id = ?
      AND status IN ('open', 'claimed')
    ORDER BY updated_at DESC, opened_at DESC, id DESC
  `).all(projectId) as unknown as ProjectAttentionSummaryRow[];
}

export function listActiveAttentionRowsForSprintRuns(storage: AppDbStorage, sprintRunIds: string[]): ProjectAttentionSummaryRow[] {
  if (sprintRunIds.length === 0) {
    return [];
  }

  return storage.executeChunkedInQuery<ProjectAttentionSummaryRow>({
    sqlPrefix: `SELECT
      id,
      project_id,
      sprint_id,
      sprint_run_id,
      attention_type,
      severity,
      owner_type,
      status,
      title,
      summary_markdown,
      payload_json,
      updated_at
    FROM project_attention_items
    WHERE sprint_run_id`,
    sqlSuffix: "AND status IN ('open', 'claimed') ORDER BY updated_at DESC, opened_at DESC, id DESC",
    items: sprintRunIds,
  });
}
INNER_EOF

cat << 'INNER_EOF' > src/repositories/execution/project-execution-snapshot-query.ts
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
    rawUsageJson: (row as any).raw_usage_json ? parsePayloadJson((row as any).raw_usage_json) : undefined,
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
INNER_EOF

cat << 'INNER_EOF' > patch-types-3.py
import re

with open('src/repositories/execution/execution-repository-types.ts', 'r') as f:
    content = f.read()

replacement = """export interface ProviderInvocationUsageRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  task_id: string | null;
  sprint_run_id: string | null;
  dispatch_id: string | null;
  task_run_id: string | null;
  attention_item_id: string | null;
  session_id: string;
  provider: string;
  purpose: string;
  status: string;
  model: string | null;
  native_session_id: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | string | null;
  prompt_chars: number | string;
  transcript_chars: number | string;
  input_tokens: number | string;
  cached_input_tokens: number | string;
  output_tokens: number | string;
  reasoning_output_tokens: number | string;
  total_tokens: number | string;
  usage_source: string;
  cost_cents: number | string | null;
  connection_id: string | null;
  raw_usage_json?: string | null;
  created_at: string;
  updated_at?: string;
}

export interface ProjectAttentionSummaryRow {
  id: string;
  project_id: string;
  sprint_id: string | null;
  sprint_run_id: string | null;
  attention_type: string;
  severity: string;
  owner_type: string;
  status: string;
  title: string;
  summary_markdown: string;
  payload_json: string | null;
  updated_at: string;
}"""

content = re.sub(r'export interface ProjectAttentionSummaryRow[\s\S]*?\}', '', content)
content = re.sub(r'export interface ProviderInvocationUsageRow[\s\S]*?\}', '', content)

content = content + "\n" + replacement

with open('src/repositories/execution/execution-repository-types.ts', 'w') as f:
    f.write(content)
INNER_EOF
python3 patch-types-3.py
