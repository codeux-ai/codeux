import type {
  ChatProviderBridgeMode,
  ChatProviderKind,
  ChatProviderSecretConfig,
  ChatProviderSetupConfig,
} from "../../../src/contracts/chat-provider-types.js";
import { IMESSAGE_BRIDGE_PROTOCOL_VERSION } from "../../../src/domain/chat-connectors/providers/imessage.js";

export type ChatConnectorAcceptanceSource = "mock" | "local-emulator" | "official-endpoint";

export interface ChatConnectorProviderFixture {
  kind: ChatProviderKind;
  label: string;
  bridgeMode: ChatProviderBridgeMode;
  setup: ChatProviderSetupConfig;
  secrets: ChatProviderSecretConfig;
  channelId: string;
  messageId: string;
  inbound: Record<string, unknown>;
  outboundResponse: Record<string, unknown>;
  acceptanceSource: ChatConnectorAcceptanceSource;
}

const syntheticTimestamp = "2026-07-14T12:00:00.000Z";

export const whatsappChallengeFixture = {
  "hub.mode": "subscribe",
  "hub.verify_token": "fixture-whatsapp-verify-token",
  "hub.challenge": "fixture-challenge-20260714",
} as const;

export const slackChallengeFixture = {
  type: "url_verification",
  challenge: "fixture-slack-challenge-20260714",
} as const;

export const teamsJwtMetadataFixture = {
  issuer: "https://api.botframework.com",
  audience: "fixture-bot-app-id",
  serviceUrl: "https://smba.trafficmanager.net/fixture-tenant/",
  openIdMetadataUrl: "https://login.botframework.com/v1/.well-known/openidconfiguration",
} as const;

export const discordGatewayFixture = {
  op: 0,
  s: 42,
  t: "MESSAGE_CREATE",
  d: {
    id: "discord-message-fixture-1",
    channel_id: "discord-channel-fixture",
    content: "Exercise the Discord connector acceptance path",
    author: { id: "discord-user-fixture", username: "fixture-user" },
    timestamp: syntheticTimestamp,
  },
} as const;

export const discordInteractionFixture = {
  id: "discord-interaction-fixture-1",
  application_id: "discord-app-fixture",
  type: 2,
  token: "fixture-interaction-token-never-persist",
  channel_id: "discord-channel-fixture",
  member: { user: { id: "discord-user-fixture", username: "fixture-user" } },
  data: { name: "codeux", options: [{ name: "message", value: "Exercise the interaction contract" }] },
} as const;

export const imessageBridgeProtocolFixture = {
  protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
  operation: "send",
  correlation: { id: "imessage-correlation-fixture-1" },
  message: { guid: "imessage-message-fixture-1", text: "Exercise the iMessage bridge acceptance path", timestamp: syntheticTimestamp },
  chat: { guid: "imessage-chat-fixture", name: "Approved local fixture chat" },
  sender: { id: "imessage-sender-fixture", name: "Fixture Sender" },
  reply: { messageGuid: null, threadId: "imessage-thread-fixture" },
  result: null,
  error: null,
} as const;

