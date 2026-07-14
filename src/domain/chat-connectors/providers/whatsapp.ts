import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { ChatProviderBridgeMode } from "../../../contracts/chat-provider-types.js";
import { redactText } from "../../../shared/security/redaction.js";
import type {
  ChatConnectorOutboundErrorClassification,
  ChatConnectorOutboundContext,
  ChatConnectorOutboundResponseContext,
  ChatConnectorOutboundResult,
  ChatConnectorProfile,
  ChatConnectorVerificationResult,
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
  resolveLegacyIdentity,
  verifyConnectorConfiguration,
} from "../types.js";

const WHATSAPP_GRAPH_API_ORIGIN = "https://graph.facebook.com";
const PHONE_NUMBER_FIELDS = "id,display_phone_number,verified_name,quality_rating";
const RETRYABLE_GRAPH_ERROR_CODES = new Set([1, 2, 4, 17, 32, 341, 613, 80004, 130429, 131048, 131056]);

const setupSchema = {
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
      secretFields: [{ key: "bridgeApiKey", label: "Bridge API key", required: true }],
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
    {
      mode: "official_api",
      label: "WhatsApp Cloud API",
      integration: "official_api",
      setupFields: [
        { key: "graphApiVersion", label: "Graph API version", type: "string", required: true },
        { key: "phoneNumberId", label: "Phone-number ID", type: "string", required: true },
        { key: "appId", label: "Meta app ID", type: "string", required: false },
        { key: "businessAccountId", label: "WhatsApp Business Account ID", type: "string", required: false },
      ],
      secretFields: [
        { key: "accessToken", label: "Access token", required: true },
        { key: "appSecret", label: "Meta app secret", required: true },
        { key: "webhookVerifyToken", label: "Webhook verify token", required: true },
      ],
    },
  ],
} as const;

export interface WhatsAppWebhookChallengeResult {
  verified: boolean;
  statusCode: 200 | 403;
  body: string;
}

export interface WhatsAppStatusEvent {
  externalChannelId?: string;
  externalMessageId?: string;
  recipientId?: string;
  status?: string;
  timestamp?: unknown;
}

export type NormalizedWhatsAppWebhook =
  | { kind: "message"; message: PartialNormalizedChatConnectorInbound }
  | { kind: "status"; statuses: readonly WhatsAppStatusEvent[] }
  | { kind: "unsupported" };

export interface WhatsAppGraphErrorClassification {
  retryable: boolean;
  statusCode: number;
  code: number | null;
  subcode: number | null;
  type: string | null;
  isTransient: boolean;
  message: string;
}

export interface WhatsAppVerifiedPhoneNumber {
  id: string;
  displayPhoneNumber: string | null;
  verifiedName: string | null;
  qualityRating: string | null;
}

export interface WhatsAppOfficialConnectionVerificationResult extends ChatConnectorVerificationResult {
  retryable: boolean;
  resource: WhatsAppVerifiedPhoneNumber | null;
}

export interface WhatsAppChatConnectorProfile extends ChatConnectorProfile {
  officialApi: {
    webhook: {
      verifyChallenge: typeof verifyWhatsAppWebhookChallenge;
      verifySignature: typeof verifyWhatsAppWebhookSignature;
      normalize: typeof normalizeWhatsAppWebhook;
    };
    outbound: {
      classifyError: typeof classifyWhatsAppGraphError;
    };
    verification: {
      verifyConnection: typeof verifyWhatsAppOfficialConnection;
    };
  };
}

export function verifyWhatsAppWebhookChallenge(
  query: Record<string, unknown>,
  webhookVerifyToken: string,
): WhatsAppWebhookChallengeResult {
  const mode = readExactString(query["hub.mode"]);
  const actualToken = readExactString(query["hub.verify_token"]);
  const challenge = readExactString(query["hub.challenge"]);
  const verified = mode === "subscribe"
    && challenge !== null
    && challenge.length > 0
    && actualToken !== null
    && webhookVerifyToken.length > 0
    && constantTimeEquals(actualToken, webhookVerifyToken);

  return verified
    ? { verified: true, statusCode: 200, body: challenge }
    : { verified: false, statusCode: 403, body: "Forbidden" };
}

