import type {
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderKind,
  ChatProviderMessageDeliveryRecord,
} from "../contracts/chat-provider-types.js";
import type { ConversationMessageRecord } from "../contracts/connection-chat-types.js";
import type { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type { ChatThreadRuntimeService } from "./chat-thread-runtime-service.js";
import type { Logger } from "../shared/logging/logger.js";
import { getCorrelationId } from "../shared/logging/correlation-id.js";
import { redactMetadata, redactText } from "../shared/security/redaction.js";
import {
  CHAT_CONNECTOR_REGISTRY,
  type ChatConnectorRegistry,
} from "../domain/chat-connectors/registry.js";
import type { PartialNormalizedChatConnectorInbound } from "../domain/chat-connectors/types.js";
import type { ChatProviderSecretService } from "./chat-provider-secret-service.js";

export interface ChatProviderIngressPayload {
  providerConnectionId: string;
  payload: unknown;
}

export interface NormalizedChatProviderInboundMessage {
  providerConnectionId: string;
  providerKind: ChatProviderKind;
  externalChannelId: string;
  externalChannelName: string;
  externalSenderId: string;
  externalSenderName: string;
  textBody: string;
  externalMessageId: string;
  timestamp: string;
  providerConversationId: string | null;
  providerThreadId: string | null;
  rawMetadata: Record<string, unknown>;
}

export type ChatProviderIngressStatus =
  | "accepted"
  | "duplicate"
  | "ignored"
  | "ambiguous"
  | "unbound"
  | "rejected";

export interface ChatProviderIngressResult {
  status: ChatProviderIngressStatus;
  message: string;
  providerConnectionId: string;
  providerKind?: ChatProviderKind;
  delivery?: ChatProviderMessageDeliveryRecord;
  conversationMessage?: ConversationMessageRecord;
  candidateProjectIds?: string[];
}

interface ChatProviderIngressServiceDependencies {
  chatProviderRepository: ChatProviderRepository;
  chatProviderSecretService?: ChatProviderSecretService;
  chatThreadRuntimeService: ChatThreadRuntimeService;
  logger?: Logger;
  connectorRegistry?: ChatConnectorRegistry;
}

interface RoutingResolution {
  binding: ChatProviderChannelBindingRecord | null;
  bodyMarkdown: string;
  ambiguousBindings: ChatProviderChannelBindingRecord[];
}

const SECRETISH_KEYS = new Set([
  "authorization",
  "token",
  "bot_token",
  "botToken",
  "api_key",
  "apiKey",
  "secret",
  "webhookSecret",
  "signingSecret",
  "password",
]);

export class ChatProviderIngressService {
  private readonly registry: ChatConnectorRegistry;
  private readonly processing = new Map<string, Promise<ChatProviderIngressResult>>();
  private readonly controllers = new Map<string, AbortController>();
  private started = false;
  private stopping = false;

  constructor(private readonly deps: ChatProviderIngressServiceDependencies) {
    this.registry = deps.connectorRegistry ?? CHAT_CONNECTOR_REGISTRY;
  }

  async processInbound(input: ChatProviderIngressPayload): Promise<ChatProviderIngressResult> {
    const accepted = await this.acceptInbound(input);
    if (accepted.status !== "accepted" || !accepted.delivery || accepted.delivery.status !== "pending") {
      return accepted;
    }
    return this.processAccepted(accepted.delivery.id);
  }

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    this.stopping = false;
    const pending = this.deps.chatProviderRepository.listDeliveries({ direction: "inbound", limit: 500 })
      .filter((delivery) => delivery.status === "pending" && readString(delivery.payload?.state) === "accepted");
    await Promise.allSettled(pending.map((delivery) => this.processAccepted(delivery.id)));
  }

  async stop(): Promise<void> {
    this.started = false;
    this.stopping = true;
    for (const controller of this.controllers.values()) {
      controller.abort(new Error("Chat provider ingress service is stopping."));
    }
    await Promise.allSettled([...this.processing.values()]);
  }

  async acceptInbound(input: ChatProviderIngressPayload): Promise<ChatProviderIngressResult> {
    const connection = this.deps.chatProviderSecretService
      ? await this.deps.chatProviderSecretService.resolveConnection(input.providerConnectionId).catch(() => null)
      : this.deps.chatProviderRepository.getConnectionInternal(input.providerConnectionId);
    if (!connection) {
      this.log("warn", "Rejected chat provider ingress for unknown connection", {
        providerConnectionId: input.providerConnectionId,
        reason: "connection_not_found",
      });
      return {
        status: "rejected",
        message: "Chat provider connection not found.",
        providerConnectionId: input.providerConnectionId,
      };
    }

    const body = requireRecord(input.payload, "payload");
    const profile = this.registry.getForMode(connection.providerKind, connection.bridgeMode);
    const ignoreResult = connection.bridgeMode === "official_api"
      ? profile.ingress.ignore?.(body, connection.bridgeMode) ?? null
      : null;
    const ignored = typeof ignoreResult === "string"
      ? ignoreResult
      : ignoreResult && typeof ignoreResult === "object" && ignoreResult.ignored
        ? ignoreResult.reason ?? "provider_profile"
        : null;
    if (ignored || (connection.bridgeMode === "official_api" && profile.ingress.classify?.(body) === "ignored")) {
      this.log("info", "Ignored chat provider ingress update", {
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        reason: ignored ?? "provider_profile",
      });
      return {
        status: "ignored",
        message: "Inbound chat provider update ignored.",
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
      };
    }

    const normalized = normalizeInboundPayload(connection, body, this.registry);

    const routing = this.resolveRouting(normalized);
    if (!routing.binding) {
      const result = this.recordUnroutedDelivery(normalized, routing.ambiguousBindings);
      this.log(result.status === "ambiguous" ? "warn" : "warn", "Chat provider ingress could not be routed", {
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        externalChannelId: normalized.externalChannelId,
        externalMessageId: normalized.externalMessageId,
        status: result.status,
        candidateProjectIds: result.candidateProjectIds,
      });
      return result;
    }

    const internalThreadId = this.resolveInternalThreadId(routing.binding, normalized);
    const recorded = this.deps.chatProviderRepository.recordInboundMessage({
      providerConnectionId: normalized.providerConnectionId,
      channelBindingId: routing.binding.id,
      externalChannelId: normalized.externalChannelId,
      externalMessageId: normalized.externalMessageId,
      status: "pending",
      payload: buildDeliveryPayload(normalized, {
        state: "accepted",
        projectId: routing.binding.projectId,
        channelBindingId: routing.binding.id,
        bodyMarkdown: routing.bodyMarkdown,
        internalThreadId,
      }),
    });
    if (recorded.duplicate) {
      this.log("info", "Duplicate chat provider ingress ignored", {
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        externalChannelId: normalized.externalChannelId,
        externalMessageId: normalized.externalMessageId,
        deliveryId: recorded.delivery.id,
        outcome: "duplicate",
      });
      return {
        status: "duplicate",
        message: "Duplicate inbound message. Returning existing delivery.",
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        delivery: recorded.delivery,
      };
    }

    this.log("info", "Persisted accepted chat provider ingress", {
      providerConnectionId: normalized.providerConnectionId,
      providerKind: normalized.providerKind,
      channelBindingId: routing.binding.id,
      deliveryId: recorded.delivery.id,
      outcome: "accepted",
    });
    return {
      status: "accepted",
      message: "Inbound chat provider message accepted for processing.",
      providerConnectionId: normalized.providerConnectionId,
      providerKind: normalized.providerKind,
      delivery: recorded.delivery,
    };
  }

  async processAccepted(deliveryId: string): Promise<ChatProviderIngressResult> {
    const existing = this.processing.get(deliveryId);
    if (existing) return existing;
    let processingPromise: Promise<ChatProviderIngressResult>;
    processingPromise = this.processAcceptedOnce(deliveryId).finally(() => {
      if (this.processing.get(deliveryId) === processingPromise) this.processing.delete(deliveryId);
      this.controllers.delete(deliveryId);
    });
    this.processing.set(deliveryId, processingPromise);
    return processingPromise;
  }

  private async processAcceptedOnce(deliveryId: string): Promise<ChatProviderIngressResult> {
    const pendingDelivery = this.deps.chatProviderRepository.getDelivery(deliveryId);
    if (!pendingDelivery || pendingDelivery.direction !== "inbound") {
      throw new Error(`Inbound chat provider delivery not found: ${deliveryId}`);
    }
    if (pendingDelivery.status !== "pending") return resultFromSettledDelivery(pendingDelivery);
    const payload = pendingDelivery.payload ?? {};
    const bindingId = readString(payload.channelBindingId) ?? pendingDelivery.channelBindingId;
    const binding = bindingId ? this.deps.chatProviderRepository.getChannelBinding(bindingId) : null;
    const projectId = readString(payload.projectId);
    const bodyMarkdown = readString(payload.bodyMarkdown);
    if (!binding || !projectId || !bodyMarkdown) {
      const failed = this.deps.chatProviderRepository.updateDeliveryState(deliveryId, {
        status: "failed",
        lastError: "Accepted inbound delivery is missing durable routing data.",
      });
      return resultFromSettledDelivery(failed);
    }
    const controller = new AbortController();
    this.controllers.set(deliveryId, controller);
    const startedAt = Date.now();
    const externalSender = readRecord(payload.externalSender);

    try {
      const conversationMessage = await this.deps.chatThreadRuntimeService.postMessage(projectId, {
        threadId: readString(payload.internalThreadId) ?? undefined,
        bodyMarkdown,
        metadata: {
          source: "chat_provider",
          providerKind: pendingDelivery.providerKind,
          providerConnectionId: pendingDelivery.providerConnectionId,
          channelBindingId: binding.id,
          externalChannelId: pendingDelivery.externalChannelId,
          externalSender: externalSender ? {
            id: readString(externalSender.id) ?? "unknown",
            name: readString(externalSender.name) ?? "unknown",
          } : null,
          providerConversationId: readString(payload.providerConversationId),
          providerThreadId: readString(payload.providerThreadId),
          inboundDeliveryId: pendingDelivery.id,
          agentPresetId: binding.agentPresetId,
          suppressRichWidgets: binding.suppressRichWidgets,
        },
      }, { signal: controller.signal });
      if (conversationMessage.deliveryStatus === "failed") {
        throw new Error("Chat thread processing failed after the connector message was accepted.");
      }
      const delivery = this.deps.chatProviderRepository.updateDeliveryState(pendingDelivery.id, {
        conversationThreadId: conversationMessage.threadId,
        conversationMessageId: conversationMessage.id,
        status: "processed",
        payload: {
          ...payload,
          state: "processed",
          projectId,
          channelBindingId: binding.id,
        },
      });

      this.log("info", "Accepted chat provider ingress", {
        providerConnectionId: pendingDelivery.providerConnectionId,
        providerKind: pendingDelivery.providerKind,
        channelBindingId: binding.id,
        projectId,
        deliveryId: delivery.id,
        conversationThreadId: conversationMessage.threadId,
        conversationMessageId: conversationMessage.id,
        latencyMs: Math.max(0, Date.now() - startedAt),
        outcome: "processed",
      });
      return {
        status: "accepted",
        message: "Inbound chat provider message accepted.",
        providerConnectionId: pendingDelivery.providerConnectionId,
        providerKind: pendingDelivery.providerKind,
        delivery,
        conversationMessage,
      };
    } catch (error) {
      const failed = this.deps.chatProviderRepository.updateDeliveryState(pendingDelivery.id, {
        status: "failed",
        lastError: redactError(error),
        payload: {
          ...payload,
          state: "failed",
          projectId,
          channelBindingId: binding.id,
        },
      });
      this.log("error", "Failed to process chat provider ingress", {
        providerConnectionId: pendingDelivery.providerConnectionId,
        providerKind: pendingDelivery.providerKind,
        channelBindingId: binding.id,
        deliveryId,
        latencyMs: Math.max(0, Date.now() - startedAt),
        outcome: controller.signal.aborted ? "cancelled" : "failed",
        providerErrorCode: controller.signal.aborted ? "shutdown_abort" : "chat_processing_error",
      });
      return {
        status: "accepted",
        message: "Inbound chat provider message was accepted, but asynchronous chat processing failed.",
        providerConnectionId: pendingDelivery.providerConnectionId,
        providerKind: pendingDelivery.providerKind,
        delivery: failed,
      };
    }
  }

  private resolveInternalThreadId(
    binding: ChatProviderChannelBindingRecord,
    normalized: NormalizedChatProviderInboundMessage,
  ): string | null {
    const configured = readString(binding.routingHints?.conversationThreadId, binding.routingHints?.threadId);
    if (configured) return configured;
    if (!normalized.providerConversationId && !normalized.providerThreadId) return null;
    const previous = this.deps.chatProviderRepository.listDeliveries({
      providerConnectionId: normalized.providerConnectionId,
      direction: "inbound",
      limit: 500,
    }).find((delivery) => delivery.channelBindingId === binding.id
      && delivery.conversationThreadId
      && delivery.payload?.providerConversationId === normalized.providerConversationId
      && delivery.payload?.providerThreadId === normalized.providerThreadId);
    return previous?.conversationThreadId ?? null;
  }

  private resolveRouting(normalized: NormalizedChatProviderInboundMessage): RoutingResolution {
    const bindings = this.deps.chatProviderRepository.listChannelBindings({
      providerConnectionId: normalized.providerConnectionId,
      externalChannelId: normalized.externalChannelId,
      enabledOnly: true,
    }).filter((binding) => binding.inboundEnabled);

    if (bindings.length === 0) {
      return { binding: null, bodyMarkdown: normalized.textBody, ambiguousBindings: [] };
    }
    if (bindings.length === 1) {
      return { binding: bindings[0], bodyMarkdown: normalized.textBody, ambiguousBindings: [] };
    }

    const hinted = selectBindingByRoutingHint(bindings, normalized);
    if (hinted) {
      return hinted;
    }

    return { binding: null, bodyMarkdown: normalized.textBody, ambiguousBindings: bindings };
  }

  private recordUnroutedDelivery(
    normalized: NormalizedChatProviderInboundMessage,
    ambiguousBindings: ChatProviderChannelBindingRecord[],
  ): ChatProviderIngressResult {
    const ambiguous = ambiguousBindings.length > 1;
    const recorded = this.deps.chatProviderRepository.recordInboundMessage({
      providerConnectionId: normalized.providerConnectionId,
      externalChannelId: normalized.externalChannelId,
      externalMessageId: normalized.externalMessageId,
      status: ambiguous ? "pending" : "failed",
      payload: buildDeliveryPayload(normalized, {
        state: ambiguous ? "disambiguation_needed" : "unbound_channel",
        candidateProjectIds: ambiguousBindings.map((binding) => binding.projectId),
        candidateBindingIds: ambiguousBindings.map((binding) => binding.id),
      }),
    });
    if (recorded.duplicate) {
      return {
        status: "duplicate",
        message: "Duplicate inbound message. Returning existing delivery.",
        providerConnectionId: normalized.providerConnectionId,
        providerKind: normalized.providerKind,
        delivery: recorded.delivery,
      };
    }
    const delivery = recorded.delivery;

    return {
      status: ambiguous ? "ambiguous" : "unbound",
      message: ambiguous
        ? "Multiple project bindings match this external channel. Add a project selector prefix or routing hint."
        : "No enabled inbound channel binding matches this external channel.",
      providerConnectionId: normalized.providerConnectionId,
      providerKind: normalized.providerKind,
      delivery,
      candidateProjectIds: ambiguous ? ambiguousBindings.map((binding) => binding.projectId) : undefined,
    };
  }

  private log(level: "info" | "warn" | "error", message: string, metadata: Record<string, unknown>): void {
    this.deps.logger?.[level](message, {
      logPurpose: "integration",
      correlationId: getCorrelationId(),
      ...metadata,
    });
  }
}

