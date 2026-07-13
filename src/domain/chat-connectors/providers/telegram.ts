import type { ChatProviderBridgeMode } from "../../../contracts/chat-provider-types.js";
import { redactText } from "../../../shared/security/redaction.js";
import type {
  ChatConnectorLiveVerificationResult,
  ChatConnectorOutboundContext,
  ChatConnectorOutboundResult,
  ChatConnectorProfile,
  PartialNormalizedChatConnectorInbound,
} from "../types.js";
import {
  buildLegacyHttpOutboundRequest,
  ChatConnectorOutboundResponseError,
  DEFAULT_CONNECTOR_TIMEOUT_MS,
  isLegacyRetryableHttpStatus,
  joinName,
  parseLegacyOutboundResponse,
  readRecord,
  readString,
  verifyConnectorConfiguration,
} from "../types.js";

const TELEGRAM_BOT_API_ORIGIN = "https://api.telegram.org";
const TELEGRAM_MAX_TEXT_LENGTH = 4_096;
const TELEGRAM_UPDATE_MESSAGE_KEYS = [
  "message",
  "channel_post",
  "edited_message",
  "edited_channel_post",
] as const;

type TelegramUpdateMessageKey = typeof TELEGRAM_UPDATE_MESSAGE_KEYS[number];

interface TelegramUpdateMessage {
  key: TelegramUpdateMessageKey;
  message: Record<string, unknown>;
}

const setupSchema = {
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
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
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
    {
      mode: "official_api",
      label: "Telegram Bot API",
      integration: "official_api",
      setupFields: [
        { key: "botUsername", label: "Bot username", type: "string", required: false },
      ],
      secretFields: [
        { key: "botToken", label: "Bot token", required: true },
        { key: "webhookSecret", label: "Webhook secret token", required: true },
      ],
    },
  ],
} as const;

export const telegramChatConnectorProfile: ChatConnectorProfile = {
  kind: "telegram",
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
        type: "header_secret",
        secretKeys: ["webhookSecret"],
        tokenHeaders: ["x-telegram-bot-api-secret-token"],
      },
    },
    handshake: { type: "none" },
    acknowledgement: { statusCode: 200, headers: { "content-type": "application/json" }, body: null },
    ignore: (body, mode) => {
      if (mode !== "official_api") {
        return { ignored: false };
      }
      const updateMessage = findTelegramUpdateMessage(body);
      const sender = readRecord(updateMessage?.message.from);
      return sender?.is_bot === true
        ? { ignored: true, reason: "bot_originated_update" }
        : { ignored: false };
    },
    normalize: (body, mode) => normalizeTelegramUpdate(body, mode),
  },
  identity: {
    resolve: (normalized, body) => {
      const updateMessage = findTelegramUpdateMessage(body);
      return {
        conversationId: readString(normalized.externalChannelId) ?? null,
        threadId: readString(updateMessage?.message.message_thread_id) ?? null,
      };
    },
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
        return buildTelegramSendMessageRequest(context);
      }
      throw new Error(`Unsupported bridge mode for telegram: ${mode}`);
    },
    parseResponse: (responseBody, context) => context?.mode === "official_api"
      ? parseTelegramSendMessageResponse(responseBody, context.statusCode)
      : parseLegacyOutboundResponse(responseBody),
    isRetryableStatus: (statusCode, mode) => mode === "official_api"
      ? statusCode === 429
      : isLegacyRetryableHttpStatus(statusCode),
  },
  verification: {
    strategy: "configuration_and_live",
    capabilities: ["setup", "authentication", "outbound"],
    verifyConfiguration: (mode, setup, secrets) => verifyTelegramConfiguration(mode, setup, secrets),
    verifyLive: (mode, setup, secrets) => verifyTelegramOfficialApi(mode, setup, secrets),
  },
  session: { required: false, scope: "connection", requirements: [] },
  officialDocumentation: [{ label: "Telegram Bot API", url: "https://core.telegram.org/bots/api" }],
  liveTest: { available: true, modes: ["official_api"] },
  lifecycle: { status: "stable", profileVersion: 2, introducedIn: "telegram-official-api" },
};

