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
import { settingsIntegrationsMessages } from "../i18n/messages/settings-integrations.js";
import { translateDashboardMessage, type DashboardLocale, type DashboardTextMessageKey } from "../i18n/locales.js";

export const CHAT_PROVIDER_KINDS: ChatProviderKind[] = [
  "whatsapp",
  "imessage",
  "telegram",
  "slack",
  "microsoft-teams",
  "discord",
];

const localized = (locale: DashboardLocale, key: DashboardTextMessageKey<typeof settingsIntegrationsMessages>): string => (
  translateDashboardMessage(settingsIntegrationsMessages, locale, key)
);

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

export const getChatProviderSetupNotes = (providerKind: ChatProviderKind, locale: DashboardLocale = "en"): string[] => {
  const keys = providerKind === "microsoft-teams"
    ? ["teamsNote1", "teamsNote2"] as const
    : [`${providerKind}Note1`, `${providerKind}Note2`] as const;
  return keys.map((key) => localized(locale, key));
};

export const isChatProviderKind = (value: unknown): value is ChatProviderKind => (
  typeof value === "string" && (CHAT_PROVIDER_KINDS as string[]).includes(value)
);

export const getChatProviderDescription = (providerKind: ChatProviderKind, locale: DashboardLocale = "en"): string => {
  switch (providerKind) {
    case "whatsapp":
      return localized(locale, "whatsappDescription");
    case "imessage":
      return localized(locale, "imessageDescription");
    case "telegram":
      return localized(locale, "telegramDescription");
    case "slack":
      return localized(locale, "slackDescription");
    case "microsoft-teams":
      return localized(locale, "teamsDescription");
    case "discord":
      return localized(locale, "discordDescription");
  }
};

export const getBridgeModeLabel = (bridgeMode: ChatProviderBridgeMode, locale: DashboardLocale = "en"): string => {
  switch (bridgeMode) {
    case "managed_bridge":
      return localized(locale, "managedBridge");
    case "webhook":
      return localized(locale, "webhook");
    case "native_bridge":
      return localized(locale, "nativeBridge");
  }
};

const CHAT_PROVIDER_FIELD_LABEL_KEYS = {
  "Plugin name": "pluginName",
  "Connector workspace": "connectorWorkspace",
  "Bridge API key": "bridgeApiKey",
  "Webhook URL": "webhookUrl",
  "Verify token name": "verifyTokenName",
  "Webhook signing secret": "webhookSigningSecret",
  "Verify token": "verifyToken",
  "Device label": "deviceLabel",
  "Bridge command": "bridgeCommand",
  "Working directory": "workingDirectory",
  "Bridge token": "bridgeToken",
  "Bot username": "botUsername",
  "Bot token": "botToken",
  "Webhook secret token": "webhookSecretToken",
  "Events webhook URL": "eventsWebhookUrl",
  "Slack app ID": "slackAppId",
  "Signing secret": "signingSecret",
  "Tenant ID": "tenantId",
  "Bot endpoint URL": "botEndpointUrl",
  "Bot app password": "botAppPassword",
  "Gateway URL": "gatewayUrl",
  "Application ID": "applicationId",
} as const satisfies Record<string, DashboardTextMessageKey<typeof settingsIntegrationsMessages>>;

export const getChatProviderFieldLabel = (
  fieldLabel: string,
  locale: DashboardLocale = "en",
): string => {
  const key = CHAT_PROVIDER_FIELD_LABEL_KEYS[fieldLabel as keyof typeof CHAT_PROVIDER_FIELD_LABEL_KEYS];
  return key ? localized(locale, key) : fieldLabel;
};

