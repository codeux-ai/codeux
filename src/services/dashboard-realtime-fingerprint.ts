import { createHash } from "node:crypto";

const FINGERPRINT_VERSION = "dashboard-realtime-fingerprint:v2";
const DEFAULT_SIGNATURE_LIMIT = 50;
const RECENT_SIGNATURE_LIMIT = 30;
const ALL_SIGNATURE_ITEMS = Number.POSITIVE_INFINITY;
const FALLBACK_ARRAY_LIMIT = 50;
const FALLBACK_OBJECT_KEY_LIMIT = 80;
const FALLBACK_STRING_LIMIT = 512;
const FALLBACK_DEPTH_LIMIT = 8;
const TIMESTAMP_ONLY_KEYS = new Set(["updatedAt", "timestamp", "lastUpdated"]);
const GIT_HASH_OPTIONS = {
  maxArrayItems: Number.POSITIVE_INFINITY,
  maxObjectKeys: Number.POSITIVE_INFINITY,
  maxStringLength: Number.POSITIVE_INFINITY,
  maxDepth: Number.POSITIVE_INFINITY,
};

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compactRecord(value: unknown, keys: string[]): JsonRecord {
  if (!isRecord(value)) {
    return {};
  }

  const output: JsonRecord = {};
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      output[key] = value[key];
    }
  }
  return output;
}

function compactList(
  value: unknown,
  signature: (item: unknown) => unknown,
  limit: number = DEFAULT_SIGNATURE_LIMIT,
): { length: number; items: unknown[] } {
  if (!Array.isArray(value)) {
    return { length: 0, items: [] };
  }

  const itemLimit = Number.isFinite(limit) ? Math.min(value.length, limit) : value.length;
  const items: unknown[] = [];
  for (let index = 0; index < itemLimit; index += 1) {
    items.push(signature(value[index]));
  }

  return { length: value.length, items };
}

function compactDashboardStatus(value: unknown): JsonRecord {
  const status = compactRecord(value, [
    "project_id",
    "sprint_id",
    "sprint_number",
    "source_id",
    "repo_path",
    "feature_branch",
    "reportText",
    "statusTable",
    "instructions",
  ]);
  status.subtasks = compactList(isRecord(value) ? value.subtasks : undefined, (subtask) =>
    compactRecord(subtask, [
      "id",
      "key",
      "title",
      "status",
      "priority",
      "executorType",
      "dependsOn",
      "taskRunState",
      "dispatchStatus",
      "intervention_owner",
      "intervention_hint",
      "is_merged",
    ]), ALL_SIGNATURE_ITEMS);
  return status;
}

function compactRuntimeEvent(value: unknown): JsonRecord {
  return compactRecord(value, [
    "id",
    "scopeType",
    "taskRunId",
    "sprintRunId",
    "dispatchId",
    "projectId",
    "sprintId",
    "sprintRunStatus",
    "taskId",
    "taskKey",
    "taskRunState",
    "eventType",
    "originator",
    "sourceEventKey",
    "provider",
    "sessionId",
    "workerBranch",
    "prUrl",
    "connectionId",
    "createdAt",
  ]);
}