function normalizeTelegramUpdate(
  body: Record<string, unknown>,
  mode: ChatProviderBridgeMode,
): PartialNormalizedChatConnectorInbound {
  const updateMessage = findTelegramUpdateMessage(body);
  const message = updateMessage?.message;
  const chat = readRecord(message?.chat);
  const sender = readRecord(message?.from) ?? readRecord(message?.sender_chat) ?? chat;
  const updateId = readString(body.update_id);
  const chatId = readString(chat?.id);
  const messageId = readString(message?.message_id);
  return {
    externalChannelId: chatId,
    externalChannelName: readString(chat?.title, chat?.username, chat?.first_name, chat?.id),
    externalSenderId: readString(sender?.id, sender?.username),
    externalSenderName: joinName(sender?.first_name, sender?.last_name)
      ?? readString(sender?.username, sender?.title, sender?.id),
    textBody: readString(message?.text, message?.caption),
    externalMessageId: mode === "official_api" && updateId && chatId && messageId
      ? `telegram:${updateId}:${chatId}:${messageId}`
      : messageId,
    timestamp: message?.edit_date ?? message?.date,
  };
}

function findTelegramUpdateMessage(body: Record<string, unknown>): TelegramUpdateMessage | null {
  for (const key of TELEGRAM_UPDATE_MESSAGE_KEYS) {
    const message = readRecord(body[key]);
    if (message) {
      return { key, message };
    }
  }
  return null;
}

function buildTelegramSendMessageRequest(context: ChatConnectorOutboundContext) {
  const botToken = readBotToken(context.connection.secrets);
  const text = truncateTelegramText(context.payload.replyText);
  const sourceMessage = findSourceTelegramMessage(context.payload.metadata);
  const messageThreadId = readSafeInteger(sourceMessage?.message_thread_id);
  const replyMessageId = readSafeInteger(sourceMessage?.message_id)
    ?? readTelegramMessageId(context.payload.replyToExternalMessageId);
  return {
    transport: "http" as const,
    url: buildTelegramBotApiUrl(botToken, "sendMessage"),
    label: "Telegram Bot API endpoint",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": context.correlationId,
      "x-codeux-provider-kind": context.connection.providerKind,
      "x-codeux-bridge-mode": "official_api",
    },
    bearerSecretKeys: [],
    body: {
      chat_id: context.payload.channelId,
      text,
      ...(messageThreadId !== null ? { message_thread_id: messageThreadId } : {}),
      ...(replyMessageId !== null ? {
        reply_parameters: {
          message_id: replyMessageId,
          allow_sending_without_reply: true,
        },
      } : {}),
    },
    timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
  };
}

function truncateTelegramText(value: string): string {
  if (!value.trim()) {
    throw new Error("Telegram reply text is empty.");
  }
  return Array.from(value).slice(0, TELEGRAM_MAX_TEXT_LENGTH).join("");
}

function findSourceTelegramMessage(metadata: Record<string, unknown>): Record<string, unknown> | null {
  const inboundPayload = readRecord(metadata.inboundPayload);
  const rawMetadata = readRecord(inboundPayload?.rawMetadata);
  return rawMetadata ? findTelegramUpdateMessage(rawMetadata)?.message ?? null : null;
}

function readTelegramMessageId(value: string | null): number | null {
  if (!value) {
    return null;
  }
  const candidate = value.match(/(?:^|:)(\d+)$/)?.[1];
  return readSafeInteger(candidate);
}

function readSafeInteger(value: unknown): number | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) {
    return value;
  }
  if (typeof value === "string" && /^-?\d+$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  return null;
}

