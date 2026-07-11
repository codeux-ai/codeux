import {
  AlertTriangle,
  CircleStop,
  HelpCircle,
  ServerCrash,
  type LucideIcon,
} from "lucide-preact";
import type {
  DashboardNotification as DashboardNotificationRecord,
  DashboardNotificationKind,
} from "../../types.js";

export type NotificationSeverity = "critical" | "warning" | "success" | "info";

export type NotificationType =
  | "intervention"
  | "task-failure"
  | "sprint-failure"
  | "automatic-stop"
  | "system-error";

export interface NotificationDetail {
  label: string;
  value: string;
}

export interface NotificationViewModel {
  id: string;
  sourceId?: string;
  type?: NotificationType;
  severity: NotificationSeverity;
  title: string;
  body?: string;
  subtitle?: string;
  time: string;
  updatedAt?: string;
  unread: boolean;
  dismissible: boolean;
  icon: LucideIcon;
  iconColor?: string;
  actionLabel?: string;
  actionHref?: string;
  onAction?: () => void;
  details?: NotificationDetail[];
}

const KIND_PRESENTATION: Record<DashboardNotificationKind, {
  type: NotificationType;
  icon: LucideIcon;
  actionLabel: string;
}> = {
  human_intervention: { type: "intervention", icon: HelpCircle, actionLabel: "Review intervention" },
  task_execution_failed: { type: "task-failure", icon: AlertTriangle, actionLabel: "Review task" },
  sprint_execution_failed: { type: "sprint-failure", icon: AlertTriangle, actionLabel: "Review sprint" },
  sprint_automatically_stopped: { type: "automatic-stop", icon: CircleStop, actionLabel: "Review stop" },
  system_execution_error: { type: "system-error", icon: ServerCrash, actionLabel: "Review error" },
};

const toSeverity = (record: DashboardNotificationRecord): NotificationSeverity => {
  if (record.kind === "human_intervention") {
    return record.severity === "critical" ? "critical" : "warning";
  }
  if (record.kind === "sprint_automatically_stopped") return "warning";
  return "critical";
};

const relativeTime = (timestamp: string, now: number): string => {
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return "just now";
  const elapsedMinutes = Math.floor(Math.max(0, now - parsed) / 60_000);
  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes}m ago`;
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours}h ago`;
  return `${Math.floor(elapsedHours / 24)}d ago`;
};

const sprintLabel = (record: DashboardNotificationRecord): string | null => {
  if (!record.sprintId) return null;
  const key = record.sprintNumber === null ? null : `SPR-${record.sprintNumber}`;
  if (key && record.sprintName) return `${key} (${record.sprintName})`;
  return key || record.sprintName || record.sprintId;
};

const taskLabel = (record: DashboardNotificationRecord): string | null => {
  if (!record.taskId) return null;
  if (record.taskKey && record.taskTitle) return `${record.taskKey} (${record.taskTitle})`;
  return record.taskKey || record.taskTitle || record.taskId;
};

const actionTarget = (record: DashboardNotificationRecord): string => {
  // These links are server-owned route metadata. Choose the most specific
  // available destination without rebuilding or normalizing its query string.
  if (record.taskId && record.links.task) return record.links.task;
  if (record.sprintId && record.source.sprintRunId && record.links.live) return record.links.live;
  if (record.sprintId && record.links.sprint) return record.links.sprint;
  return record.links.project;
};

const sourceContext = (record: DashboardNotificationRecord): string => {
  const sourceLabels: Record<DashboardNotificationRecord["source"]["type"], string> = {
    attention_item: "Project attention item",
    task_dispatch: "Task dispatch",
    sprint_run: "Sprint run",
    task_run_event: "Task run event",
    sprint_run_event: "Sprint run event",
  };
  const event = record.source.eventType
    ? ` · ${record.source.eventType.replace(/[_-]+/g, " ")}`
    : "";
  return `${sourceLabels[record.source.type]}${event} · Source ${record.source.id}`;
};

export const toNotificationViewModel = (
  record: DashboardNotificationRecord,
  now: number = Date.now(),
): Omit<NotificationViewModel, "unread"> => {
  const presentation = KIND_PRESENTATION[record.kind];
  const sprint = sprintLabel(record);
  const task = taskLabel(record);
  const context = [
    task ? `Task ${task}` : null,
    sprint ? `Sprint ${sprint}` : null,
    `Project ${record.projectName}`,
  ].filter((part): part is string => Boolean(part)).join(" · ");
  const details: NotificationDetail[] = [
    { label: "Project", value: record.projectName },
    ...(sprint ? [{ label: "Sprint", value: sprint }] : []),
    ...(task ? [{ label: "Task", value: task }] : []),
    { label: "What went wrong", value: record.summary },
    { label: "Why this needs attention", value: record.reason },
    { label: "Recommended next steps", value: record.instructions },
    { label: "Timestamp", value: record.updatedAt },
    { label: "Source context", value: sourceContext(record) },
  ];

  return {
    id: `${record.id}@${record.updatedAt}`,
    sourceId: record.id,
    type: presentation.type,
    severity: toSeverity(record),
    title: record.title,
    body: `${context} — ${record.summary}`,
    subtitle: context,
    time: relativeTime(record.updatedAt, now),
    updatedAt: record.updatedAt,
    dismissible: true,
    icon: presentation.icon,
    iconColor: record.kind === "human_intervention" ? "text-status-amber" : undefined,
    actionLabel: presentation.actionLabel,
    actionHref: actionTarget(record),
    details,
  };
};
