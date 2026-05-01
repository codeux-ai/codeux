import { AlertCircle, CheckCircle2, Circle, CircleDashed, Clock, PlayCircle } from "lucide-preact";
import type { FunctionComponent } from "preact";

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

export function getStatusConfig(status?: string): StatusConfig {
  if (!status) return TASK_STATUS_CONFIG.pending;
  return TASK_STATUS_CONFIG[status] || TASK_STATUS_CONFIG.pending;
}
