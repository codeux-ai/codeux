import type { ChatConnectorProfile, PartialNormalizedChatConnectorInbound } from "../types.js";
import {
  DEFAULT_CONNECTOR_TIMEOUT_MS,
  buildLegacyHttpOutboundRequest,
  isLegacyRetryableHttpStatus,
  parseLegacyOutboundResponse,
  readArray,
  readRecord,
  readString,
  verifyConnectorConfiguration,
} from "../types.js";

export type MicrosoftBotApplicationType = "MultiTenant" | "SingleTenant";

export interface MicrosoftTeamsChannelAccount {
  id: string;
  name?: string;
  aadObjectId?: string;
}

export interface MicrosoftTeamsConversationAccount {
  id: string;
  name?: string;
  conversationType?: string;
  isGroup?: boolean;
}

export interface MicrosoftTeamsConversationReference {
  activityId: string;
  serviceUrl: string;
  serviceUrlValidated: true;
  channelId: string;
  locale?: string;
  tenantId?: string;
  teamId?: string;
  teamsChannelId?: string;
  conversation: MicrosoftTeamsConversationAccount;
  bot: MicrosoftTeamsChannelAccount;
  user: MicrosoftTeamsChannelAccount;
}

export interface NormalizedMicrosoftTeamsActivity extends PartialNormalizedChatConnectorInbound {
  activityType: "message";
  channelId?: string;
  locale?: string;
  tenantId?: string;
  teamId?: string;
  teamsChannelId?: string;
  replyToId?: string;
  conversation?: MicrosoftTeamsConversationAccount;
}

export class UnsupportedMicrosoftTeamsActivityError extends Error {
  readonly code = "unsupported_activity_type";

  constructor(readonly activityType: string) {
    super(`Unsupported Microsoft Teams activity type: ${activityType || "missing"}.`);
    this.name = "UnsupportedMicrosoftTeamsActivityError";
  }
}

const DOCUMENTED_MICROSOFT_BOT_SERVICE_HOSTS = new Set([
  "smba.trafficmanager.net",
  "smba.infra.gcc.teams.microsoft.com",
  "smba.infra.gov.teams.microsoft.us",
  "smba.infra.dod.teams.microsoft.us",
]);

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
    {
      mode: "official_api",
      label: "Microsoft Bot Connector API",
      integration: "official_api",
      setupFields: [
        { key: "microsoftAppId", label: "Microsoft app ID", type: "string", required: true },
        {
          key: "applicationType",
          label: "Application type",
          type: "select",
          required: true,
          defaultValue: "MultiTenant",
          options: ["MultiTenant", "SingleTenant"],
        },
        { key: "tenantId", label: "Microsoft tenant ID", type: "string", required: false },
      ],
      secretFields: [{ key: "clientSecret", label: "Client secret", required: true }],
    },
  ],
} as const;

export function normalizeMicrosoftTeamsActivity(
  body: Record<string, unknown>,
  options: { requireType?: boolean } = {},
): NormalizedMicrosoftTeamsActivity {
  const activityType = readString(body.type) ?? "";
  if ((options.requireType && activityType !== "message") || (activityType && activityType !== "message")) {
    throw new UnsupportedMicrosoftTeamsActivityError(activityType);
  }

  const conversation = readRecord(body.conversation);
  const sender = readRecord(body.from);
  const channelData = readRecord(body.channelData);
  const tenant = readRecord(channelData?.tenant);
  const team = readRecord(channelData?.team);
  const teamsChannel = readRecord(channelData?.channel);
  return {
    activityType: "message",
    externalChannelId: readString(conversation?.id, teamsChannel?.id, body.channelId),
    externalChannelName: readString(teamsChannel?.name, conversation?.name, conversation?.id),
    externalSenderId: readString(sender?.aadObjectId, sender?.id),
    externalSenderName: readString(sender?.name, sender?.id),
    textBody: removeBotMention(readString(body.text, body.body, body.content), body),
    externalMessageId: readString(body.id),
    timestamp: body.timestamp ?? body.localTimestamp,
    channelId: readString(body.channelId),
    locale: readString(body.locale),
    tenantId: readString(tenant?.id),
    teamId: readString(team?.id),
    teamsChannelId: readString(teamsChannel?.id),
    replyToId: readString(body.replyToId),
    conversation: conversation
      ? {
        id: readString(conversation.id) ?? "",
        name: readString(conversation.name),
        conversationType: readString(conversation.conversationType),
        isGroup: typeof conversation.isGroup === "boolean" ? conversation.isGroup : undefined,
      }
      : undefined,
  };
}

