import type {
  ProjectAttentionOwnerType,
  ProjectAttentionSeverity,
  ProjectAttentionStatus,
} from "./project-attention-types.js";

export type DashboardNotificationKind =
  | "human_intervention"
  | "task_execution_failed"
  | "sprint_execution_failed"
  | "sprint_automatically_stopped"
  | "system_execution_error";

export type DashboardNotificationSeverity = ProjectAttentionSeverity;

export type DashboardNotificationSourceType =
  | "attention_item"
  | "task_dispatch"
  | "sprint_run"
  | "task_run_event"
  | "sprint_run_event";

export interface DashboardNotificationSource {
  type: DashboardNotificationSourceType;
  id: string;
  eventType: string | null;
  sprintRunId: string | null;
  taskRunId: string | null;
  dispatchId: string | null;
  attentionOwnerType: ProjectAttentionOwnerType | null;
  attentionStatus: Extract<ProjectAttentionStatus, "open" | "claimed"> | null;
}

export interface DashboardNotificationLinks {
  project: string;
  sprint: string | null;
  task: string | null;
  live: string | null;
}

export interface DashboardNotification {
  id: string;
  kind: DashboardNotificationKind;
  severity: DashboardNotificationSeverity;
  title: string;
  summary: string;
  reason: string;
  instructions: string;
  projectId: string;
  projectName: string;
  sprintId: string | null;
  sprintName: string | null;
  sprintNumber: number | null;
  taskId: string | null;
  taskKey: string | null;
  taskTitle: string | null;
  attentionItemId: string | null;
  createdAt: string;
  updatedAt: string;
  source: DashboardNotificationSource;
  links: DashboardNotificationLinks;
}

export interface DashboardNotificationFeed {
  notifications: DashboardNotification[];
  updatedAt: string | null;
}