export function verifyWhatsAppWebhookSignature(
  rawBody: string | Uint8Array,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  const match = signatureHeader?.trim().match(/^sha256=([a-f0-9]{64})$/i);
  if (!match || !appSecret) {
    return false;
  }
  const expected = createHmac("sha256", appSecret).update(rawBody).digest("hex");
  return constantTimeEquals(match[1].toLowerCase(), expected);
}

export function normalizeWhatsAppWebhook(payload: Record<string, unknown>): NormalizedWhatsAppWebhook {
  const value = readRecord(readArray(readRecord(readArray(payload.entry)?.[0])?.changes)?.[0])?.value;
  const valueRecord = readRecord(value);
  if (!valueRecord) {
    return { kind: "unsupported" };
  }

  const metadata = readRecord(valueRecord.metadata);
  const message = readRecord(readArray(valueRecord.messages)?.[0]);
  if (message) {
    const contact = readRecord(readArray(valueRecord.contacts)?.[0]);
    return {
      kind: "message",
      message: {
        externalChannelId: readString(metadata?.phone_number_id, payload.phone_number_id),
        externalChannelName: readString(metadata?.display_phone_number, metadata?.phone_number_id),
        externalSenderId: readString(message.from, contact?.wa_id),
        externalSenderName: readString(readRecord(contact?.profile)?.name, contact?.wa_id),
        textBody: readString(
          readRecord(message.text)?.body,
          readRecord(message.image)?.caption,
          readRecord(message.video)?.caption,
          readRecord(message.document)?.caption,
          readRecord(message.button)?.text,
          message.body,
        ),
        externalMessageId: readString(message.id),
        timestamp: message.timestamp,
      },
    };
  }

  const statuses = readArray(valueRecord.statuses);
  if (statuses) {
    return {
      kind: "status",
      statuses: statuses.map((candidate) => {
        const status = readRecord(candidate);
        return {
          externalChannelId: readString(metadata?.phone_number_id, payload.phone_number_id),
          externalMessageId: readString(status?.id),
          recipientId: readString(status?.recipient_id),
          status: readString(status?.status),
          timestamp: status?.timestamp,
        };
      }),
    };
  }

  return { kind: "unsupported" };
}

export function classifyWhatsAppGraphError(
  statusCode: number,
  responseBody: string,
): WhatsAppGraphErrorClassification {
  const payload = parseJsonRecord(responseBody);
  const error = readRecord(payload?.error);
  const code = readFiniteNumber(error?.code);
  const subcode = readFiniteNumber(error?.error_subcode);
  const isTransient = error?.is_transient === true;
  const retryable = isLegacyRetryableHttpStatus(statusCode)
    || isTransient
    || (code !== null && RETRYABLE_GRAPH_ERROR_CODES.has(code));
  const identifiers = [
    `HTTP ${statusCode}`,
    code === null ? null : `code ${code}`,
    subcode === null ? null : `subcode ${subcode}`,
  ].filter((value): value is string => value !== null);

  return {
    retryable,
    statusCode,
    code,
    subcode,
    type: sanitizeGraphErrorType(error?.type),
    isTransient,
    message: `Meta Graph API request failed (${identifiers.join(", ")}).`,
  };
}

