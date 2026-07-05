import type {
  DashboardSettings,
  DashboardStatus,
  ExecutionAttentionItemSummary,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
  OnboardingRuntimeReadiness,
  OverviewTelemetrySnapshot,
  ProjectLiveDashboardSnapshot,
} from "../../types.js";
import { fetchJson } from "./fetch-json.js";

export type RuntimeDashboardPayload = ProjectLiveDashboardSnapshot;

export const fetchRuntimeStatus = async (): Promise<DashboardStatus> => {
  return fetchJson<DashboardStatus>("/api/status");
};

export const fetchExecutionSnapshot = async (): Promise<ExecutionDashboardSnapshot> => {
  return fetchJson<ExecutionDashboardSnapshot>("/api/execution");
};

const MAX_CACHE_SIZE = 5;
const livePayloadCache = new Map<string, RuntimeDashboardPayload>();
const livePayloadInflight = new Map<string, Promise<RuntimeDashboardPayload>>();
const livePayloadProjectIndex = new Map<string, string>();

export interface LivePayloadCacheOptions {
  selectedSprintId?: string | null;
  scopeKey?: string | null;
}

const normalizeScopePart = (value?: string | null): string | null => {
  const trimmed = value?.trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
};

const getProjectCacheKey = (projectId?: string | null): string => normalizeScopePart(projectId) || "default";

const deleteProjectIndexEntriesForKey = (cacheKey: string): void => {
  for (const [projectKey, indexedKey] of Array.from(livePayloadProjectIndex.entries())) {
    if (indexedKey === cacheKey) {
      livePayloadProjectIndex.delete(projectKey);
    }
  }
};

const getLatestProjectScopedCacheKey = (projectKey: string): string | null => {
  const indexedKey = livePayloadProjectIndex.get(projectKey);
  if (indexedKey && livePayloadCache.has(indexedKey)) {
    return indexedKey;
  }
  const latestKey = Array.from(livePayloadCache.keys())
    .reverse()
    .find((key) => key === projectKey || key.startsWith(`${projectKey}::`)) || null;
  if (latestKey) {
    livePayloadProjectIndex.set(projectKey, latestKey);
  } else {
    livePayloadProjectIndex.delete(projectKey);
  }
  return latestKey;
};

const hasSelectedSprintScope = (options?: LivePayloadCacheOptions): boolean => (
  !!options && Object.prototype.hasOwnProperty.call(options, "selectedSprintId")
);

const getLivePayloadCacheKey = (
  projectId?: string | null,
  options?: LivePayloadCacheOptions,
  payload?: RuntimeDashboardPayload,
): string => {
  const projectKey = getProjectCacheKey(projectId || payload?.projectId || payload?.status.project_id || null);
  const explicitScopeKey = normalizeScopePart(options?.scopeKey);
  if (explicitScopeKey) {
    return `${projectKey}::scope:${explicitScopeKey}`;
  }
  if (hasSelectedSprintScope(options)) {
    return `${projectKey}::sprint:${normalizeScopePart(options?.selectedSprintId) || "none"}`;
  }
  if (payload) {
    return `${projectKey}::sprint:${normalizeScopePart(payload.selectedSprintId) || "none"}`;
  }
  return projectKey;
};

const isPayloadInScope = (
  payload: RuntimeDashboardPayload,
  projectId?: string | null,
  options?: LivePayloadCacheOptions,
): boolean => {
  const expectedProjectId = normalizeScopePart(projectId);
  const payloadProjectId = normalizeScopePart(payload.projectId || payload.status.project_id || payload.execution.projectId);
  if (expectedProjectId && payloadProjectId && expectedProjectId !== payloadProjectId) {
    return false;
  }
  if (!hasSelectedSprintScope(options)) {
    return true;
  }
  return normalizeScopePart(payload.selectedSprintId) === normalizeScopePart(options?.selectedSprintId);
};

const updateLruCache = (key: string, resolved: RuntimeDashboardPayload, requestProjectId?: string | null) => {
  if (livePayloadCache.has(key)) {
    livePayloadCache.delete(key);
  } else if (livePayloadCache.size >= MAX_CACHE_SIZE) {
    const firstKey = livePayloadCache.keys().next().value;
    if (firstKey !== undefined) {
      livePayloadCache.delete(firstKey);
      deleteProjectIndexEntriesForKey(firstKey);
    }
  }
  livePayloadCache.set(key, resolved);
  livePayloadProjectIndex.set(getProjectCacheKey(resolved.projectId || resolved.status.project_id || resolved.execution.projectId), key);
  livePayloadProjectIndex.set(getProjectCacheKey(requestProjectId), key);
};

