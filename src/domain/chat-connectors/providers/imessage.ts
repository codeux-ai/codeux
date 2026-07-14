import type { ChatConnectorOutboundContext, ChatConnectorOutboundResult, ChatConnectorProfile } from "../types.js";
import { redactMetadata } from "../../../shared/security/redaction.js";
import {
  buildLegacyCommandOutboundRequest,
  buildLegacyHttpOutboundRequest,
  isLegacyRetryableHttpStatus,
  readRecord,
  readString,
  verifyConnectorConfiguration,
} from "../types.js";

export const IMESSAGE_BRIDGE_PROTOCOL_VERSION = "1.0" as const;

export interface ImessageBridgeErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

export interface ImessageBridgeEnvelope {
  protocolVersion: typeof IMESSAGE_BRIDGE_PROTOCOL_VERSION;
  operation: "send" | "health_check";
  correlation: { id: string };
  message: {
    guid: string | null;
    text: string | null;
    timestamp: string | null;
  } | null;
  chat: { guid: string | null; name: string | null } | null;
  sender: { id: string | null; name: string | null } | null;
  reply: { messageGuid: string | null; threadId: string | null } | null;
  result: {
    status: "sent" | "healthy";
    messageGuid: string | null;
    chatGuid: string | null;
    metadata: Record<string, unknown>;
  } | null;
  error: ImessageBridgeErrorPayload | null;
}