export const chatConnectorProviderFixtures: readonly ChatConnectorProviderFixture[] = [
  {
    kind: "whatsapp",
    label: "WhatsApp",
    bridgeMode: "managed_bridge",
    setup: { pluginName: "fixture-whatsapp-plugin", workspaceId: "fixture-workspace" },
    secrets: { bridgeApiKey: "fixture-whatsapp-bridge-secret" },
    channelId: "109876543210987",
    messageId: "wamid.fixture.1",
    inbound: {
      object: "whatsapp_business_account",
      entry: [{ id: "fixture-business-account", changes: [{ field: "messages", value: {
        messaging_product: "whatsapp",
        metadata: { display_phone_number: "+15550000100", phone_number_id: "109876543210987" },
        contacts: [{ profile: { name: "Fixture Sender" }, wa_id: "15550000101" }],
        messages: [{ from: "15550000101", id: "wamid.fixture.1", timestamp: "1784030400", text: { body: "Exercise the WhatsApp connector acceptance path" }, type: "text" }],
      } }] }],
    },
    outboundResponse: { externalMessageId: "wamid.fixture.out.1" },
    acceptanceSource: "mock",
  },
  {
    kind: "telegram",
    label: "Telegram",
    bridgeMode: "managed_bridge",
    setup: { workspaceId: "fixture-workspace", botUsername: "fixture_codeux_bot" },
    secrets: { bridgeApiKey: "fixture-telegram-bridge-secret" },
    channelId: "-100123450001",
    messageId: "101",
    inbound: {
      update_id: "telegram-update-fixture-1",
      message: { message_id: 101, date: 1784030400, message_thread_id: 7, text: "Exercise the Telegram connector acceptance path", chat: { id: "-100123450001", title: "Fixture channel" }, from: { id: "telegram-user-fixture", first_name: "Fixture" } },
    },
    outboundResponse: { messageId: "telegram-message-fixture-out-1" },
    acceptanceSource: "mock",
  },
  {
    kind: "slack",
    label: "Slack",
    bridgeMode: "managed_bridge",
    setup: { pluginName: "fixture-slack-plugin", workspaceId: "T-FIXTURE" },
    secrets: { bridgeApiKey: "fixture-slack-bridge-secret" },
    channelId: "C-FIXTURE",
    messageId: "Ev-fixture-1",
    inbound: { event_id: "Ev-fixture-1", team_id: "T-FIXTURE", event: { type: "message", channel: "C-FIXTURE", user: "U-FIXTURE", username: "Fixture User", text: "Exercise the Slack connector acceptance path", ts: "1784030400.000100" } },
    outboundResponse: { ts: "1784030401.000100", channel: "C-FIXTURE" },
    acceptanceSource: "mock",
  },
  {
    kind: "microsoft-teams",
    label: "Microsoft Teams",
    bridgeMode: "managed_bridge",
    setup: { pluginName: "fixture-teams-plugin", tenantId: "fixture-tenant" },
    secrets: { bridgeApiKey: "fixture-teams-bridge-secret" },
    channelId: "teams-conversation-fixture",
    messageId: "teams-activity-fixture-1",
    inbound: { type: "message", id: "teams-activity-fixture-1", timestamp: syntheticTimestamp, serviceUrl: teamsJwtMetadataFixture.serviceUrl, channelId: "msteams", from: { id: "teams-user-fixture", name: "Fixture User" }, conversation: { id: "teams-conversation-fixture", name: "Fixture conversation" }, text: "Exercise the Teams connector acceptance path", channelData: { tenant: { id: "fixture-tenant" } } },
    outboundResponse: { id: "teams-activity-fixture-out-1" },
    acceptanceSource: "local-emulator",
  },
  {
    kind: "discord",
    label: "Discord",
    bridgeMode: "webhook",
    setup: { gatewayUrl: "https://bridge.example.test/discord", applicationId: "discord-app-fixture" },
    secrets: { botToken: "fixture-discord-bot-token", webhookSecret: "fixture-discord-signing-secret" },
    channelId: "discord-channel-fixture",
    messageId: "discord-message-fixture-1",
    inbound: discordGatewayFixture.d,
    outboundResponse: { id: "discord-message-fixture-out-1" },
    acceptanceSource: "mock",
  },
  {
    kind: "imessage",
    label: "iMessage",
    bridgeMode: "managed_bridge",
    setup: { workspaceId: "fixture-workspace", deviceLabel: "fixture-macos-device" },
    secrets: { bridgeApiKey: "fixture-imessage-bridge-secret" },
    channelId: "imessage-chat-fixture",
    messageId: "imessage-message-fixture-1",
    inbound: imessageBridgeProtocolFixture,
    outboundResponse: {
      protocolVersion: IMESSAGE_BRIDGE_PROTOCOL_VERSION,
      operation: "send",
      correlation: { id: "imessage-correlation-fixture-1" },
      message: null,
      chat: null,
      sender: null,
      reply: null,
      result: { status: "sent", messageGuid: "imessage-message-fixture-out-1", chatGuid: "imessage-chat-fixture", metadata: { source: "fixture-bridge" } },
      error: null,
    },
    acceptanceSource: "local-emulator",
  },
] as const;

export function assertSyntheticConnectorFixture(value: unknown): void {
  const serialized = JSON.stringify(value);
  const forbidden = [
    /@(?:gmail|outlook|icloud|yahoo)\./i,
    /\b(?:prod|production|live[-_ ]?customer)\b/i,
    /\b(?:sk_live|xox[baprs]-|EA[A-Za-z0-9]{30,})/,
  ];
  if (forbidden.some((pattern) => pattern.test(serialized))) {
    throw new Error("Connector fixture contains a production-looking value.");
  }
}
