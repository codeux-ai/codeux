import { AlertCircle, CheckCircle2, Circle, CircleDashed, Clock, PlayCircle } from "lucide-preact";
import type { FunctionComponent } from "preact";
import type { DashboardLocale } from "../i18n/locales.js";
import { translateDashboardMessage } from "../i18n/locales.js";
import { shellMessages } from "../i18n/messages/shell.js";

export type StatusVariant = "default" | "success" | "warning" | "danger" | "muted";

export interface StatusConfig {
  label: string;
  variant: StatusVariant;
  icon: FunctionComponent<any>;
}

export const TASK_STATUS_CONFIG: Record<string, StatusConfig> = {
  pending: {
    label: "Pending",
    variant: "muted",
    icon: CircleDashed,
  },
  in_progress: {
    label: "In Progress",
    variant: "warning",
    icon: PlayCircle,
  },
  coding_completed: {
    label: "Coding Done",
    variant: "default",
    icon: Circle,
  },
  completed: {
    label: "Completed",
    variant: "success",
    icon: CheckCircle2,
  },
  QA_REVIEW_FAILED: {
    label: "QA Failed",
    variant: "danger",
    icon: AlertCircle,
  },
};

const STATUS_MESSAGE_KEYS = {
  pending: "taskPending", in_progress: "taskInProgress", coding_completed: "taskCodingDone",
  completed: "taskCompleted", QA_REVIEW_FAILED: "taskQaFailed",
} as const;

export function getStatusConfig(status?: string, locale: DashboardLocale = "en"): StatusConfig {
  if (!status) return { ...TASK_STATUS_CONFIG.pending, label: translateDashboardMessage(shellMessages, locale, "taskPending") };
  const lower = status.toLowerCase();
  if (lower.startsWith("pending_cap_")) {
    const match = status.match(/^PENDING_cap_(\d+)_(\d+)$/i);
    if (match) {
      return {
        label: translateDashboardMessage(shellMessages, locale, "taskWaitingSlot", { current: match[1], total: match[2] }),
        variant: "muted",
        icon: CircleDashed,
      };
    }
  }
  const config = TASK_STATUS_CONFIG[status] || TASK_STATUS_CONFIG.pending;
  const key = STATUS_MESSAGE_KEYS[status as keyof typeof STATUS_MESSAGE_KEYS] ?? "taskPending";
  return { ...config, label: translateDashboardMessage(shellMessages, locale, key) };
}
