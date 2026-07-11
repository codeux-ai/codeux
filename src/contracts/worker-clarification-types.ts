export const WORKER_CLARIFICATION_PAYLOAD_TYPE = "worker_clarification" as const;
export const WORKER_CLARIFICATION_PAYLOAD_VERSION = 1 as const;

export type WorkerClarificationStatus = "pending" | "replied" | "expired" | "cancelled";

export interface WorkerClarificationPayload {
  type: typeof WORKER_CLARIFICATION_PAYLOAD_TYPE;
  schemaVersion: typeof WORKER_CLARIFICATION_PAYLOAD_VERSION;
  deduplicationKey: string;
  status: WorkerClarificationStatus;
  taskRunId: string | null;
  sessionId: string | null;
  requesterAgentId: string;
  questionMarkdown: string;
  answerMarkdown: string | null;
  requestedAt: string;
  repliedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  repliedByAgentId: string | null;
  resolvedByAgentId: string | null;
  resolutionReason: string | null;
}

export interface WorkerClarificationRecord {
  id: string;
  projectId: string;
  taskId: string | null;
  sprintId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  taskRunId: string | null;
  sessionId: string | null;
  requesterAgentId: string;
  deduplicationKey: string;
  status: WorkerClarificationStatus;
  questionMarkdown: string;
  answerMarkdown: string | null;
  requestedAt: string;
  repliedAt: string | null;
  expiredAt: string | null;
  cancelledAt: string | null;
  resolvedAt: string | null;
  updatedAt: string;
  repliedByAgentId: string | null;
  resolvedByAgentId: string | null;
  resolutionReason: string | null;
}

export interface CreateWorkerClarificationInput {
  projectId: string;
  taskId?: string | null;
  sprintId?: string | null;
  sprintRunId?: string | null;
  dispatchId?: string | null;
  taskRunId?: string | null;
  sessionId?: string | null;
  requesterAgentId: string;
  deduplicationKey: string;
  questionMarkdown: string;
}

export interface ListWorkerClarificationsOptions {
  statuses?: WorkerClarificationStatus[];
  limit?: number;
}

export interface ReplyToWorkerClarificationInput {
  answerMarkdown: string;
  repliedByAgentId: string;
}

export interface ResolveWorkerClarificationInput {
  status: "expired" | "cancelled";
  resolvedByAgentId: string;
  reason?: string;
}

/** Provider/session continuation is deliberately performed by a later integration task. */
export interface WorkerClarificationContinuationRequest {
  kind: "worker_clarification_reply";
  clarificationId: string;
  projectId: string;
  taskId: string | null;
  sprintId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  taskRunId: string | null;
  sessionId: string | null;
  requesterAgentId: string;
  repliedByAgentId: string;
  answerMarkdown: string;
}

export interface WorkerClarificationReplyResult {
  clarification: WorkerClarificationRecord;
  continuation: WorkerClarificationContinuationRequest;
}

export interface WorkerClarificationEventMetadata {
  clarificationId: string;
  attentionItemId: string;
  projectId: string;
  sprintId: string | null;
  taskId: string | null;
  sprintRunId: string | null;
  dispatchId: string | null;
  taskRunId: string | null;
  sessionId: string | null;
  requesterAgentId: string;
  status: WorkerClarificationStatus;
}