export async function verifyWhatsAppOfficialConnection(
  setup: Record<string, unknown>,
  secrets: Record<string, unknown> | null,
  fetchImplementation: typeof fetch = globalThis.fetch,
): Promise<WhatsAppOfficialConnectionVerificationResult> {
  const configuration = verifyWhatsAppConfiguration("official_api", setup, secrets);
  if (!configuration.valid) {
    return { ...configuration, retryable: false, resource: null };
  }

  const graphApiVersion = requireGraphApiVersion(setup.graphApiVersion);
  const phoneNumberId = requirePhoneNumberId(setup.phoneNumberId);
  const accessToken = requireConfiguredString(secrets?.accessToken, "accessToken");
  const url = `${WHATSAPP_GRAPH_API_ORIGIN}/${graphApiVersion}/${phoneNumberId}?fields=${PHONE_NUMBER_FIELDS}`;

  let response: Response;
  try {
    response = await fetchImplementation(url, {
      method: "GET",
      headers: { authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(DEFAULT_CONNECTOR_TIMEOUT_MS),
    });
  } catch (error) {
    return {
      valid: false,
      issues: [`Meta Graph API verification failed: ${sanitizeNetworkError(error, [accessToken])}`],
      retryable: true,
      resource: null,
    };
  }

  const responseBody = await response.text().catch(() => "");
  if (!response.ok) {
    const classification = classifyWhatsAppGraphError(response.status, responseBody);
    return {
      valid: false,
      issues: [classification.message],
      retryable: classification.retryable,
      resource: null,
    };
  }

  const resource = parseJsonRecord(responseBody);
  const returnedId = readString(resource?.id);
  if (returnedId !== phoneNumberId) {
    return {
      valid: false,
      issues: ["Meta Graph API verification returned a different phone-number resource."],
      retryable: false,
      resource: null,
    };
  }

  return {
    valid: true,
    issues: [],
    retryable: false,
    resource: {
      id: returnedId,
      displayPhoneNumber: readString(resource?.display_phone_number) ?? null,
      verifiedName: readString(resource?.verified_name) ?? null,
      qualityRating: readString(resource?.quality_rating) ?? null,
    },
  };
}

function verifyWhatsAppConfiguration(
  mode: ChatProviderBridgeMode,
  setup: Record<string, unknown>,
  secrets: Record<string, unknown> | null,
): ChatConnectorVerificationResult {
  const base = verifyConnectorConfiguration(setupSchema, mode, setup, secrets);
  if (mode !== "official_api") {
    return base;
  }

  const issues = [...base.issues];
  if (readString(setup.graphApiVersion) && !isGraphApiVersion(setup.graphApiVersion)) {
    issues.push("Graph API version must use the v{major}.{minor} format.");
  }
  if (readString(setup.phoneNumberId) && !isPhoneNumberId(setup.phoneNumberId)) {
    issues.push("Phone-number ID must contain digits only.");
  }
  return { valid: issues.length === 0, issues };
}

function buildOfficialOutboundRequest(context: ChatConnectorOutboundContext) {
  const graphApiVersion = requireGraphApiVersion(context.connection.setup.graphApiVersion);
  const phoneNumberId = requirePhoneNumberId(context.connection.setup.phoneNumberId);
  const recipientId = resolveInboundSenderWhatsAppId(context);
  const replyToMessageId = readString(context.payload.replyToExternalMessageId);

  return {
    transport: "http" as const,
    url: `${WHATSAPP_GRAPH_API_ORIGIN}/${graphApiVersion}/${phoneNumberId}/messages`,
    label: "WhatsApp Cloud API messages endpoint",
    headers: {
      "content-type": "application/json",
      "x-correlation-id": context.correlationId,
      "x-codeux-provider-kind": "whatsapp",
      "x-codeux-bridge-mode": "official_api",
    },
    bearerSecretKeys: ["accessToken"],
    body: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: recipientId,
      ...(replyToMessageId ? { context: { message_id: replyToMessageId } } : {}),
      type: "text",
      text: {
        preview_url: false,
        body: context.payload.replyText,
      },
    },
    timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
  };
}

