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
import { redactMetadata } from "../shared/security/redaction.js";
import { getChatConnectorProfileForMode } from "../domain/chat-connectors/registry.js";
import type { PartialNormalizedChatConnectorInbound } from "../domain/chat-connectors/types.js";

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
  chatThreadRuntimeService: ChatThreadRuntimeService;
  logger?: Logger;
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
  constructor(private readonly deps: ChatProviderIngressServiceDependencies) {}

  async processInbound(input: ChatProviderIngressPayload): Promise<ChatProviderIngressResult> {
    const connection = this.deps.chatProviderRepository.getConnectionInternal(input.providerConnectionId);
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
    const profile = getChatConnectorProfileForMode(connection.providerKind, connection.bridgeMode);
    const ignoreResult = connection.bridgeMode === "official_api"
      ? profile.ingress.ignore?.(body, connection.bridgeMode)
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

    const normalized = normalizeInboundPayload(connection, body);
    const existing = this.deps.chatProviderRepository.findInboundDelivery(connection.id, normalized.externalMessageId);
    if (existing) {
      this.log("info", "Duplicate chat provider ingress ignored", {
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        externalChannelId: normalized.externalChannelId,
        externalMessageId: normalized.externalMessageId,
        deliveryId: existing.id,
      });
      return {
        status: "duplicate",
        message: "Duplicate inbound message. Returning existing delivery.",
        providerConnectionId: connection.id,
        providerKind: connection.providerKind,
        delivery: existing,
      };
    }

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

    const pendingDelivery = this.deps.chatProviderRepository.recordInboundMessage({
      providerConnectionId: normalized.providerConnectionId,
      channelBindingId: routing.binding.id,
      externalChannelId: normalized.externalChannelId,
      externalMessageId: normalized.externalMessageId,
      status: "pending",
      payload: buildDeliveryPayload(normalized, {
        state: "posting",
        projectId: routing.binding.projectId,
        channelBindingId: routing.binding.id,
      }),
    }).delivery;

    try {
      const conversationMessage = await this.deps.chatThreadRuntimeService.postMessage(routing.binding.projectId, {
        threadId: resolveThreadId(routing.binding.routingHints, normalized.rawMetadata),
        bodyMarkdown: routing.bodyMarkdown,
        metadata: {
          source: "chat_provider",
          providerKind: normalized.providerKind,
          externalChannelId: normalized.externalChannelId,
          externalSender: {
            id: normalized.externalSenderId,
            name: normalized.externalSenderName,
          },
          inboundDeliveryId: pendingDelivery.id,
          suppressRichWidgets: true,
        },
      });
      const delivery = this.deps.chatProviderRepository.updateDeliveryState(pendingDelivery.id, {
        conversationThreadId: conversationMessage.threadId,
        conversationMessageId: conversationMessage.id,
        status: "processed",
        payload: buildDeliveryPayload(normalized, {
          state: "processed",
          projectId: routing.binding.projectId,
          channelBindingId: routing.binding.id,
        }),
      });

      this.log("info", "Accepted chat provider ingress", {
        providerConnectionId: normalized.providerConnectionId,
        providerKind: normalized.providerKind,
        externalChannelId: normalized.externalChannelId,
        externalMessageId: normalized.externalMessageId,
        channelBindingId: routing.binding.id,
        projectId: routing.binding.projectId,
        deliveryId: delivery.id,
        conversationThreadId: conversationMessage.threadId,
        conversationMessageId: conversationMessage.id,
      });
      return {
        status: "accepted",
        message: "Inbound chat provider message accepted.",
        providerConnectionId: normalized.providerConnectionId,
        providerKind: normalized.providerKind,
        delivery,
        conversationMessage,
      };
    } catch (error) {
      this.deps.chatProviderRepository.updateDeliveryState(pendingDelivery.id, {
        status: "failed",
        lastError: error instanceof Error ? error.message : String(error),
        payload: buildDeliveryPayload(normalized, {
          state: "failed",
          projectId: routing.binding.projectId,
          channelBindingId: routing.binding.id,
        }),
      });
      this.log("error", "Failed to process chat provider ingress", {
        providerConnectionId: normalized.providerConnectionId,
        providerKind: normalized.providerKind,
        externalChannelId: normalized.externalChannelId,
        externalMessageId: normalized.externalMessageId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
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
    const delivery = this.deps.chatProviderRepository.recordInboundMessage({
      providerConnectionId: normalized.providerConnectionId,
      externalChannelId: normalized.externalChannelId,
      externalMessageId: normalized.externalMessageId,
      status: ambiguous ? "pending" : "failed",
      payload: buildDeliveryPayload(normalized, {
        state: ambiguous ? "disambiguation_needed" : "unbound_channel",
        candidateProjectIds: ambiguousBindings.map((binding) => binding.projectId),
        candidateBindingIds: ambiguousBindings.map((binding) => binding.id),
      }),
    }).delivery;

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
): NormalizedChatProviderInboundMessage {
  const body = requireRecord(payload, "payload");
  const providerKind = connection.providerKind;
  const profile = getChatConnectorProfileForMode(providerKind, connection.bridgeMode);
  const normalized = {
    ...profile.ingress.normalize(body, connection.bridgeMode),
    ...definedInboundFields(normalizeGeneric(body)),
  };
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

function resolveThreadId(
  routingHints: Record<string, unknown> | null,
  rawMetadata: Record<string, unknown>,
): string | undefined {
  return readString(
    rawMetadata.threadId,
    rawMetadata.conversationThreadId,
    routingHints?.threadId,
    routingHints?.conversationThreadId,
  );
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
