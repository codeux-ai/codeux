import type { ProjectAttentionItemRecord } from "../contracts/project-attention-types.js";
import {
  WORKER_CLARIFICATION_PAYLOAD_TYPE,
  WORKER_CLARIFICATION_PAYLOAD_VERSION,
  type CreateWorkerClarificationInput,
  type ListWorkerClarificationsOptions,
  type ReplyToWorkerClarificationInput,
  type ResolveWorkerClarificationInput,
  type WorkerClarificationPayload,
  type WorkerClarificationRecord,
  type WorkerClarificationStatus,
} from "../contracts/worker-clarification-types.js";
import { ConcurrencyConflictError, ValidationError } from "./repository-utils.js";
import { ProjectAttentionRepository } from "./project-attention-repository.js";

export interface PersistWorkerClarificationInput extends CreateWorkerClarificationInput {
  requestedAt: string;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parsePayload(item: ProjectAttentionItemRecord): WorkerClarificationPayload | null {
  const payload = item.payload;
  if (
    item.attentionType !== "worker_clarification"
    || item.ownerType !== "human"
    || payload?.type !== WORKER_CLARIFICATION_PAYLOAD_TYPE
    || payload.schemaVersion !== WORKER_CLARIFICATION_PAYLOAD_VERSION
    || typeof payload.deduplicationKey !== "string"
    || typeof payload.requesterAgentId !== "string"
    || typeof payload.questionMarkdown !== "string"
    || typeof payload.requestedAt !== "string"
    || !["pending", "replied", "expired", "cancelled"].includes(String(payload.status))
  ) {
    return null;
  }
  return payload as unknown as WorkerClarificationPayload;
}

function mapItem(item: ProjectAttentionItemRecord): WorkerClarificationRecord | null {
  const payload = parsePayload(item);
  if (!payload) return null;
  return {
    id: item.id,
    projectId: item.projectId,
    taskId: item.taskId,
    sprintId: item.sprintId,
    sprintRunId: item.sprintRunId,
    dispatchId: item.dispatchId,
    taskRunId: optionalString(payload.taskRunId),
    sessionId: optionalString(payload.sessionId),
    executionInvocationId: optionalString(payload.executionInvocationId),
    requesterAgentId: payload.requesterAgentId,
    deduplicationKey: payload.deduplicationKey,
    status: payload.status,
    questionMarkdown: payload.questionMarkdown,
    answerMarkdown: optionalString(payload.answerMarkdown),
    requestedAt: payload.requestedAt,
    repliedAt: optionalString(payload.repliedAt),
    expiredAt: optionalString(payload.expiredAt),
    cancelledAt: optionalString(payload.cancelledAt),
    resolvedAt: item.resolvedAt,
    updatedAt: item.updatedAt,
    repliedByAgentId: optionalString(payload.repliedByAgentId),
    resolvedByAgentId: optionalString(payload.resolvedByAgentId),
    resolutionReason: optionalString(payload.resolutionReason),
  };
}

function isSameRequest(record: WorkerClarificationRecord, input: PersistWorkerClarificationInput): boolean {
  return record.taskId === (input.taskId ?? null)
    && record.sprintId === (input.sprintId ?? null)
    && record.sprintRunId === (input.sprintRunId ?? null)
    && record.dispatchId === (input.dispatchId ?? null)
    && record.taskRunId === (input.taskRunId ?? null)
    && record.sessionId === (input.sessionId ?? null)
    && record.executionInvocationId === (input.executionInvocationId ?? null)
    && record.requesterAgentId === input.requesterAgentId
    && record.questionMarkdown === input.questionMarkdown;
}

export class WorkerClarificationRepository {
  constructor(private readonly attentionRepository: ProjectAttentionRepository) {}

