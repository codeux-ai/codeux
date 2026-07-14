import type {
  ChatConnectorHttpResponse,
  ChatConnectorLiveVerificationResult,
  ChatConnectorOutboundContext,
  ChatConnectorOutboundResult,
  ChatConnectorProfile,
  PartialNormalizedChatConnectorInbound,
} from "../types.js";
import {
  DEFAULT_CONNECTOR_TIMEOUT_MS,
  buildLegacyHttpOutboundRequest,
  isLegacyRetryableHttpStatus,
  parseLegacyOutboundResponse,
  readRecord,
  readString,
  resolveLegacyIdentity,
  verifyConnectorConfiguration,
} from "../types.js";

const SLACK_AUTH_TEST_URL = "https://slack.com/api/auth.test";
const SLACK_POST_MESSAGE_URL = "https://slack.com/api/chat.postMessage";
const SLACK_CHANNEL_INTERVAL_MS = 1_000;
const CONNECTOR_EVENT_TYPE = "codeux_connector_message";

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
      label: "Custom Slack-compatible webhook",
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
    {
      mode: "official_api",
      label: "Slack Events and Web APIs",
      integration: "official_api",
      setupFields: [
        { key: "appId", label: "Slack app ID", type: "string", required: true },
        { key: "workspaceId", label: "Slack workspace ID", type: "string", required: true },
        { key: "workspaceName", label: "Workspace display name", type: "string", required: false },
      ],
      secretFields: [
        { key: "signingSecret", label: "Signing secret", required: true },
        { key: "botToken", label: "Bot token", required: true },
      ],
    },
  ],
} as const;

export const slackChatConnectorProfile: ChatConnectorProfile = {
  kind: "slack",
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
        type: "hmac_sha256",
        secretKeys: ["signingSecret"],
        signatureHeaders: ["x-slack-signature"],
        timestampHeaders: ["x-slack-request-timestamp"],
        signaturePrefix: "v0=",
        signatureBases: ({ timestamp, rawBody }) => [`v0:${timestamp}:${rawBody}`],
      },
    },
    handshake: {
      type: "challenge",
      challengeField: "challenge",
      responseField: "challenge",
      modes: ["official_api"],
    },
    acknowledgement: {
      statusCode: 200,
      headers: { "content-type": "application/json" },
      body: null,
      deadlineMs: 2_500,
      immediateModes: ["official_api"],
    },
    ignore: getSlackIgnoredEventReason,
    normalize: normalizeSlackEvent,
  },
  identity: {
    resolve: (normalized, payload) => ({
      conversationId: readString(normalized.externalChannelId) ?? null,
      threadId: readString(normalized.conversationThreadId) ?? resolveLegacyIdentity(normalized, payload).threadId,
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
        return buildSlackPostMessageRequest(context);
      }
      throw new Error(`Unsupported bridge mode for slack: ${mode}`);
    },
    parseResponse: (responseBody, context) => context?.bridgeMode === "official_api"
      ? parseSlackPostMessageResponse(responseBody, context)
      : parseLegacyOutboundResponse(responseBody),
    isRetryableStatus: isLegacyRetryableHttpStatus,
    ambiguousTransportFailureModes: ["official_api"],
  },
  verification: {
    strategy: "configuration_and_live",
    capabilities: ["setup", "authentication", "handshake", "outbound"],
    verifyConfiguration: (mode, setup, secrets) => verifyConnectorConfiguration(setupSchema, mode, setup, secrets),
    live: {
      buildRequest: ({ correlationId }) => ({
        transport: "http",
        url: SLACK_AUTH_TEST_URL,
        label: "Slack auth.test API",
        headers: {
          "content-type": "application/json; charset=utf-8",
          "x-correlation-id": correlationId,
        },
        bearerSecretKeys: ["botToken"],
        body: {},
        timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
      }),
      parseResponse: parseSlackAuthTestResponse,
    },
  },
  session: { required: false, scope: "connection", requirements: [] },
  officialDocumentation: [
    { label: "Slack request verification", url: "https://api.slack.com/docs/verifying-requests-from-slack" },
    { label: "Slack Events API", url: "https://api.slack.com/apis/connections/events-api" },
    { label: "Slack auth.test", url: "https://api.slack.com/methods/auth.test" },
    { label: "Slack chat.postMessage", url: "https://api.slack.com/methods/chat.postMessage" },
    { label: "Slack rate limits", url: "https://api.slack.com/apis/rate-limits" },
  ],
  liveTest: { available: true, modes: ["official_api"] },
  lifecycle: { status: "stable", profileVersion: 2, introducedIn: "slack-official-api" },
};

