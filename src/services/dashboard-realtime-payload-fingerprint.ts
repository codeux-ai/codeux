import type {
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  OverviewTelemetrySnapshot,
  ProjectLiveDashboardSnapshot,
} from "../contracts/app-types.js";
import type { ProjectCollectionResponse } from "../contracts/project-management-types.js";

export type DashboardRealtimeSnapshotEventType =
  | "project.live.updated"
  | "project.execution.updated"
  | "project.runtime_status.updated"
  | "projects.updated"
  | "project.git.updated"
  | "overview.telemetry.updated";

export type DashboardRealtimeFingerprintEventType = DashboardRealtimeSnapshotEventType | (string & {});

export type DashboardRealtimeKnownSnapshotPayload =
  | ProjectLiveDashboardSnapshot
  | ExecutionDashboardSnapshot
  | DashboardStatus
  | ProjectCollectionResponse
  | GitTrackingStatus
  | OverviewTelemetrySnapshot;

interface SnapshotObject {
  [key: string]: unknown;
}

const FALLBACK_MAX_DEPTH = 6;
const FALLBACK_MAX_ARRAY_ITEMS = 80;
const FALLBACK_MAX_OBJECT_KEYS = 80;
const FALLBACK_MAX_STRING_LENGTH = 512;

export function getDashboardRealtimePayloadFingerprint(
  eventType: DashboardRealtimeFingerprintEventType,
  payload: DashboardRealtimeKnownSnapshotPayload | unknown,
): string {
  return getSemanticSnapshotSignature(eventType, payload) ?? getBoundedStableFingerprint(payload);
}

export function getBoundedStableFingerprint(payload: unknown): string {
  return stableSerialize(payload, 0);
}

function getSemanticSnapshotSignature(eventType: string, payload: unknown): string | null {
  if (eventType === "project.execution.updated") {
    return getExecutionSnapshotSignature(payload);
  }
  if (eventType === "project.live.updated") {
    return getLiveSnapshotSignature(payload);
  }
  if (eventType === "project.runtime_status.updated") {
    return getDashboardStatusSignature(payload);
  }
  if (eventType === "projects.updated") {
    return getProjectsSnapshotSignature(payload);
  }
  if (eventType === "project.git.updated") {
    return joinSignatureParts(["project.git.updated", getGitStatusSignature(payload)]);
  }
  if (eventType === "overview.telemetry.updated") {
    return getOverviewTelemetrySignature(payload);
  }
  return null;
}

function getLiveSnapshotSignature(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }

  const executionSignature = getExecutionSnapshotSignature(payload.execution);
  const statusSignature = getDashboardStatusSignature(payload.status);
  if (!executionSignature || !statusSignature) {
    return null;
  }

  return joinSignatureParts([
    "project.live.updated",
    signatureValue(payload.projectId),
    signatureValue(payload.selectedSprintId),
    statusSignature,
    executionSignature,
    getGitStatusSignature(payload.gitStatus),
    signatureValue(payload.gitStatusError),
  ]);
}

function getExecutionSnapshotSignature(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }

  const sprintRuns = arrayField(payload, "sprintRuns");
  const taskDispatches = arrayField(payload, "taskDispatches");
  const connections = arrayField(payload, "connections");
  const overflowAssignedWorkers = arrayField(payload, "overflowAssignedWorkers");
  const attentionItems = arrayField(payload, "attentionItems");
  const recentEvents = arrayField(payload, "recentEvents");
  if (!sprintRuns || !taskDispatches || !connections || !overflowAssignedWorkers || !attentionItems || !recentEvents) {
    return null;
  }

  const recentInvocations = Array.isArray(payload.recentInvocations) ? payload.recentInvocations : [];

  return joinSignatureParts([
    "execution",
    signatureValue(payload.projectId),
    signatureValue(payload.projectName),
    signatureCollection(sprintRuns, getSprintRunSignature),
    signatureCollection(taskDispatches, getTaskDispatchSignature),
    signatureCollection(connections, getConnectionSignature),
    getAssignedWorkerSignature(payload.primaryAssignedWorker),
    signatureCollection(overflowAssignedWorkers, getAssignedWorkerSignature),
    signatureCollection(attentionItems, getAttentionItemSignature),
    signatureCollection(recentEvents, getRuntimeEventSignature),
    signatureCollection(recentInvocations, getInvocationSignature),
  ]);
}

