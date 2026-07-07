import type {
  ChatProviderBridgeMode,
  ChatProviderBridgeSetupSchema,
  ChatProviderChannelBindingRecord,
  ChatProviderKind,
  ChatProviderMessageDeliveryRecord,
  ChatProviderSetupConfig,
} from "../types.js";
import type {
  DashboardChatProviderConnectionRecord,
  DashboardChatProviderSetupDefinition,
} from "./chat-provider-api.js";

export const CHAT_PROVIDER_KINDS: ChatProviderKind[] = [
  "whatsapp",
  "imessage",
  "telegram",
  "slack",
  "microsoft-teams",
  "discord",
];

const SETUP_NOTES: Record<ChatProviderKind, string[]> = {
  whatsapp: [
    "Use a managed WhatsApp bridge, or paste the generated ingress URL into a Meta webhook gateway.",
    "Bind each WhatsApp group or business conversation by its external channel id before enabling inbound routing.",
  ],
  imessage: [
    "Use a managed iMessage bridge on a trusted Apple device, or run the macOS native bridge command from a locked-down local account.",
    "Native bridge mode accepts an optional bridge token; keep it in the secret field and rotate it if the host changes.",
  ],
  telegram: [
    "Connect a managed Telegram bridge or configure a Telegram bot webhook with the generated ingress URL.",
    "Use bot usernames and channel labels only for operator clarity; routing is based on the external channel id and binding hints.",
  ],
  slack: [
    "Configure Slack Events API or a managed Slack bridge to send message events to the connection ingress URL.",
    "Store Slack signing secrets or bot tokens only in the credential fields; saved values are returned as redacted metadata.",
  ],
  "microsoft-teams": [
    "Use a managed Teams bridge or a Teams bot endpoint that posts normalized activity payloads to the ingress URL.",
    "Tenant and bot identifiers belong in setup fields; bot passwords and signing material belong in secret fields.",
  ],
  discord: [
    "Configure a Discord bot or gateway to forward messages into the generated ingress URL.",
    "Enable outbound replies only after the bot token is stored and the target channels are explicitly bound.",
  ],
};

export interface ChatProviderDeliveryViewModel {
  id: string;
  statusLabel: string;
  retryLabel: string;
  channelLabel: string;
  attemptLabel: string;
  updatedAtLabel: string;
  redactedError: string;
  isRetryable: boolean;
}

export interface ChatProviderConnectionViewModel {
  id: string;
  providerKind: ChatProviderKind;
  displayName: string;
  statusLabel: string;
  bridgeModeLabel: string;
  ingressUrl: string;
  enabledLabel: string;
  authStatusLabel: string;
  configuredChannelCount: number;
  boundProjectCount: number;
  pendingOutboundCount: number;
  failedOutboundCount: number;
  outboundRepliesEnabled: boolean;
  recentFailedDeliveries: ChatProviderDeliveryViewModel[];
}

export interface ChatProviderCardViewModel {
  providerKind: ChatProviderKind;
  label: string;
  description: string;
  setupNotes: string[];
  connectionCount: number;
  activeConnectionCount: number;
  configuredChannelCount: number;
  boundProjectCount: number;
  pendingOutboundCount: number;
  failedOutboundCount: number;
  outboundRepliesEnabled: boolean;
  connections: ChatProviderConnectionViewModel[];
}

export const getChatProviderSetupNotes = (providerKind: ChatProviderKind): string[] => SETUP_NOTES[providerKind];

export const isChatProviderKind = (value: unknown): value is ChatProviderKind => (
  typeof value === "string" && (CHAT_PROVIDER_KINDS as string[]).includes(value)
);

export const getChatProviderDescription = (providerKind: ChatProviderKind): string => {
  switch (providerKind) {
    case "whatsapp":
      return "WhatsApp bridge, webhook setup, and project/channel routing.";
    case "imessage":
      return "iMessage managed or native macOS bridge with command controls.";
    case "telegram":
      return "Telegram bot and managed channel ingress for project chat.";
    case "slack":
      return "Slack Events or managed bridge with signed inbound routing.";
    case "microsoft-teams":
      return "Teams bot and managed bridge bindings for project channels.";
    case "discord":
      return "Discord bot or gateway connection with explicit channel bindings.";
  }
};

export const getBridgeModeLabel = (bridgeMode: ChatProviderBridgeMode): string => {
  switch (bridgeMode) {
    case "managed_bridge":
      return "Managed bridge";
    case "webhook":
      return "Webhook";
    case "native_bridge":
      return "Native bridge";
  }
};

export const findBridgeSchema = (
  definition: DashboardChatProviderSetupDefinition,
  bridgeMode: ChatProviderBridgeMode,
): ChatProviderBridgeSetupSchema => (
  definition.bridgeModes.find((bridge) => bridge.mode === bridgeMode) ?? definition.bridgeModes[0]!
);

