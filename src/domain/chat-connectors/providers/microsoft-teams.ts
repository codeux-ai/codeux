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
  kind: "microsoft-teams",
  label: "Microsoft Teams",
  defaultBridgeMode: "managed_bridge",
  bridgeModes: [
    {
      mode: "managed_bridge",
      label: "Managed Teams bridge",
      integration: "managed_plugin",
      setupFields: [
        { key: "pluginName", label: "Plugin name", type: "string", required: true, defaultValue: "microsoft-teams" },
        { key: "tenantId", label: "Tenant ID", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
    },
    {
      mode: "webhook",
      label: "Teams bot webhook",
      integration: "webhook",
      setupFields: [
        { key: "botEndpointUrl", label: "Bot endpoint URL", type: "url", required: true },
        { key: "tenantId", label: "Tenant ID", type: "string", required: false },
      ],
      secretFields: [
        { key: "botAppPassword", label: "Bot app password", required: true },
        { key: "webhookSecret", label: "Webhook signing secret", required: false },
      ],
    },
  ],
} as const;

export const microsoftTeamsChatConnectorProfile: ChatConnectorProfile = {
  kind: "microsoft-teams",
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
      throw new Error(`Unsupported bridge mode for microsoft-teams: ${mode}`);
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
  officialDocumentation: [{ label: "Teams conversational bots", url: "https://learn.microsoft.com/en-us/microsoftteams/platform/bots/build-conversational-capability" }],
  liveTest: { available: false, modes: [], reason: "Baseline bridge profiles do not invoke provider endpoints." },
  lifecycle: { status: "baseline", profileVersion: 1, introducedIn: "typed-registry" },
};