function readBotToken(secrets: Record<string, unknown> | null): string {
  const token = typeof secrets?.botToken === "string" ? secrets.botToken : "";
  if (!token || !/^[^\s/?#]+:[^\s/?#]+$/.test(token)) {
    throw new Error("Telegram bot token is not configured or has an invalid format.");
  }
  return token;
}

function buildTelegramBotApiUrl(token: string, method: "sendMessage" | "getMe" | "getWebhookInfo"): string {
  return `${TELEGRAM_BOT_API_ORIGIN}/bot${token}/${method}`;
}

export function parseTelegramSendMessageResponse(
  responseBody: string,
  statusCode = 200,
): ChatConnectorOutboundResult {
  const result = parseTelegramBotApiEnvelope(responseBody, statusCode);
  const message = readRecord(result);
  const messageId = readString(message?.message_id);
  if (!message || !messageId) {
    throw new ChatConnectorOutboundResponseError(
      "Telegram Bot API returned an invalid sendMessage result.",
      false,
      statusCode,
    );
  }
  return {
    externalMessageId: messageId,
    responseMetadata: {
      ok: true,
      chatId: readString(readRecord(message.chat)?.id) ?? null,
      messageThreadId: readString(message.message_thread_id) ?? null,
      date: message.date ?? null,
    },
  };
}

function parseTelegramBotApiEnvelope(responseBody: string, statusCode: number): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    throw new ChatConnectorOutboundResponseError(
      "Telegram Bot API returned an invalid JSON response.",
      false,
      statusCode,
    );
  }
  const envelope = readRecord(parsed);
  if (!envelope || typeof envelope.ok !== "boolean") {
    throw new ChatConnectorOutboundResponseError(
      "Telegram Bot API returned an invalid response envelope.",
      false,
      statusCode,
    );
  }
  if (!envelope.ok) {
    const errorCode = readSafeInteger(envelope.error_code) ?? statusCode;
    const description = typeof envelope.description === "string"
      ? redactTelegramBotApiUrls(redactText(envelope.description)).slice(0, 500)
      : "Request failed.";
    const retryAfterSeconds = readSafeInteger(readRecord(envelope.parameters)?.retry_after);
    throw new ChatConnectorOutboundResponseError(
      `Telegram Bot API error ${errorCode}: ${description}`,
      errorCode === 429,
      errorCode,
      errorCode === 429 && retryAfterSeconds !== null ? retryAfterSeconds * 1_000 : undefined,
    );
  }
  if (!("result" in envelope)) {
    throw new ChatConnectorOutboundResponseError(
      "Telegram Bot API response did not include a result.",
      false,
      statusCode,
    );
  }
  return envelope.result;
}