export const clearLivePayloadCacheForTests = (): void => {
  livePayloadCache.clear();
  livePayloadInflight.clear();
  livePayloadProjectIndex.clear();
  overviewTelemetryInflight = null;
  onboardingReadinessInflight = null;
};

export const invalidateLivePayloadCache = (projectId?: string | null): void => {
  if (projectId === undefined || projectId === null) {
    livePayloadCache.clear();
    livePayloadInflight.clear();
    livePayloadProjectIndex.clear();
    return;
  }
  const projectKey = getProjectCacheKey(projectId);
  const indexedKey = getLatestProjectScopedCacheKey(projectKey);
  for (const key of Array.from(livePayloadCache.keys())) {
    if (key === projectKey || key === indexedKey || key.startsWith(`${projectKey}::`)) {
      livePayloadCache.delete(key);
      deleteProjectIndexEntriesForKey(key);
    }
  }
  for (const key of Array.from(livePayloadInflight.keys())) {
    if (key === projectKey || key === indexedKey || key.startsWith(`${projectKey}::`)) {
      livePayloadInflight.delete(key);
    }
  }
  livePayloadProjectIndex.delete(projectKey);
};

export const getCachedLivePayload = (
  projectId?: string | null,
  options?: LivePayloadCacheOptions,
): RuntimeDashboardPayload | null => {
  const projectKey = getProjectCacheKey(projectId);
  const key = hasSelectedSprintScope(options) || normalizeScopePart(options?.scopeKey)
    ? getLivePayloadCacheKey(projectId, options)
    : livePayloadCache.has(projectKey)
      ? projectKey
      : getLatestProjectScopedCacheKey(projectKey) || projectKey;
  if (!livePayloadCache.has(key)) return null;
  const val = livePayloadCache.get(key)!;
  if (!isPayloadInScope(val, projectId, options)) {
    return null;
  }
  // Update LRU position on access
  livePayloadCache.delete(key);
  livePayloadCache.set(key, val);
  return val;
};

export const fetchRuntimeDashboardPayload = async (
  projectId?: string | null,
  options?: LivePayloadCacheOptions,
): Promise<RuntimeDashboardPayload> => {
  return fetchLivePayload(projectId, options);
};

/** Single HTTP call returning both status + execution — used for fast initial load. */
export const fetchLivePayload = async (
  projectId?: string | null,
  options?: LivePayloadCacheOptions,
): Promise<RuntimeDashboardPayload> => {
  const requestKey = getLivePayloadCacheKey(projectId, options);
  let request = livePayloadInflight.get(requestKey);
  if (!request) {
    const query = typeof projectId === "string" && projectId.trim().length > 0
      ? `?projectId=${encodeURIComponent(projectId.trim())}`
      : "";
    request = fetchJson<RuntimeDashboardPayload>(`/api/live${query}`).finally(() => {
      livePayloadInflight.delete(requestKey);
    });
    livePayloadInflight.set(requestKey, request);
  }
  const resolved = await request;
  updateLruCache(getLivePayloadCacheKey(projectId, options, resolved), resolved, projectId);
  return resolved;
};

export const fetchLiveActivities = async (): Promise<import("../../types.js").LiveActivitiesResponse> => {
  return fetchJson<import("../../types.js").LiveActivitiesResponse>("/api/live-activities");
};

let overviewTelemetryInflight: Promise<OverviewTelemetrySnapshot> | null = null;

export const fetchOverviewTelemetry = async (): Promise<OverviewTelemetrySnapshot> => {
  if (!overviewTelemetryInflight) {
    overviewTelemetryInflight = fetchJson<OverviewTelemetrySnapshot>("/api/telemetry/overview").finally(() => {
      overviewTelemetryInflight = null;
    });
  }
  return overviewTelemetryInflight;
};

export const fetchGitTrackingStatus = async (): Promise<GitTrackingStatus> => {
  return fetchJson<GitTrackingStatus>("/api/git-status");
};

