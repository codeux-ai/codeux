import type {
  DashboardSettings,
  DashboardStatus,
  ExecutionAttentionItemSummary,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
  OverviewTelemetrySnapshot,
} from "../../types.js";

const fetchJson = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const errorMessage = typeof errorBody?.error === "string" ? errorBody.error : `Request failed: ${path}`;
    throw new Error(errorMessage);
  }
  return (await response.json()) as T;
};

export interface RuntimeDashboardPayload {
  status: DashboardStatus;
  execution: ExecutionDashboardSnapshot;
}

export const fetchRuntimeStatus = async (): Promise<DashboardStatus> => {
  return fetchJson<DashboardStatus>("/api/status");
};

export const fetchExecutionSnapshot = async (): Promise<ExecutionDashboardSnapshot> => {
  return fetchJson<ExecutionDashboardSnapshot>("/api/execution");
};

export const fetchRuntimeDashboardPayload = async (): Promise<RuntimeDashboardPayload> => {
  const [status, execution] = await Promise.all([
    fetchRuntimeStatus(),
    fetchExecutionSnapshot(),
  ]);

  return {
    status,
    execution,
  };
};

/** Single HTTP call returning both status + execution — used for fast initial load. */
export const fetchLivePayload = async (): Promise<RuntimeDashboardPayload> => {
  return fetchJson<RuntimeDashboardPayload>("/api/live");
};

export const fetchLiveActivities = async (): Promise<import("../../types.js").LiveActivitiesResponse> => {
  return fetchJson<import("../../types.js").LiveActivitiesResponse>("/api/live-activities");
};

export const fetchOverviewTelemetry = async (): Promise<OverviewTelemetrySnapshot> => {
  return fetchJson<OverviewTelemetrySnapshot>("/api/telemetry/overview");
};

export const fetchGitTrackingStatus = async (): Promise<GitTrackingStatus> => {
  return fetchJson<GitTrackingStatus>("/api/git-status");
};

export const fetchDashboardSettings = async (): Promise<DashboardSettings> => {
  return fetchJson<DashboardSettings>("/api/settings");
};

export const saveDashboardSettings = async (settings: DashboardSettings): Promise<DashboardSettings> => {
  return fetchJson<DashboardSettings>("/api/settings", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(settings),
  });
};

export const fetchExternalSettingsHints = async (): Promise<ExternalSettingsHints> => {
  return fetchJson<ExternalSettingsHints>("/api/settings/import-sources");
};

export const rerunTask = async (taskId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/tasks/${encodeURIComponent(taskId)}/rerun`, {
    method: "POST",
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