function resolveInboundSenderWhatsAppId(context: ChatConnectorOutboundContext): string {
  const metadata = context.payload.metadata;
  const inboundPayload = readRecord(metadata.inboundPayload);
  const triggeringMetadata = readRecord(metadata.triggeringMessageMetadata);
  const directSender = readRecord(metadata.externalSender);
  const recipient = readString(
    readRecord(inboundPayload?.externalSender)?.id,
    readRecord(triggeringMetadata?.externalSender)?.id,
    directSender?.id,
  );
  if (!recipient || !/^\d{5,20}$/.test(recipient)) {
    throw new Error("Inbound sender WhatsApp ID is unavailable for outbound delivery.");
  }
  return recipient;
}

function classifyWhatsAppOutboundError(
  statusCode: number,
  responseBody: string,
  context?: ChatConnectorOutboundResponseContext,
): ChatConnectorOutboundErrorClassification | null {
  if (context?.bridgeMode !== "official_api") {
    return null;
  }
  const hasStructuredError = readRecord(parseJsonRecord(responseBody)?.error) !== null;
  if (statusCode >= 200 && statusCode < 300 && !hasStructuredError) {
    return null;
  }
  return classifyWhatsAppGraphError(statusCode, responseBody);
}

function parseWhatsAppOutboundResponse(
  responseBody: string,
  context?: ChatConnectorOutboundResponseContext,
): ChatConnectorOutboundResult {
  if (context?.bridgeMode !== "official_api") {
    return parseLegacyOutboundResponse(responseBody);
  }
  const payload = parseJsonRecord(responseBody);
  if (!payload) {
    return parseLegacyOutboundResponse(responseBody);
  }
  if (readRecord(payload.error)) {
    throw new Error(classifyWhatsAppGraphError(200, responseBody).message);
  }
  const messages = readArray(payload.messages);
  if (!messages) {
    return parseLegacyOutboundResponse(responseBody);
  }
  const externalMessageId = readString(readRecord(messages[0])?.id) ?? null;
  return {
    externalMessageId,
    responseMetadata: {
      messagingProduct: readString(payload.messaging_product) ?? "whatsapp",
      messageCount: messages.length,
    },
  };
}