function compactExecutionSnapshot(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return {};
  }

  return {
    projectId: value.projectId,
    projectName: value.projectName,
    sprintRuns: compactList(value.sprintRuns, (run) =>
      compactRecord(run, [
        "id",
        "projectId",
        "sprintId",
        "sprintName",
        "sprintNumber",
        "status",
        "triggerType",
        "triggeredBy",
        "executorMode",
        "startedAt",
        "finishedAt",
        "activeLeaseOwnerKey",
        "humanIntervention",
        "usage",
      ]), ALL_SIGNATURE_ITEMS),
    taskDispatches: compactList(value.taskDispatches, (dispatch) =>
      compactRecord(dispatch, [
        "id",
        "projectId",
        "sprintId",
        "sprintRunId",
        "taskId",
        "taskKey",
        "taskTitle",
        "status",
        "executorType",
        "priority",
        "connectionId",
        "taskRunId",
        "taskRunState",
        "provider",
        "sessionId",
        "workerBranch",
        "prUrl",
        "queuedAt",
        "claimedAt",
        "startedAt",
        "finishedAt",
        "errorMessage",
        "activeLeaseOwnerKey",
        "usage",
      ]), ALL_SIGNATURE_ITEMS),
    connections: compactList(value.connections, (connection) =>
      compactRecord(connection, [
        "id",
        "connectionKey",
        "displayName",
        "role",
        "transport",
        "status",
        "model",
        "listenMode",
        "projectIds",
        "activeProjectIds",
        "tasksRunCount",
        "threadCount",
        "messageCount",
        "pendingInboxCount",
        "activeDispatchCount",
      ]), ALL_SIGNATURE_ITEMS),
    primaryAssignedWorker: compactRecord(value.primaryAssignedWorker, [
      "assignmentId",
      "workerEndpointId",
      "workerEndpointKey",
      "workerEndpointType",
      "workerDisplayName",
      "assignmentRole",
      "status",
      "workerStatus",
      "canSuperviseProjects",
      "canExecuteTasks",
    ]),
    overflowAssignedWorkers: compactList(value.overflowAssignedWorkers, (worker) =>
      compactRecord(worker, [
        "assignmentId",
        "workerEndpointId",
        "workerEndpointKey",
        "workerEndpointType",
        "workerDisplayName",
        "assignmentRole",
        "status",
        "workerStatus",
        "canSuperviseProjects",
        "canExecuteTasks",
      ]), ALL_SIGNATURE_ITEMS),
    attentionItems: compactList(value.attentionItems, (item) =>
      compactRecord(item, [
        "id",
        "sprintId",
        "taskId",
        "sprintRunId",
        "dispatchId",
        "attentionType",
        "severity",
        "ownerType",
        "status",
        "assignedWorkerEndpointId",
        "title",
        "claimedAt",
        "resolvedAt",
      ]), ALL_SIGNATURE_ITEMS),
    recentEvents: compactList(value.recentEvents, compactRuntimeEvent, RECENT_SIGNATURE_LIMIT),
    recentInvocations: compactList(value.recentInvocations, (invocation) =>
      compactRecord(invocation, [
        "id",
        "providerInvocationId",
        "purpose",
        "status",
        "provider",
        "model",
        "startedAt",
        "completedAt",
        "totalTokens",
        "totalCostUsd",
      ]), RECENT_SIGNATURE_LIMIT),
  };
}

function compactOverviewProject(value: unknown): JsonRecord {
  return compactRecord(value, [
    "projectId",
    "projectName",
    "sprintId",
    "sprintName",
    "sprintNumber",
    "sprintRunId",
    "sprintRunStatus",
    "activeDispatchCount",
    "runningDispatchCount",
    "humanIntervention",
  ]);
}

function compactOverviewSnapshot(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return {};
  }

  return {
    activeProjects: compactList(value.activeProjects, compactOverviewProject, ALL_SIGNATURE_ITEMS),
    attentionProjects: compactList(value.attentionProjects, compactOverviewProject, ALL_SIGNATURE_ITEMS),
    recentEvents: compactList(value.recentEvents, compactRuntimeEvent, RECENT_SIGNATURE_LIMIT),
  };
}

function compactLiveSnapshot(value: unknown): JsonRecord {
  if (!isRecord(value)) {
    return {};
  }

  return {
    projectId: value.projectId,
    selectedSprintId: value.selectedSprintId,
    status: compactDashboardStatus(value.status),
    execution: compactExecutionSnapshot(value.execution),
    gitStatus: hashSemanticValue(value.gitStatus, GIT_HASH_OPTIONS),
    gitStatusError: value.gitStatusError,
  };
}

