import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import type { ChatProviderBridgeMode } from "../../../contracts/chat-provider-types.js";
import { ChatConnectorOutboundExecutionError } from "../types.js";
import type {
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
  readArray,
  readRecord,
  readString,
  verifyConnectorConfiguration,
} from "../types.js";

export const DISCORD_API_ORIGIN = "https://discord.com";
export const DISCORD_API_BASE_URL = `${DISCORD_API_ORIGIN}/api/v10`;
export const DISCORD_GATEWAY_URL = "wss://gateway.discord.gg/?v=10&encoding=json";
export const DISCORD_MESSAGE_CONTENT_INTENT = 1 << 15;
export const DISCORD_DEFAULT_INTENTS = (1 << 0) | (1 << 9) | (1 << 12) | DISCORD_MESSAGE_CONTENT_INTENT;

const DEFAULT_INTERACTION_TOLERANCE_MS = 5 * 60 * 1_000;
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
const SNOWFLAKE_PATTERN = /^\d{1,20}$/;

const setupSchema = {
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
    {
      mode: "official_api",
      label: "Discord official API",
      integration: "official_api",
      setupFields: [
        { key: "applicationId", label: "Application ID", type: "string", required: true },
        { key: "publicKey", label: "Interactions public key", type: "string", required: true },
        {
          key: "intents",
          label: "Gateway intents bitfield",
          type: "string",
          required: true,
          defaultValue: String(DISCORD_DEFAULT_INTENTS),
        },
      ],
      secretFields: [
        { key: "botToken", label: "Bot token (write-only)", required: true },
      ],
    },
  ],
} as const;

export type DiscordInteractionFailureCode =
  | "missing_signature"
  | "malformed_signature"
  | "missing_timestamp"
  | "malformed_timestamp"
  | "stale_timestamp"
  | "malformed_public_key"
  | "signature_mismatch"
  | "malformed_payload"
  | "unsupported_interaction";

export type DiscordInteractionResult =
  | {
    ok: true;
    kind: "ping";
    payload: Record<string, unknown>;
    response: { statusCode: 200; headers: { "content-type": "application/json" }; body: { type: 1 } };
  }
  | {
    ok: true;
    kind: "message";
    payload: Record<string, unknown>;
    normalized: PartialNormalizedChatConnectorInbound;
  }
  | {
    ok: false;
    statusCode: 400 | 401;
    code: DiscordInteractionFailureCode;
    message: string;
  };

export interface DiscordInteractionRequest {
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>;
  rawBody: string | Uint8Array;
  publicKey: string;
  now?: Date;
  timestampToleranceMs?: number;
}

export function verifyDiscordInteractionRequest(input: DiscordInteractionRequest): DiscordInteractionResult {
  const signature = getHeader(input.headers, "x-signature-ed25519");
  if (!signature) {
    return interactionFailure("missing_signature", "Missing Discord interaction signature.", 401);
  }
  if (!/^[a-f\d]{128}$/i.test(signature)) {
    return interactionFailure("malformed_signature", "Malformed Discord interaction signature.", 401);
  }
  const timestamp = getHeader(input.headers, "x-signature-timestamp");
  if (!timestamp) {
    return interactionFailure("missing_timestamp", "Missing Discord interaction timestamp.", 401);
  }
  if (!/^\d{1,16}$/.test(timestamp)) {
    return interactionFailure("malformed_timestamp", "Malformed Discord interaction timestamp.", 401);
  }
  const timestampMs = Number(timestamp) * 1_000;
  if (!Number.isSafeInteger(timestampMs)) {
    return interactionFailure("malformed_timestamp", "Malformed Discord interaction timestamp.", 401);
  }
  const toleranceMs = input.timestampToleranceMs ?? DEFAULT_INTERACTION_TOLERANCE_MS;
  if (Math.abs((input.now ?? new Date()).getTime() - timestampMs) > toleranceMs) {
    return interactionFailure("stale_timestamp", "Discord interaction timestamp is outside the allowed window.", 401);
  }
  const publicKey = input.publicKey.trim();
  if (!/^[a-f\d]{64}$/i.test(publicKey)) {
    return interactionFailure("malformed_public_key", "Malformed Discord interactions public key.", 401);
  }
  const rawBody = typeof input.rawBody === "string" ? Buffer.from(input.rawBody, "utf8") : Buffer.from(input.rawBody);
  const signedBody = Buffer.concat([Buffer.from(timestamp, "utf8"), rawBody]);
  try {
    const key = createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, Buffer.from(publicKey, "hex")]),
      format: "der",
      type: "spki",
    });
    if (!verifySignature(null, signedBody, key, Buffer.from(signature, "hex"))) {
      return interactionFailure("signature_mismatch", "Invalid Discord interaction signature.", 401);
    }
  } catch {
    return interactionFailure("signature_mismatch", "Invalid Discord interaction signature.", 401);
  }

  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(rawBody.toString("utf8")) as unknown;
    const record = readRecord(parsed);
    if (!record) {
      throw new Error("not an object");
    }
    payload = record;
  } catch {
    return interactionFailure("malformed_payload", "Malformed Discord interaction payload.", 400);
  }
  if (payload.type === 1) {
    return {
      ok: true,
      kind: "ping",
      payload,
      response: { statusCode: 200, headers: { "content-type": "application/json" }, body: { type: 1 } },
    };
  }
  const normalized = normalizeDiscordInteraction(payload);
  if (!normalized) {
    return interactionFailure("unsupported_interaction", "Unsupported Discord interaction payload.", 400);
  }
  return { ok: true, kind: "message", payload, normalized };
}