export const getChatProviderBridgeSetupLabel = (
  definition: DashboardChatProviderSetupDefinition,
  bridgeMode: ChatProviderBridgeMode,
  locale: DashboardLocale = "en",
): string => {
  const bridge = findBridgeSchema(definition, bridgeMode);
  return locale === "en" ? bridge.label : `${definition.label}: ${getBridgeModeLabel(bridgeMode, locale)}`;
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

export const redactChatProviderError = (value: string | null | undefined, locale: DashboardLocale = "en"): string => {
  if (!value?.trim()) {
    return localized(locale, "noErrorDetails");
  }

  return value
    .replace(/\b(bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, "$1[redacted]")
    .replace(/\b(token|secret|password|api[_ -]?key)(\s*[=:]\s*)["']?[^"'\s,;]+/gi, "$1$2[redacted]")
    .replace(/\b[A-Za-z0-9_-]{32,}\b/g, "[redacted]")
    .trim();
};

const uniqueCount = (values: string[]): number => new Set(values.filter(Boolean)).size;

const formatStatus = (value: string, locale: DashboardLocale): string => {
  const knownStatus = {
    draft: "statusDraft",
    active: "statusActive",
    disabled: "disabled",
    error: "statusError",
    pending: "statusPending",
    sending: "statusSending",
    failed: "statusFailed",
    delivered: "statusDelivered",
  } as const;
  const key = knownStatus[value as keyof typeof knownStatus];
  return key ? localized(locale, key) : value.split(/[-_]/g).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
};

const buildDeliveryViewModel = (delivery: ChatProviderMessageDeliveryRecord, locale: DashboardLocale): ChatProviderDeliveryViewModel => {
  const isRetryable = delivery.status === "failed" || delivery.status === "pending" || delivery.status === "sending";
  return {
    id: delivery.id,
    statusLabel: formatStatus(delivery.status, locale),
    retryLabel: localized(locale, isRetryable ? "retryable" : "terminal"),
    channelLabel: delivery.externalChannelId,
    attemptLabel: `${delivery.attemptCount} ${localized(locale, delivery.attemptCount === 1 ? "attempt" : "attempts")}`,
    updatedAtLabel: delivery.updatedAt,
    redactedError: redactChatProviderError(delivery.lastError, locale),
    isRetryable,
  };
};

const buildConnectionAuthLabel = (
  connection: DashboardChatProviderConnectionRecord,
  definition: DashboardChatProviderSetupDefinition,
  locale: DashboardLocale,
): string => {
  const bridge = findBridgeSchema(definition, connection.bridgeMode);
  const requiredKeys = new Set(bridge.secretFields.filter((field) => field.required).map((field) => field.key));
  if (requiredKeys.size === 0) {
    return localized(locale, "noRequiredSecrets");
  }
  const configuredRequired = connection.credentials.filter((credential) => (
    requiredKeys.has(credential.key) && credential.configured
  )).length;
  return configuredRequired === requiredKeys.size
    ? localized(locale, "authenticated")
    : `${configuredRequired}/${requiredKeys.size} ${localized(locale, "secrets")}`;
};

export const buildChatProviderCatalogViewModel = (input: {
  definitions: DashboardChatProviderSetupDefinition[];
  connections: DashboardChatProviderConnectionRecord[];
  bindings: ChatProviderChannelBindingRecord[];
  deliveriesByConnection: Record<string, ChatProviderMessageDeliveryRecord[]>;
  locale?: DashboardLocale;
}): ChatProviderCardViewModel[] => (
  input.definitions.map((definition) => {
    const locale = input.locale ?? "en";
    const connections = input.connections.filter((connection) => connection.providerKind === definition.kind);
    const connectionViewModels = connections.map((connection) => {
      const bindings = input.bindings.filter((binding) => binding.providerConnectionId === connection.id);
      const deliveries = input.deliveriesByConnection[connection.id] ?? [];
      const recentFailedDeliveries = deliveries
        .filter((delivery) => delivery.status === "failed")
        .slice(0, 5)
        .map((delivery) => buildDeliveryViewModel(delivery, locale));
      return {
        id: connection.id,
        providerKind: connection.providerKind,
        displayName: connection.displayName,
        statusLabel: formatStatus(connection.status, locale),
        bridgeModeLabel: connection.setupHints?.bridgeModeLabel || getBridgeModeLabel(connection.bridgeMode, locale),
        ingressUrl: connection.ingressUrl,
        enabledLabel: localized(locale, connection.enabled ? "enabled" : "disabled"),
        authStatusLabel: buildConnectionAuthLabel(connection, definition, locale),
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
      description: getChatProviderDescription(definition.kind, locale),
      setupNotes: getChatProviderSetupNotes(definition.kind, locale),
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
