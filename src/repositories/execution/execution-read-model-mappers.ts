import {
  ExecutionSprintRunSummary,
  ExecutionTaskDispatchSummary,
  ExecutionRuntimeEventSummary,
  ExecutionHumanInterventionSummary,
  ExecutionUsageTotals,
} from "../../contracts/app-types.js";
import { ProviderInvocationUsageRecord } from "../../contracts/execution-types.js";
import { ExecutionInvocationRecord, ExecutionInvocationMessageRecord } from "../../contracts/invocation-types.js";
import { toNumber, parsePayloadJson } from "./execution-utils.js";
import {
  ExecutionSprintRunSummaryRow,
  ExecutionTaskDispatchSummaryRow,
  ExecutionRuntimeEventSummaryRow,
  ProviderInvocationUsageRow,
  ExecutionInvocationRow,
  ExecutionInvocationMessageRow,
} from "./execution-repository-types.js";

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

export function mapExecutionInvocationRow(row: ExecutionInvocationRow): ExecutionInvocationRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    sprintId: row.sprint_id,
    taskId: row.task_id,
    dispatchId: row.dispatch_id,
    sprintRunId: row.sprint_run_id,
    taskRunId: row.task_run_id,
    attentionItemId: row.attention_item_id,
    providerInvocationId: row.provider_invocation_id,
    type: row.type,
    status: row.status as any,
    provider: row.provider,
    model: row.model,
    systemPrompt: row.system_prompt,
    errorMessage: row.error_message,
    lastErrorCategory: row.last_error_category as any,
    lastErrorMessage: row.last_error_message,
    lastRetryAfterIso: row.last_retry_after_iso,
    messageCount: toNumber(row.message_count),
    lastMessageAt: row.last_message_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export function mapExecutionInvocationMessageRow(row: ExecutionInvocationMessageRow): ExecutionInvocationMessageRecord {
  return {
    id: row.id,
    invocationId: row.invocation_id,
    role: row.role as any,
    contentMarkdown: row.content_markdown,
    toolCallsJson: row.tool_calls_json ? parsePayloadJson(row.tool_calls_json) : null,
    metadata: row.metadata_json ? parsePayloadJson(row.metadata_json) : null,
    createdAt: row.created_at,
  };
}