export type DiscordInboundEvent =
  | { kind: "message"; normalized: PartialNormalizedChatConnectorInbound; payload: Record<string, unknown> }
  | { kind: "ignored"; reason: "self_message" | "unsupported_event" };

export function normalizeDiscordGatewayEvent(
  payload: Record<string, unknown>,
  botUserId?: string | null,
): DiscordInboundEvent {
  if (payload.t === undefined && readRecord(payload.data)) {
    return { kind: "ignored", reason: "unsupported_event" };
  }
  const event = payload.t === "MESSAGE_CREATE" ? readRecord(payload.d) : payload;
  if (!event || (payload.t !== undefined && payload.t !== "MESSAGE_CREATE")) {
    return { kind: "ignored", reason: "unsupported_event" };
  }
  const author = readRecord(event.author);
  if (botUserId && readString(author?.id) === botUserId) {
    return { kind: "ignored", reason: "self_message" };
  }
  const normalized = normalizeDiscordMessage(event);
  return normalized.externalMessageId && normalized.externalChannelId && normalized.externalSenderId
    ? { kind: "message", normalized, payload: event }
    : { kind: "ignored", reason: "unsupported_event" };
}

function normalizeDiscordMessage(body: Record<string, unknown>): PartialNormalizedChatConnectorInbound {
  const channel = readRecord(body.channel);
  const author = readRecord(body.author) ?? readRecord(body.member);
  const user = readRecord(author?.user) ?? author;
  const thread = readRecord(body.thread);
  return {
    externalChannelId: readString(body.channel_id, channel?.id),
    externalChannelName: readString(channel?.name, body.channel_name, body.channel_id),
    externalSenderId: readString(user?.id),
    externalSenderName: readString(user?.global_name, user?.username, user?.name, user?.id),
    textBody: readString(body.content, body.text),
    externalMessageId: readString(body.id, body.message_id),
    timestamp: body.timestamp,
    externalThreadId: readString(body.thread_id, thread?.id, isThreadChannel(channel) ? channel?.id : undefined),
  };
}

function normalizeDiscordInteraction(body: Record<string, unknown>): PartialNormalizedChatConnectorInbound | null {
  if (![2, 3, 5].includes(Number(body.type))) {
    return null;
  }
  const channel = readRecord(body.channel);
  const member = readRecord(body.member);
  const user = readRecord(member?.user) ?? readRecord(body.user);
  const data = readRecord(body.data);
  const message = readRecord(body.message);
  const resolved = readRecord(data?.resolved);
  const resolvedMessages = readRecord(resolved?.messages);
  const firstResolvedMessage = resolvedMessages ? readRecord(Object.values(resolvedMessages)[0]) : null;
  const text = readString(
    message?.content,
    firstResolvedMessage?.content,
    collectInteractionValues(data),
    data?.custom_id,
    data?.name,
  );
  const channelId = readString(body.channel_id, channel?.id);
  const senderId = readString(user?.id);
  const messageId = readString(body.id);
  if (!channelId || !senderId || !messageId || !text) {
    return null;
  }
  return {
    externalChannelId: channelId,
    externalChannelName: readString(channel?.name, channelId),
    externalSenderId: senderId,
    externalSenderName: readString(user?.global_name, user?.username, member?.nick, senderId),
    textBody: text,
    externalMessageId: messageId,
    timestamp: body.timestamp,
    externalThreadId: readString(body.thread_id, isThreadChannel(channel) ? channelId : undefined),
  };
}

