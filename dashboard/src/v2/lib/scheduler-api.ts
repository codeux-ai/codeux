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
import { createDashboardFormatters } from "../i18n/formatters.js";
import {
  resolveDashboardLocale,
  translateDashboardMessage,
  type DashboardLocale,
} from "../i18n/locales.js";
import { schedulerMessages } from "../i18n/messages/scheduler.js";

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

const activePresentationLocale = (): DashboardLocale => resolveDashboardLocale(
  typeof document === "undefined" ? undefined : document.documentElement.lang,
);

const scheduleAnchorOffsetLabel = (offsetMinutes: number | undefined, locale: DashboardLocale): string => {
  const offset = Math.max(0, Math.floor(Number(offsetMinutes ?? 0)));
  if (offset === 0) {
    return "";
  }
  return translateDashboardMessage(
    schedulerMessages,
    locale,
    offset === 1 ? "offsetOneMinute" : "offsetManyMinutes",
    { count: offset },
  );
};

export const formatScheduleDateTime = (
  iso: string | null | undefined,
  locale: DashboardLocale = activePresentationLocale(),
  timeZone?: string,
): string => {
  if (!iso) {
    return translateDashboardMessage(schedulerMessages, locale, "noScheduledTime");
  }
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return translateDashboardMessage(schedulerMessages, locale, "noScheduledTime");
  }
  return createDashboardFormatters(locale).formatDate(date, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(timeZone ? { timeZone } : {}),
  });
};

const statusLabel = (status: ScheduleStatus, locale: DashboardLocale): string => {
  const key = {
    scheduled: "statusScheduled",
    paused: "statusPaused",
    completed: "statusCompleted",
    failed: "statusFailed",
    cancelled: "statusCancelled",
  } as const;
  return translateDashboardMessage(schedulerMessages, locale, key[status]);
};

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
}, locale: DashboardLocale = activePresentationLocale()): AgentSchedulerSummaryEntry => {
  const scheduledAt = entry.nextRunAt ?? entry.scheduledFor ?? null;
  const offset = scheduleAnchorOffsetLabel(entry.scheduleAnchor?.offsetMinutes, locale);
  const timingSummary = entry.scheduleAnchor?.mode === "after_sprint_end"
    ? translateDashboardMessage(schedulerMessages, locale, "anchorAfterSourceSprint", {
      sprintId: entry.scheduleAnchor.sourceSprintId,
      offset,
    })
    : entry.scheduleAnchor?.mode === "after_task_end"
      ? translateDashboardMessage(schedulerMessages, locale, "anchorAfterSourceTask", {
        taskId: entry.scheduleAnchor.sourceTaskId,
        offset,
      })
      : translateDashboardMessage(schedulerMessages, locale, "scheduledFor", {
        date: formatScheduleDateTime(scheduledAt, locale, entry.timezone),
      });

  if (entry.targetType === "agent_wakeup") {
    return {
      id: entry.id,
      targetType: entry.targetType,
      label: translateDashboardMessage(schedulerMessages, locale, "targetAgentWakeup"),
      title: entry.title || entry.agentWakeupTarget?.title || translateDashboardMessage(schedulerMessages, locale, "targetAgentWakeup"),
      status: entry.status,
      statusLabel: statusLabel(entry.status, locale),
      timingSummary,
      targetSummary: entry.agentWakeupTarget?.threadId
        ? translateDashboardMessage(schedulerMessages, locale, "threadSummary", { threadId: entry.agentWakeupTarget.threadId })
        : translateDashboardMessage(schedulerMessages, locale, "projectChatWakeup"),
      scheduledAt,
    };
  }

  return {
    id: entry.id,
    targetType: entry.targetType,
    label: translateDashboardMessage(schedulerMessages, locale, "taskRun"),
    title: entry.title || translateDashboardMessage(schedulerMessages, locale, "scheduledTaskRun"),
    status: entry.status,
    statusLabel: statusLabel(entry.status, locale),
    timingSummary,
    targetSummary: entry.taskTarget?.taskId
      ? translateDashboardMessage(schedulerMessages, locale, "taskSummary", {
        taskId: entry.taskTarget.taskId,
        provider: entry.taskTarget.provider ? ` · ${entry.taskTarget.provider}` : "",
      })
      : translateDashboardMessage(schedulerMessages, locale, "taskRerun"),
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
  locale: DashboardLocale = activePresentationLocale(),
): Promise<AgentSchedulerSummaryEntry[]> => {
  const window = buildAgentScheduleWindow();
  const schedule = await fetchProjectSchedule(projectId, window.from, window.to, signal);
  return schedule.entries
    .filter(isActiveAgentSchedulerEntry)
    .map((entry) => toAgentSchedulerSummaryEntry(entry, locale))
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
