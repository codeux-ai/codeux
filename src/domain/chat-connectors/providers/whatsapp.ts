import type { ChatConnectorProfile } from "../types.js";
import {
  buildLegacyHttpOutboundRequest,
  isLegacyRetryableHttpStatus,
  parseLegacyOutboundResponse,
  readArray,
  readRecord,
  readString,
  resolveLegacyIdentity,
  verifyConnectorConfiguration,
} from "../types.js";

const setupSchema = {
  kind: "whatsapp",
  label: "WhatsApp",
  defaultBridgeMode: "managed_bridge",
  bridgeModes: [
    {
      mode: "managed_bridge",
      label: "Managed WhatsApp bridge",
      integration: "managed_plugin",
      setupFields: [
        { key: "pluginName", label: "Plugin name", type: "string", required: true, defaultValue: "whatsapp" },
        { key: "workspaceId", label: "Connector workspace", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
    },
    {
      mode: "webhook",
      label: "WhatsApp webhook",
      integration: "webhook",
      setupFields: [
        { key: "webhookUrl", label: "Webhook URL", type: "url", required: true },
        { key: "verifyTokenName", label: "Verify token name", type: "string", required: false },
      ],
      secretFields: [
        { key: "webhookSecret", label: "Webhook signing secret", required: true },
        { key: "verifyToken", label: "Verify token", required: false },
      ],
    },
  ],
} as const;

export const whatsappChatConnectorProfile: ChatConnectorProfile = {
  kind: "whatsapp",
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
      const value = readRecord(readArray(readRecord(readArray(body.entry)?.[0])?.changes)?.[0])?.value;
      const valueRecord = readRecord(value);
      const message = readRecord(readArray(valueRecord?.messages)?.[0]);
      const contact = readRecord(readArray(valueRecord?.contacts)?.[0]);
      const metadata = readRecord(valueRecord?.metadata);
      return {
        externalChannelId: readString(metadata?.phone_number_id, body.phone_number_id),
        externalChannelName: readString(metadata?.display_phone_number, metadata?.phone_number_id),
        externalSenderId: readString(message?.from, contact?.wa_id),
        externalSenderName: readString(readRecord(contact?.profile)?.name, contact?.wa_id),
        textBody: readString(readRecord(message?.text)?.body, message?.body),
        externalMessageId: readString(message?.id),
        timestamp: message?.timestamp,
      };
    },
  },
  identity: { resolve: resolveLegacyIdentity },
  outbound: {
    buildRequest: (context) => {
      if (context.connection.bridgeMode === "managed_bridge") {
        return buildLegacyHttpOutboundRequest(context, {
          mode: "managed_bridge",
          urlKeys: ["bridgeUrl", "outboundUrl", "endpointUrl", "url"],
          bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
          label: "managed_bridge bridge URL",
        });
      }
      if (context.connection.bridgeMode === "webhook") {
        return buildLegacyHttpOutboundRequest(context, {
          mode: "webhook",
          urlKeys: ["outboundWebhookUrl", "webhookUrl", "eventsUrl", "botEndpointUrl", "gatewayUrl", "bridgeUrl", "url"],
          bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
          label: "webhook bridge URL",
        });
      }
      throw new Error(`Unsupported bridge mode for whatsapp: ${context.connection.bridgeMode}`);
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
  officialDocumentation: [{ label: "WhatsApp Cloud API", url: "https://developers.facebook.com/docs/whatsapp/cloud-api" }],
  liveTest: { available: false, modes: [], reason: "Baseline bridge profiles do not invoke provider endpoints." },
  lifecycle: { status: "baseline", profileVersion: 1, introducedIn: "typed-registry" },
};
