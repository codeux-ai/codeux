export type ChatProviderKind =
  | "whatsapp"
  | "imessage"
  | "telegram"
  | "slack"
  | "microsoft-teams"
  | "discord";

export type ChatProviderBridgeMode = "managed_bridge" | "webhook" | "native_bridge";

export type ChatProviderConnectionStatus =
  | "draft"
  | "active"
  | "disabled"
  | "error";

export type ChatProviderDeliveryDirection = "inbound" | "outbound";

export type ChatProviderDeliveryStatus =
  | "pending"
  | "sending"
  | "delivered"
  | "retryable_failure"
  | "processed"
  | "failed"
  | "duplicate"
  | "cancelled";

export type ChatProviderSetupFieldType =
  | "string"
  | "url"
  | "command"
  | "boolean"
  | "select";

export type ChatProviderBridgeIntegration =
  | "managed_core"
  | "managed_plugin"
  | "webhook"
  | "native_bridge"
  | "bot_gateway";

export interface ChatProviderSetupFieldSchema {
  key: string;
  label: string;
  type: ChatProviderSetupFieldType;
  required: boolean;
  defaultValue?: string | boolean;
  options?: string[];
}

export interface ChatProviderSecretFieldSchema {
  key: string;
  label: string;
  required: boolean;
}

export interface ChatProviderBridgeSetupSchema {
  mode: ChatProviderBridgeMode;
  label: string;
  integration: ChatProviderBridgeIntegration;
  setupFields: ChatProviderSetupFieldSchema[];
  secretFields: ChatProviderSecretFieldSchema[];
}

export interface ChatProviderSetupSchema {
  kind: ChatProviderKind;
  label: string;
  defaultBridgeMode: ChatProviderBridgeMode;
  bridgeModes: ChatProviderBridgeSetupSchema[];
}

export type ChatProviderSetupConfig = Record<string, unknown>;
export type ChatProviderSecretConfig = Record<string, unknown>;
export type ChatProviderRoutingHints = Record<string, unknown>;
export type ExternalChannelMetadata = Record<string, unknown>;

export interface RedactedCredentialField {
  key: string;
  label: string;
  configured: boolean;
  redactedValue: string | null;
}

export interface CreateChatProviderConnectionInput {
  providerKind: ChatProviderKind;
  displayName: string;
  bridgeMode?: ChatProviderBridgeMode;
  status?: ChatProviderConnectionStatus;
  enabled?: boolean;
  setup?: ChatProviderSetupConfig;
  secrets?: ChatProviderSecretConfig | null;
}

export interface UpdateChatProviderConnectionInput {
  displayName?: string;
  bridgeMode?: ChatProviderBridgeMode;
  status?: ChatProviderConnectionStatus;
  enabled?: boolean;
  setup?: ChatProviderSetupConfig;
  secrets?: ChatProviderSecretConfig | null;
}

export interface ChatProviderConnectionRecord {
  id: string;
  providerKind: ChatProviderKind;
  displayName: string;
  bridgeMode: ChatProviderBridgeMode;
  status: ChatProviderConnectionStatus;
  enabled: boolean;
  setup: ChatProviderSetupConfig;
  credentials: RedactedCredentialField[];
  createdAt: string;
  updatedAt: string;
}

export interface ChatProviderConnectionInternalRecord extends Omit<ChatProviderConnectionRecord, "credentials"> {
  secrets: ChatProviderSecretConfig | null;
}

export interface CreateChatProviderChannelBindingInput {
  providerConnectionId: string;
  externalChannelId: string;
  externalChannelName: string;
  externalChannelMetadata?: ExternalChannelMetadata | null;
  projectId: string;
  agentPresetId?: string | null;
  routingHints?: ChatProviderRoutingHints | null;
  enabled?: boolean;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  suppressRichWidgets?: boolean;
}

export interface UpdateChatProviderChannelBindingInput {
  externalChannelName?: string;
  externalChannelMetadata?: ExternalChannelMetadata | null;
  projectId?: string;
  agentPresetId?: string | null;
  routingHints?: ChatProviderRoutingHints | null;
  enabled?: boolean;
  inboundEnabled?: boolean;
  outboundEnabled?: boolean;
  suppressRichWidgets?: boolean;
}

export interface ChatProviderChannelBindingRecord {
  id: string;
  providerConnectionId: string;
  providerKind: ChatProviderKind;
  externalChannelId: string;
  externalChannelName: string;
  externalChannelMetadata: ExternalChannelMetadata | null;
  projectId: string;
  agentPresetId: string | null;
  routingHints: ChatProviderRoutingHints | null;
  enabled: boolean;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  suppressRichWidgets: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RecordInboundChatProviderMessageInput {
  providerConnectionId: string;
  channelBindingId?: string | null;
  externalChannelId: string;
  externalMessageId: string;
  conversationThreadId?: string | null;
  conversationMessageId?: string | null;
  payload?: Record<string, unknown> | null;
  status?: ChatProviderDeliveryStatus;
}

export interface UpsertOutboundChatProviderDeliveryInput {
  providerConnectionId: string;
  channelBindingId?: string | null;
  externalChannelId: string;
  externalMessageId?: string | null;
  conversationThreadId?: string | null;
  conversationMessageId: string;
  payload?: Record<string, unknown> | null;
  status?: ChatProviderDeliveryStatus;
  attemptCount?: number;
  lastError?: string | null;
}

export interface UpdateChatProviderDeliveryStateInput {
  status: ChatProviderDeliveryStatus;
  attemptCount?: number;
  lastError?: string | null;
  externalMessageId?: string | null;
  conversationThreadId?: string | null;
  conversationMessageId?: string | null;
  payload?: Record<string, unknown> | null;
}

export interface ChatProviderMessageDeliveryRecord {
  id: string;
  providerConnectionId: string;
  providerKind: ChatProviderKind;
  channelBindingId: string | null;
  externalChannelId: string;
  externalMessageId: string | null;
  direction: ChatProviderDeliveryDirection;
  status: ChatProviderDeliveryStatus;
  attemptCount: number;
  lastError: string | null;
  conversationThreadId: string | null;
  conversationMessageId: string | null;
  payload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
}

export const CHAT_PROVIDER_SETUP_SCHEMAS: readonly ChatProviderSetupSchema[] = [
  {
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
        secretFields: [
          { key: "bridgeApiKey", label: "Bridge API key", required: true },
        ],
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
  },
  {
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
        secretFields: [
          { key: "bridgeApiKey", label: "Bridge API key", required: true },
        ],
      },
      {
        mode: "native_bridge",
        label: "macOS native bridge command",
        integration: "native_bridge",
        setupFields: [
          { key: "command", label: "Bridge command", type: "command", required: true },
          { key: "workingDirectory", label: "Working directory", type: "string", required: false },
        ],
        secretFields: [
          { key: "bridgeToken", label: "Bridge token", required: false },
        ],
      },
    ],
  },
  {
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
        secretFields: [
          { key: "bridgeApiKey", label: "Bridge API key", required: true },
        ],
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
  },
  {
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
        secretFields: [
          { key: "bridgeApiKey", label: "Bridge API key", required: true },
        ],
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
  },
  {
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
        secretFields: [
          { key: "bridgeApiKey", label: "Bridge API key", required: true },
        ],
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
  },
  {
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
  },
];

export function getChatProviderSetupSchema(kind: ChatProviderKind): ChatProviderSetupSchema {
  const schema = CHAT_PROVIDER_SETUP_SCHEMAS.find((entry) => entry.kind === kind);
  if (!schema) {
    throw new Error(`Unsupported chat provider kind: ${kind}`);
  }
  return schema;
}
