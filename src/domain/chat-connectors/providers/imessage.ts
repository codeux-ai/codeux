import type { ChatConnectorProfile } from "../types.js";
import {
  buildLegacyCommandOutboundRequest,
  buildLegacyHttpOutboundRequest,
  isLegacyRetryableHttpStatus,
  parseLegacyOutboundResponse,
  readRecord,
  readString,
  resolveLegacyIdentity,
  verifyConnectorConfiguration,
} from "../types.js";

const setupSchema = {
  kind: "imessage",
  label: "iMessage",
  defaultBridgeMode: "managed_bridge",
  bridgeModes: [
    {
      mode: "managed_bridge",
      label: "Managed iMessage bridge",
      integration: "managed_core",
      setupFields: [
        { key: "workspaceId", label: "Connector workspace", type: "string", required: false },
        { key: "deviceLabel", label: "Device label", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
    },
    {
      mode: "native_bridge",
      label: "macOS native bridge command",
      integration: "native_bridge",
      setupFields: [
        { key: "command", label: "Bridge command", type: "command", required: true },
        { key: "workingDirectory", label: "Working directory", type: "string", required: false },
      ],
      secretFields: [{ key: "bridgeToken", label: "Bridge token", required: false }],
    },
  ],
} as const;

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
    acknowledgement: { statusCode: 200, headers: { "content-type": "application/json" }, body: null },
    normalize: (body) => {
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
    },
  },
  identity: { resolve: resolveLegacyIdentity },
  outbound: {
    buildRequest: (context) => {
      if (context.connection.bridgeMode === "managed_bridge") {
        return buildLegacyHttpOutboundRequest(context, {
          mode: "managed_bridge",
          urlKeys: ["bridgeUrl", "outboundUrl", "endpointUrl", "url"],
          bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret"],
          label: "managed_bridge bridge URL",
        });
      }
      if (context.connection.bridgeMode === "native_bridge") {
        return buildLegacyCommandOutboundRequest(context, ["bridgeToken", "botToken", "webhookSecret"]);
      }
      throw new Error(`Unsupported bridge mode for imessage: ${context.connection.bridgeMode}`);
    },
    parseResponse: parseLegacyOutboundResponse,
    isRetryableStatus: isLegacyRetryableHttpStatus,
  },
  verification: {
    strategy: "configuration",
    capabilities: ["setup", "authentication", "outbound"],
    verifyConfiguration: (mode, setup, secrets) => verifyConnectorConfiguration(setupSchema, mode, setup, secrets),
  },
  session: { required: true, scope: "connection", requirements: ["A reachable bridge session is required for delivery."] },
  officialDocumentation: [{ label: "Apple Messages", url: "https://developer.apple.com/documentation/messages" }],
  liveTest: { available: false, modes: [], reason: "Baseline bridge profiles do not invoke provider endpoints." },
  lifecycle: { status: "baseline", profileVersion: 1, introducedIn: "typed-registry" },
};
