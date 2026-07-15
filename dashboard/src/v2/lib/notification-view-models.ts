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
import { translateDashboardMessage, type DashboardLocale, type DashboardTextMessageKey } from "../i18n/locales.js";
import { shellMessages } from "../i18n/messages/shell.js";

export type NotificationSeverity = "critical" | "warning" | "success" | "info";

export type NotificationType =
  | "intervention"
  | "task-failure"
  | "sprint-failure"
  | "automatic-stop"
  | "system-error";

export interface NotificationDetail {
  kind?: "project" | "sprint" | "task" | "summary" | "reason" | "instructions" | "timestamp" | "source";
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
  actionKey: DashboardTextMessageKey<typeof shellMessages>;
}> = {
  human_intervention: { type: "intervention", icon: HelpCircle, actionKey: "notificationActionReviewIntervention" },
  task_execution_failed: { type: "task-failure", icon: AlertTriangle, actionKey: "notificationActionReviewTask" },
  sprint_execution_failed: { type: "sprint-failure", icon: AlertTriangle, actionKey: "notificationActionReviewSprint" },
  sprint_automatically_stopped: { type: "automatic-stop", icon: CircleStop, actionKey: "notificationActionReviewStop" },
  system_execution_error: { type: "system-error", icon: ServerCrash, actionKey: "notificationActionReviewError" },
};

const toSeverity = (record: DashboardNotificationRecord): NotificationSeverity => {
  if (record.kind === "human_intervention") {
    return record.severity === "critical" ? "critical" : "warning";
  }
  if (record.kind === "sprint_automatically_stopped") return "warning";
  return "critical";
};

const relativeTime = (timestamp: string, now: number, locale: DashboardLocale): string => {
  const text = (key: DashboardTextMessageKey<typeof shellMessages>, variables?: Record<string, string | number>): string => (
    translateDashboardMessage(shellMessages, locale, key, variables)
  );
  const parsed = new Date(timestamp).getTime();
  if (!Number.isFinite(parsed)) return text("justNow");
  const elapsedMinutes = Math.floor(Math.max(0, now - parsed) / 60_000);
  if (elapsedMinutes < 1) return text("justNow");
  if (elapsedMinutes < 60) return text("minutesAgo", { count: elapsedMinutes });
  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) return text("hoursAgo", { count: elapsedHours });
  return text("daysAgo", { count: Math.floor(elapsedHours / 24) });
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

const sourceContext = (record: DashboardNotificationRecord, locale: DashboardLocale): string => {
  const sourceKeys: Record<DashboardNotificationRecord["source"]["type"], DashboardTextMessageKey<typeof shellMessages>> = {
    attention_item: "notificationSourceAttention",
    task_dispatch: "notificationSourceDispatch",
    sprint_run: "notificationSourceSprintRun",
    task_run_event: "notificationSourceTaskEvent",
    sprint_run_event: "notificationSourceSprintEvent",
  };
  const event = record.source.eventType
    ? ` · ${record.source.eventType.replace(/[_-]+/g, " ")}`
    : "";
  return `${translateDashboardMessage(shellMessages, locale, sourceKeys[record.source.type])}${event} · ${translateDashboardMessage(shellMessages, locale, "notificationSource", { id: record.source.id })}`;
};

export const toNotificationViewModel = (
  record: DashboardNotificationRecord,
  now: number = Date.now(),
  locale: DashboardLocale = "en",
): Omit<NotificationViewModel, "unread"> => {
  const presentation = KIND_PRESENTATION[record.kind];
  const text = (key: DashboardTextMessageKey<typeof shellMessages>): string => translateDashboardMessage(shellMessages, locale, key);
  const sprint = sprintLabel(record);
  const task = taskLabel(record);
  const context = [
    task ? `${text("notificationTask")} ${task}` : null,
    sprint ? `${text("notificationSprint")} ${sprint}` : null,
    `${text("notificationProject")} ${record.projectName}`,
  ].filter((part): part is string => Boolean(part)).join(" · ");
  const details: NotificationDetail[] = [
    { kind: "project", label: text("notificationProject"), value: record.projectName },
    ...(sprint ? [{ kind: "sprint" as const, label: text("notificationSprint"), value: sprint }] : []),
    ...(task ? [{ kind: "task" as const, label: text("notificationTask"), value: task }] : []),
    { kind: "summary", label: text("notificationWhatWentWrong"), value: record.summary },
    { kind: "reason", label: text("notificationWhyAttention"), value: record.reason },
    { kind: "instructions", label: text("notificationRecommendedSteps"), value: record.instructions },
    { kind: "timestamp", label: text("notificationTimestamp"), value: record.updatedAt },
    { kind: "source", label: text("notificationSourceContext"), value: sourceContext(record, locale) },
  ];

  return {
    id: `${record.id}@${record.updatedAt}`,
    sourceId: record.id,
    type: presentation.type,
    severity: toSeverity(record),
    title: record.title,
    body: `${context} — ${record.summary}`,
    subtitle: context,
    time: relativeTime(record.updatedAt, now, locale),
    updatedAt: record.updatedAt,
    dismissible: true,
    icon: presentation.icon,
    iconColor: record.kind === "human_intervention" ? "text-status-amber" : undefined,
    actionLabel: text(presentation.actionKey),
    actionHref: actionTarget(record),
    details,
  };
};