export function getSlackChallengeResponse(payload: Record<string, unknown>): Record<string, string> | null {
  return payload.type === "url_verification" && typeof payload.challenge === "string" && payload.challenge
    ? { challenge: payload.challenge }
    : null;
}

export function getSlackIgnoredEventReason(payload: Record<string, unknown>): string | null {
  if (payload.type !== "event_callback") {
    return payload.type === "url_verification" ? null : "unsupported_callback";
  }
  const event = readRecord(payload.event);
  if (!event) {
    return "missing_event";
  }
  const message = event.subtype === "message_changed" ? readRecord(event.message) : event;
  if (!message) {
    return "message_change_without_text";
  }
  if (isConnectorGenerated(message) || isConnectorGenerated(event)) {
    return "connector_generated";
  }
  if (readString(message.bot_id, event.bot_id) || message.bot_profile || event.bot_profile || event.subtype === "bot_message") {
    return "bot_message";
  }
  if (event.subtype === "message_changed" && !readString(message.text)) {
    return "message_change_without_text";
  }
  if (!readString(message.text)) {
    return "message_without_text";
  }
  return null;
}

export function normalizeSlackEvent(payload: Record<string, unknown>): PartialNormalizedChatConnectorInbound {
  const event = readRecord(payload.event) ?? payload;
  const message = event.subtype === "message_changed" ? readRecord(event.message) ?? event : event;
  return {
    externalChannelId: readString(event.channel, message.channel, event.channel_id),
    externalChannelName: readString(event.channel_name, message.channel_name, event.channel),
    externalSenderId: readString(message.user, event.user, message.user_id),
    externalSenderName: readString(message.username, event.username, message.user_name, message.user),
    textBody: readString(message.text),
    externalMessageId: readString(payload.event_id, message.client_msg_id, event.event_ts, message.ts),
    conversationThreadId: readString(message.thread_ts, event.thread_ts, message.ts),
    timestamp: message.ts ?? event.event_ts,
  };
}

export function parseSlackPostMessageResponse(
  responseBody: string,
  response?: ChatConnectorHttpResponse,
): ChatConnectorOutboundResult {
  const envelope = parseSlackEnvelope(responseBody);
  if (!envelope) {
    return {
      failure: {
        message: `Slack chat.postMessage returned an invalid response${response ? ` (HTTP ${response.statusCode})` : ""}.`,
        retryable: response ? isLegacyRetryableHttpStatus(response.statusCode) : false,
      },
    };
  }
  if (envelope.ok !== true) {
    const errorCode = safeSlackErrorCode(envelope.error);
    const diagnostic = getSlackPostCapabilityDiagnostic(errorCode);
    return {
      failure: {
        message: `Slack chat.postMessage failed: ${errorCode}.`,
        retryable: isRetryableSlackError(errorCode) || (response ? isLegacyRetryableHttpStatus(response.statusCode) : false),
        ...(diagnostic ? { diagnostic } : {}),
      },
    };
  }
  return {
    externalMessageId: readString(envelope.ts, readRecord(envelope.message)?.ts) ?? null,
    responseMetadata: { ok: true },
  };
}

