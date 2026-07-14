import type {
  CreateSchedulerEntryInput,
  MemoryRemediationScheduleResponse,
  MemoryRemediationScheduleSettings,
  SchedulerCollectionResponse,
  SchedulerEntryRecord,
  ScheduleStatus,
  UpdateSchedulerEntryInput,
} from "../types.js";
import { fetchJson } from "../../lib/api/fetch-json.js";

export interface AgentSchedulerSummaryEntry {
  id: string;
  targetType: "agent_wakeup" | "task";
  label: string;
  title: string;
  status: ScheduleStatus;
  statusLabel: string;
  timingSummary: string;
  targetSummary: string;
  scheduledAt: string | null;
}

export const fetchProjectSchedule = async (
  projectId: string,
  from: string,
  to: string,
  signal?: AbortSignal,
): Promise<SchedulerCollectionResponse> => {
  const url = new URL(`/api/projects/${encodeURIComponent(projectId)}/scheduler`, window.location.origin);
  url.searchParams.set("from", from);
  url.searchParams.set("to", to);
  return fetchJson<SchedulerCollectionResponse>(`${url.pathname}${url.search}`, { signal });
};

const scheduleAnchorOffsetLabel = (offsetMinutes?: number): string => {
  const offset = Math.max(0, Math.floor(Number(offsetMinutes ?? 0)));
  if (offset === 0) {
    return "";
  }
  return offset === 1 ? " + 1 minute" : ` + ${offset} minutes`;
};

const formatScheduleDateTime = (iso: string | null | undefined): string => {
  if (!iso) {
    return "No scheduled time";
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return "No scheduled time";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
};

const statusLabel = (status: ScheduleStatus): string => status.replaceAll("_", " ");

const isAgentSchedulerSource = (entry: SchedulerEntryRecord): boolean => {
  if (entry.targetType === "agent_wakeup") {
    return entry.agentWakeupTarget?.origin === "agent_scheduler"
      || entry.agentWakeupTarget?.source === "agent_scheduler";
  }
  if (entry.targetType === "task") {
    return entry.taskTarget?.origin === "agent_scheduler"
      || entry.taskTarget?.source === "agent_scheduler";
  }
  return false;
};

export const isActiveAgentSchedulerEntry = (entry: SchedulerEntryRecord): entry is SchedulerEntryRecord & {
  targetType: "agent_wakeup" | "task";
} => (
  entry.status === "scheduled"
  && (entry.targetType === "agent_wakeup" || entry.targetType === "task")
  && isAgentSchedulerSource(entry)
);

export const toAgentSchedulerSummaryEntry = (entry: SchedulerEntryRecord & {
  targetType: "agent_wakeup" | "task";
}): AgentSchedulerSummaryEntry => {
  const scheduledAt = entry.nextRunAt ?? entry.scheduledFor ?? null;
  const timingSummary = entry.scheduleAnchor?.mode === "after_sprint_end"
    ? `After source sprint ${entry.scheduleAnchor.sourceSprintId} ends${scheduleAnchorOffsetLabel(entry.scheduleAnchor.offsetMinutes)}`
    : `Scheduled for ${formatScheduleDateTime(scheduledAt)}`;

  if (entry.targetType === "agent_wakeup") {
    return {
      id: entry.id,
      targetType: entry.targetType,
      label: "Agent wakeup",
      title: entry.title || entry.agentWakeupTarget?.title || "Agent wakeup",
      status: entry.status,
      statusLabel: statusLabel(entry.status),
      timingSummary,
      targetSummary: entry.agentWakeupTarget?.threadId
        ? `Thread ${entry.agentWakeupTarget.threadId}`
        : "Project chat wakeup",
      scheduledAt,
    };
  }

  return {
    id: entry.id,
    targetType: entry.targetType,
    label: "Task run",
    title: entry.title || "Scheduled task run",
    status: entry.status,
    statusLabel: statusLabel(entry.status),
    timingSummary,
    targetSummary: entry.taskTarget?.taskId
      ? `Task ${entry.taskTarget.taskId}${entry.taskTarget.provider ? ` · ${entry.taskTarget.provider}` : ""}`
      : "Task rerun",
    scheduledAt,
  };
};

const buildAgentScheduleWindow = (): { from: string; to: string } => {
  const now = new Date();
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 7));
  const to = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 35, 23, 59, 59, 999));
  return { from: from.toISOString(), to: to.toISOString() };
};

const scheduleSortValue = (entry: AgentSchedulerSummaryEntry): number => {
  const time = entry.scheduledAt ? new Date(entry.scheduledAt).getTime() : Number.POSITIVE_INFINITY;
  return Number.isFinite(time) ? time : Number.POSITIVE_INFINITY;
};

export const fetchActiveAgentSchedulerEntries = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<AgentSchedulerSummaryEntry[]> => {
  const window = buildAgentScheduleWindow();
  const schedule = await fetchProjectSchedule(projectId, window.from, window.to, signal);
  return schedule.entries
    .filter(isActiveAgentSchedulerEntry)
    .map(toAgentSchedulerSummaryEntry)
    .sort((left, right) => scheduleSortValue(left) - scheduleSortValue(right) || left.title.localeCompare(right.title));
};

export const createSchedulerEntry = async (
  projectId: string,
  input: CreateSchedulerEntryInput,
): Promise<SchedulerEntryRecord> => {
  return fetchJson<SchedulerEntryRecord>(`/api/projects/${encodeURIComponent(projectId)}/scheduler`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const updateSchedulerEntry = async (
  entryId: string,
  input: UpdateSchedulerEntryInput,
): Promise<SchedulerEntryRecord> => {
  return fetchJson<SchedulerEntryRecord>(`/api/scheduler/${encodeURIComponent(entryId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
};

export const deleteSchedulerEntry = async (entryId: string): Promise<void> => {
  await fetchJson<{ ok: boolean }>(`/api/scheduler/${encodeURIComponent(entryId)}`, {
    method: "DELETE",
  });
};

export const fetchMemoryRemediationSchedule = async (
  projectId: string,
  signal?: AbortSignal,
): Promise<MemoryRemediationScheduleResponse> => {
  return fetchJson<MemoryRemediationScheduleResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/scheduler/memory-remediation`,
    { signal },
  );
};

export const saveMemoryRemediationSchedule = async (
  projectId: string,
  input: MemoryRemediationScheduleSettings,
): Promise<MemoryRemediationScheduleResponse> => {
  return fetchJson<MemoryRemediationScheduleResponse>(
    `/api/projects/${encodeURIComponent(projectId)}/scheduler/memory-remediation`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
};
