import type {
  ChatProviderBridgeMode,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionStatus,
  ChatProviderKind,
  ChatProviderSecretConfig,
  ChatProviderSetupConfig,
} from "../../../../types.js";
import type {
  DashboardChatProviderConnectionRecord,
  DashboardChatProviderSetupDefinition,
} from "../../../lib/chat-provider-api.js";
import { createDefaultSetupForBridge, findBridgeSchema } from "../../../lib/chat-provider-view-models.js";

export interface ChatProviderConnectionDraft {
  displayName: string;
  bridgeMode: ChatProviderBridgeMode;
  status: ChatProviderConnectionStatus;
  enabled: boolean;
  setup: ChatProviderSetupConfig;
  secrets: Record<string, string>;
}

export interface ChatProviderBindingDraft {
  externalChannelId: string;
  externalChannelName: string;
  projectId: string;
  agentPresetId: string;
  projectSelectorPrefix: string;
  projectSelector: string;
  conversationThreadId: string;
  enabled: boolean;
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  suppressRichWidgets: boolean;
}

export const createConnectionDraft = (
  connection: DashboardChatProviderConnectionRecord,
  definition: DashboardChatProviderSetupDefinition,
): ChatProviderConnectionDraft => ({
  displayName: connection.displayName,
  bridgeMode: connection.bridgeMode,
  status: connection.status,
  enabled: connection.enabled,
  setup: { ...createDefaultSetupForBridge(definition, connection.bridgeMode), ...connection.setup },
  secrets: {},
});

const getRoutingHint = (binding: ChatProviderChannelBindingRecord, key: string): string => {
  const value = binding.routingHints?.[key];
  return typeof value === "string" ? value : "";
};

export const createBindingDraft = (binding: ChatProviderChannelBindingRecord): ChatProviderBindingDraft => ({
  externalChannelId: binding.externalChannelId,
  externalChannelName: binding.externalChannelName,
  projectId: binding.projectId,
  agentPresetId: binding.agentPresetId ?? "",
  projectSelectorPrefix: getRoutingHint(binding, "projectSelectorPrefix"),
  projectSelector: getRoutingHint(binding, "projectSelector"),
  conversationThreadId: getRoutingHint(binding, "conversationThreadId"),
  enabled: binding.enabled,
  inboundEnabled: binding.inboundEnabled,
  outboundEnabled: binding.outboundEnabled,
  suppressRichWidgets: binding.suppressRichWidgets,
});

export const createNewBindingDraft = (projectId: string): ChatProviderBindingDraft => ({
  externalChannelId: "",
  externalChannelName: "",
  projectId,
  agentPresetId: "",
  projectSelectorPrefix: "",
  projectSelector: "",
  conversationThreadId: "",
  enabled: true,
  inboundEnabled: true,
  outboundEnabled: false,
  suppressRichWidgets: true,
});

export const buildRoutingHints = (draft: ChatProviderBindingDraft): Record<string, string> | null => {
  const entries = [
    ["projectSelectorPrefix", draft.projectSelectorPrefix],
    ["projectSelector", draft.projectSelector],
    ["conversationThreadId", draft.conversationThreadId],
  ].filter((entry): entry is [string, string] => entry[1].trim().length > 0);
  return entries.length > 0
    ? Object.fromEntries(entries.map(([key, value]) => [key, value.trim()]))
    : null;
};

export const buildSecretUpdate = (
  draft: ChatProviderConnectionDraft,
  definition: DashboardChatProviderSetupDefinition,
): ChatProviderSecretConfig | undefined => {
  const allowedKeys = new Set(findBridgeSchema(definition, draft.bridgeMode).secretFields.map((field) => field.key));
  const secrets = Object.fromEntries(Object.entries(draft.secrets)
    .filter(([key, value]) => allowedKeys.has(key) && value.trim().length > 0)
    .map(([key, value]) => [key, value.trim()]));
  return Object.keys(secrets).length > 0 ? secrets : undefined;
};

const stableSetup = (setup: ChatProviderSetupConfig): string => JSON.stringify(
  Object.keys(setup).sort().map((key) => [key, setup[key]]),
);

export const hasMaterialConnectionEdits = (
  connection: DashboardChatProviderConnectionRecord,
  draft: ChatProviderConnectionDraft,
): boolean => (
  connection.bridgeMode !== draft.bridgeMode
  || stableSetup(connection.setup) !== stableSetup(draft.setup)
  || Object.values(draft.secrets).some((value) => value.trim().length > 0)
);

export const validateConnectionDraft = (
  connection: DashboardChatProviderConnectionRecord,
  definition: DashboardChatProviderSetupDefinition,
  draft: ChatProviderConnectionDraft,
): string[] => {
  const bridge = findBridgeSchema(definition, draft.bridgeMode);
  const issues: string[] = [];
  if (!draft.displayName.trim()) issues.push("Display name is required.");
  for (const field of bridge.setupFields) {
    const value = draft.setup[field.key];
    if (field.required && (value === undefined || value === null || (typeof value === "string" && !value.trim()))) {
      issues.push(`${field.label} is required.`);
    }
  }
  for (const field of bridge.secretFields) {
    const stored = connection.bridgeMode === draft.bridgeMode
      && connection.credentials.some((credential) => credential.key === field.key && credential.configured);
    if (field.required && !stored && !draft.secrets[field.key]?.trim()) issues.push(`${field.label} is required.`);
  }
  if (draft.status === "active") {
    if (!hasMaterialConnectionEdits(connection, draft) && connection.verificationStatus !== "verified") {
      issues.push("Test the connection successfully before activation.");
    }
  }
  return issues;
};

export const requiresConnectionChangeConfirmation = (
  connection: DashboardChatProviderConnectionRecord,
  definition: DashboardChatProviderSetupDefinition,
  draft: ChatProviderConnectionDraft,
): { required: boolean; reasons: string[] } => {
  const bridge = findBridgeSchema(definition, draft.bridgeMode);
  const endpointChanged = bridge.setupFields.some((field) => (
    (field.type === "url" || field.type === "command")
    && draft.setup[field.key] !== connection.setup[field.key]
  ));
  const secretReplaced = bridge.secretFields.some((field) => (
    Boolean(draft.secrets[field.key]?.trim())
    && connection.credentials.some((credential) => credential.key === field.key && credential.configured)
  ));
  const reasons = [
    ...(endpointChanged ? ["a command or provider endpoint"] : []),
    ...(secretReplaced ? ["stored credentials"] : []),
  ];
  return { required: reasons.length > 0, reasons };
};

export const getExternalChannelLabel = (providerKind: ChatProviderKind): string => ({
  discord: "Discord channel ID",
  whatsapp: "WhatsApp conversation ID",
  imessage: "iMessage chat GUID",
  telegram: "Telegram chat ID",
  slack: "Slack channel ID",
  "microsoft-teams": "Teams conversation ID",
})[providerKind];

export const getLongContentGuidance = (providerKind: ChatProviderKind): string => ({
  discord: "Long replies are split into Discord-safe messages and retain the bound thread when available.",
  whatsapp: "Long replies are split into provider-safe messages; rich dashboard widgets stay suppressed by default.",
  imessage: "Long replies are split for the bridge contract and keep the chat GUID and reply thread context.",
  telegram: "Long replies are split into Bot API-safe messages and retain message-thread identifiers when available.",
  slack: "Long replies are split into Slack-safe messages and retain thread timestamps when available.",
  "microsoft-teams": "Long replies are split into Teams-safe messages and retain conversation/thread identifiers when available.",
})[providerKind];
