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

export interface DeliverChatProviderReplyInput {
  projectId: string;
  thread: ConversationThreadRecord;
  triggeringMessage: ConversationMessageRecord;
  replyMessage: ConversationMessageRecord;
}

interface ChatProviderOutboundServiceDependencies {
  chatProviderRepository: ChatProviderRepository;
  adapter?: ChatProviderOutboundAdapter;
  logger?: Logger;
  pollIntervalMs?: number;
  initialBackoffMs?: number;
  maxAttempts?: number;
  now?: () => Date;
}

interface RetryMetadata {
  retryable: boolean;
  nextAttemptAt: string | null;
}

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_INITIAL_BACKOFF_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 3;

export class ChatProviderOutboundService {
  private readonly adapter: ChatProviderOutboundAdapter;
  private readonly pollIntervalMs: number;
  private readonly initialBackoffMs: number;
  private readonly maxAttempts: number;
  private readonly now: () => Date;
  private timer: NodeJS.Timeout | null = null;
  private retryProcessingPromise: Promise<ChatProviderMessageDeliveryRecord[]> | null = null;

  constructor(private readonly deps: ChatProviderOutboundServiceDependencies) {
    this.adapter = deps.adapter ?? createDefaultChatProviderOutboundAdapter();
    this.pollIntervalMs = deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.initialBackoffMs = deps.initialBackoffMs ?? DEFAULT_INITIAL_BACKOFF_MS;
    this.maxAttempts = deps.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    if (this.timer) {
      return;
    }
    this.timer = setInterval(() => {
      this.processDueRetries().catch((error) => {
        this.log("error", "Chat provider outbound retry loop failed", {
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = null;
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
    const now = this.now().toISOString();
    const due = this.deps.chatProviderRepository.listPendingOutboundDeliveries(limit)
      .filter((delivery) => delivery.status !== "retryable_failure" || getNextAttemptAt(delivery) <= now);
    const results: ChatProviderMessageDeliveryRecord[] = [];
    for (const delivery of due) {
      results.push(await this.attemptDelivery(delivery.id));
    }
    return results;
  }

  async attemptDelivery(deliveryId: string): Promise<ChatProviderMessageDeliveryRecord> {
    const delivery = requireDelivery(this.deps.chatProviderRepository.getDelivery(deliveryId), deliveryId);
    const connection = this.deps.chatProviderRepository.getConnectionInternal(delivery.providerConnectionId);
    if (!connection || !connection.enabled || connection.status === "disabled") {
      return this.markTerminalFailure(delivery, "Chat provider connection is disabled or missing.", getPayload(delivery));
    }
    const binding = delivery.channelBindingId
      ? this.deps.chatProviderRepository.getChannelBinding(delivery.channelBindingId)
      : null;
    if (!binding || !binding.enabled || !binding.outboundEnabled) {
      return this.markTerminalFailure(delivery, "Outbound channel binding is disabled or missing.", getPayload(delivery));
    }
    const payload = normalizePayload(delivery, binding);
    const attemptCount = delivery.attemptCount + 1;
    const correlationId = getCorrelationId() ?? generateCorrelationId();

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
      });
      const delivered = this.deps.chatProviderRepository.updateDeliveryState(delivery.id, {
        status: "delivered",
        externalMessageId: result.externalMessageId ?? delivery.externalMessageId ?? null,
        lastError: null,
        payload: {
          ...payload,
          bridgeResponse: result.responseMetadata ?? null,
          delivery: {
            state: "delivered",
            retryable: false,
            nextAttemptAt: null,
          },
        },
      });
      this.log("info", "Delivered chat provider outbound reply", {
        correlationId,
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        channelBindingId: binding.id,
        externalChannelId: delivery.externalChannelId,
        deliveryId: delivery.id,
        externalMessageId: delivered.externalMessageId,
        attemptCount: delivered.attemptCount,
      });
      return delivered;
    } catch (error) {
      const adapterError = normalizeAdapterError(error);
      const retryable = adapterError.retryable && attemptCount < this.maxAttempts;
      const nextAttemptAt = retryable
        ? this.computeNextAttemptAt(attemptCount, adapterError.retryAfterMs).toISOString()
        : null;
      const failed = this.deps.chatProviderRepository.updateDeliveryState(delivery.id, {
        status: retryable ? "retryable_failure" : "failed",
        attemptCount,
        lastError: adapterError.message,
        payload: withDeliveryState(payload, { retryable, nextAttemptAt }, retryable ? "retryable_failure" : "failed"),
      });
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
        error: adapterError.message,
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
  ): ChatProviderMessageDeliveryRecord {
    const failed = this.deps.chatProviderRepository.updateDeliveryState(delivery.id, {
      status: "failed",
      lastError: redactText(message),
      payload: withDeliveryState(payload, { retryable: false, nextAttemptAt: null }, "failed"),
    });
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
    const exponentialDelay = this.initialBackoffMs * Math.pow(2, Math.max(0, attemptCount - 1));
    const delay = Math.max(exponentialDelay, retryAfterMs ?? 0);
    return new Date(this.now().getTime() + delay);
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

function getNextAttemptAt(delivery: ChatProviderMessageDeliveryRecord): string {
  const nextAttemptAt = delivery.payload?.delivery
    && typeof delivery.payload.delivery === "object"
    && !Array.isArray(delivery.payload.delivery)
    && typeof (delivery.payload.delivery as Record<string, unknown>).nextAttemptAt === "string"
    ? (delivery.payload.delivery as Record<string, unknown>).nextAttemptAt as string
    : "";
  return nextAttemptAt || "0000-01-01T00:00:00.000Z";
}