let onboardingReadinessInflight: Promise<OnboardingRuntimeReadiness> | null = null;

export const fetchOnboardingReadiness = async (): Promise<OnboardingRuntimeReadiness> => {
  if (!onboardingReadinessInflight) {
    onboardingReadinessInflight = fetchJson<OnboardingRuntimeReadiness>("/api/onboarding/readiness").finally(() => {
      onboardingReadinessInflight = null;
    });
  }
  return onboardingReadinessInflight;
};


let externalSettingsHintsCache: ExternalSettingsHints | null = null;
let externalSettingsHintsInflightRequest: Promise<ExternalSettingsHints> | null = null;

export const fetchExternalSettingsHints = async (): Promise<ExternalSettingsHints> => {
  if (externalSettingsHintsCache) {
    return externalSettingsHintsCache;
  }
  if (!externalSettingsHintsInflightRequest) {
    externalSettingsHintsInflightRequest = fetchJson<ExternalSettingsHints>("/api/settings/import-sources").then((hints) => {
      externalSettingsHintsCache = hints;
      return hints;
    }).finally(() => {
      externalSettingsHintsInflightRequest = null;
    });
  }
  return externalSettingsHintsInflightRequest;
};

export interface RerunTaskOptions {
  provider?: string;
  providerConfigId?: string;
  model?: string;
  clearWorktree?: boolean;
  resetDependents?: boolean;
  undoMerge?: boolean;
}

export const rerunTask = async (taskId: string, options?: RerunTaskOptions): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/rerun`, {
    method: "POST",
    headers: options ? { "Content-Type": "application/json" } : undefined,
    body: options ? JSON.stringify(options) : undefined,
  });
  invalidateLivePayloadCache();
};

export const orchestrateSprint = async (projectId: string, sprintId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/orchestrate`,
    { method: "POST" },
  );
  invalidateLivePayloadCache(projectId);
};

export const pauseSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/pause`, {
    method: "POST",
  });
  invalidateLivePayloadCache();
};

export const resumeSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/resume`, {
    method: "POST",
  });
  invalidateLivePayloadCache();
};

export const cancelSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/cancel`, {
    method: "POST",
  });
  invalidateLivePayloadCache();
};

export const forceCancelSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/force-cancel`, {
    method: "POST",
  });
  invalidateLivePayloadCache();
};

export const cancelTaskDispatch = async (dispatchId: string): Promise<void> => {
  await fetchJson(`/api/task-dispatches/${encodeURIComponent(dispatchId)}/cancel`, {
    method: "POST",
  });
  invalidateLivePayloadCache();
};

export const forceCancelTaskDispatch = async (dispatchId: string): Promise<void> => {
  await fetchJson(`/api/task-dispatches/${encodeURIComponent(dispatchId)}/force-cancel`, {
    method: "POST",
  });
  invalidateLivePayloadCache();
};

export const retryTaskDispatch = async (dispatchId: string): Promise<void> => {
  await fetchJson(`/api/task-dispatches/${encodeURIComponent(dispatchId)}/retry`, {
    method: "POST",
  });
  invalidateLivePayloadCache();
};

export const claimAttentionItem = async (
  projectId: string,
  attentionItemId: string,
  input?: { workerEndpointId?: string; claimReason?: string },
): Promise<ExecutionAttentionItemSummary> => {
  return fetchJson<ExecutionAttentionItemSummary>(
    `/api/projects/${encodeURIComponent(projectId)}/attention-items/${encodeURIComponent(attentionItemId)}/claim`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input || {}),
    },
  ).then((summary) => {
    invalidateLivePayloadCache(projectId);
    return summary;
  });
};

export const resolveAttentionItem = async (
  projectId: string,
  attentionItemId: string,
  input?: { status?: "resolved" | "dismissed"; reason?: string; resolutionSummaryMarkdown?: string },
): Promise<ExecutionAttentionItemSummary> => {
  return fetchJson<ExecutionAttentionItemSummary>(
    `/api/projects/${encodeURIComponent(projectId)}/attention-items/${encodeURIComponent(attentionItemId)}/resolve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input || {}),
    },
  ).then((summary) => {
    invalidateLivePayloadCache(projectId);
    return summary;
  });
};