export function normalizeInboundPayload(
  connection: ChatProviderConnectionInternalRecord,
  payload: unknown,
  registry: ChatConnectorRegistry = CHAT_CONNECTOR_REGISTRY,
): NormalizedChatProviderInboundMessage {
  const body = requireRecord(payload, "payload");
  const providerKind = connection.providerKind;
  const profile = registry.getForMode(providerKind, connection.bridgeMode);
  const normalized = {
    ...definedInboundFields(normalizeGeneric(body)),
    ...definedInboundFields(profile.ingress.normalize(body, connection.bridgeMode)),
  };
  const identity = profile.identity.resolve(normalized, body, connection.bridgeMode);
  const timestamp = parseTimestamp(normalized.timestamp) ?? new Date().toISOString();
  const externalChannelId = requireNonEmpty(normalized.externalChannelId, "external channel id");
  const externalSenderId = requireNonEmpty(normalized.externalSenderId, "external sender id");
  return {
    providerConnectionId: connection.id,
    providerKind,
    externalChannelId,
    externalChannelName: normalized.externalChannelName?.trim() || externalChannelId,
    externalSenderId,
    externalSenderName: normalized.externalSenderName?.trim() || externalSenderId,
    textBody: requireNonEmpty(normalized.textBody, "message text"),
    externalMessageId: requireNonEmpty(normalized.externalMessageId, "external message id"),
    timestamp,
    providerConversationId: identity.conversationId,
    providerThreadId: identity.threadId,
    rawMetadata: stripSecrets(body),
  };
}