export function verifyMicrosoftTeamsConfiguration(
  mode: Parameters<ChatConnectorProfile["verification"]["verifyConfiguration"]>[0],
  setup: Record<string, unknown>,
  secrets: Record<string, unknown> | null,
): ReturnType<ChatConnectorProfile["verification"]["verifyConfiguration"]> {
  const baseline = verifyConnectorConfiguration(setupSchema, mode, setup, secrets);
  if (mode !== "official_api") {
    return baseline;
  }

  const issues = [...baseline.issues];
  const applicationType = readString(setup.applicationType);
  if (applicationType !== "MultiTenant" && applicationType !== "SingleTenant") {
    issues.push("Invalid application type: expected MultiTenant or SingleTenant");
  }
  if (applicationType === "SingleTenant" && !readString(setup.tenantId)) {
    issues.push("Missing required setup field for SingleTenant application: tenantId");
  }
  return { valid: issues.length === 0, issues };
}

export function buildMicrosoftTeamsActivityReplyRequest(
  reference: MicrosoftTeamsConversationReference,
  replyText: string,
  correlationId: string,
): ReturnType<ChatConnectorProfile["outbound"]["buildRequest"]> {
  if (reference.serviceUrlValidated !== true) {
    throw new Error("Microsoft Teams conversation reference does not contain a validated service URL.");
  }
  const baseUrl = new URL(reference.serviceUrl);
  if (!isDocumentedMicrosoftBotServiceUrl(baseUrl)) {
    throw new Error("Microsoft Teams conversation reference contains an invalid service URL.");
  }
  const basePath = baseUrl.pathname.replace(/\/+$/, "");
  baseUrl.pathname = `${basePath}/v3/conversations/${encodeURIComponent(reference.conversation.id)}/activities/${encodeURIComponent(reference.activityId)}`;
  baseUrl.search = "";
  baseUrl.hash = "";
  return {
    transport: "http" as const,
    url: baseUrl.toString(),
    label: "validated Microsoft Bot Connector service URL",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": correlationId,
    },
    bearerSecretKeys: [] as const,
    body: {
      type: "message",
      from: reference.bot,
      recipient: reference.user,
      conversation: reference.conversation,
      locale: reference.locale,
      replyToId: reference.activityId,
      text: replyText,
      channelData: {
        tenant: reference.tenantId ? { id: reference.tenantId } : undefined,
        team: reference.teamId ? { id: reference.teamId } : undefined,
        channel: reference.teamsChannelId ? { id: reference.teamsChannelId } : undefined,
      },
    },
    timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
  };
}

export const microsoftTeamsChatConnectorProfile: ChatConnectorProfile = {
  kind: "microsoft-teams",
  setupSchema,
  supportedTransportModes: ["managed_bridge", "webhook", "official_api"],
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
      official_api: {
        type: "bearer",
        secretKeys: [],
        tokenHeaders: ["authorization"],
        timestampHeaders: [],
      },
    },
    handshake: { type: "none" },
    acknowledgement: { statusCode: 200, headers: { "content-type": "application/json" }, body: null },
    normalize: normalizeMicrosoftTeamsActivity,
  },
  identity: {
    resolve: (normalized, payload) => ({
      conversationId: readString(normalized.externalChannelId) ?? null,
      threadId: readString(payload.replyToId, payload.id) ?? null,
    }),
  },
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
      if (mode === "official_api") {
        const reference = findConversationReference(context.payload.metadata);
        if (!reference) {
          throw new Error("Microsoft Teams official_api delivery requires a persisted validated conversation reference.");
        }
        return buildMicrosoftTeamsActivityReplyRequest(reference, context.payload.replyText, context.correlationId);
      }
      throw new Error(`Unsupported bridge mode for microsoft-teams: ${mode}`);
    },
    parseResponse: parseLegacyOutboundResponse,
    isRetryableStatus: isLegacyRetryableHttpStatus,
  },
  verification: {
    strategy: "configuration",
    capabilities: ["setup", "authentication", "outbound"],
    verifyConfiguration: verifyMicrosoftTeamsConfiguration,
  },
  session: {
    required: true,
    scope: "conversation",
    requirements: ["Persist a conversation reference only after Bot Connector JWT and service URL validation."],
  },
  officialDocumentation: [
    {
      label: "Bot Connector authentication",
      url: "https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-authentication?view=azure-bot-service-4.0",
    },
    {
      label: "Bot Connector send and receive messages",
      url: "https://learn.microsoft.com/en-us/azure/bot-service/rest-api/bot-framework-rest-connector-send-and-receive-messages?view=azure-bot-service-4.0",
    },
    {
      label: "Activity protocol",
      url: "https://learn.microsoft.com/en-us/microsoft-365/agents-sdk/activity-protocol",
    },
  ],
  liveTest: {
    available: false,
    modes: [],
    reason: "Microsoft provides Bot Framework Emulator and Agents tooling for local tests, not a public unauthenticated sandbox endpoint.",
  },
  lifecycle: { status: "stable", profileVersion: 2, introducedIn: "typed-registry" },
};