function getDashboardStatusSignature(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }
  const subtasks = arrayField(payload, "subtasks");
  if (!subtasks) {
    return null;
  }
  return joinSignatureParts([
    "status",
    signatureValue(payload.project_id),
    signatureValue(payload.sprint_id),
    signatureValue(payload.sprint_number),
    signatureValue(payload.source_id),
    signatureValue(payload.repo_path),
    signatureValue(payload.feature_branch),
    signatureCollection(subtasks, getSubtaskSignature),
  ]);
}

function getProjectsSnapshotSignature(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }
  const projects = arrayField(payload, "projects");
  if (!projects) {
    return null;
  }
  return joinSignatureParts([
    "projects",
    signatureValue(payload.selectedProjectId),
    signatureCollection(projects, getProjectSummarySignature),
  ]);
}

function getOverviewTelemetrySignature(payload: unknown): string | null {
  if (!isObject(payload)) {
    return null;
  }
  const activeProjects = arrayField(payload, "activeProjects");
  const attentionProjects = arrayField(payload, "attentionProjects");
  const recentEvents = arrayField(payload, "recentEvents");
  if (!activeProjects || !attentionProjects || !recentEvents) {
    return null;
  }
  return joinSignatureParts([
    "overview",
    signatureCollection(activeProjects, getOverviewProjectSignature),
    signatureCollection(attentionProjects, getOverviewProjectSignature),
    signatureCollection(recentEvents, getRuntimeEventSignature),
  ]);
}

function getProjectSummarySignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.slug),
    signatureValue(value.name),
    signatureValue(value.baseDir),
    signatureValue(value.repoUrl),
    signatureValue(value.sourceType),
    signatureValue(value.sourceRef),
    signatureValue(value.gitProvider),
    signatureValue(value.gitHostDomain),
    signatureValue(value.defaultBranch),
    signatureValue(value.featureBranchPrefix),
    signatureValue(value.status),
    signatureValue(value.sprintsCount),
    signatureValue(value.openTasks),
    signatureValue(value.completedTasks),
    signatureValue(value.isRunning),
    signatureValue(value.lastRunAt),
    signatureValue(value.lastRunStatus),
  ]);
}

function getOverviewProjectSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.projectId),
    signatureValue(value.projectName),
    signatureValue(value.sprintId),
    signatureValue(value.sprintName),
    signatureValue(value.sprintNumber),
    signatureValue(value.sprintRunId),
    signatureValue(value.sprintRunStatus),
    signatureValue(value.activeDispatchCount),
    signatureValue(value.runningDispatchCount),
    getHumanInterventionSignature(value.humanIntervention),
  ]);
}

function getSprintRunSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.sprintId),
    signatureValue(value.status),
    signatureValue(value.lastHeartbeatAt),
    signatureValue(value.activeLeaseOwnerKey),
    signatureValue(value.activeLeaseExpiresAt),
    signatureValue(value.finishedAt),
    getHumanInterventionSignature(value.humanIntervention),
  ]);
}

function getTaskDispatchSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.sprintRunId),
    signatureValue(value.taskId),
    signatureValue(value.status),
    signatureValue(value.taskRunState),
    signatureValue(value.provider),
    signatureValue(value.sessionId),
    signatureValue(value.workerBranch),
    signatureValue(value.prUrl),
    signatureValue(value.lastHeartbeatAt),
    signatureValue(value.activeLeaseOwnerKey),
    signatureValue(value.activeLeaseExpiresAt),
    signatureValue(value.errorMessage),
  ]);
}

function getConnectionSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.status),
    signatureValue(value.lastHeartbeatAt),
    signatureValue(value.activeDispatchCount),
    signatureValue(value.pendingInboxCount),
    signatureValue(value.tasksRunCount),
    signatureValue(value.messageCount),
  ]);
}

function getAssignedWorkerSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.assignmentId),
    signatureValue(value.workerEndpointId),
    signatureValue(value.status),
    signatureValue(value.lastAffinityAt),
    signatureValue(value.workerStatus),
  ]);
}

function getAttentionItemSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.sprintId),
    signatureValue(value.taskId),
    signatureValue(value.sprintRunId),
    signatureValue(value.dispatchId),
    signatureValue(value.attentionType),
    signatureValue(value.severity),
    signatureValue(value.ownerType),
    signatureValue(value.status),
    signatureValue(value.claimedAt),
    signatureValue(value.resolvedAt),
  ]);
}

function getHumanInterventionSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.title),
    signatureValue(value.reason),
    signatureValue(value.attentionType),
    signatureValue(value.severity),
    signatureValue(value.ownerType),
  ]);
}

function getRuntimeEventSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.scopeType),
    signatureValue(value.taskRunId),
    signatureValue(value.sprintRunId),
    signatureValue(value.dispatchId),
    signatureValue(value.eventType),
    signatureValue(value.sourceEventKey),
    signatureValue(value.provider),
    signatureValue(value.sessionId),
    signatureValue(value.workerBranch),
    signatureValue(value.prUrl),
  ]);
}

function getInvocationSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.providerInvocationId),
    signatureValue(value.status),
    signatureValue(value.type),
    signatureValue(value.sprintRunId),
    signatureValue(value.dispatchId),
    signatureValue(value.taskRunId),
    signatureValue(value.attentionItemId),
    signatureValue(value.provider),
    signatureValue(value.model),
    signatureValue(value.finishedAt),
    signatureValue(value.errorMessage),
    signatureValue(value.lastErrorCategory),
    signatureValue(value.lastErrorMessage),
    signatureValue(value.messageCount),
    signatureValue(value.lastMessageAt),
  ]);
}

function getSubtaskSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.record_id),
    signatureValue(value.status),
    signatureValue(value.session_id),
    signatureValue(value.session_name),
    signatureValue(value.session_state),
    signatureValue(value.provider),
    signatureValue(value.model),
    signatureValue(value.worker_branch),
    signatureValue(value.pr_url),
    signatureValue(value.merge_indicator),
    signatureValue(value.intervention_owner),
  ]);
}

function getGitStatusSignature(payload: unknown): string {
  if (payload === null || payload === undefined) {
    return signatureValue(payload);
  }
  if (!isObject(payload)) {
    return signatureValue(payload);
  }
  return joinSignatureParts([
    signatureValue(payload.mode),
    signatureValue(payload.available),
    signatureValue(payload.repositoryRoot),
    signatureValue(payload.branch),
    signatureValue(payload.hasRemote),
    signatureValue(payload.dirty),
    getGitTrackingTargetSignature(payload.tracking),
    signatureCollection(Array.isArray(payload.openPullRequests) ? payload.openPullRequests : [], getPullRequestSignature),
    signatureCollection(Array.isArray(payload.ciRuns) ? payload.ciRuns : [], getCiRunSignature),
    signatureCollection(Array.isArray(payload.mergedPullRequests) ? payload.mergedPullRequests : [], getMergedPullRequestSignature),
    signatureCollection(Array.isArray(payload.warnings) ? payload.warnings : [], signatureValue),
  ]);
}

function getGitTrackingTargetSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.scope),
    signatureValue(value.label),
    signatureValue(value.branch),
  ]);
}

function getPullRequestSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.number),
    signatureValue(value.title),
    signatureValue(value.url),
    signatureValue(value.headRefName),
    signatureValue(value.baseRefName),
    signatureValue(value.state),
    signatureCollection(Array.isArray(value.checks) ? value.checks : [], getGitStatusCheckSignature),
  ]);
}

function getGitStatusCheckSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.name),
    signatureValue(value.status),
  ]);
}

function getCiRunSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.name),
    signatureValue(value.status),
    signatureValue(value.conclusion),
    signatureValue(value.event),
    signatureValue(value.headBranch),
    signatureValue(value.url),
    signatureCollection(Array.isArray(value.failedJobs) ? value.failedJobs : [], getCiFailedJobSignature),
  ]);
}

function getCiFailedJobSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.id),
    signatureValue(value.name),
    signatureValue(value.conclusion),
    signatureCollection(Array.isArray(value.failedSteps) ? value.failedSteps : [], signatureValue),
  ]);
}

function getMergedPullRequestSignature(item: unknown): string {
  const value = objectOrEmpty(item);
  return joinSignatureParts([
    signatureValue(value.number),
    signatureValue(value.title),
    signatureValue(value.url),
    signatureValue(value.headRefName),
    signatureValue(value.baseRefName),
    signatureValue(value.mergedAt),
    signatureValue(value.mergedBy),
  ]);
}

function signatureCollection(items: unknown[], summarize: (item: unknown) => string): string {
  return joinSignatureParts([String(items.length), ...items.map((item) => summarize(item))]);
}

function signatureValue(value: unknown): string {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return `${typeof value}:${String(value)}`;
  }
  if (isObject(value)) {
    return `object:${Object.keys(value).sort().join(",")}`;
  }
  return `${typeof value}:${String(value)}`;
}

function joinSignatureParts(parts: string[]): string {
  return parts.map((part) => `${part.length}:${part}`).join("|");
}

function arrayField(payload: SnapshotObject, key: string): unknown[] | null {
  const value = payload[key];
  return Array.isArray(value) ? value : null;
}

function objectOrEmpty(value: unknown): SnapshotObject {
  return isObject(value) ? value : {};
}

function isObject(value: unknown): value is SnapshotObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableSerialize(value: unknown, depth: number): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string") {
    return JSON.stringify(truncateString(value));
  }
  const valueType = typeof value;
  if (valueType === "number" || valueType === "boolean") {
    return JSON.stringify(value);
  }
  if (valueType === "undefined") {
    return "undefined";
  }
  if (valueType === "bigint") {
    return `bigint:${String(value)}`;
  }
  if (valueType === "symbol" || valueType === "function") {
    return valueType;
  }
  if (depth >= FALLBACK_MAX_DEPTH) {
    return depthLimitMarker(value);
  }
  if (Array.isArray(value)) {
    const items = value.slice(0, FALLBACK_MAX_ARRAY_ITEMS).map((item) => stableSerialize(item, depth + 1));
    if (value.length > FALLBACK_MAX_ARRAY_ITEMS) {
      items.push(`__truncated_array_items:${value.length - FALLBACK_MAX_ARRAY_ITEMS}`);
    }
    return `[${items.join(",")}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value)
      .filter((key) => key !== "updatedAt" && key !== "timestamp")
      .sort();
    const selectedKeys = keys.slice(0, FALLBACK_MAX_OBJECT_KEYS);
    const properties = selectedKeys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key], depth + 1)}`);
    if (keys.length > FALLBACK_MAX_OBJECT_KEYS) {
      properties.push(`${JSON.stringify("__truncated_object_keys")}:${keys.length - FALLBACK_MAX_OBJECT_KEYS}`);
    }
    return `{${properties.join(",")}}`;
  }
  return JSON.stringify(String(value));
}

function truncateString(value: string): string {
  if (value.length <= FALLBACK_MAX_STRING_LENGTH) {
    return value;
  }
  return `${value.slice(0, FALLBACK_MAX_STRING_LENGTH)}...__truncated_string:${value.length - FALLBACK_MAX_STRING_LENGTH}`;
}

function depthLimitMarker(value: unknown): string {
  if (Array.isArray(value)) {
    return `__depth_limit_array:${value.length}`;
  }
  if (isObject(value)) {
    return `__depth_limit_object:${Object.keys(value).length}`;
  }
  return "__depth_limit";
}