function collectInteractionValues(data: Record<string, unknown> | null): string | undefined {
  const values: string[] = [];
  const visit = (items: unknown): void => {
    for (const item of readArray(items) ?? []) {
      const option = readRecord(item);
      if (!option) continue;
      const value = readString(option.value);
      if (value) values.push(value);
      visit(option.options);
      visit(option.components);
    }
  };
  visit(data?.options);
  visit(data?.components);
  return values.join(" ") || undefined;
}

export type DiscordApiFailureCode =
  | "invalid_auth"
  | "missing_permissions"
  | "rate_limited"
  | "timeout"
  | "cancelled"
  | "ambiguous_network"
  | "provider_unavailable"
  | "invalid_response"
  | "invalid_request";

export class DiscordApiError extends ChatConnectorOutboundExecutionError {
  constructor(
    readonly code: DiscordApiFailureCode,
    message: string,
    retryable: boolean,
    statusCode?: number,
    readonly retryAfterMs?: number,
  ) {
    super(message, retryable, statusCode);
    this.name = "DiscordApiError";
  }
}

export interface DiscordCredentialVerificationResult {
  valid: boolean;
  classification: "verified" | DiscordApiFailureCode;
  botUserId?: string;
  botUsername?: string;
  issues: readonly string[];
}

interface DiscordApiClientDependencies {
  fetch?: typeof fetch;
  now?: () => number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  timeoutMs?: number;
  maxRateLimitWaitMs?: number;
}

export interface SendDiscordReplyInput {
  botToken: string;
  channelId: string;
  content: string;
  deliveryId: string;
  replyToMessageId?: string | null;
  signal?: AbortSignal;
}

