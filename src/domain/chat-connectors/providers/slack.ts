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
  kind: "slack",
  label: "Slack",
  defaultBridgeMode: "managed_bridge",
  bridgeModes: [
    {
      mode: "managed_bridge",
      label: "Managed Slack bridge",
      integration: "managed_plugin",
      setupFields: [
        { key: "pluginName", label: "Plugin name", type: "string", required: true, defaultValue: "slack" },
        { key: "workspaceId", label: "Connector workspace", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
    },
    {
      mode: "webhook",
      label: "Slack Events webhook",
      integration: "webhook",
      setupFields: [
        { key: "eventsUrl", label: "Events webhook URL", type: "url", required: true },
        { key: "appId", label: "Slack app ID", type: "string", required: false },
      ],
      secretFields: [
        { key: "signingSecret", label: "Signing secret", required: true },
        { key: "botToken", label: "Bot token", required: false },
      ],
    },
  ],
} as const;

export const slackChatConnectorProfile: ChatConnectorProfile = {
  kind: "slack",
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
      const event = readRecord(body.event) ?? body;
      return {
        externalChannelId: readString(event.channel, event.channel_id),
        externalChannelName: readString(event.channel_name, event.channel),
        externalSenderId: readString(event.user, event.user_id, event.bot_id),
        externalSenderName: readString(event.username, event.user_name, event.user),
        textBody: readString(event.text),
        externalMessageId: readString(event.client_msg_id, body.event_id, event.event_ts, event.ts),
        timestamp: event.event_ts ?? event.ts,
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
      throw new Error(`Unsupported bridge mode for slack: ${mode}`);
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
  officialDocumentation: [
    { label: "Slack Events API", url: "https://api.slack.com/apis/connections/events-api" },
    { label: "Slack request verification", url: "https://api.slack.com/docs/verifying-requests-from-slack" },
  ],
  liveTest: { available: false, modes: [], reason: "Baseline bridge profiles do not invoke provider endpoints." },
  lifecycle: { status: "baseline", profileVersion: 1, introducedIn: "typed-registry" },
};
