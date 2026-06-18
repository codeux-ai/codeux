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

const updateLruCache = (key: string, resolved: RuntimeDashboardPayload) => {
  if (livePayloadCache.has(key)) {
    livePayloadCache.delete(key);
  } else if (livePayloadCache.size >= MAX_CACHE_SIZE) {
    const firstKey = livePayloadCache.keys().next().value;
    if (firstKey !== undefined) {
      livePayloadCache.delete(firstKey);
    }
  }
  livePayloadCache.set(key, resolved);
};

export const clearLivePayloadCacheForTests = (): void => {
  livePayloadCache.clear();
  livePayloadInflight.clear();
  overviewTelemetryInflight = null;
  onboardingReadinessInflight = null;
};

export const invalidateLivePayloadCache = (projectId?: string | null): void => {
  const key = projectId?.trim() || "default";
  livePayloadCache.delete(key);
};

export const getCachedLivePayload = (projectId?: string | null): RuntimeDashboardPayload | null => {
  const key = projectId?.trim() || "default";
  if (!livePayloadCache.has(key)) return null;
  const val = livePayloadCache.get(key)!;
  // Update LRU position on access
  livePayloadCache.delete(key);
  livePayloadCache.set(key, val);
  return val;
};

export const fetchRuntimeDashboardPayload = async (projectId?: string | null): Promise<RuntimeDashboardPayload> => {
  return fetchLivePayload(projectId);
};

/** Single HTTP call returning both status + execution — used for fast initial load. */
export const fetchLivePayload = async (projectId?: string | null): Promise<RuntimeDashboardPayload> => {
  const key = projectId?.trim() || "default";
  let request = livePayloadInflight.get(key);
  if (!request) {
    const query = typeof projectId === "string" && projectId.trim().length > 0
      ? `?projectId=${encodeURIComponent(projectId.trim())}`
      : "";
    request = fetchJson<RuntimeDashboardPayload>(`/api/live${query}`).finally(() => {
      livePayloadInflight.delete(key);
    });
    livePayloadInflight.set(key, request);
  }
  const resolved = await request;
  updateLruCache(key, resolved);
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
};

export const orchestrateSprint = async (projectId: string, sprintId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(
    `/api/projects/${encodeURIComponent(projectId)}/sprints/${encodeURIComponent(sprintId)}/orchestrate`,
    { method: "POST" },
  );
};

export const pauseSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/pause`, {
    method: "POST",
  });
};

export const resumeSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/resume`, {
    method: "POST",
  });
};

export const cancelSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/cancel`, {
    method: "POST",
  });
};

export const forceCancelSprintRun = async (sprintRunId: string): Promise<void> => {
  await fetchJson(`/api/sprint-runs/${encodeURIComponent(sprintRunId)}/force-cancel`, {
    method: "POST",
  });
};

export const cancelTaskDispatch = async (dispatchId: string): Promise<void> => {
  await fetchJson(`/api/task-dispatches/${encodeURIComponent(dispatchId)}/cancel`, {
    method: "POST",
  });
};

export const forceCancelTaskDispatch = async (dispatchId: string): Promise<void> => {
  await fetchJson(`/api/task-dispatches/${encodeURIComponent(dispatchId)}/force-cancel`, {
    method: "POST",
  });
};

export const retryTaskDispatch = async (dispatchId: string): Promise<void> => {
  await fetchJson(`/api/task-dispatches/${encodeURIComponent(dispatchId)}/retry`, {
    method: "POST",
  });
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
  );
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
  );
};
