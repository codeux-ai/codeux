import type { ChatConnectorProfile } from "../types.js";
import {
  buildLegacyHttpOutboundRequest,
  isLegacyRetryableHttpStatus,
  parseLegacyOutboundResponse,
  readRecord,
  readString,
  resolveLegacyIdentity,
  verifyConnectorConfiguration,
} from "../types.js";

const setupSchema = {
  kind: "discord",
  label: "Discord",
  defaultBridgeMode: "webhook",
  bridgeModes: [
    {
      mode: "webhook",
      label: "Discord bot/webhook gateway",
      integration: "bot_gateway",
      setupFields: [
        { key: "gatewayUrl", label: "Gateway URL", type: "url", required: false },
        { key: "applicationId", label: "Application ID", type: "string", required: false },
      ],
      secretFields: [
        { key: "botToken", label: "Bot token", required: true },
        { key: "webhookSecret", label: "Webhook signing secret", required: false },
      ],
    },
  ],
} as const;

export const discordChatConnectorProfile: ChatConnectorProfile = {
  kind: "discord",
  setupSchema,
  supportedTransportModes: ["webhook"],
  ingress: {
    authentication: {
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
    },
  },
  identity: { resolve: resolveLegacyIdentity },
  outbound: {
    buildRequest: (context) => {
      if (context.connection.bridgeMode !== "webhook") {
        throw new Error(`Unsupported bridge mode for discord: ${context.connection.bridgeMode}`);
      }
      return buildLegacyHttpOutboundRequest(context, {
        mode: "webhook",
        urlKeys: ["outboundWebhookUrl", "webhookUrl", "eventsUrl", "botEndpointUrl", "gatewayUrl", "bridgeUrl", "url"],
        bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
        label: "webhook bridge URL",
      });
    },
    parseResponse: parseLegacyOutboundResponse,
    isRetryableStatus: isLegacyRetryableHttpStatus,
  },
  verification: {
    strategy: "configuration",
    capabilities: ["setup", "authentication", "outbound"],
    verifyConfiguration: (mode, setup, secrets) => verifyConnectorConfiguration(setupSchema, mode, setup, secrets),
  },
  session: { required: true, scope: "connection", requirements: ["A bot or gateway session owns provider event delivery."] },
  officialDocumentation: [
    { label: "Discord interactions", url: "https://docs.discord.com/developers/interactions/receiving-and-responding" },
    { label: "Discord messages", url: "https://docs.discord.com/developers/resources/message" },
  ],
  liveTest: { available: false, modes: [], reason: "Baseline bridge profiles do not invoke provider endpoints." },
  lifecycle: { status: "baseline", profileVersion: 1, introducedIn: "typed-registry" },
};
