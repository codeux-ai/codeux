import type {
  ChatProviderBridgeMode,
  ChatProviderBridgeSetupSchema,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderKind,
  ChatProviderMessageDeliveryRecord,
  ChatProviderSetupSchema,
} from "../../contracts/chat-provider-types.js";
import { redactMetadata, redactText } from "../../shared/security/redaction.js";

export interface PartialNormalizedChatConnectorInbound {
  externalChannelId?: string;
  externalChannelName?: string;
  externalSenderId?: string;
  externalSenderName?: string;
  textBody?: string;
  externalMessageId?: string;
  conversationThreadId?: string;
  timestamp?: unknown;
  externalThreadId?: string;
}

export interface ChatConnectorAuthenticationInput {
  timestamp: string;
  rawBody: string;
}

export interface ChatConnectorProviderIngressRequest {
  connection: ChatProviderConnectionInternalRecord;
  headers: Readonly<Record<string, string | string[] | undefined>>;
  rawBody: string | Uint8Array;
  now: Date;
}

export interface ChatConnectorImmediateResponse {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: unknown;
}

export type ChatConnectorProviderIngressResult =
  | {
    authenticated: true;
    method: string;
    immediateResponse?: ChatConnectorImmediateResponse;
  }
  | {
    authenticated: false;
    code: string;
    message: string;
    statusCode: number;
  };

export interface ChatConnectorBearerAuthentication {
  type: "bearer";
  secretKeys: readonly string[];
  tokenHeaders: readonly string[];
  timestampHeaders: readonly string[];
}

export interface ChatConnectorHmacAuthentication {
  type: "hmac_sha256";
  secretKeys: readonly string[];
  signatureHeaders: readonly string[];
  timestampHeaders: readonly string[];
  signaturePrefix?: string;
  signatureBases(input: ChatConnectorAuthenticationInput): readonly string[];
}

export type ChatConnectorIngressAuthentication =
  | ChatConnectorBearerAuthentication
  | ChatConnectorHmacAuthentication;

export interface ChatConnectorHandshake {
  type: "none" | "challenge";
  challengeField?: string;
  responseField?: string;
  modes?: readonly ChatProviderBridgeMode[];
}

export interface ChatConnectorAcknowledgement {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
  body: string | null;
  immediateModes?: readonly ChatProviderBridgeMode[];
}

export interface ChatConnectorExternalIdentity {
  conversationId: string | null;
  threadId: string | null;
}

export interface ChatConnectorOutboundPayload {
  providerKind: string;
  providerConnectionId: string;
  channelId: string;
  threadId: string;
  conversationMessageId: string;
  replyText: string;
  replyToExternalMessageId: string | null;
  metadata: Record<string, unknown>;
}

export interface ChatConnectorOutboundContext {
  connection: ChatProviderConnectionInternalRecord;
  binding: ChatProviderChannelBindingRecord;
  delivery: ChatProviderMessageDeliveryRecord;
  payload: ChatConnectorOutboundPayload;
  correlationId: string;
}

export interface ChatConnectorHttpOutboundRequest {
  transport: "http";
  url: string;
  label: string;
  headers: Record<string, string>;
  bearerSecretKeys: readonly string[];
  body: unknown;
  timeoutMs: number;
  rateLimit?: {
    key: string;
    minimumIntervalMs: number;
  };
}

export interface ChatConnectorCommandOutboundRequest {
  transport: "command";
  command: string;
  workingDirectory: string;
  tokenSecretKeys: readonly string[];
  body: unknown;
  timeoutMs: number;
}

export type ChatConnectorOutboundRequest =
  | ChatConnectorHttpOutboundRequest
  | ChatConnectorCommandOutboundRequest;

export interface ChatConnectorOutboundResult {
  externalMessageId?: string | null;
  responseMetadata?: Record<string, unknown>;
  failure?: {
    message: string;
    retryable: boolean;
    diagnostic?: ChatConnectorCapabilityDiagnostic;
  };
}

