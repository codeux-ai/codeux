export type ChatProviderKind =
  | "whatsapp"
  | "imessage"
  | "telegram"
  | "slack"
  | "microsoft-teams"
  | "discord";

export type ChatProviderBridgeMode = "managed_bridge" | "webhook" | "native_bridge" | "official_api";

export type ChatProviderConnectionStatus =
  | "draft"
  | "active"
  | "disabled"
  | "error";

export type ChatProviderVerificationStatus =
  | "unverified"
  | "pending"
  | "verified"
  | "failed";

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
  | "official_api"
  | "bot_gateway";

export interface ChatProviderSetupFieldSchema {
  key: string;
  label: string;
  type: ChatProviderSetupFieldType;
  required: boolean;
  defaultValue?: string | boolean;
  options?: readonly string[];
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
  setupFields: readonly ChatProviderSetupFieldSchema[];
  secretFields: readonly ChatProviderSecretFieldSchema[];
}

export interface ChatProviderSetupSchema {
  kind: ChatProviderKind;
  label: string;
  defaultBridgeMode: ChatProviderBridgeMode;
  bridgeModes: readonly ChatProviderBridgeSetupSchema[];
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
  verificationStatus: ChatProviderVerificationStatus;
  verificationDetails: Record<string, unknown> | null;
  verifiedAt: string | null;
  secretVersion: number;
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
  nextAttemptAt?: string | null;
}

export interface UpdateChatProviderDeliveryStateInput {
  status: ChatProviderDeliveryStatus;
  attemptCount?: number;
  lastError?: string | null;
  externalMessageId?: string | null;
  conversationThreadId?: string | null;
  conversationMessageId?: string | null;
  payload?: Record<string, unknown> | null;
  nextAttemptAt?: string | null;
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
  nextAttemptAt: string | null;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ChatProviderIngressReplayReceiptRecord {
  id: string;
  providerConnectionId: string;
  receiptKey: string;
  expiresAt: string;
  createdAt: string;
}

export interface ChatProviderSessionStateRecord {
  id: string;
  providerConnectionId: string;
  channelBindingId: string | null;
  externalChannelId: string;
  sessionKey: string;
  state: Record<string, unknown>;
  version: number;
  expiresAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateChatProviderSessionStateInput {
  providerConnectionId: string;
  channelBindingId?: string | null;
  externalChannelId: string;
  sessionKey: string;
  state: Record<string, unknown>;
  expiresAt?: string | null;
}

export interface ClaimChatProviderDeliveriesInput {
  leaseOwner: string;
  leaseDurationMs: number;
  limit?: number;
  now?: Date;
}

export interface ReleaseChatProviderDeliveryInput {
  status?: "pending" | "retryable_failure";
  nextAttemptAt?: string | null;
  lastError?: string | null;
}

export {
  CHAT_PROVIDER_SETUP_SCHEMAS,
  getChatProviderSetupSchema,
} from "../domain/chat-connectors/registry.js";