function normalizeGeneric(body: Record<string, unknown>): PartialNormalizedChatConnectorInbound {
  const channel = readRecord(body.channel) ?? readRecord(body.externalChannel);
  const sender = readRecord(body.sender) ?? readRecord(body.externalSender) ?? readRecord(body.from) ?? readRecord(body.author);
  const message = readRecord(body.message);
  return {
    externalChannelId: readString(body.externalChannelId, body.channelId, channel?.id, channel?.channelId),
    externalChannelName: readString(body.externalChannelName, body.channelName, channel?.name, channel?.title),
    externalSenderId: readString(body.externalSenderId, body.senderId, sender?.id, sender?.userId, sender?.username, sender?.handle),
    externalSenderName: readString(body.externalSenderName, body.senderName, sender?.name, sender?.username, sender?.displayName),
    textBody: readString(body.textBody, body.text, body.body, body.content, message?.text, message?.body, message?.content),
    externalMessageId: readString(body.externalMessageId, body.messageId, body.id, message?.id, message?.messageId),
    timestamp: body.timestamp ?? body.createdAt ?? message?.timestamp,
  };
}

function selectBindingByRoutingHint(
  bindings: ChatProviderChannelBindingRecord[],
  normalized: NormalizedChatProviderInboundMessage,
): RoutingResolution | null {
  const metadataSelector = readString(
    normalized.rawMetadata.projectId,
    normalized.rawMetadata.projectSelector,
    normalized.rawMetadata.projectAlias,
    normalized.rawMetadata.project,
  )?.toLowerCase();
  if (metadataSelector) {
    const match = bindings.find((binding) => (
      binding.projectId.toLowerCase() === metadataSelector
      || collectSelectors(binding).some((selector) => selector.toLowerCase() === metadataSelector)
    ));
    if (match) {
      return { binding: match, bodyMarkdown: normalized.textBody, ambiguousBindings: [] };
    }
  }

  for (const binding of bindings) {
    for (const selector of collectSelectors(binding)) {
      const stripped = stripSelectorPrefix(normalized.textBody, selector);
      if (stripped !== null) {
        return { binding, bodyMarkdown: stripped, ambiguousBindings: [] };
      }
    }
  }

  return null;
}