  create(input: PersistWorkerClarificationInput): WorkerClarificationRecord {
    const existingItem = this.attentionRepository.getAttentionItemByDeduplicationKey(
      input.projectId,
      "worker_clarification",
      input.deduplicationKey,
    );
    const existing = existingItem ? mapItem(existingItem) : null;
    if (existing) {
      if (!isSameRequest(existing, input)) {
        throw new ValidationError(`Clarification deduplication key ${input.deduplicationKey} is already used by a different request.`);
      }
      return existing;
    }

    const payload: WorkerClarificationPayload = {
      type: WORKER_CLARIFICATION_PAYLOAD_TYPE,
      schemaVersion: WORKER_CLARIFICATION_PAYLOAD_VERSION,
      deduplicationKey: input.deduplicationKey,
      status: "pending",
      taskRunId: input.taskRunId ?? null,
      sessionId: input.sessionId ?? null,
      executionInvocationId: input.executionInvocationId ?? null,
      requesterAgentId: input.requesterAgentId,
      questionMarkdown: input.questionMarkdown,
      answerMarkdown: null,
      requestedAt: input.requestedAt,
      repliedAt: null,
      expiredAt: null,
      cancelledAt: null,
      repliedByAgentId: null,
      resolvedByAgentId: null,
      resolutionReason: null,
    };
    const item = this.attentionRepository.openOrRefreshItem({
      projectId: input.projectId,
      taskId: input.taskId ?? null,
      sprintId: input.sprintId ?? null,
      sprintRunId: input.sprintRunId ?? null,
      dispatchId: input.dispatchId ?? null,
      attentionType: "worker_clarification",
      severity: "high",
      ownerType: "human",
      title: "Worker clarification requested",
      summaryMarkdown: input.questionMarkdown,
      payload: payload as unknown as Record<string, unknown>,
      deduplicationKey: input.deduplicationKey,
      refreshOnDuplicate: false,
    });
    const created = this.requireMapped(item);
    if (!isSameRequest(created, input)) {
      throw new ValidationError(`Clarification deduplication key ${input.deduplicationKey} is already used by a different request.`);
    }
    return created;
  }

  list(projectId: string, options: ListWorkerClarificationsOptions = {}): WorkerClarificationRecord[] {
    const requestedStatuses = new Set(options.statuses ?? []);
    const limit = Math.min(200, Math.max(1, options.limit ?? 50));
    return this.attentionRepository.listProjectAttentionItems(projectId, { limit: 1_000 })
      .map(mapItem)
      .filter((record): record is WorkerClarificationRecord => Boolean(record))
      .filter((record) => requestedStatuses.size === 0 || requestedStatuses.has(record.status))
      .slice(0, limit);
  }

  get(projectId: string, clarificationId: string): WorkerClarificationRecord | null {
    const item = this.attentionRepository.getAttentionItem(clarificationId);
    if (!item || item.projectId !== projectId) return null;
    return mapItem(item);
  }

  markReplied(
    projectId: string,
    clarificationId: string,
    input: ReplyToWorkerClarificationInput & { repliedAt: string },
  ): WorkerClarificationRecord {
    const current = this.require(projectId, clarificationId);
    if (current.status !== "pending") {
      throw new ConcurrencyConflictError(`Clarification ${clarificationId} has already been resolved.`);
    }
    const result = this.attentionRepository.resolveAttentionItemIfActive(clarificationId, {
      status: "resolved",
      reason: "worker_clarification_replied",
      payloadPatch: {
        status: "replied",
        answerMarkdown: input.answerMarkdown,
        repliedAt: input.repliedAt,
        repliedByAgentId: input.repliedByAgentId,
      },
    });
    if (!result.transitioned) {
      throw new ConcurrencyConflictError(`Clarification ${clarificationId} has already been resolved.`);
    }
    return this.requireMapped(result.item);
  }

  resolve(
    projectId: string,
    clarificationId: string,
    input: ResolveWorkerClarificationInput & { resolvedAt: string },
  ): WorkerClarificationRecord {
    const current = this.require(projectId, clarificationId);
    if (current.status !== "pending") return current;
    const timestampPatch = input.status === "expired"
      ? { expiredAt: input.resolvedAt }
      : { cancelledAt: input.resolvedAt };
    const result = this.attentionRepository.resolveAttentionItemIfActive(clarificationId, {
      status: input.status === "expired" ? "expired" : "resolved",
      reason: input.reason ?? `worker_clarification_${input.status}`,
      payloadPatch: {
        status: input.status,
        resolvedByAgentId: input.resolvedByAgentId,
        resolutionReason: input.reason ?? null,
        ...timestampPatch,
      },
    });
    return this.requireMapped(result.item);
  }

  private require(projectId: string, clarificationId: string): WorkerClarificationRecord {
    const record = this.get(projectId, clarificationId);
    if (!record) throw new Error(`Worker clarification not found: ${clarificationId}`);
    return record;
  }

  private requireMapped(item: ProjectAttentionItemRecord): WorkerClarificationRecord {
    const record = mapItem(item);
    if (!record) throw new Error(`Attention item ${item.id} is not a valid worker clarification.`);
    return record;
  }
}
