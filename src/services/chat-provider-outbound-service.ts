import type {
  ChatProviderChannelBindingRecord,
  ChatProviderMessageDeliveryRecord,
} from "../contracts/chat-provider-types.js";
import type {
  ConversationMessageRecord,
  ConversationThreadRecord,
} from "../contracts/connection-chat-types.js";
import type { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { generateCorrelationId, getCorrelationId } from "../shared/logging/correlation-id.js";
import { redactMetadata, redactText } from "../shared/security/redaction.js";
import {
  ChatProviderOutboundAdapterError,
  createDefaultChatProviderOutboundAdapter,
  type ChatProviderOutboundAdapter,
  type ChatProviderOutboundBridgePayload,
} from "./chat-provider-adapters.js";
import { stripDashboardOnlyWidgets } from "./chat-reply-prompt.js";
import type { ChatProviderSecretService } from "./chat-provider-secret-service.js";
import { randomUUID } from "node:crypto";
import type { ChatConnectorRegistry } from "../domain/chat-connectors/registry.js";

export interface DeliverChatProviderReplyInput {
  projectId: string;
  thread: ConversationThreadRecord;
  triggeringMessage: ConversationMessageRecord;
  replyMessage: ConversationMessageRecord;
}

interface ChatProviderOutboundServiceDependencies {
  chatProviderRepository: ChatProviderRepository;
  chatProviderSecretService?: ChatProviderSecretService;
  adapter?: ChatProviderOutboundAdapter;
  logger?: Logger;
  pollIntervalMs?: number;
  initialBackoffMs?: number;
  maxAttempts?: number;
  maxBackoffMs?: number;
  jitterRatio?: number;
  random?: () => number;
  leaseDurationMs?: number;
  now?: () => Date;
  connectorRegistry?: ChatConnectorRegistry;
}

interface RetryMetadata {
  retryable: boolean;
  nextAttemptAt: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_INITIAL_BACKOFF_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_LEASE_DURATION_MS = 60_000;
const DEFAULT_MAX_BACKOFF_MS = 15 * 60_000;
const DEFAULT_JITTER_RATIO = 0.2;

export class ChatProviderOutboundService {
  private readonly adapter: ChatProviderOutboundAdapter;
  private readonly pollIntervalMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxAttempts: number;
  private readonly maxBackoffMs: number;
  private readonly jitterRatio: number;
  private readonly random: () => number;
  private readonly leaseDurationMs: number;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private retryProcessingPromise: Promise<ChatProviderMessageDeliveryRecord[]> | null = null;
  private readonly leaseOwner = `chat-provider-outbound:${randomUUID()}`;
  private readonly inFlightControllers = new Map<string, AbortController>();
  private readonly inFlightAttempts = new Set<Promise<ChatProviderMessageDeliveryRecord>>();
  private started = false;
  private stopping = false;

  constructor(private readonly deps: ChatProviderOutboundServiceDependencies) {
    this.adapter = deps.adapter ?? createDefaultChatProviderOutboundAdapter(deps.connectorRegistry);
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.initialBackoffMs = deps.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.maxBackoffMs = deps.maxBackoffMs ?? DEFAULT_MAX_BACKOFF_MS;
    this.jitterRatio = deps.jitterRatio ?? DEFAULT_JITTER_RATIO;
    this.random = deps.random ?? Math.random;
    this.leaseDurationMs = deps.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    this.now = deps.now ?? (() => new Date());
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    this.timer = setInterval(() => {
      this.processDueRetries().catch((error) => {
        this.log("error", "Chat provider outbound retry loop failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
    await this.processDueRetries();
  }

  async stop(): Promise<void> {
    if (!this.started && !this.timer && this.inFlightAttempts.size === 0) return;
    this.started = false;
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const controller of this.inFlightControllers.values()) {
      controller.abort(new Error("Chat provider outbound service is stopping."));
    }
    await Promise.allSettled([...this.inFlightAttempts]);
  }

  async cancelDelivery(deliveryId: string): Promise<ChatProviderMessageDeliveryRecord> {
    const delivery = requireDelivery(this.deps.chatProviderRepository.getDelivery(deliveryId), deliveryId);
    if (delivery.direction !== "outbound") {
      throw new Error("Only outbound chat provider deliveries can be cancelled.");
    }
    if (delivery.status === "delivered" || delivery.status === "failed" || delivery.status === "cancelled") {
      return delivery;
    }
    const cancelled = this.deps.chatProviderRepository.updateDeliveryState(deliveryId, {
      status: "cancelled",
      lastError: "Cancelled manually.",
      nextAttemptAt: null,
    });
    this.inFlightControllers.get(deliveryId)?.abort(new Error("Outbound delivery cancelled manually."));
    this.log("info", "Cancelled chat provider outbound delivery", {
      providerConnectionId: delivery.providerConnectionId,
      providerKind: delivery.providerKind,
      channelBindingId: delivery.channelBindingId,
      deliveryId,
      outcome: "cancelled",
    });
    return cancelled;
  }

  async retryDelivery(deliveryId: string): Promise<ChatProviderMessageDeliveryRecord> {
    const delivery = requireDelivery(this.deps.chatProviderRepository.getDelivery(deliveryId), deliveryId);
    if (delivery.direction !== "outbound") {
      throw new Error("Only outbound chat provider deliveries can be retried.");
    }
    if (delivery.status === "delivered" || delivery.status === "sending") {
      throw new Error(`Chat provider delivery cannot be retried from status ${delivery.status}.`);
    }
    this.deps.chatProviderRepository.updateDeliveryState(deliveryId, {
      status: "pending",
      lastError: null,
      nextAttemptAt: null,
    });
    this.log("info", "Retrying chat provider outbound delivery manually", {
      providerConnectionId: delivery.providerConnectionId,
      providerKind: delivery.providerKind,
      channelBindingId: delivery.channelBindingId,
      deliveryId,
      outcome: "manual_retry",
    });
    return this.attemptDelivery(deliveryId);
  }

  async deliverReply(input: DeliverChatProviderReplyInput): Promise<ChatProviderMessageDeliveryRecord | null> {
    const inboundDeliveryId = getStringMetadata(input.triggeringMessage.metadata, "inboundDeliveryId");
    if (!inboundDeliveryId) {
      return null;
    }

    const inboundDelivery = this.deps.chatProviderRepository.getDelivery(inboundDeliveryId);
    if (!inboundDelivery || inboundDelivery.direction !== "inbound") {
      this.log("warn", "Skipped chat provider outbound delivery because inbound delivery was not found", {
        projectId: input.projectId,
        threadId: input.thread.id,
        conversationMessageId: input.replyMessage.id,
        inboundDeliveryId,
      });
      return null;
    }

    const binding = inboundDelivery.channelBindingId
      ? this.deps.chatProviderRepository.getChannelBinding(inboundDelivery.channelBindingId)
      : null;
    const payload = this.buildPayload(input, inboundDelivery);
    const pending = this.deps.chatProviderRepository.upsertOutboundDelivery({
      providerConnectionId: inboundDelivery.providerConnectionId,
      channelBindingId: inboundDelivery.channelBindingId,
      externalChannelId: inboundDelivery.externalChannelId,
      conversationThreadId: input.thread.id,
      conversationMessageId: input.replyMessage.id,
      externalMessageId: null,
      status: "pending",
      attemptCount: 0,
      lastError: null,
      nextAttemptAt: null,
      payload: {
        ...payload,
        delivery: {
          state: "pending",
          retryable: false,
          nextAttemptAt: null,
        },
      },
    });

    if (!binding) {
      return this.markTerminalFailure(pending, "Outbound channel binding was not found.", payload);
    }
    if (!binding.enabled || !binding.outboundEnabled) {
      return this.markTerminalFailure(pending, "Outbound delivery is disabled for this channel binding.", payload);
    }

    return this.attemptDelivery(pending.id);
  }

  async processDueRetries(limit = 100): Promise<ChatProviderMessageDeliveryRecord[]> {
    if (this.retryProcessingPromise) {
      return this.retryProcessingPromise;
    }
    let processingPromise: Promise<ChatProviderMessageDeliveryRecord[]>;
    processingPromise = this.processDueRetriesOnce(limit).finally(() => {
      if (this.retryProcessingPromise === processingPromise) {
        this.retryProcessingPromise = null;
      }
    });
    this.retryProcessingPromise = processingPromise;
    return processingPromise;
  }

  private async processDueRetriesOnce(limit: number): Promise<ChatProviderMessageDeliveryRecord[]> {
    if (this.stopping) return [];
    const due = this.deps.chatProviderRepository.claimOutboundDeliveries({
      leaseOwner: this.leaseOwner,
      leaseDurationMs: this.leaseDurationMs,
      limit,
      now: this.now(),
    });
    const results: ChatProviderMessageDeliveryRecord[] = [];
    for (const delivery of due) {
      if (this.stopping) {
        this.releaseAfterShutdown(delivery);
        continue;
      }
      results.push(await this.attemptDelivery(delivery.id, this.leaseOwner));
    }
    return results;
  }

  async attemptDelivery(deliveryId: string, leaseOwner?: string): Promise<ChatProviderMessageDeliveryRecord> {
    if (this.stopping) return requireDelivery(this.deps.chatProviderRepository.getDelivery(deliveryId), deliveryId);
    const owner = leaseOwner ?? this.leaseOwner;
    const repository = this.deps.chatProviderRepository as ChatProviderRepository & {
      claimOutboundDelivery?: ChatProviderRepository["claimOutboundDelivery"];
    };
    const usesLease = Boolean(leaseOwner || repository.claimOutboundDelivery);
    const delivery = leaseOwner
      ? requireDelivery(this.deps.chatProviderRepository.getDelivery(deliveryId), deliveryId)
      : repository.claimOutboundDelivery?.(deliveryId, {
          leaseOwner: owner,
          leaseDurationMs: this.leaseDurationMs,
          now: this.now(),
        }) ?? (!repository.claimOutboundDelivery
          ? requireDelivery(this.deps.chatProviderRepository.getDelivery(deliveryId), deliveryId)
          : null);
    if (!delivery) return requireDelivery(this.deps.chatProviderRepository.getDelivery(deliveryId), deliveryId);
    const controller = new AbortController();
    this.inFlightControllers.set(deliveryId, controller);
    let attemptPromise: Promise<ChatProviderMessageDeliveryRecord>;
    attemptPromise = this.attemptClaimedDelivery(delivery, usesLease ? owner : undefined, controller.signal).finally(() => {
      this.inFlightControllers.delete(deliveryId);
      this.inFlightAttempts.delete(attemptPromise);
    });
    this.inFlightAttempts.add(attemptPromise);
    return attemptPromise;
  }

  private async attemptClaimedDelivery(
    delivery: ChatProviderMessageDeliveryRecord,
    leaseOwner: string | undefined,
    signal: AbortSignal,
  ): Promise<ChatProviderMessageDeliveryRecord> {
    const connection = this.deps.chatProviderSecretService
      ? await this.deps.chatProviderSecretService.resolveConnection(delivery.providerConnectionId).catch(() => null)
      : this.deps.chatProviderRepository.getConnectionInternal(delivery.providerConnectionId);
    if (!connection || !connection.enabled || connection.status === "disabled") {
      return this.markTerminalFailure(delivery, "Chat provider connection is disabled or missing.", getPayload(delivery), leaseOwner);
    }
    const binding = delivery.channelBindingId
      ? this.deps.chatProviderRepository.getChannelBinding(delivery.channelBindingId)
      : null;
    if (!binding || !binding.enabled || !binding.outboundEnabled) {
      return this.markTerminalFailure(delivery, "Outbound channel binding is disabled or missing.", getPayload(delivery), leaseOwner);
    }
    const payload = normalizePayload(delivery, binding);
    const attemptCount = delivery.attemptCount + 1;
    const correlationId = getCorrelationId() ?? generateCorrelationId();
    const startedAt = this.now().getTime();

    this.log("info", "Attempting chat provider outbound delivery", {
      correlationId,
      providerConnectionId: connection.id,
      providerKind: connection.providerKind,
      channelBindingId: binding.id,
      externalChannelId: delivery.externalChannelId,
      deliveryId: delivery.id,
      conversationThreadId: delivery.conversationThreadId,
      conversationMessageId: delivery.conversationMessageId,
      attemptCount,
    });

    const sending = this.deps.chatProviderRepository.updateDeliveryState(delivery.id, {
      status: "sending",
      attemptCount,
      lastError: null,
      nextAttemptAt: null,
      payload: withDeliveryState(payload, {
        retryable: false,
        nextAttemptAt: null,
      }, "sending"),
    });

    try {
      const result = await this.adapter.send({
        connection,
        binding,
        delivery: sending,
        payload,
        correlationId,
        signal,
      });
      const completion = {
        status: "delivered",
        externalMessageId: result.externalMessageId ?? delivery.externalMessageId ?? null,
        lastError: null,
        nextAttemptAt: null,
        payload: {
          ...payload,
          bridgeResponse: result.responseMetadata ?? null,
          delivery: {
            state: "delivered",
            retryable: false,
            nextAttemptAt: null,
          },
        },
      } as const;
      const delivered = leaseOwner
        ? this.deps.chatProviderRepository.completeOutboundDelivery(delivery.id, leaseOwner, completion)
        : this.deps.chatProviderRepository.updateDeliveryState(delivery.id, completion);
      this.log("info", "Delivered chat provider outbound reply", {
        correlationId,
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        channelBindingId: binding.id,
        externalChannelId: delivery.externalChannelId,
        deliveryId: delivery.id,
        externalMessageId: delivered.externalMessageId,
        attemptCount: delivered.attemptCount,
        latencyMs: Math.max(0, this.now().getTime() - startedAt),
        outcome: "delivered",
      });
      return delivered;
    } catch (error) {
      const adapterError = normalizeAdapterError(error);
      const current = requireDelivery(this.deps.chatProviderRepository.getDelivery(delivery.id), delivery.id);
      if (current.status === "cancelled") return current;
      if (adapterError.outcome === "cancelled" && this.stopping) {
        return this.releaseAfterShutdown(current);
      }
      const retryable = adapterError.retryable && attemptCount < this.maxAttempts;
      const nextAttemptAt = retryable
        ? this.computeNextAttemptAt(attemptCount, adapterError.retryAfterMs).toISOString()
        : null;
      const completion = {
        status: retryable ? "retryable_failure" : "failed",
        attemptCount,
        lastError: adapterError.message,
        nextAttemptAt,
        payload: withDeliveryState(payload, { retryable, nextAttemptAt }, retryable ? "retryable_failure" : "failed"),
      } as const;
      const failed = leaseOwner
        ? this.deps.chatProviderRepository.completeOutboundDelivery(delivery.id, leaseOwner, completion)
        : this.deps.chatProviderRepository.updateDeliveryState(delivery.id, completion);
      this.log(retryable ? "warn" : "error", retryable
        ? "Chat provider outbound delivery failed and will retry"
        : "Chat provider outbound delivery failed permanently", {
        correlationId,
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        channelBindingId: binding.id,
        externalChannelId: delivery.externalChannelId,
        deliveryId: delivery.id,
        attemptCount,
        nextAttemptAt,
        retryAt: nextAttemptAt,
        latencyMs: Math.max(0, this.now().getTime() - startedAt),
        outcome: adapterError.outcome === "ambiguous" ? "ambiguous" : retryable ? "retry_scheduled" : "failed",
        providerErrorCode: adapterError.statusCode ? `http_${adapterError.statusCode}` : "transport_error",
      });
      return failed;
    }
  }

  private buildPayload(
    input: DeliverChatProviderReplyInput,
    inboundDelivery: ChatProviderMessageDeliveryRecord,
  ): ChatProviderOutboundBridgePayload {
    return {
      providerKind: inboundDelivery.providerKind,
      providerConnectionId: inboundDelivery.providerConnectionId,
      channelId: inboundDelivery.externalChannelId,
      threadId: input.thread.id,
      conversationMessageId: input.replyMessage.id,
      replyText: stripDashboardOnlyWidgets(input.replyMessage.bodyMarkdown),
      replyToExternalMessageId: inboundDelivery.externalMessageId,
      metadata: redactMetadata({
        projectId: input.projectId,
        sourceInboundDeliveryId: inboundDelivery.id,
        sourceConversationMessageId: input.triggeringMessage.id,
        replyConversationMessageId: input.replyMessage.id,
        triggeringMessageMetadata: input.triggeringMessage.metadata ?? null,
        inboundPayload: inboundDelivery.payload ?? null,
      }) as Record<string, unknown>,
    };
  }

  private markTerminalFailure(
    delivery: ChatProviderMessageDeliveryRecord,
    message: string,
    payload: ChatProviderOutboundBridgePayload,
    leaseOwner?: string,
  ): ChatProviderMessageDeliveryRecord {
    const completion = {
      status: "failed",
      lastError: redactText(message),
      nextAttemptAt: null,
      payload: withDeliveryState(payload, { retryable: false, nextAttemptAt: null }, "failed"),
    } as const;
    const failed = leaseOwner
      ? this.deps.chatProviderRepository.completeOutboundDelivery(delivery.id, leaseOwner, completion)
      : this.deps.chatProviderRepository.updateDeliveryState(delivery.id, completion);
    this.log("error", "Chat provider outbound delivery could not be attempted", {
      providerConnectionId: delivery.providerConnectionId,
      providerKind: delivery.providerKind,
      channelBindingId: delivery.channelBindingId,
      externalChannelId: delivery.externalChannelId,
      deliveryId: delivery.id,
      error: message,
    });
    return failed;
  }

  private computeNextAttemptAt(attemptCount: number, retryAfterMs?: number): Date {
    const exponential = Math.min(
      this.maxBackoffMs,
      this.initialBackoffMs * Math.pow(2, Math.max(0, attemptCount - 1)),
    );
    const jitter = exponential * this.jitterRatio * ((this.random() * 2) - 1);
    const backoffWithJitter = Math.min(this.maxBackoffMs, Math.max(0, Math.round(exponential + jitter)));
    const delay = retryAfterMs ?? backoffWithJitter;
    return new Date(this.now().getTime() + delay);
  }

  private releaseAfterShutdown(delivery: ChatProviderMessageDeliveryRecord): ChatProviderMessageDeliveryRecord {
    if (delivery.leaseOwner !== this.leaseOwner) return delivery;
    return this.deps.chatProviderRepository.releaseOutboundDelivery(delivery.id, this.leaseOwner, {
      status: delivery.attemptCount > 0 ? "retryable_failure" : "pending",
      nextAttemptAt: delivery.nextAttemptAt ?? this.now().toISOString(),
      lastError: "Interrupted by runtime shutdown.",
    });
  }

  private log(level: "info" | "warn" | "error", message: string, metadata: Record<string, unknown>): void {
    this.deps.logger?.[level](message, {
      logPurpose: "integration",
      correlationId: getCorrelationId(),
      ...metadata,
    });
  }
}

function getStringMetadata(metadata: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = metadata?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function requireDelivery(delivery: ChatProviderMessageDeliveryRecord | null, deliveryId: string): ChatProviderMessageDeliveryRecord {
  if (!delivery) {
    throw new Error(`Chat provider delivery not found: ${deliveryId}`);
  }
  return delivery;
}

function normalizeAdapterError(error: unknown): ChatProviderOutboundAdapterError {
  if (error instanceof ChatProviderOutboundAdapterError) {
    return error;
  }
  return new ChatProviderOutboundAdapterError(error instanceof Error ? error.message : String(error), true);
}

function getPayload(delivery: ChatProviderMessageDeliveryRecord): ChatProviderOutboundBridgePayload {
  return normalizePayload(delivery, null);
}

function normalizePayload(
  delivery: ChatProviderMessageDeliveryRecord,
  binding: ChatProviderChannelBindingRecord | null,
): ChatProviderOutboundBridgePayload {
  const payload = delivery.payload ?? {};
  const replyText = typeof payload.replyText === "string" ? payload.replyText : "";
  return {
    providerKind: typeof payload.providerKind === "string" ? payload.providerKind : delivery.providerKind,
    providerConnectionId: typeof payload.providerConnectionId === "string" ? payload.providerConnectionId : delivery.providerConnectionId,
    channelId: typeof payload.channelId === "string" ? payload.channelId : binding?.externalChannelId ?? delivery.externalChannelId,
    threadId: typeof payload.threadId === "string" ? payload.threadId : delivery.conversationThreadId ?? "",
    conversationMessageId: typeof payload.conversationMessageId === "string" ? payload.conversationMessageId : delivery.conversationMessageId ?? "",
    replyText,
    replyToExternalMessageId: typeof payload.replyToExternalMessageId === "string" ? payload.replyToExternalMessageId : delivery.externalMessageId,
    metadata: payload.metadata && typeof payload.metadata === "object" && !Array.isArray(payload.metadata)
      ? redactMetadata(payload.metadata) as Record<string, unknown>
      : {},
  };
}

function withDeliveryState(
  payload: ChatProviderOutboundBridgePayload,
  retry: RetryMetadata,
  state: string,
): Record<string, unknown> {
  return {
    ...payload,
    delivery: {
      state,
      retryable: retry.retryable,
      nextAttemptAt: retry.nextAttemptAt,
    },
  };
}