export function parseSlackAuthTestResponse(
  responseBody: string,
  response: ChatConnectorHttpResponse,
  setup: Record<string, unknown>,
): ChatConnectorLiveVerificationResult {
  const envelope = parseSlackEnvelope(responseBody);
  const expectedWorkspaceId = readString(setup.workspaceId);
  const actualWorkspaceId = readString(envelope?.team_id);
  const errorCode = safeSlackErrorCode(envelope?.error);
  const tokenRevoked = ["account_inactive", "invalid_auth", "not_authed", "token_revoked"].includes(errorCode);
  const authenticated = response.statusCode >= 200 && response.statusCode < 300 && envelope?.ok === true;
  const botIdentity = authenticated && Boolean(readString(envelope?.bot_id));
  const workspaceMatches = authenticated && Boolean(expectedWorkspaceId && actualWorkspaceId === expectedWorkspaceId);
  const scopeHeader = getHeader(response.headers, "x-oauth-scopes");
  const scopes = scopeHeader?.split(",").map((scope) => scope.trim()).filter(Boolean) ?? [];
  const scopeStatus = scopeHeader ? (scopes.includes("chat:write") ? "available" : "missing") : "unknown";
  const issues: string[] = [];
  if (!authenticated) {
    issues.push(tokenRevoked ? "Slack bot token is invalid or revoked." : `Slack authentication failed: ${errorCode}.`);
  }
  if (authenticated && !botIdentity) {
    issues.push("Slack token does not resolve to a bot identity.");
  }
  if (authenticated && !workspaceMatches) {
    issues.push("Slack token workspace does not match the configured workspace.");
  }
  if (scopeStatus === "missing") {
    issues.push("Slack bot token is missing the chat:write scope.");
  }
  return {
    valid: issues.length === 0,
    issues,
    diagnostics: [
      {
        capability: "bot_token",
        status: authenticated ? "available" : "missing",
        message: authenticated ? "Slack accepted the bot token." : tokenRevoked
          ? "The bot token is invalid or revoked."
          : "Slack did not accept the bot token.",
      },
      {
        capability: "bot_identity",
        status: botIdentity ? "available" : "missing",
        message: botIdentity ? "The token resolves to a Slack bot." : "The token does not resolve to a Slack bot.",
      },
      {
        capability: "workspace_binding",
        status: workspaceMatches ? "available" : "missing",
        message: workspaceMatches
          ? "The bot token is bound to the configured workspace."
          : "The bot token workspace does not match the configured workspace.",
      },
      {
        capability: "chat:write",
        status: scopeStatus,
        message: scopeStatus === "available" ? "The bot token has chat:write."
          : scopeStatus === "missing" ? "The bot token is missing chat:write."
          : "Slack did not report granted scopes; chat:write could not be confirmed.",
      },
      {
        capability: "channel_membership",
        status: "unknown",
        message: "Channel membership is checked when Slack accepts chat.postMessage for a bound channel.",
      },
    ],
  };
}

function buildSlackPostMessageRequest(context: ChatConnectorOutboundContext) {
  const threadTimestamp = resolveSlackThreadTimestamp(context);
  return {
    transport: "http" as const,
    url: SLACK_POST_MESSAGE_URL,
    label: "Slack chat.postMessage API",
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-correlation-id": context.correlationId,
    },
    bearerSecretKeys: ["botToken"],
    body: {
      channel: context.payload.channelId,
      text: context.payload.replyText,
      ...(threadTimestamp ? { thread_ts: threadTimestamp } : {}),
      metadata: {
        event_type: CONNECTOR_EVENT_TYPE,
        event_payload: { source: "codeux" },
      },
    },
    timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
    rateLimit: {
      key: `slack:${context.connection.id}:${context.payload.channelId}`,
      minimumIntervalMs: SLACK_CHANNEL_INTERVAL_MS,
    },
  };
}

function resolveSlackThreadTimestamp(context: ChatConnectorOutboundContext): string | undefined {
  const inboundPayload = readRecord(context.payload.metadata.inboundPayload);
  const rawMetadata = readRecord(inboundPayload?.rawMetadata);
  const event = readRecord(rawMetadata?.event);
  const changedMessage = readRecord(event?.message);
  return readString(
    changedMessage?.thread_ts,
    event?.thread_ts,
    changedMessage?.ts,
    event?.ts,
    rawMetadata?.conversationThreadId,
  );
}

function isConnectorGenerated(value: Record<string, unknown>): boolean {
  const metadata = readRecord(value.metadata) ?? readRecord(value.event_metadata);
  return readString(metadata?.event_type) === CONNECTOR_EVENT_TYPE;
}

function parseSlackEnvelope(responseBody: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(responseBody) as unknown);
  } catch {
    return null;
  }
}

function safeSlackErrorCode(value: unknown): string {
  const code = readString(value);
  return code && /^[a-z0-9_]+$/i.test(code) ? code : "unknown_error";
}

function isRetryableSlackError(errorCode: string): boolean {
  return ["fatal_error", "internal_error", "rate_limited", "ratelimited", "request_timeout", "service_unavailable"].includes(errorCode);
}

function getSlackPostCapabilityDiagnostic(errorCode: string) {
  if (errorCode === "missing_scope") {
    return {
      capability: "chat:write",
      status: "missing" as const,
      message: "The bot token is missing chat:write.",
    };
  }
  if (["channel_not_found", "not_in_channel"].includes(errorCode)) {
    return {
      capability: "channel_membership",
      status: "missing" as const,
      message: "The bot cannot post to the bound channel; verify the channel and invite the app.",
    };
  }
  if (["account_inactive", "invalid_auth", "not_authed", "token_revoked"].includes(errorCode)) {
    return {
      capability: "bot_token",
      status: "missing" as const,
      message: "The bot token is invalid or revoked.",
    };
  }
  return null;
}

function getHeader(headers: Readonly<Record<string, string>>, name: string): string | undefined {
  const entry = Object.entries(headers).find(([key]) => key.toLowerCase() === name.toLowerCase());
  return entry?.[1];
}