export async function verifyTelegramOfficialApi(
  mode: ChatProviderBridgeMode,
  setup: Record<string, unknown>,
  secrets: Record<string, unknown> | null,
  fetchImpl: typeof fetch = fetch,
): Promise<ChatConnectorLiveVerificationResult> {
  if (mode !== "official_api") {
    return { valid: false, issues: [`Live Telegram verification is unavailable for ${mode}.`] };
  }
  const configured = verifyTelegramConfiguration(mode, setup, secrets);
  if (!configured.valid) {
    return configured;
  }

  let botToken = "";
  try {
    botToken = readBotToken(secrets);
    const bot = readRecord(await callTelegramVerificationMethod(botToken, "getMe", fetchImpl));
    if (!bot || bot.is_bot !== true || !readString(bot.id)) {
      return { valid: false, issues: ["Telegram getMe returned an invalid bot identity."] };
    }
    const webhook = readRecord(await callTelegramVerificationMethod(botToken, "getWebhookInfo", fetchImpl));
    if (!webhook || typeof webhook.url !== "string" || !Number.isSafeInteger(webhook.pending_update_count)) {
      return { valid: false, issues: ["Telegram getWebhookInfo returned invalid diagnostics."] };
    }

    const expectedUsername = normalizeTelegramUsername(readString(setup.botUsername));
    const actualUsername = normalizeTelegramUsername(readString(bot.username));
    if (expectedUsername && expectedUsername !== actualUsername) {
      return {
        valid: false,
        issues: ["Configured Telegram bot username does not match getMe."],
        diagnostics: buildTelegramVerificationDiagnostics(bot, webhook, botToken),
      };
    }
    return {
      valid: true,
      issues: [],
      diagnostics: buildTelegramVerificationDiagnostics(bot, webhook, botToken),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Telegram Bot API verification failed.";
    return {
      valid: false,
      issues: [botToken ? message.replaceAll(botToken, "[REDACTED]") : "Telegram Bot API verification failed."],
    };
  }
}

function verifyTelegramConfiguration(
  mode: ChatProviderBridgeMode,
  setup: Record<string, unknown>,
  secrets: Record<string, unknown> | null,
): ChatConnectorLiveVerificationResult {
  const configured = verifyConnectorConfiguration(setupSchema, mode, setup, secrets);
  if (mode !== "official_api") {
    return configured;
  }
  const issues = [...configured.issues];
  const webhookSecret = secrets?.webhookSecret;
  if (
    typeof webhookSecret === "string"
    && webhookSecret.length > 0
    && (webhookSecret.length > 256 || !/^[A-Za-z0-9_-]+$/.test(webhookSecret))
  ) {
    issues.push("Telegram webhook secret token must be 1-256 characters using only A-Z, a-z, 0-9, _ and -.");
  }
  const botToken = secrets?.botToken;
  if (typeof botToken === "string" && botToken.length > 0 && !/^[^\s/?#]+:[^\s/?#]+$/.test(botToken)) {
    issues.push("Telegram bot token has an invalid format.");
  }
  return { valid: issues.length === 0, issues };
}

async function callTelegramVerificationMethod(
  botToken: string,
  method: "getMe" | "getWebhookInfo",
  fetchImpl: typeof fetch,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(buildTelegramBotApiUrl(botToken, method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
      signal: AbortSignal.timeout(DEFAULT_CONNECTOR_TIMEOUT_MS),
    });
  } catch {
    throw new Error(`Telegram ${method} request did not return a response.`);
  }
  const responseBody = await response.text().catch(() => "");
  return parseTelegramBotApiEnvelope(responseBody, response.status);
}

function buildTelegramVerificationDiagnostics(
  bot: Record<string, unknown>,
  webhook: Record<string, unknown>,
  botToken: string,
): Record<string, unknown> {
  const webhookUrl = typeof webhook.url === "string" ? webhook.url : "";
  return {
    bot: {
      id: readString(bot.id) ?? null,
      username: readString(bot.username) ?? null,
      firstName: readString(bot.first_name) ?? null,
    },
    webhook: {
      url: webhookUrl.includes(botToken) ? "[REDACTED]" : webhookUrl,
      hasCustomCertificate: webhook.has_custom_certificate === true,
      pendingUpdateCount: readSafeInteger(webhook.pending_update_count) ?? 0,
      ipAddress: readString(webhook.ip_address) ?? null,
      lastErrorDate: readSafeInteger(webhook.last_error_date),
      lastErrorMessage: typeof webhook.last_error_message === "string"
        ? redactTelegramBotApiUrls(redactText(webhook.last_error_message))
          .replaceAll(botToken, "[REDACTED]")
          .slice(0, 500)
        : null,
      maxConnections: readSafeInteger(webhook.max_connections),
      allowedUpdates: Array.isArray(webhook.allowed_updates)
        ? webhook.allowed_updates.filter((value): value is string => typeof value === "string")
        : [],
    },
  };
}

function normalizeTelegramUsername(value: string | undefined): string | null {
  return value ? value.replace(/^@/, "").toLowerCase() : null;
}

function redactTelegramBotApiUrls(value: string): string {
  return value.replace(/https:\/\/api\.telegram\.org\/bot[^/\s]+\//gi, "https://api.telegram.org/bot[REDACTED]/");
}