export class DiscordOfficialApiClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly wait: (delayMs: number, signal?: AbortSignal) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly maxRateLimitWaitMs: number;
  private readonly routeAvailableAt = new Map<string, number>();
  private globalAvailableAt = 0;

  constructor(deps: DiscordApiClientDependencies = {}) {
    this.fetchImpl = deps.fetch ?? fetch;
    this.now = deps.now ?? Date.now;
    this.wait = deps.wait ?? abortableWait;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_CONNECTOR_TIMEOUT_MS;
    this.maxRateLimitWaitMs = deps.maxRateLimitWaitMs ?? 60_000;
  }

  async verifyCredentials(botToken: string, signal?: AbortSignal): Promise<DiscordCredentialVerificationResult> {
    try {
      const response = await this.request("GET", "/users/@me", botToken, undefined, "current-user", signal, false);
      const body = await readJsonRecord(response);
      const id = readString(body?.id);
      if (!id || !SNOWFLAKE_PATTERN.test(id)) {
        throw new DiscordApiError("invalid_response", "Discord returned an invalid current-user response.", false);
      }
      return {
        valid: true,
        classification: "verified",
        botUserId: id,
        botUsername: readString(body?.global_name, body?.username),
        issues: [],
      };
    } catch (error) {
      const normalized = normalizeDiscordApiError(error);
      return { valid: false, classification: normalized.code, issues: [normalized.message] };
    }
  }

  async sendReply(input: SendDiscordReplyInput): Promise<ChatConnectorOutboundResult> {
    requireSnowflake(input.channelId, "channel ID");
    if (input.replyToMessageId) requireSnowflake(input.replyToMessageId, "reply message ID");
    const nonce = stableDiscordNonce(input.deliveryId);
    const body: Record<string, unknown> = {
      content: input.content,
      allowed_mentions: { parse: [] },
      nonce,
      enforce_nonce: true,
    };
    if (input.replyToMessageId) {
      body.message_reference = { message_id: input.replyToMessageId, fail_if_not_exists: false };
    }
    const route = `channels:${input.channelId}:messages`;
    const response = await this.request(
      "POST",
      `/channels/${encodeURIComponent(input.channelId)}/messages`,
      input.botToken,
      body,
      route,
      input.signal,
      true,
    );
    const parsed = await readJsonRecord(response);
    const externalMessageId = readString(parsed?.id);
    if (!externalMessageId || !SNOWFLAKE_PATTERN.test(externalMessageId)) {
      throw new DiscordApiError("invalid_response", "Discord returned an invalid message response.", false);
    }
    return { externalMessageId, responseMetadata: { id: externalMessageId, nonce } };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    botToken: string,
    body: Record<string, unknown> | undefined,
    route: string,
    signal: AbortSignal | undefined,
    retryRateLimit: boolean,
  ): Promise<Response> {
    if (!botToken.trim()) {
      throw new DiscordApiError("invalid_auth", "Discord bot authentication is not configured.", false, 401);
    }
    for (let attempt = 0; attempt < (retryRateLimit ? 2 : 1); attempt += 1) {
      const delayMs = Math.max(this.globalAvailableAt, this.routeAvailableAt.get(route) ?? 0) - this.now();
      if (delayMs > this.maxRateLimitWaitMs) {
        throw new DiscordApiError("rate_limited", "Discord rate limit requires deferred retry.", true, 429, delayMs);
      }
      if (delayMs > 0) await this.wait(delayMs, signal);
      let response: Response;
      try {
        response = await this.fetchImpl(`${DISCORD_API_BASE_URL}${path}`, {
          method,
          headers: {
            authorization: `Bot ${botToken}`,
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: combineSignals(signal, AbortSignal.timeout(this.timeoutMs)),
          redirect: "error",
        });
      } catch (error) {
        if (signal?.aborted) throw new DiscordApiError("cancelled", "Discord request was cancelled.", false);
        if (isAbortError(error)) throw new DiscordApiError("timeout", "Discord request timed out.", true);
        throw new DiscordApiError("ambiguous_network", "Discord request outcome is unknown after a network failure.", true);
      }
      let retryAfterMs = this.captureRateLimits(route, response);
      if (response.status === 429 && retryAfterMs === 0) {
        retryAfterMs = await readRetryAfterBody(response);
        if (retryAfterMs > 0) this.recordRateLimit(route, response, retryAfterMs);
      }
      if (response.ok) return response;
      if (response.status === 429 && retryRateLimit && attempt === 0 && retryAfterMs > 0) {
        if (retryAfterMs > this.maxRateLimitWaitMs) throw classifyDiscordHttpFailure(response.status, retryAfterMs);
        await response.body?.cancel().catch(() => undefined);
        continue;
      }
      throw classifyDiscordHttpFailure(response.status, retryAfterMs);
    }
    throw new DiscordApiError("rate_limited", "Discord rate limit remained active after one retry.", true, 429);
  }

  private captureRateLimits(route: string, response: Response): number {
    const retryAfterMs = parseSecondsHeader(response.headers.get("retry-after"))
      ?? parseSecondsHeader(response.headers.get("x-ratelimit-reset-after"))
      ?? 0;
    if (response.headers.get("x-ratelimit-remaining") === "0" || response.status === 429) {
      this.recordRateLimit(route, response, retryAfterMs);
    }
    return retryAfterMs;
  }

  private recordRateLimit(route: string, response: Response, retryAfterMs: number): void {
    const availableAt = this.now() + retryAfterMs;
    if (response.headers.get("x-ratelimit-global") === "true") this.globalAvailableAt = availableAt;
    else this.routeAvailableAt.set(route, availableAt);
  }
}

export function stableDiscordNonce(deliveryId: string): string {
  return createHash("sha256").update(deliveryId).digest("hex").slice(0, 25);
}

function buildOfficialOutboundRequest(context: ChatConnectorOutboundContext) {
  const token = readString(context.connection.secrets?.botToken);
  if (!token) throw new DiscordApiError("invalid_auth", "Discord bot authentication is not configured.", false);
  requireSnowflake(context.payload.channelId, "channel ID");
  const nonce = stableDiscordNonce(context.delivery.id || context.payload.conversationMessageId);
  return {
    transport: "http" as const,
    url: `${DISCORD_API_BASE_URL}/channels/${encodeURIComponent(context.payload.channelId)}/messages`,
    label: "Discord API message endpoint",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": context.correlationId,
      authorization: `Bot ${token}`,
    },
    bearerSecretKeys: [],
    body: {
      content: context.payload.replyText,
      allowed_mentions: { parse: [] },
      nonce,
      enforce_nonce: true,
      ...(context.payload.replyToExternalMessageId
        ? { message_reference: { message_id: context.payload.replyToExternalMessageId, fail_if_not_exists: false } }
        : {}),
    },
    timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
  };
}

