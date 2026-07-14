export type ProjectAttentionType =
  | "worker_lease_expired"
  | "worker_dispatch_blocked"
  | "dispatch_cancel_stalled"
  | "merge_required"
  | "merge_conflict"
  | "action_required"
  | "manual_attention"
  | "dashboard_reply_required"
  | "human_escalation_required"
  | "ci_fix_required"
  | "worker_clarification";

export type ProjectAttentionSeverity = "low" | "medium" | "high" | "critical";
export type ProjectAttentionOwnerType = "worker" | "human" | "system";
export type ProjectAttentionStatus = "open" | "claimed" | "resolved" | "dismissed" | "expired";
export type WorkerAttentionOutcome = "handled_locally" | "needs_dashboard_reply" | "needs_human_escalation";

export type RepairPublicationPhase =
  | "pending"
  | "workspace_finalized"
  | "host_publishing"
  | "host_published";

export interface RepairAttentionRuntimeState {
  purpose: "ci_fix" | "merge_conflict";
  sessionId: string;
  workspaceSessionId: string;
  provider: string;
  providerConfigId: string;
  model: string;
  nativeSessionId: string | null;
  activeAttemptId: string | null;
  attemptRecorded: boolean;
  phase: "claimed" | "workspace_ready" | "provider_running" | "interrupted";
  workspaceBaselineHead: string | null;
  workspaceRepairHead: string | null;
  publicationPhase: RepairPublicationPhase;
  publishedHeadSha: string | null;
  updatedAt: string;
}

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