export interface ChatConnectorHttpResponse {
  statusCode: number;
  headers: Readonly<Record<string, string>>;
}

export interface ChatConnectorCapabilityDiagnostic {
  capability: string;
  status: "available" | "missing" | "unknown";
  message: string;
}

export interface ChatConnectorLiveVerificationResult extends ChatConnectorVerificationResult {
  diagnostics: readonly ChatConnectorCapabilityDiagnostic[];
}

export interface ChatConnectorLiveVerification {
  buildRequest(input: {
    setup: Record<string, unknown>;
    correlationId: string;
  }): ChatConnectorHttpOutboundRequest;
  parseResponse(
    responseBody: string,
    response: ChatConnectorHttpResponse,
    setup: Record<string, unknown>,
  ): ChatConnectorLiveVerificationResult;
}

export interface ChatConnectorOutboundExecutor {
  send(context: ChatConnectorOutboundContext): Promise<ChatConnectorOutboundResult>;
}

export interface ChatConnectorOutboundRuntime {
  fetch: typeof fetch;
  now?: () => number;
  wait?: (delayMs: number, signal?: AbortSignal) => Promise<void>;
}

export class ChatConnectorOutboundExecutionError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ChatConnectorOutboundExecutionError";
  }
}

export interface ChatConnectorVerificationResult {
  valid: boolean;
  issues: readonly string[];
}

export interface ChatConnectorProfile {
  kind: ChatProviderKind;
  setupSchema: ChatProviderSetupSchema;
  supportedTransportModes: readonly ChatProviderBridgeMode[];
  ingress: {
    authentication: Readonly<Partial<Record<ChatProviderBridgeMode, ChatConnectorIngressAuthentication>>>;
    authenticateProviderRequest?(
      request: ChatConnectorProviderIngressRequest,
    ): ChatConnectorProviderIngressResult | null;
    handshake: ChatConnectorHandshake;
    acknowledgement: ChatConnectorAcknowledgement;
    ignore?(payload: Record<string, unknown>): string | null;
    normalize(payload: Record<string, unknown>): PartialNormalizedChatConnectorInbound;
  };
  identity: {
    resolve(
      normalized: PartialNormalizedChatConnectorInbound,
      payload: Record<string, unknown>,
    ): ChatConnectorExternalIdentity;
  };
  outbound: {
    createExecutor?(
      mode: ChatProviderBridgeMode,
      runtime: ChatConnectorOutboundRuntime,
    ): ChatConnectorOutboundExecutor | null;
    buildRequest(context: ChatConnectorOutboundContext): ChatConnectorOutboundRequest;
    parseResponse(
      responseBody: string,
      response?: ChatConnectorHttpResponse,
      mode?: ChatProviderBridgeMode,
    ): ChatConnectorOutboundResult;
    isRetryableStatus(statusCode: number): boolean;
  };
  verification: {
    strategy: "configuration" | "configuration_and_live";
    capabilities: readonly ("setup" | "authentication" | "handshake" | "outbound")[];
    verifyConfiguration(
      mode: ChatProviderBridgeMode,
      setup: Record<string, unknown>,
      secrets: Record<string, unknown> | null,
    ): ChatConnectorVerificationResult;
    live?: ChatConnectorLiveVerification;
  };
  session: {
    required: boolean;
    scope: "none" | "connection" | "channel" | "conversation";
    requirements: readonly string[];
  };
  officialDocumentation: readonly { label: string; url: string }[];
  liveTest: {
    available: boolean;
    modes: readonly ChatProviderBridgeMode[];
    reason?: string;
  };
  lifecycle: {
    status: "baseline" | "preview" | "stable" | "deprecated";
    profileVersion: number;
    introducedIn: string;
  };
}

export const DEFAULT_CONNECTOR_TIMEOUT_MS = 15_000;

