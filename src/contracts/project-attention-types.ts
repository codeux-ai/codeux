export type ProjectAttentionType =
  | "worker_lease_expired"
  | "worker_dispatch_blocked"
  | "dispatch_cancel_stalled"
  | "merge_required"
  | "action_required"
  | "manual_attention"
  | "dashboard_reply_required"
  | "human_escalation_required";

export type ProjectAttentionSeverity = "low" | "medium" | "high" | "critical";
export type ProjectAttentionOwnerType = "worker" | "human" | "system";
export type ProjectAttentionStatus = "open" | "claimed" | "resolved" | "dismissed" | "expired";
export type WorkerAttentionOutcome = "handled_locally" | "needs_dashboard_reply" | "needs_human_escalation";

export interface ProjectAttentionItemRecord {
  id: string;
  projectId: string;
  sprintId: string | null;
  taskId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  attentionType: ProjectAttentionType;
  severity: ProjectAttentionSeverity;
  ownerType: ProjectAttentionOwnerType;
  status: ProjectAttentionStatus;
  assignedWorkerEndpointId: string | null;
  title: string;
  summaryMarkdown: string;
  payload: Record<string, unknown> | null;
  openedAt: string;
  claimedAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
}