function hashSemanticValue(
  value: unknown,
  options: {
    maxArrayItems?: number;
    maxObjectKeys?: number;
    maxStringLength?: number;
    maxDepth?: number;
  } = {},
): string {
  const hash = createHash("sha256");
  const seen = new WeakSet<object>();
  const limits = {
    maxArrayItems: options.maxArrayItems ?? FALLBACK_ARRAY_LIMIT,
    maxObjectKeys: options.maxObjectKeys ?? FALLBACK_OBJECT_KEY_LIMIT,
    maxStringLength: options.maxStringLength ?? FALLBACK_STRING_LIMIT,
    maxDepth: options.maxDepth ?? FALLBACK_DEPTH_LIMIT,
  };

  const update = (part: string): void => {
    hash.update(part);
  };

  const visit = (current: unknown, depth: number): void => {
    if (current === null) {
      update("null;");
      return;
    }

    const valueType = typeof current;
    if (valueType === "string") {
      const value = current as string;
      update(`string:${value.length}:`);
      update(value.length > limits.maxStringLength ? value.slice(0, limits.maxStringLength) : value);
      update(";");
      return;
    }
    if (valueType === "number" || valueType === "boolean" || valueType === "bigint") {
      update(`${valueType}:${String(current)};`);
      return;
    }
    if (valueType === "undefined" || valueType === "function" || valueType === "symbol") {
      update(`${valueType};`);
      return;
    }
    if (depth > limits.maxDepth) {
      update("max-depth;");
      return;
    }

    if (Array.isArray(current)) {
      update(`array:${current.length}[`);
      const arrayLimit = Number.isFinite(limits.maxArrayItems)
        ? Math.min(current.length, limits.maxArrayItems)
        : current.length;
      for (let index = 0; index < arrayLimit; index += 1) {
        update(`${index}=`);
        visit(current[index], depth + 1);
      }
      if (arrayLimit < current.length) {
        update(`truncated:${current.length - arrayLimit};`);
      }
      update("];");
      return;
    }

    if (current instanceof Date) {
      update(`date:${current.toISOString()};`);
      return;
    }

    if (typeof current === "object") {
      if (seen.has(current)) {
        update("circular;");
        return;
      }
      seen.add(current);
      const record = current as JsonRecord;
      const keys = Object.keys(record)
        .filter((key) => !TIMESTAMP_ONLY_KEYS.has(key))
        .sort();
      const keyLimit = Number.isFinite(limits.maxObjectKeys)
        ? Math.min(keys.length, limits.maxObjectKeys)
        : keys.length;
      update(`object:${keys.length}{`);
      for (let index = 0; index < keyLimit; index += 1) {
        const key = keys[index];
        update(`${key}:`);
        visit(record[key], depth + 1);
      }
      if (keyLimit < keys.length) {
        update(`truncated-keys:${keys.length - keyLimit};`);
      }
      update("};");
    }
  };

  visit(value, 0);
  return hash.digest("hex");
}

export function computeDashboardRealtimePayloadFingerprint(eventType: string, payload: unknown): string {
  let fingerprintSource: unknown;
  let mode: string;

  switch (eventType) {
    case "project.live.updated":
      fingerprintSource = compactLiveSnapshot(payload);
      mode = "project-live";
      break;
    case "project.execution.updated":
      fingerprintSource = compactExecutionSnapshot(payload);
      mode = "project-execution";
      break;
    case "project.git.updated":
      fingerprintSource = payload;
      mode = "project-git";
      break;
    case "overview.telemetry.updated":
      fingerprintSource = compactOverviewSnapshot(payload);
      mode = "overview-telemetry";
      break;
    default:
      fingerprintSource = payload;
      mode = "generic-bounded";
      break;
  }

  const hash = eventType === "project.git.updated"
    ? hashSemanticValue(fingerprintSource, GIT_HASH_OPTIONS)
    : hashSemanticValue(fingerprintSource);
  return `${FINGERPRINT_VERSION}:${mode}:${hash}`;
}
