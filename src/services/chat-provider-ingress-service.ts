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

    const normalized = normalizeInboundPayload(connection, input.payload);
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
  const normalized = normalizeByProvider(providerKind, body);
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

interface PartialNormalizedInbound {
  externalChannelId?: string;
  externalChannelName?: string;
  externalSenderId?: string;
  externalSenderName?: string;
  textBody?: string;
  externalMessageId?: string;
  timestamp?: unknown;
}

function normalizeByProvider(providerKind: ChatProviderKind, body: Record<string, unknown>): PartialNormalizedInbound {
  const generic = normalizeGeneric(body);
  switch (providerKind) {
    case "whatsapp":
      return { ...normalizeWhatsApp(body), ...definedInboundFields(generic) };
    case "imessage":
      return { ...normalizeIMessage(body), ...definedInboundFields(generic) };
    case "telegram":
      return { ...normalizeTelegram(body), ...definedInboundFields(generic) };
    case "slack":
      return { ...normalizeSlack(body), ...definedInboundFields(generic) };
    case "microsoft-teams":
      return { ...normalizeTeams(body), ...definedInboundFields(generic) };
    case "discord":
      return { ...normalizeDiscord(body), ...definedInboundFields(generic) };
  }
}

function normalizeGeneric(body: Record<string, unknown>): PartialNormalizedInbound {
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

function normalizeWhatsApp(body: Record<string, unknown>): PartialNormalizedInbound {
  const value = readRecord(readArray(readRecord(readArray(body.entry)?.[0])?.changes)?.[0])?.value;
  const valueRecord = readRecord(value);
  const message = readRecord(readArray(valueRecord?.messages)?.[0]);
  const contact = readRecord(readArray(valueRecord?.contacts)?.[0]);
  const metadata = readRecord(valueRecord?.metadata);
  const text = readRecord(message?.text);
  return {
    externalChannelId: readString(metadata?.phone_number_id, body.phone_number_id),
    externalChannelName: readString(metadata?.display_phone_number, metadata?.phone_number_id),
    externalSenderId: readString(message?.from, contact?.wa_id),
    externalSenderName: readString(readRecord(contact?.profile)?.name, contact?.wa_id),
    textBody: readString(text?.body, message?.body),
    externalMessageId: readString(message?.id),
    timestamp: message?.timestamp,
  };
}

function normalizeIMessage(body: Record<string, unknown>): PartialNormalizedInbound {
  const sender = readRecord(body.sender) ?? readRecord(body.from);
  return {
    externalChannelId: readString(body.chatGuid, body.chatId, body.channelId, body.groupId),
    externalChannelName: readString(body.chatName, body.channelName, body.groupName),
    externalSenderId: readString(body.senderId, body.handle, sender?.id, sender?.handle),
    externalSenderName: readString(body.senderName, sender?.name, sender?.handle),
    textBody: readString(body.text, body.body, body.content),
    externalMessageId: readString(body.guid, body.messageGuid, body.messageId, body.id),
    timestamp: body.timestamp ?? body.date,
  };
}

function normalizeTelegram(body: Record<string, unknown>): PartialNormalizedInbound {
  const message = readRecord(body.message) ?? readRecord(body.channel_post);
  const chat = readRecord(message?.chat);
  const sender = readRecord(message?.from) ?? readRecord(message?.sender_chat);
  return {
    externalChannelId: readString(chat?.id),
    externalChannelName: readString(chat?.title, chat?.username, chat?.id),
    externalSenderId: readString(sender?.id, sender?.username),
    externalSenderName: joinName(sender?.first_name, sender?.last_name) || readString(sender?.username, sender?.title, sender?.id),
    textBody: readString(message?.text, message?.caption),
    externalMessageId: readString(message?.message_id),
    timestamp: message?.date,
  };
}

function normalizeSlack(body: Record<string, unknown>): PartialNormalizedInbound {
  const event = readRecord(body.event) ?? body;
  const eventRecord = readRecord(event) ?? {};
  return {
    externalChannelId: readString(eventRecord.channel, eventRecord.channel_id),
    externalChannelName: readString(eventRecord.channel_name, eventRecord.channel),
    externalSenderId: readString(eventRecord.user, eventRecord.user_id, eventRecord.bot_id),
    externalSenderName: readString(eventRecord.username, eventRecord.user_name, eventRecord.user),
    textBody: readString(eventRecord.text),
    externalMessageId: readString(eventRecord.client_msg_id, body.event_id, eventRecord.event_ts, eventRecord.ts),
    timestamp: eventRecord.event_ts ?? eventRecord.ts,
  };
}

function normalizeTeams(body: Record<string, unknown>): PartialNormalizedInbound {
  const conversation = readRecord(body.conversation);
  const sender = readRecord(body.from);
  return {
    externalChannelId: readString(conversation?.id, body.channelId),
    externalChannelName: readString(conversation?.name, conversation?.id),
    externalSenderId: readString(sender?.id),
    externalSenderName: readString(sender?.name, sender?.id),
    textBody: readString(body.text, body.body, body.content),
    externalMessageId: readString(body.id, body.replyToId),
    timestamp: body.timestamp ?? body.localTimestamp,
  };
}

function normalizeDiscord(body: Record<string, unknown>): PartialNormalizedInbound {
  const channel = readRecord(body.channel);
  const author = readRecord(body.author) ?? readRecord(body.member);
  const user = readRecord(author?.user) ?? author;
  return {
    externalChannelId: readString(body.channel_id, channel?.id),
    externalChannelName: readString(channel?.name, body.channel_name, body.channel_id),
    externalSenderId: readString(user?.id),
    externalSenderName: readString(user?.global_name, user?.username, user?.name, user?.id),
    textBody: readString(body.content, body.text),
    externalMessageId: readString(body.id, body.message_id),
    timestamp: body.timestamp,
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

function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
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

function joinName(first: unknown, last: unknown): string | undefined {
  const joined = [first, last].filter((value): value is string => typeof value === "string" && value.trim().length > 0).join(" ").trim();
  return joined || undefined;
}

function definedInboundFields(value: PartialNormalizedInbound): PartialNormalizedInbound {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as PartialNormalizedInbound;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