const setupSchema = {
  kind: "imessage",
  label: "iMessage",
  defaultBridgeMode: "managed_bridge",
  bridgeModes: [
    {
      mode: "managed_bridge",
      label: "Third-party managed iMessage bridge contract",
      integration: "managed_core",
      setupFields: [
        { key: "workspaceId", label: "Connector workspace", type: "string", required: false },
        { key: "deviceLabel", label: "Device label", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
    },
    {
      mode: "native_bridge",
      label: "Local third-party iMessage bridge command",
      integration: "native_bridge",
      setupFields: [
        { key: "command", label: "Bridge command", type: "command", required: true },
        { key: "workingDirectory", label: "Working directory", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeToken", label: "Bridge token", required: false }],
    },
  ],
} as const;

export function normalizeImessageBridgeGuid(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.normalize("NFC").trim();
  return normalized && normalized.length <= 512 && !/[\u0000-\u001f\u007f]/.test(normalized)
    ? normalized
    : undefined;
}

export function buildImessageBridgeRequest(
  operation: "send" | "health_check",
  correlationId: string,
  context?: ChatConnectorOutboundContext,
): ImessageBridgeEnvelope {
  const payload = context?.payload;
  const messageGuid = normalizeImessageBridgeGuid(payload?.conversationMessageId) ?? null;
  const chatGuid = normalizeImessageBridgeGuid(payload?.channelId) ?? null;
  const replyGuid = normalizeImessageBridgeGuid(payload?.replyToExternalMessageId) ?? null;
  const request: ImessageBridgeEnvelope = {
    protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
    operation,
    correlation: { id: correlationId },
    message: operation === "send"
      ? { guid: messageGuid, text: payload?.replyText ?? "", timestamp: null }
      : null,
    chat: operation === "send" ? { guid: chatGuid, name: context?.binding.externalChannelName ?? null } : null,
    sender: operation === "send" ? { id: null, name: null } : null,
    reply: operation === "send" ? { messageGuid: replyGuid, threadId: payload?.threadId ?? null } : null,
    result: null,
    error: null,
  };

  if (operation === "send" && payload) {
    // Existing command records receive compatibility aliases while bridge authors migrate to v1.
    return Object.assign(request, {
      channelId: payload.channelId,
      threadId: payload.threadId,
      conversationMessageId: payload.conversationMessageId,
      replyText: payload.replyText,
      replyToExternalMessageId: payload.replyToExternalMessageId,
    });
  }
  return request;
}

export function parseImessageBridgeResponse(
  text: string,
  expectedCorrelationId?: string,
): ChatConnectorOutboundResult {
  const parsed = parseBridgeResponseRecord(text);
  const isProtocolEnvelope = "protocolVersion" in parsed || "result" in parsed || "error" in parsed;
  if (!isProtocolEnvelope) return parseLegacyImessageSendResponse(parsed);

  if (parsed.protocolVersion !== IMESSAGE_BRIDGE_PROTOCOL_VERSION) {
    throw new Error(`Unsupported iMessage bridge protocol version: ${readString(parsed.protocolVersion) ?? "missing"}.`);
  }
  if (parsed.operation !== "send") {
    throw new Error("Malformed iMessage bridge send response: operation must be send.");
  }
  const requiredFields = ["correlation", "message", "chat", "sender", "reply", "result", "error"];
  if (requiredFields.some((field) => !(field in parsed))) {
    throw new Error("Malformed iMessage bridge send response: required protocol fields are missing.");
  }
  const correlation = readRecord(parsed.correlation);
  if (typeof correlation?.id !== "string" || !correlation.id.trim()) {
    throw new Error("Malformed iMessage bridge send response: correlation.id is required.");
  }
  if (expectedCorrelationId && correlation.id !== expectedCorrelationId) {
    throw new Error("Malformed iMessage bridge send response: correlation.id does not match the request.");
  }
  const error = readRecord(parsed.error);
  if (error) {
    throw new Error(`iMessage bridge error (${readString(error.code) ?? "unknown"}): ${readString(error.message) ?? "Unknown bridge error."}`);
  }
  if (parsed.error !== null) {
    throw new Error("Malformed iMessage bridge send response: error must be null or an error object.");
  }
  const result = readRecord(parsed.result);
  if (!result || result.status !== "sent") {
    throw new Error("Malformed iMessage bridge send response: result.status must be sent.");
  }
  if (!["messageGuid", "chatGuid", "metadata"].every((field) => field in result) || !readRecord(result.metadata)) {
    throw new Error("Malformed iMessage bridge send response: result fields are missing or invalid.");
  }
  return {
    externalMessageId: normalizeImessageBridgeGuid(result.messageGuid) ?? null,
    responseMetadata: {
      protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
      status: result.status,
      chatGuid: normalizeImessageBridgeGuid(result.chatGuid) ?? null,
      metadata: redactMetadata(readRecord(result.metadata) ?? {}) as Record<string, unknown>,
    },
  };
}

function parseBridgeResponseRecord(text: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(text.trim()) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Malformed iMessage bridge response: expected a JSON object.");
    }
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error("Malformed iMessage bridge response: invalid JSON.");
    }
    throw error;
  }
}

function parseLegacyImessageSendResponse(parsed: Record<string, unknown>): ChatConnectorOutboundResult {
  const messageGuid = readString(parsed.externalMessageId, parsed.messageId, parsed.id);
  const normalizedMessageGuid = normalizeImessageBridgeGuid(messageGuid);
  if (!normalizedMessageGuid) {
    throw new Error("Malformed legacy iMessage bridge send response: a message id is required.");
  }
  return {
    externalMessageId: normalizedMessageGuid,
    responseMetadata: redactMetadata(parsed) as Record<string, unknown>,
  };
}

export const imessageChatConnectorProfile: ChatConnectorProfile = {
  kind: "imessage",
  setupSchema,
  supportedTransportModes: ["managed_bridge", "native_bridge"],
  ingress: {
    authentication: {
      managed_bridge: {
        type: "bearer",
        secretKeys: ["bridgeApiKey"],
        tokenHeaders: ["authorization", "x-code-ux-bridge-token"],
        timestampHeaders: ["x-code-ux-timestamp", "x-provider-timestamp", "x-slack-request-timestamp"],
      },
      native_bridge: {
        type: "bearer",
        secretKeys: ["bridgeToken"],
        tokenHeaders: ["authorization", "x-code-ux-bridge-token"],
        timestampHeaders: ["x-code-ux-timestamp", "x-provider-timestamp", "x-slack-request-timestamp"],
      },
    },
    handshake: { type: "none" },
    acknowledgement: { statusCode: 200, headers: { "content-type": "application/json" }, body: null, deadlineMs: 2_500 },
    normalize: (body) => {
      const message = readRecord(body.message);
      const chat = readRecord(body.chat);
      const sender = readRecord(body.sender) ?? readRecord(body.from);
      return {
        externalChannelId: normalizeImessageBridgeGuid(chat?.guid)
          ?? normalizeImessageBridgeGuid(body.chatGuid)
          ?? readString(body.chatId, body.channelId, body.groupId),
        externalChannelName: readString(chat?.name, body.chatName, body.channelName, body.groupName),
        externalSenderId: readString(sender?.id, sender?.handle, body.senderId, body.handle),
        externalSenderName: readString(sender?.name, sender?.handle, body.senderName),
        textBody: readString(message?.text, body.text, body.body, body.content),
        externalMessageId: normalizeImessageBridgeGuid(message?.guid)
          ?? normalizeImessageBridgeGuid(body.guid)
          ?? normalizeImessageBridgeGuid(body.messageGuid)
          ?? readString(body.messageId, body.id),
        timestamp: message?.timestamp ?? body.timestamp ?? body.date,
      };
    },
  },
  identity: {
    resolve: (normalized, payload) => {
      const reply = readRecord(payload.reply);
      return {
        conversationId: normalizeImessageBridgeGuid(normalized.externalChannelId) ?? null,
        threadId: readString(reply?.threadId, payload.threadId, payload.conversationThreadId) ?? null,
      };
    },
  },
  outbound: {
    buildRequest: (context) => {
      const body = buildImessageBridgeRequest("send", context.correlationId, context);
      if (context.connection.bridgeMode === "managed_bridge") {
        return {
          ...buildLegacyHttpOutboundRequest(context, {
            mode: "managed_bridge",
            urlKeys: ["bridgeUrl", "outboundUrl", "endpointUrl", "url"],
            bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret"],
            label: "third-party managed iMessage bridge URL",
          }),
          body,
        };
      }
      if (context.connection.bridgeMode === "native_bridge") {
        return {
          ...buildLegacyCommandOutboundRequest(context, ["bridgeToken", "botToken", "webhookSecret"]),
          protocol: "imessage_bridge",
          body,
        };
      }
      throw new Error(`Unsupported bridge mode for imessage: ${context.connection.bridgeMode}`);
    },
    parseResponse: (responseBody, context) => parseImessageBridgeResponse(responseBody, context?.correlationId),
    isRetryableStatus: isLegacyRetryableHttpStatus,
  },
  verification: {
    strategy: "configuration",
    capabilities: ["setup", "authentication", "outbound"],
    verifyConfiguration: (mode, setup, secrets) => verifyConnectorConfiguration(setupSchema, mode, setup, secrets),
  },
  session: {
    required: true,
    scope: "connection",
    requirements: ["An operator-configured third-party bridge session is required for delivery."],
  },
  officialDocumentation: [
    { label: "Apple Messages framework", url: "https://developer.apple.com/documentation/messages" },
    { label: "iMessage apps and stickers", url: "https://developer.apple.com/imessage/" },
    { label: "Apple Message UI", url: "https://developer.apple.com/documentation/messageui" },
  ],
  liveTest: {
    available: false,
    modes: [],
    reason: "Apple provider-native endpoint verification is unavailable; Code UX verifies only configured third-party bridge contracts.",
  },
  lifecycle: { status: "preview", profileVersion: 2, introducedIn: "imessage-bridge-protocol-v1" },
};