function parseOfficialOutboundResponse(text: string): ChatConnectorOutboundResult {
  let body: Record<string, unknown> | null = null;
  try { body = readRecord(JSON.parse(text)); } catch { /* handled below */ }
  const id = readString(body?.id);
  if (!id || !SNOWFLAKE_PATTERN.test(id)) {
    throw new DiscordApiError("invalid_response", "Discord returned an invalid message response.", false);
  }
  return { externalMessageId: id, responseMetadata: { id } };
}

export const discordChatConnectorProfile: ChatConnectorProfile = {
  kind: "discord",
  setupSchema,
  supportedTransportModes: ["webhook", "official_api"],
  ingress: {
    authentication: {
      webhook: {
        type: "hmac_sha256",
        secretKeys: ["signingSecret", "webhookSecret", "botAppPassword"],
        signatureHeaders: ["x-code-ux-signature", "x-hub-signature-256", "x-slack-signature", "x-signature"],
        timestampHeaders: ["x-code-ux-timestamp", "x-provider-timestamp", "x-slack-request-timestamp"],
        signatureBases: ({ timestamp, rawBody }) => [`${timestamp}.${rawBody}`, `v0:${timestamp}:${rawBody}`, rawBody],
      },
    },
    authenticateProviderRequest: ({ connection, headers, rawBody, now }) => {
      if (connection.bridgeMode !== "official_api") return null;
      const publicKey = readString(connection.setup.publicKey);
      if (!publicKey) {
        return {
          authenticated: false,
          code: "missing_public_key",
          message: "Discord interactions public key is not configured.",
          statusCode: 403,
        };
      }
      const result = verifyDiscordInteractionRequest({ headers, rawBody, publicKey, now });
      if (!result.ok) {
        return {
          authenticated: false,
          code: result.code,
          message: result.message,
          statusCode: result.statusCode,
        };
      }
      return {
        authenticated: true,
        method: "discord_ed25519",
        ...(result.kind === "ping" ? { immediateResponse: result.response } : {}),
      };
    },
    handshake: { type: "none" },
    acknowledgement: { statusCode: 200, headers: { "content-type": "application/json" }, body: null },
    normalize: (body) => {
      const gateway = normalizeDiscordGatewayEvent(body);
      if (gateway.kind === "message") return gateway.normalized;
      return normalizeDiscordInteraction(body) ?? {};
    },
  },
  identity: {
    resolve: (normalized, payload) => ({
      conversationId: readString(normalized.externalChannelId) ?? null,
      threadId: readString(normalized.externalThreadId, payload.thread_id) ?? null,
    }),
  },
  outbound: {
    createExecutor: (mode, runtime) => {
      if (mode !== "official_api") return null;
      const client = new DiscordOfficialApiClient(runtime);
      return {
        send: async (context) => {
          const botToken = readString(context.connection.secrets?.botToken);
          if (!botToken) {
            throw new DiscordApiError("invalid_auth", "Discord bot authentication is not configured.", false, 401);
          }
          return client.sendReply({
            botToken,
            channelId: context.payload.channelId,
            content: context.payload.replyText,
            deliveryId: context.delivery.id || context.payload.conversationMessageId,
            replyToMessageId: context.payload.replyToExternalMessageId,
          });
        },
      };
    },
    buildRequest: (context) => {
      if (context.connection.bridgeMode === "official_api") return buildOfficialOutboundRequest(context);
      if (context.connection.bridgeMode !== "webhook") {
        throw new Error(`Unsupported bridge mode for discord: ${context.connection.bridgeMode}`);
      }
      return buildLegacyHttpOutboundRequest(context, {
        mode: "webhook",
        urlKeys: ["outboundWebhookUrl", "webhookUrl", "eventsUrl", "botEndpointUrl", "gatewayUrl", "bridgeUrl", "url"],
        bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
        label: "webhook bridge URL",
      });
    },
    parseResponse: (body) => {
      try { return parseOfficialOutboundResponse(body); } catch { return parseLegacyOutboundResponse(body); }
    },
    isRetryableStatus: isLegacyRetryableHttpStatus,
  },
  verification: {
    strategy: "configuration_and_live",
    capabilities: ["setup", "authentication", "handshake", "outbound"],
    verifyConfiguration: (mode: ChatProviderBridgeMode, setup, secrets) => {
      const result = verifyConnectorConfiguration(setupSchema, mode, setup, secrets);
      if (!result.valid || mode !== "official_api") return result;
      const issues = [...result.issues];
      if (!/^[a-f\d]{64}$/i.test(readString(setup.publicKey) ?? "")) issues.push("Invalid Discord interactions public key.");
      const intents = Number(readString(setup.intents));
      if (!Number.isSafeInteger(intents) || intents < 0) issues.push("Invalid Discord Gateway intents bitfield.");
      if (Number.isSafeInteger(intents) && (intents & DISCORD_MESSAGE_CONTENT_INTENT) === 0) {
        issues.push("Discord MESSAGE_CONTENT intent is required to receive ordinary message text.");
      }
      return { valid: issues.length === 0, issues };
    },
  },
  session: {
    required: true,
    scope: "connection",
    requirements: [
      "Official API delivery owns a resumable Gateway v10 session.",
      "MESSAGE_CONTENT is a privileged intent and must be enabled in the Discord Developer Portal.",
    ],
  },
  officialDocumentation: [
    { label: "Discord Gateway", url: "https://docs.discord.com/developers/events/gateway" },
    { label: "Discord Gateway events", url: "https://docs.discord.com/developers/events/gateway-events" },
    { label: "Discord interactions", url: "https://docs.discord.com/developers/interactions/overview" },
    { label: "Discord messages", url: "https://docs.discord.com/developers/resources/message" },
    { label: "Discord rate limits", url: "https://docs.discord.com/developers/topics/rate-limits" },
  ],
  liveTest: { available: true, modes: ["official_api"], reason: "Uses Discord's read-only current-user endpoint." },
  lifecycle: { status: "preview", profileVersion: 2, introducedIn: "discord-official-api" },
};