function collectSelectors(binding: ChatProviderChannelBindingRecord): string[] {
  const hints = binding.routingHints ?? {};
  const values = [
    hints.projectSelector,
    hints.projectSelectorPrefix,
    hints.projectAlias,
    hints.alias,
    hints.prefix,
    hints.selector,
    hints.projectId,
    ...(Array.isArray(hints.projectSelectorPrefixes) ? hints.projectSelectorPrefixes : []),
    ...(Array.isArray(hints.aliases) ? hints.aliases : []),
  ];
  return values
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .map((value) => value.trim());
}

function stripSelectorPrefix(text: string, selector: string): string | null {
  const escaped = escapeRegExp(selector);
  const patterns = [
    new RegExp(`^\\[${escaped}\\]\\s*`, "i"),
    new RegExp(`^/${escaped}\\s+`, "i"),
    new RegExp(`^@${escaped}\\s+`, "i"),
    new RegExp(`^${escaped}:\\s*`, "i"),
    new RegExp(`^${escaped}\\s+`, "i"),
  ];
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      return text.replace(pattern, "").trim();
    }
  }
  return null;
}

function buildDeliveryPayload(
  normalized: NormalizedChatProviderInboundMessage,
  state: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...state,
    externalSender: {
      id: normalized.externalSenderId,
      name: normalized.externalSenderName,
    },
    externalChannelName: normalized.externalChannelName,
    timestamp: normalized.timestamp,
    providerConversationId: normalized.providerConversationId,
    providerThreadId: normalized.providerThreadId,
    rawMetadata: normalized.rawMetadata,
  };
}