export const createDefaultSetupForBridge = (
  definition: DashboardChatProviderSetupDefinition,
  bridgeMode: ChatProviderBridgeMode = definition.defaultBridgeMode,
): ChatProviderSetupConfig => {
  const bridge = findBridgeSchema(definition, bridgeMode);
  return Object.fromEntries(
    bridge.setupFields
      .filter((field) => field.defaultValue !== undefined)
      .map((field) => [field.key, field.defaultValue]),
  );
};

export const redactChatProviderError = (value: string | null | undefined): string => {
  if (!value?.trim()) {
    return "No error details were reported.";
  }

  return value
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\b(token|secret|password|api[_ -]?key)(\s*[=:]\s*)["']?[^"'\s,;]+/gi, "$1$2[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .trim();
};

const uniqueCount = (values: string[]): number => new Set(values.filter(Boolean)).size;

const formatStatus = (value: string): string => (
  value.split(/[-_]/g).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")
);

const buildDeliveryViewModel = (delivery: ChatProviderMessageDeliveryRecord): ChatProviderDeliveryViewModel => {
  const isRetryable = delivery.status === "failed" || delivery.status === "pending" || delivery.status === "sending";
  return {
    id: delivery.id,
    statusLabel: formatStatus(delivery.status),
    retryLabel: isRetryable ? "Retryable" : "Terminal",
    channelLabel: delivery.externalChannelId,
    attemptLabel: `${delivery.attemptCount} attempt${delivery.attemptCount === 1 ? "" : "s"}`,
    updatedAtLabel: delivery.updatedAt,
    redactedError: redactChatProviderError(delivery.lastError),
    isRetryable,
  };
};

const buildConnectionAuthLabel = (
  connection: DashboardChatProviderConnectionRecord,
  definition: DashboardChatProviderSetupDefinition,
): string => {
  const bridge = findBridgeSchema(definition, connection.bridgeMode);
  const requiredKeys = new Set(bridge.secretFields.filter((field) => field.required).map((field) => field.key));
  if (requiredKeys.size === 0) {
    return "No required secrets";
  }
  const configuredRequired = connection.credentials.filter((credential) => (
    requiredKeys.has(credential.key) && credential.configured
  )).length;
  return configuredRequired === requiredKeys.size
    ? "Authenticated"
    : `${configuredRequired}/${requiredKeys.size} secrets`;
};

export const buildChatProviderCatalogViewModel = (input: {
  definitions: DashboardChatProviderSetupDefinition[];
  connections: DashboardChatProviderConnectionRecord[];
  bindings: ChatProviderChannelBindingRecord[];
  deliveriesByConnection: Record<string, ChatProviderMessageDeliveryRecord[]>;
}): ChatProviderCardViewModel[] => (
  input.definitions.map((definition) => {
    const connections = input.connections.filter((connection) => connection.providerKind === definition.kind);
    const connectionViewModels = connections.map((connection) => {
      const bindings = input.bindings.filter((binding) => binding.providerConnectionId === connection.id);
      const deliveries = input.deliveriesByConnection[connection.id] ?? [];
      const recentFailedDeliveries = deliveries
        .filter((delivery) => delivery.status === "failed")
        .slice(0, 5)
        .map(buildDeliveryViewModel);
      return {
        id: connection.id,
        providerKind: connection.providerKind,
        displayName: connection.displayName,
        statusLabel: formatStatus(connection.status),
        bridgeModeLabel: connection.setupHints?.bridgeModeLabel || getBridgeModeLabel(connection.bridgeMode),
        ingressUrl: connection.ingressUrl,
        enabledLabel: connection.enabled ? "Enabled" : "Disabled",
        authStatusLabel: buildConnectionAuthLabel(connection, definition),
        configuredChannelCount: uniqueCount(bindings.map((binding) => binding.externalChannelId)),
        boundProjectCount: uniqueCount(bindings.map((binding) => binding.projectId)),
        pendingOutboundCount: deliveries.filter((delivery) => delivery.status === "pending" || delivery.status === "sending").length,
        failedOutboundCount: deliveries.filter((delivery) => delivery.status === "failed").length,
        outboundRepliesEnabled: bindings.some((binding) => binding.enabled && binding.outboundEnabled),
        recentFailedDeliveries,
      };
    });

    return {
      providerKind: definition.kind,
      label: definition.label,
      description: getChatProviderDescription(definition.kind),
      setupNotes: getChatProviderSetupNotes(definition.kind),
      connectionCount: connections.length,
      activeConnectionCount: connections.filter((connection) => connection.enabled && connection.status === "active").length,
      configuredChannelCount: connectionViewModels.reduce((sum, connection) => sum + connection.configuredChannelCount, 0),
      boundProjectCount: uniqueCount(input.bindings
        .filter((binding) => binding.providerKind === definition.kind)
        .map((binding) => binding.projectId)),
      pendingOutboundCount: connectionViewModels.reduce((sum, connection) => sum + connection.pendingOutboundCount, 0),
      failedOutboundCount: connectionViewModels.reduce((sum, connection) => sum + connection.failedOutboundCount, 0),
      outboundRepliesEnabled: connectionViewModels.some((connection) => connection.outboundRepliesEnabled),
      connections: connectionViewModels,
    };
  })
);