function parseJsonRecord(value: string): Record<string, unknown> | null {
  try {
    return readRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function requireGraphApiVersion(value: unknown): string {
  const version = readString(value);
  if (!version || !isGraphApiVersion(version)) {
    throw new Error("WhatsApp Graph API version must use the v{major}.{minor} format.");
  }
  return version;
}

function isGraphApiVersion(value: unknown): boolean {
  return typeof value === "string" && /^v\d{1,3}\.\d{1,2}$/.test(value.trim());
}

function requirePhoneNumberId(value: unknown): string {
  const phoneNumberId = readString(value);
  if (!phoneNumberId || !isPhoneNumberId(phoneNumberId)) {
    throw new Error("WhatsApp phone-number ID must contain digits only.");
  }
  return phoneNumberId;
}

function isPhoneNumberId(value: unknown): boolean {
  return typeof value === "string" && /^\d+$/.test(value.trim());
}

function requireConfiguredString(value: unknown, key: string): string {
  const configured = readString(value);
  if (!configured) {
    throw new Error(`Missing required secret field: ${key}`);
  }
  return configured;
}

function readExactString(value: unknown): string | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  return typeof candidate === "string" ? candidate : null;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function sanitizeGraphErrorType(value: unknown): string | null {
  return typeof value === "string" && /^[A-Za-z0-9_.-]{1,100}$/.test(value) ? value : null;
}

function sanitizeNetworkError(error: unknown, sensitiveValues: readonly string[]): string {
  let message = error instanceof Error ? error.message : String(error);
  for (const sensitiveValue of [...sensitiveValues].sort((left, right) => right.length - left.length)) {
    if (sensitiveValue) {
      message = message.split(sensitiveValue).join("[REDACTED]");
    }
  }
  return redactText(message).slice(0, 300);
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest);
}

export const whatsappChatConnectorProfile: WhatsAppChatConnectorProfile = {
  kind: "whatsapp",
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
        secretKeys: ["appSecret"],
        signatureHeaders: ["x-hub-signature-256"],
        timestampHeaders: [],
        timestampRequirement: "none",
        signatureBases: ({ rawBody }) => [rawBody],
      },
    },
    handshake: {
      type: "challenge",
      modes: ["official_api"],
      handle: ({ query, secrets }) => {
        const configuredToken = typeof secrets?.webhookVerifyToken === "string"
          ? secrets.webhookVerifyToken
          : "";
        const result = verifyWhatsAppWebhookChallenge({ ...query }, configuredToken);
        return {
          statusCode: result.statusCode,
          headers: { "content-type": "text/plain; charset=utf-8" },
          body: result.body,
        };
      },
    },
    acknowledgement: { statusCode: 200, headers: { "content-type": "application/json" }, body: null },
    classify: (body) => normalizeWhatsAppWebhook(body).kind === "status" ? "ignored" : "message",
    normalize: (body) => {
      const normalized = normalizeWhatsAppWebhook(body);
      return normalized.kind === "message" ? normalized.message : {};
    },
  },
  identity: { resolve: resolveLegacyIdentity },
  outbound: {
    buildRequest: (context) => {
      if (context.connection.bridgeMode === "managed_bridge") {
        return buildLegacyHttpOutboundRequest(context, {
          mode: "managed_bridge",
          urlKeys: ["bridgeUrl", "outboundUrl", "endpointUrl", "url"],
          bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
          label: "managed_bridge bridge URL",
        });
      }
      if (context.connection.bridgeMode === "webhook") {
        return buildLegacyHttpOutboundRequest(context, {
          mode: "webhook",
          urlKeys: ["outboundWebhookUrl", "webhookUrl", "eventsUrl", "botEndpointUrl", "gatewayUrl", "bridgeUrl", "url"],
          bearerSecretKeys: ["bridgeApiKey", "bridgeToken", "botToken", "webhookSecret", "signingSecret", "botAppPassword"],
          label: "webhook bridge URL",
        });
      }
      if (context.connection.bridgeMode === "official_api") {
        return buildOfficialOutboundRequest(context);
      }
      throw new Error(`Unsupported bridge mode for whatsapp: ${context.connection.bridgeMode}`);
    },
    parseResponse: parseWhatsAppOutboundResponse,
    isRetryableStatus: isLegacyRetryableHttpStatus,
    classifyError: classifyWhatsAppOutboundError,
  },
  verification: {
    strategy: "configuration_and_live",
    capabilities: ["setup", "authentication", "handshake", "outbound"],
    verifyConfiguration: verifyWhatsAppConfiguration,
  },
  officialApi: {
    webhook: {
      verifyChallenge: verifyWhatsAppWebhookChallenge,
      verifySignature: verifyWhatsAppWebhookSignature,
      normalize: normalizeWhatsAppWebhook,
    },
    outbound: { classifyError: classifyWhatsAppGraphError },
    verification: { verifyConnection: verifyWhatsAppOfficialConnection },
  },
  session: { required: false, scope: "connection", requirements: [] },
  officialDocumentation: [
    { label: "WhatsApp Cloud API", url: "https://developers.facebook.com/docs/whatsapp/cloud-api" },
    { label: "Meta Webhooks", url: "https://developers.facebook.com/docs/graph-api/webhooks/getting-started" },
    { label: "Meta WhatsApp Postman collection", url: "https://www.postman.com/meta/whatsapp-business-platform/overview" },
  ],
  liveTest: {
    available: false,
    modes: [],
    reason: "Connection verification is read-only; message sends require the separately opted-in Meta test-number path.",
  },
  lifecycle: { status: "preview", profileVersion: 2, introducedIn: "whatsapp-cloud-api" },
};