function stripSecrets(value: Record<string, unknown>): Record<string, unknown> {
  return redactMetadata(removeSecretKeys(value)) as Record<string, unknown>;
}

function removeSecretKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(removeSecretKeys);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        SECRETISH_KEYS.has(key) || /(?:token|secret|authorization|password|api[-_]?key)/i.test(key)
          ? "[REDACTED]"
          : removeSecretKeys(item),
      ]),
    );
  }
  return value;
}

function parseTimestamp(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value < 10_000_000_000 ? value * 1000 : value).toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    const date = Number.isFinite(numeric)
      ? new Date(Math.abs(numeric) < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(value);
    if (Number.isFinite(date.getTime())) {
      return date.toISOString();
    }
  }
  return null;
}

function requireRecord(value: unknown, fieldName: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Invalid ${fieldName}. Expected an object.`);
  }
  return value as Record<string, unknown>;
}

function requireNonEmpty(value: string | undefined, fieldName: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Missing ${fieldName}.`);
  }
  return value.trim();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

function definedInboundFields(
  value: PartialNormalizedChatConnectorInbound,
): PartialNormalizedChatConnectorInbound {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as PartialNormalizedChatConnectorInbound;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function redactError(error: unknown): string {
  const value = error instanceof Error ? error.message : String(error);
  return redactText(value);
}

function resultFromSettledDelivery(delivery: ChatProviderMessageDeliveryRecord): ChatProviderIngressResult {
  return {
    status: delivery.status === "duplicate" ? "duplicate" : "accepted",
    message: delivery.status === "failed"
      ? "Inbound chat provider message was accepted, but asynchronous chat processing failed."
      : "Inbound chat provider message has already been processed.",
    providerConnectionId: delivery.providerConnectionId,
    providerKind: delivery.providerKind,
    delivery,
  };
}
