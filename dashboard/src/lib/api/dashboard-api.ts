import type {
  DashboardSettings,
  DashboardStatus,
  ExecutionAttentionItemSummary,
  ExecutionDashboardSnapshot,
  ExternalSettingsHints,
  GitTrackingStatus,
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

export const fetchRuntimeDashboardPayload = async (projectId?: string | null): Promise<RuntimeDashboardPayload> => {
  return fetchLivePayload(projectId);
};

/** Single HTTP call returning both status + execution — used for fast initial load. */
export const fetchLivePayload = async (projectId?: string | null): Promise<RuntimeDashboardPayload> => {
  const query = typeof projectId === "string" && projectId.trim().length > 0
    ? `?projectId=${encodeURIComponent(projectId.trim())}`
    : "";
  return fetchJson<RuntimeDashboardPayload>(`/api/live${query}`);
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

export interface RerunTaskOptions {
  provider?: string;
  clearWorktree?: boolean;
  resetDependents?: boolean;
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