function removeBotMention(text: string | undefined, body: Record<string, unknown>): string | undefined {
  if (!text) {
    return undefined;
  }
  const recipient = readRecord(body.recipient);
  const botId = readString(recipient?.id);
  const botName = readString(recipient?.name);
  let normalized = text;
  for (const value of readArray(body.entities) ?? []) {
    const entity = readRecord(value);
    if (readString(entity?.type)?.toLowerCase() !== "mention") {
      continue;
    }
    const mentioned = readRecord(entity?.mentioned);
    const mentionedId = readString(mentioned?.id);
    const mentionedName = readString(mentioned?.name);
    if (botId && mentionedId !== botId) {
      continue;
    }
    if (!botId && botName && mentionedName !== botName) {
      continue;
    }
    const mentionText = readString(entity?.text);
    if (mentionText) {
      normalized = normalized.replace(new RegExp(escapeRegExp(mentionText), "gi"), " ");
    }
    if (mentionedName) {
      normalized = normalized.replace(new RegExp(`<at>\\s*${escapeRegExp(mentionedName)}\\s*</at>`, "gi"), " ");
    }
  }
  return normalized.replace(/&nbsp;/gi, " ").replace(/\s+/g, " ").trim() || undefined;
}

function findConversationReference(metadata: Record<string, unknown>): MicrosoftTeamsConversationReference | null {
  const direct = readRecord(metadata.microsoftTeamsConversationReference);
  const inboundPayload = readRecord(metadata.inboundPayload);
  const rawMetadata = readRecord(inboundPayload?.rawMetadata);
  const nested = readRecord(rawMetadata?.microsoftTeamsConversationReference);
  return parseConversationReference(direct ?? nested);
}

function parseConversationReference(value: Record<string, unknown> | null): MicrosoftTeamsConversationReference | null {
  if (!value || value.serviceUrlValidated !== true) {
    return null;
  }
  const conversation = readRecord(value.conversation);
  const bot = readRecord(value.bot);
  const user = readRecord(value.user);
  const activityId = readString(value.activityId);
  const serviceUrl = readString(value.serviceUrl);
  const channelId = readString(value.channelId);
  const conversationId = readString(conversation?.id);
  const botId = readString(bot?.id);
  const userId = readString(user?.id);
  if (!activityId || !serviceUrl || !channelId || !conversationId || !botId || !userId) {
    return null;
  }
  return {
    activityId,
    serviceUrl,
    serviceUrlValidated: true,
    channelId,
    locale: readString(value.locale),
    tenantId: readString(value.tenantId),
    teamId: readString(value.teamId),
    teamsChannelId: readString(value.teamsChannelId),
    conversation: {
      id: conversationId,
      name: readString(conversation?.name),
      conversationType: readString(conversation?.conversationType),
      isGroup: typeof conversation?.isGroup === "boolean" ? conversation.isGroup : undefined,
    },
    bot: {
      id: botId,
      name: readString(bot?.name),
      aadObjectId: readString(bot?.aadObjectId),
    },
    user: {
      id: userId,
      name: readString(user?.name),
      aadObjectId: readString(user?.aadObjectId),
    },
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isDocumentedMicrosoftBotServiceUrl(value: string | URL): boolean {
  try {
    const url = value instanceof URL ? value : new URL(value);
    const hostname = url.hostname.toLowerCase();
    const channelHost = hostname.endsWith(".botframework.com")
      && hostname !== "login.botframework.com"
      && hostname !== "api.botframework.com"
      && hostname !== "state.botframework.com";
    return url.protocol === "https:"
      && !url.username
      && !url.password
      && !url.port
      && !url.search
      && !url.hash
      && (DOCUMENTED_MICROSOFT_BOT_SERVICE_HOSTS.has(hostname) || channelHost);
  } catch {
    return false;
  }
}