export function getBridgeSchema(
  setupSchema: ChatProviderSetupSchema,
  mode: ChatProviderBridgeMode,
): ChatProviderBridgeSetupSchema {
  const schema = setupSchema.bridgeModes.find((candidate) => candidate.mode === mode);
  if (!schema) {
    throw new Error(`Unsupported bridge mode for ${setupSchema.kind}: ${mode}`);
  }
  return schema;
}

export function verifyConnectorConfiguration(
  setupSchema: ChatProviderSetupSchema,
  mode: ChatProviderBridgeMode,
  setup: Record<string, unknown>,
  secrets: Record<string, unknown> | null,
): ChatConnectorVerificationResult {
  let bridgeSchema: ChatProviderBridgeSetupSchema;
  try {
    bridgeSchema = getBridgeSchema(setupSchema, mode);
  } catch {
    return { valid: false, issues: [`Unsupported bridge mode: ${mode}`] };
  }

  const issues = [
    ...bridgeSchema.setupFields
      .filter((field) => field.required && !isConfigured(setup[field.key]))
      .map((field) => `Missing required setup field: ${field.key}`),
    ...bridgeSchema.secretFields
      .filter((field) => field.required && !isConfigured(secrets?.[field.key]))
      .map((field) => `Missing required secret field: ${field.key}`),
  ];
  return { valid: issues.length === 0, issues };
}

export function buildLegacyHttpOutboundRequest(
  context: ChatConnectorOutboundContext,
  input: {
    mode: "managed_bridge" | "webhook" | "official_api";
    urlKeys: readonly string[];
    bearerSecretKeys: readonly string[];
    label: string;
  },
): ChatConnectorHttpOutboundRequest {
  return {
    transport: "http",
    url: readString(...input.urlKeys.map((key) => context.connection.setup[key])) ?? "",
    label: input.label,
    headers: {
      "content-type": "application/json",
      "x-correlation-id": context.correlationId,
      "x-codeux-provider-kind": context.connection.providerKind,
      "x-codeux-bridge-mode": input.mode,
    },
    bearerSecretKeys: input.bearerSecretKeys,
    body: context.payload,
    timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
  };
}

export function buildLegacyCommandOutboundRequest(
  context: ChatConnectorOutboundContext,
  tokenSecretKeys: readonly string[],
): ChatConnectorCommandOutboundRequest {
  return {
    transport: "command",
    command: readString(context.connection.setup.command) ?? "",
    workingDirectory: readString(context.connection.setup.workingDirectory) ?? process.cwd(),
    tokenSecretKeys,
    body: context.payload,
    timeoutMs: DEFAULT_CONNECTOR_TIMEOUT_MS,
  };
}

export function resolveLegacyIdentity(
  normalized: PartialNormalizedChatConnectorInbound,
  payload: Record<string, unknown>,
): ChatConnectorExternalIdentity {
  return {
    conversationId: readString(normalized.externalChannelId) ?? null,
    threadId: readString(payload.threadId, payload.conversationThreadId) ?? null,
  };
}

export function isLegacyRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function parseLegacyOutboundResponse(text: string): ChatConnectorOutboundResult {
  const trimmed = text.trim();
  if (!trimmed) {
    return {};
  }
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const record = parsed as Record<string, unknown>;
      return {
        externalMessageId: readString(record.externalMessageId, record.messageId, record.id) ?? null,
        responseMetadata: redactMetadata(record) as Record<string, unknown>,
      };
    }
  } catch {
    // Non-JSON bridge responses are retained only as bounded, redacted metadata.
  }
  return { responseMetadata: { raw: redactText(trimmed.slice(0, 500)) } };
}

export function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

export function readArray(value: unknown): unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function readString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      return String(value);
    }
  }
  return undefined;
}

export function joinName(first: unknown, last: unknown): string | undefined {
  const joined = [first, last]
    .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
    .join(" ")
    .trim();
  return joined || undefined;
}

function isConfigured(value: unknown): boolean {
  return typeof value === "string" ? value.trim().length > 0 : value !== undefined && value !== null;
}
