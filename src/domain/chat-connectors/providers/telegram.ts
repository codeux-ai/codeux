import type { ChatConnectorProfile } from "../types.js";
import {
  buildLegacyHttpOutboundRequest,
  isLegacyRetryableHttpStatus,
  joinName,
  parseLegacyOutboundResponse,
  readRecord,
  readString,
  resolveLegacyIdentity,
  verifyConnectorConfiguration,
} from "../types.js";

const setupSchema = {
  kind: "telegram",
  label: "Telegram",
  defaultBridgeMode: "managed_bridge",
  bridgeModes: [
    {
      mode: "managed_bridge",
      label: "Managed Telegram bridge",
      integration: "managed_core",
      setupFields: [
        { key: "workspaceId", label: "Connector workspace", type: "string", required: false },
        { key: "botUsername", label: "Bot username", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
    },
    {
      mode: "webhook",
      label: "Telegram bot webhook",
      integration: "webhook",
      setupFields: [
        { key: "webhookUrl", label: "Webhook URL", type: "url", required: true },
        { key: "botUsername", label: "Bot username", type: "string", required: false },
      ],
      secretFields: [
        { key: "botToken", label: "Bot token", required: true },
        { key: "webhookSecret", label: "Webhook secret token", required: false },
      ],
    },
  ],
} as const;

export const telegramChatConnectorProfile: ChatConnectorProfile = {
  kind: "telegram",
  setupSchema,
  supportedTransportModes: ["managed_bridge", "webhook"],
  ingress: {
    authentication: {
      managed_bridge: {
        type: "bearer",
        secretKeys: ["bridgeApiKey"],
        tokenHeaders: ["authorization", "x-code-ux-bridge-token"],
        timestampHeaders: ["x-code-ux-timestamp", "x-provider-timestamp", "x-slack-request-timestamp"],
      },
      webhook: {
        type: "hmac_sha256",
        secretKeys: ["signingSecret", "webhookSecret", "botAppPassword"],
        signatureHeaders: ["x-code-ux-signature", "x-hub-signature-256", "x-slack-signature", "x-signature"],
        timestampHeaders: ["x-code-ux-timestamp", "x-provider-timestamp", "x-slack-request-timestamp"],
        signatureBases: ({ timestamp, rawBody }) => [`${timestamp}.${rawBody}`, `v0:${timestamp}:${rawBody}`, rawBody],
      },
    },
    handshake: { type: "none" },
    acknowledgement: { statusCode: 200, headers: { "content-type": "application/json" }, body: null },
    normalize: (body) => {
      const message = readRecord(body.message) ?? readRecord(body.channel_post);
      const chat = readRecord(message?.chat);
      const sender = readRecord(message?.from) ?? readRecord(message?.sender_chat);
      return {
        externalChannelId: readString(chat?.id),
        externalChannelName: readString(chat?.title, chat?.username, chat?.id),
        externalSenderId: readString(sender?.id, sender?.username),
        externalSenderName: joinName(sender?.first_name, sender?.last_name) ?? readString(sender?.username, sender?.title, sender?.id),
        textBody: readString(message?.text, message?.caption),
        externalMessageId: readString(message?.message_id),
        timestamp: message?.date,
      };
    },
  },
  identity: { resolve: resolveLegacyIdentity },
  outbound: {
    buildRequest: (context) => {
      const mode = context.connection.bridgeMode;
      if (mode === "managed_bridge") {
        return buildLegacyHttpOutboundRequest(context, {
          mode,
          urlKeys: ["bridgeUrl", "outboundUrl", "endpointUrl", "url"],
          bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
          label: "managed_bridge bridge URL",
        });
      }
      if (mode === "webhook") {
        return buildLegacyHttpOutboundRequest(context, {
          mode,
          urlKeys: ["outboundWebhookUrl", "webhookUrl", "eventsUrl", "botEndpointUrl", "gatewayUrl", "bridgeUrl", "url"],
          bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
          label: "webhook bridge URL",
        });
      }
      throw new Error(`Unsupported bridge mode for telegram: ${mode}`);
    },
    parseResponse: parseLegacyOutboundResponse,
    isRetryableStatus: isLegacyRetryableHttpStatus,
  },
  verification: {
    strategy: "configuration",
    capabilities: ["setup", "authentication", "outbound"],
    verifyConfiguration: (mode, setup, secrets) => verifyConnectorConfiguration(setupSchema, mode, setup, secrets),
  },
  session: { required: false, scope: "connection", requirements: [] },
  officialDocumentation: [{ label: "Telegram Bot API", url: "https://core.telegram.org/bots/api" }],
  liveTest: { available: false, modes: [], reason: "Baseline bridge profiles do not invoke provider endpoints." },
  lifecycle: { status: "baseline", profileVersion: 1, introducedIn: "typed-registry" },
};