function interactionFailure(
  code: DiscordInteractionFailureCode,
  message: string,
  statusCode: 400 | 401,
): DiscordInteractionResult {
  return { ok: false, code, message, statusCode };
}

function getHeader(
  headers: Headers | Readonly<Record<string, string | string[] | undefined>>,
  name: string,
): string | undefined {
  if (headers instanceof Headers) return headers.get(name)?.trim() || undefined;
  const value = Object.entries(headers).find(([key]) => key.toLowerCase() === name)?.[1];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || undefined;
}

function isThreadChannel(channel: Record<string, unknown> | null): boolean {
  return [10, 11, 12].includes(Number(channel?.type));
}

function requireSnowflake(value: string, label: string): void {
  if (!SNOWFLAKE_PATTERN.test(value)) {
    throw new DiscordApiError("invalid_request", `Invalid Discord ${label}.`, false);
  }
}

function classifyDiscordHttpFailure(status: number, retryAfterMs: number): DiscordApiError {
  if (status === 401) return new DiscordApiError("invalid_auth", "Discord rejected bot authentication.", false, status);
  if (status === 403) return new DiscordApiError("missing_permissions", "Discord bot permissions are insufficient.", false, status);
  if (status === 429) return new DiscordApiError("rate_limited", "Discord rate limit is active.", true, status, retryAfterMs);
  if (status >= 500) return new DiscordApiError("provider_unavailable", "Discord API is temporarily unavailable.", true, status);
  return new DiscordApiError("invalid_request", `Discord API rejected the request with HTTP ${status}.`, false, status);
}

function normalizeDiscordApiError(error: unknown): DiscordApiError {
  return error instanceof DiscordApiError
    ? error
    : new DiscordApiError("ambiguous_network", "Discord request failed with an unknown outcome.", true);
}

async function readJsonRecord(response: Response): Promise<Record<string, unknown> | null> {
  try { return readRecord(await response.json()); } catch { return null; }
}

async function readRetryAfterBody(response: Response): Promise<number> {
  try {
    const body = readRecord(await response.clone().json());
    const seconds = Number(body?.retry_after);
    return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : 0;
  } catch {
    return 0;
  }
}

function parseSecondsHeader(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.ceil(seconds * 1_000) : null;
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function combineSignals(left: AbortSignal | undefined, right: AbortSignal): AbortSignal {
  return left ? AbortSignal.any([left, right]) : right;
}

function abortableWait(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DiscordApiError("cancelled", "Discord request was cancelled.", false));
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    timer.unref?.();
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DiscordApiError("cancelled", "Discord request was cancelled.", false));
    }, { once: true });
  });
}
