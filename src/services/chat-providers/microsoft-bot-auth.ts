import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import {
  isDocumentedMicrosoftBotServiceUrl,
  normalizeMicrosoftTeamsActivity,
  type MicrosoftBotApplicationType,
  type MicrosoftTeamsChannelAccount,
  type MicrosoftTeamsConversationAccount,
  type MicrosoftTeamsConversationReference,
  type NormalizedMicrosoftTeamsActivity,
} from "../../domain/chat-connectors/providers/microsoft-teams.js";

export const MICROSOFT_BOT_OPENID_METADATA_URL = "https://login.botframework.com/v1/.well-known/openidconfiguration";
export const MICROSOFT_BOT_JWKS_URL = "https://login.botframework.com/v1/.well-known/keys";
export const MICROSOFT_BOT_ISSUER = "https://api.botframework.com";
export const MICROSOFT_BOT_TOKEN_SCOPE = "https://api.botframework.com/.default";
export const MICROSOFT_BOT_MAX_SIGNING_KEY_CACHE_MS = 24 * 60 * 60 * 1000;

const DEFAULT_CLOCK_SKEW_MS = 5 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_TOKEN_PRE_EXPIRY_MS = 5 * 60 * 1000;
const DEFAULT_UNKNOWN_KEY_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const MAX_JWT_LENGTH = 64 * 1024;

export type MicrosoftBotAuthErrorCode =
  | "app_identity_invalid"
  | "authorization_header_invalid"
  | "jwt_malformed"
  | "jwt_algorithm_invalid"
  | "jwt_issuer_invalid"
  | "jwt_audience_invalid"
  | "jwt_not_yet_valid"
  | "jwt_expired"
  | "jwt_signature_invalid"
  | "signing_key_unknown"
  | "signing_key_expired"
  | "signing_keys_unusable"
  | "channel_endorsement_missing"
  | "service_url_invalid"
  | "service_url_mismatch"
  | "tenant_mismatch"
  | "openid_metadata_failed"
  | "jwks_failed"
  | "token_acquisition_failed"
  | "microsoft_throttled"
  | "microsoft_service_unavailable"
  | "reply_rejected";

export interface MicrosoftBotCredentials {
  microsoftAppId: string;
  applicationType: MicrosoftBotApplicationType;
  tenantId?: string;
  clientSecret: string;
}

export interface MicrosoftBotAuthenticatedActivity {
  activity: Record<string, unknown>;
  normalized: NormalizedMicrosoftTeamsActivity;
  conversationReference: MicrosoftTeamsConversationReference;
  ingressPayload: Record<string, unknown>;
}

export interface MicrosoftBotReplyResult {
  externalMessageId: string | null;
  statusCode: number;
}

export interface MicrosoftBotDiagnostic {
  check: "app_identity" | "token_acquisition" | "signing_metadata";
  ok: boolean;
  code: "ok" | MicrosoftBotAuthErrorCode;
  message: string;
  retryable: boolean;
}

export interface MicrosoftBotConnectionDiagnostics {
  ok: boolean;
  checks: readonly MicrosoftBotDiagnostic[];
}

export class MicrosoftBotAuthError extends Error {
  constructor(
    readonly code: MicrosoftBotAuthErrorCode,
    message: string,
    readonly statusCode: number,
    readonly retryable = false,
    readonly retryAfterMs: number | null = null,
  ) {
    super(message);
    this.name = "MicrosoftBotAuthError";
  }
}

export interface MicrosoftBotAuthServiceOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  signingKeyCacheMs?: number;
  clockSkewMs?: number;
  requestTimeoutMs?: number;
  tokenPreExpiryMs?: number;
  unknownKeyRefreshIntervalMs?: number;
}

export interface ValidateIncomingActivityInput {
  authorization: string | undefined;
  activity: unknown;
  credentials: MicrosoftBotCredentials;
}

export interface SendReplyInput {
  credentials: MicrosoftBotCredentials;
  conversationReference: MicrosoftTeamsConversationReference;
  text: string;
  correlationId?: string;
}

interface JwtHeader {
  alg: string;
  kid: string;
}

interface JwtClaims {
  iss: unknown;
  aud: unknown;
  nbf: unknown;
  exp: unknown;
  iat?: unknown;
  serviceUrl: unknown;
}

interface BotOpenIdMetadata {
  issuer: string;
  jwks_uri: string;
  id_token_signing_alg_values_supported: string[];
}

interface BotSigningKey extends Record<string, unknown> {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
  endorsements: string[];
}

interface SigningKeyCache {
  fetchedAt: number;
  expiresAt: number;
  keys: BotSigningKey[];
}

interface AccessTokenCache {
  accessToken: string;
  usableUntil: number;
}

interface HttpOperation {
  kind: "metadata" | "jwks" | "token" | "reply";
  failureCode: MicrosoftBotAuthErrorCode;
  label: string;
}

const OPERATIONS = {
  metadata: { kind: "metadata", failureCode: "openid_metadata_failed", label: "OpenID metadata" },
  jwks: { kind: "jwks", failureCode: "jwks_failed", label: "signing keys" },
  token: { kind: "token", failureCode: "token_acquisition_failed", label: "OAuth token" },
  reply: { kind: "reply", failureCode: "reply_rejected", label: "Bot Connector reply" },
} as const satisfies Record<string, HttpOperation>;

export class MicrosoftBotAuthService {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly signingKeyCacheMs: number;
  private readonly clockSkewMs: number;
  private readonly requestTimeoutMs: number;
  private readonly tokenPreExpiryMs: number;
  private readonly unknownKeyRefreshIntervalMs: number;
  private signingKeyCache: SigningKeyCache | null = null;
  private signingKeyRefreshPromise: Promise<SigningKeyCache> | null = null;
  private lastUnknownKeyRefreshAt = Number.NEGATIVE_INFINITY;
  private readonly tokenCache = new Map<string, AccessTokenCache>();
  private readonly tokenRequests = new Map<string, Promise<string>>();

  constructor(options: MicrosoftBotAuthServiceOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
    this.now = options.now ?? (() => new Date());
    this.signingKeyCacheMs = clampPositive(
      options.signingKeyCacheMs ?? MICROSOFT_BOT_MAX_SIGNING_KEY_CACHE_MS,
      MICROSOFT_BOT_MAX_SIGNING_KEY_CACHE_MS,
    );
    this.clockSkewMs = clampNonNegative(options.clockSkewMs ?? DEFAULT_CLOCK_SKEW_MS);
    this.requestTimeoutMs = clampPositive(options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, 60_000);
    this.tokenPreExpiryMs = clampNonNegative(options.tokenPreExpiryMs ?? DEFAULT_TOKEN_PRE_EXPIRY_MS);
    this.unknownKeyRefreshIntervalMs = clampNonNegative(
      options.unknownKeyRefreshIntervalMs ?? DEFAULT_UNKNOWN_KEY_REFRESH_INTERVAL_MS,
    );
  }

  async validateIncomingActivity(input: ValidateIncomingActivityInput): Promise<MicrosoftBotAuthenticatedActivity> {
    const credentials = validateCredentials(input.credentials);
    const activity = requireRecord(input.activity, "Activity");
    const token = parseBearerToken(input.authorization);
    const compactJwt = parseCompactJwt(token);
    if (compactJwt.header.alg !== "RS256") {
      throw authError("jwt_algorithm_invalid", "Microsoft Bot Connector JWT must use RS256.");
    }

    let keys = (await this.getSigningKeyCache(false)).keys;
    let key = keys.find((candidate) => candidate.kid === compactJwt.header.kid);
    if (!key && this.canRefreshForUnknownKey()) {
      this.lastUnknownKeyRefreshAt = this.nowMs();
      keys = (await this.getSigningKeyCache(true)).keys;
      key = keys.find((candidate) => candidate.kid === compactJwt.header.kid);
    }
    if (!key) {
      throw authError("signing_key_unknown", "Microsoft Bot Connector JWT uses an unknown signing key ID.");
    }

    this.validateSigningKey(key);
    this.verifyJwtSignature(compactJwt.signingInput, compactJwt.signature, key);
    this.validateClaims(compactJwt.claims, credentials, activity);
    this.validateChannelEndorsement(key, activity);
    const conversationReference = buildMicrosoftTeamsConversationReference(activity);
    this.validateTenant(credentials, conversationReference.tenantId);
    const normalized = normalizeMicrosoftTeamsActivity(activity, { requireType: true });
    const ingressPayload = {
      ...activity,
      microsoftTeamsConversationReference: conversationReference,
    };
    return { activity, normalized, conversationReference, ingressPayload };
  }

  async acquireAccessToken(credentialsInput: MicrosoftBotCredentials): Promise<string> {
    const credentials = validateCredentials(credentialsInput);
    const cacheKey = tokenCacheKey(credentials);
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.usableUntil > this.nowMs()) {
      return cached.accessToken;
    }

    const pending = this.tokenRequests.get(cacheKey);
    if (pending) {
      return pending;
    }
    const request = this.requestAccessToken(credentials, cacheKey).finally(() => {
      this.tokenRequests.delete(cacheKey);
    });
    this.tokenRequests.set(cacheKey, request);
    return request;
  }

  async sendReply(input: SendReplyInput): Promise<MicrosoftBotReplyResult> {
    const credentials = validateCredentials(input.credentials);
    const reference = validateConversationReference(input.conversationReference);
    this.validateTenant(credentials, reference.tenantId);
    const accessToken = await this.acquireAccessToken(credentials);
    const replyUrl = buildReplyUrl(reference);
    const response = await this.fetchWithTimeout(replyUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        ...(input.correlationId ? { "x-correlation-id": input.correlationId } : {}),
      },
      body: JSON.stringify(buildReplyActivity(reference, input.text)),
    }, OPERATIONS.reply);
    if (!response.ok) {
      throw this.httpFailure(OPERATIONS.reply, response.status, response.headers);
    }
    const responseBody = await response.text().catch(() => "");
    const parsed = parseOptionalRecord(responseBody);
    return {
      externalMessageId: readRequiredString(parsed?.id) ?? null,
      statusCode: response.status,
    };
  }

  async diagnoseConnection(credentialsInput: MicrosoftBotCredentials): Promise<MicrosoftBotConnectionDiagnostics> {
    const checks: MicrosoftBotDiagnostic[] = [];
    try {
      validateCredentials(credentialsInput);
      checks.push(okDiagnostic("app_identity", "Microsoft app identity configuration is valid."));
    } catch (error) {
      checks.push(errorDiagnostic("app_identity", error));
      return { ok: false, checks };
    }

    try {
      await this.acquireAccessToken(credentialsInput);
      checks.push(okDiagnostic("token_acquisition", "Microsoft Bot Connector OAuth token acquisition succeeded."));
    } catch (error) {
      checks.push(errorDiagnostic("token_acquisition", error));
    }

    try {
      const signingKeyCache = await this.getSigningKeyCache(true);
      this.validateDiagnosticSigningKeys(signingKeyCache.keys);
      checks.push(okDiagnostic("signing_metadata", "Microsoft Bot Connector OpenID metadata and signing keys are available."));
    } catch (error) {
      checks.push(errorDiagnostic("signing_metadata", error));
    }

    return { ok: checks.every((check) => check.ok), checks };
  }

  private async requestAccessToken(credentials: MicrosoftBotCredentials, cacheKey: string): Promise<string> {
    const tenant = credentials.applicationType === "MultiTenant" ? "botframework.com" : credentials.tenantId!;
    const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenant)}/oauth2/v2.0/token`;
    const form = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: credentials.microsoftAppId,
      client_secret: credentials.clientSecret,
      scope: MICROSOFT_BOT_TOKEN_SCOPE,
    });
    const response = await this.fetchWithTimeout(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
    }, OPERATIONS.token);
    if (!response.ok) {
      throw this.httpFailure(OPERATIONS.token, response.status, response.headers);
    }
    const body = await readJsonRecord(response, OPERATIONS.token);
    const accessToken = readRequiredString(body.access_token);
    const tokenType = readRequiredString(body.token_type);
    const expiresIn = readPositiveNumber(body.expires_in);
    if (!accessToken || tokenType?.toLowerCase() !== "bearer" || !expiresIn) {
      throw new MicrosoftBotAuthError(
        "token_acquisition_failed",
        "Microsoft OAuth token response is missing a bearer access token or expiry.",
        502,
        true,
      );
    }
    const ttlMs = expiresIn * 1000;
    const preExpiryMs = Math.min(this.tokenPreExpiryMs, Math.floor(ttlMs / 2));
    this.tokenCache.set(cacheKey, {
      accessToken,
      usableUntil: this.nowMs() + Math.max(0, ttlMs - preExpiryMs),
    });
    return accessToken;
  }

  private async getSigningKeyCache(forceRefresh: boolean): Promise<SigningKeyCache> {
    if (!forceRefresh && this.isSigningKeyCacheFresh()) {
      return this.signingKeyCache!;
    }
    if (this.signingKeyRefreshPromise) {
      return this.signingKeyRefreshPromise;
    }
    const refresh = this.refreshSigningKeys().finally(() => {
      if (this.signingKeyRefreshPromise === refresh) {
        this.signingKeyRefreshPromise = null;
      }
    });
    this.signingKeyRefreshPromise = refresh;
    return refresh;
  }

  private async refreshSigningKeys(): Promise<SigningKeyCache> {
    const metadataResponse = await this.fetchWithTimeout(MICROSOFT_BOT_OPENID_METADATA_URL, {}, OPERATIONS.metadata);
    if (!metadataResponse.ok) {
      throw this.httpFailure(OPERATIONS.metadata, metadataResponse.status, metadataResponse.headers);
    }
    const metadataBody = await readJsonRecord(metadataResponse, OPERATIONS.metadata);
    const metadata = parseOpenIdMetadata(metadataBody);
    const keysResponse = await this.fetchWithTimeout(metadata.jwks_uri, {}, OPERATIONS.jwks);
    if (!keysResponse.ok) {
      throw this.httpFailure(OPERATIONS.jwks, keysResponse.status, keysResponse.headers);
    }
    const keysBody = await readJsonRecord(keysResponse, OPERATIONS.jwks);
    const keys = parseSigningKeys(keysBody);
    const fetchedAt = this.nowMs();
    const cache = { fetchedAt, expiresAt: fetchedAt + this.signingKeyCacheMs, keys };
    this.signingKeyCache = cache;
    return cache;
  }

  private validateSigningKey(key: BotSigningKey): void {
    if (key.kty !== "RSA" || (key.alg && key.alg !== "RS256") || (key.use && key.use !== "sig")) {
      throw authError("jwt_algorithm_invalid", "Microsoft signing key is not valid for RS256 signatures.");
    }
    if (key.key_ops && !key.key_ops.includes("verify")) {
      throw authError("jwt_algorithm_invalid", "Microsoft signing key is not endorsed for signature verification.");
    }
    const now = this.nowMs();
    const notBefore = readTimestampMs(key.nbf);
    const expiresAt = readTimestampMs(key.exp);
    if (notBefore !== null && now + this.clockSkewMs < notBefore) {
      throw new MicrosoftBotAuthError("signing_key_expired", "Microsoft signing key is not active yet.", 401);
    }
    if (expiresAt !== null && now - this.clockSkewMs >= expiresAt) {
      throw new MicrosoftBotAuthError("signing_key_expired", "Microsoft signing key has expired.", 401);
    }
  }

  private validateDiagnosticSigningKeys(keys: readonly BotSigningKey[]): void {
    const failures: MicrosoftBotAuthError[] = [];
    for (const key of keys) {
      try {
        this.validateSigningKey(key);
        if (!key.endorsements.includes("msteams")) {
          throw new MicrosoftBotAuthError(
            "channel_endorsement_missing",
            "Microsoft signing key does not endorse Microsoft Teams.",
            502,
          );
        }
        createPublicKey({ key: key as JsonWebKey, format: "jwk" });
        return;
      } catch (error) {
        failures.push(error instanceof MicrosoftBotAuthError
          ? error
          : new MicrosoftBotAuthError(
            "signing_keys_unusable",
            "Microsoft signing key material is not usable for signature verification.",
            502,
          ));
      }
    }

    const allExpired = failures.length > 0 && failures.every((failure) => failure.code === "signing_key_expired");
    throw new MicrosoftBotAuthError(
      allExpired ? "signing_key_expired" : "signing_keys_unusable",
      allExpired
        ? "Microsoft Bot Connector published no currently active signing keys."
        : "Microsoft Bot Connector published no usable Microsoft Teams signing keys.",
      502,
      true,
    );
  }

  private verifyJwtSignature(signingInput: string, signature: Buffer, key: BotSigningKey): void {
    try {
      const publicKey = createPublicKey({ key: key as JsonWebKey, format: "jwk" });
      if (!verifySignature("RSA-SHA256", Buffer.from(signingInput), publicKey, signature)) {
        throw authError("jwt_signature_invalid", "Microsoft Bot Connector JWT signature is invalid.");
      }
    } catch (error) {
      if (error instanceof MicrosoftBotAuthError) {
        throw error;
      }
      throw authError("jwt_signature_invalid", "Microsoft Bot Connector JWT signing key or signature is invalid.");
    }
  }

  private validateClaims(
    claims: JwtClaims,
    credentials: MicrosoftBotCredentials,
    activity: Record<string, unknown>,
  ): void {
    if (claims.iss !== MICROSOFT_BOT_ISSUER) {
      throw authError("jwt_issuer_invalid", "Microsoft Bot Connector JWT issuer is invalid.");
    }
    const audiences = typeof claims.aud === "string"
      ? [claims.aud]
      : Array.isArray(claims.aud) ? claims.aud.filter((value): value is string => typeof value === "string") : [];
    if (!audiences.includes(credentials.microsoftAppId)) {
      throw authError("jwt_audience_invalid", "Microsoft Bot Connector JWT audience does not match the Microsoft app ID.");
    }
    const now = this.nowMs();
    const notBefore = readJwtNumericDateMs(claims.nbf);
    const expiresAt = readJwtNumericDateMs(claims.exp);
    if (notBefore === null || now + this.clockSkewMs < notBefore) {
      throw authError("jwt_not_yet_valid", "Microsoft Bot Connector JWT is outside its validity window.");
    }
    if (expiresAt === null || now - this.clockSkewMs >= expiresAt) {
      throw authError("jwt_expired", "Microsoft Bot Connector JWT has expired.");
    }
    const issuedAt = claims.iat === undefined ? null : readJwtNumericDateMs(claims.iat);
    if (claims.iat !== undefined && issuedAt === null) {
      throw authError("jwt_not_yet_valid", "Microsoft Bot Connector JWT issued-at claim is invalid.");
    }
    if (issuedAt !== null && now + this.clockSkewMs < issuedAt) {
      throw authError("jwt_not_yet_valid", "Microsoft Bot Connector JWT was issued in the future.");
    }
    const activityServiceUrl = readRequiredString(activity.serviceUrl);
    const claimServiceUrl = readRequiredString(claims.serviceUrl);
    if (!activityServiceUrl || !claimServiceUrl || activityServiceUrl !== claimServiceUrl) {
      throw authError("service_url_mismatch", "JWT serviceUrl claim does not exactly match the Activity serviceUrl.");
    }
    requireAllowedMicrosoftBotServiceUrl(activityServiceUrl);
  }

  private validateChannelEndorsement(key: BotSigningKey, activity: Record<string, unknown>): void {
    const channelId = readRequiredString(activity.channelId);
    if (!channelId || !key.endorsements.includes(channelId)) {
      throw new MicrosoftBotAuthError(
        "channel_endorsement_missing",
        "Microsoft signing key does not endorse the Activity channel.",
        403,
      );
    }
  }

  private validateTenant(credentials: MicrosoftBotCredentials, activityTenantId: string | undefined): void {
    if (credentials.tenantId && credentials.tenantId !== activityTenantId) {
      throw new MicrosoftBotAuthError(
        "tenant_mismatch",
        "Microsoft Teams Activity tenant does not match the configured tenant.",
        403,
      );
    }
    if (credentials.applicationType === "SingleTenant" && !activityTenantId) {
      throw new MicrosoftBotAuthError(
        "tenant_mismatch",
        "Single-tenant Microsoft Teams Activities must include the configured tenant.",
        403,
      );
    }
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    operation: HttpOperation,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      const detail = controller.signal.aborted ? "timed out" : "is unavailable";
      throw new MicrosoftBotAuthError(
        "microsoft_service_unavailable",
        `Microsoft ${operation.label} service ${detail}.`,
        503,
        true,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private httpFailure(operation: HttpOperation, status: number, headers: Headers): MicrosoftBotAuthError {
    if (status === 429) {
      return new MicrosoftBotAuthError(
        "microsoft_throttled",
        `Microsoft ${operation.label} service throttled the request.`,
        429,
        true,
        parseRetryAfterMs(headers.get("retry-after"), this.nowMs()),
      );
    }
    if (status >= 500 || status === 408) {
      return new MicrosoftBotAuthError(
        "microsoft_service_unavailable",
        `Microsoft ${operation.label} service is unavailable (HTTP ${status}).`,
        status,
        true,
      );
    }
    return new MicrosoftBotAuthError(
      operation.failureCode,
      `Microsoft ${operation.label} request failed (HTTP ${status}).`,
      status,
      operation.kind === "reply" && (status === 409 || status === 425),
    );
  }

  private isSigningKeyCacheFresh(): boolean {
    return this.signingKeyCache !== null && this.signingKeyCache.expiresAt > this.nowMs();
  }

  private canRefreshForUnknownKey(): boolean {
    return this.nowMs() - this.lastUnknownKeyRefreshAt >= this.unknownKeyRefreshIntervalMs;
  }

  private nowMs(): number {
    return this.now().getTime();
  }
}

export function isAllowedMicrosoftBotServiceUrl(value: string): boolean {
  return isDocumentedMicrosoftBotServiceUrl(value);
}

export function requireAllowedMicrosoftBotServiceUrl(value: string): string {
  if (!isAllowedMicrosoftBotServiceUrl(value)) {
    throw new MicrosoftBotAuthError(
      "service_url_invalid",
      "Microsoft Teams service URL must use HTTPS on a documented Bot Framework host.",
      403,
    );
  }
  return value;
}

function buildMicrosoftTeamsConversationReference(
  activity: Record<string, unknown>,
): MicrosoftTeamsConversationReference {
  const serviceUrl = requireAllowedMicrosoftBotServiceUrl(requireString(activity.serviceUrl, "Activity serviceUrl"));
  const conversation = requireAccount(activity.conversation, "Activity conversation");
  const bot = requireAccount(activity.recipient, "Activity recipient");
  const user = requireAccount(activity.from, "Activity sender");
  const channelData = optionalRecord(activity.channelData);
  const tenant = optionalRecord(channelData?.tenant);
  const team = optionalRecord(channelData?.team);
  const channel = optionalRecord(channelData?.channel);
  return {
    activityId: requireString(activity.id, "Activity ID"),
    serviceUrl,
    serviceUrlValidated: true,
    channelId: requireString(activity.channelId, "Activity channel ID"),
    locale: readRequiredString(activity.locale),
    tenantId: readRequiredString(tenant?.id),
    teamId: readRequiredString(team?.id),
    teamsChannelId: readRequiredString(channel?.id),
    conversation: conversation as MicrosoftTeamsConversationAccount,
    bot,
    user,
  };
}

function validateCredentials(credentials: MicrosoftBotCredentials): MicrosoftBotCredentials {
  if (!credentials || typeof credentials !== "object") {
    throw new MicrosoftBotAuthError("app_identity_invalid", "Microsoft bot credentials are required.", 400);
  }
  if (!readRequiredString(credentials.microsoftAppId)) {
    throw new MicrosoftBotAuthError("app_identity_invalid", "Microsoft app ID is required.", 400);
  }
  if (credentials.applicationType !== "MultiTenant" && credentials.applicationType !== "SingleTenant") {
    throw new MicrosoftBotAuthError("app_identity_invalid", "Microsoft application type is invalid.", 400);
  }
  if (credentials.applicationType === "SingleTenant" && !readRequiredString(credentials.tenantId)) {
    throw new MicrosoftBotAuthError("app_identity_invalid", "Single-tenant Microsoft bots require a tenant ID.", 400);
  }
  if (!readRequiredString(credentials.clientSecret)) {
    throw new MicrosoftBotAuthError("app_identity_invalid", "Microsoft client secret is required.", 400);
  }
  return {
    microsoftAppId: credentials.microsoftAppId.trim(),
    applicationType: credentials.applicationType,
    tenantId: credentials.tenantId?.trim() || undefined,
    clientSecret: credentials.clientSecret,
  };
}

function parseBearerToken(authorization: string | undefined): string {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  if (!match?.[1]) {
    throw authError("authorization_header_invalid", "Microsoft Bot Connector request requires a Bearer authorization header.");
  }
  return match[1];
}

function parseCompactJwt(token: string): {
  header: JwtHeader;
  claims: JwtClaims;
  signingInput: string;
  signature: Buffer;
} {
  if (token.length > MAX_JWT_LENGTH) {
    throw authError("jwt_malformed", "Microsoft Bot Connector JWT is too large.");
  }
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw authError("jwt_malformed", "Microsoft Bot Connector JWT is malformed.");
  }
  try {
    const header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")) as unknown;
    const claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")) as unknown;
    const headerRecord = requireRecord(header, "JWT header");
    const claimsRecord = requireRecord(claims, "JWT claims");
    const alg = readRequiredString(headerRecord.alg);
    const kid = readRequiredString(headerRecord.kid);
    if (!alg || !kid) {
      throw new Error("missing alg or kid");
    }
    return {
      header: { alg, kid },
      claims: claimsRecord as unknown as JwtClaims,
      signingInput: `${parts[0]}.${parts[1]}`,
      signature: Buffer.from(parts[2], "base64url"),
    };
  } catch (error) {
    if (error instanceof MicrosoftBotAuthError) {
      throw error;
    }
    throw authError("jwt_malformed", "Microsoft Bot Connector JWT header or claims are malformed.");
  }
}

function parseOpenIdMetadata(body: Record<string, unknown>): BotOpenIdMetadata {
  const issuer = readRequiredString(body.issuer);
  const jwksUri = readRequiredString(body.jwks_uri);
  const algorithms = Array.isArray(body.id_token_signing_alg_values_supported)
    ? body.id_token_signing_alg_values_supported.filter((value): value is string => typeof value === "string")
    : [];
  if (issuer !== MICROSOFT_BOT_ISSUER || jwksUri !== MICROSOFT_BOT_JWKS_URL || !algorithms.includes("RS256")) {
    throw new MicrosoftBotAuthError(
      "openid_metadata_failed",
      "Microsoft Bot Connector OpenID metadata does not match the fixed issuer, JWKS URL, and RS256 contract.",
      502,
      true,
    );
  }
  return { issuer, jwks_uri: jwksUri, id_token_signing_alg_values_supported: algorithms };
}

function parseSigningKeys(body: Record<string, unknown>): BotSigningKey[] {
  if (!Array.isArray(body.keys)) {
    throw new MicrosoftBotAuthError("jwks_failed", "Microsoft signing keys response is malformed.", 502, true);
  }
  const keys = body.keys.map((value) => {
    const key = optionalRecord(value);
    if (!key) {
      throw new MicrosoftBotAuthError("jwks_failed", "Microsoft signing key must be an object.", 502, true);
    }
    const kid = readRequiredString(key.kid);
    const kty = readRequiredString(key.kty);
    if (!kid || !kty) {
      throw new MicrosoftBotAuthError("jwks_failed", "Microsoft signing key is missing kid or kty.", 502, true);
    }
    return {
      ...key,
      kid,
      kty,
      alg: readRequiredString(key.alg),
      use: readRequiredString(key.use),
      key_ops: Array.isArray(key.key_ops) ? key.key_ops.filter((entry): entry is string => typeof entry === "string") : undefined,
      endorsements: Array.isArray(key.endorsements)
        ? key.endorsements.filter((entry): entry is string => typeof entry === "string")
        : [],
    };
  });
  if (keys.length === 0) {
    throw new MicrosoftBotAuthError("jwks_failed", "Microsoft signing keys response is empty.", 502, true);
  }
  return keys;
}

function validateConversationReference(reference: MicrosoftTeamsConversationReference): MicrosoftTeamsConversationReference {
  if (!reference || reference.serviceUrlValidated !== true) {
    throw new MicrosoftBotAuthError(
      "service_url_invalid",
      "Microsoft Teams reply requires an authenticated persisted conversation reference.",
      403,
    );
  }
  requireAllowedMicrosoftBotServiceUrl(reference.serviceUrl);
  requireString(reference.activityId, "conversation reference activity ID");
  requireString(reference.channelId, "conversation reference channel ID");
  requireString(reference.conversation?.id, "conversation reference conversation ID");
  requireString(reference.bot?.id, "conversation reference bot ID");
  requireString(reference.user?.id, "conversation reference user ID");
  return reference;
}

function buildReplyUrl(reference: MicrosoftTeamsConversationReference): string {
  const url = new URL(reference.serviceUrl);
  const basePath = url.pathname.replace(/\/+$/, "");
  url.pathname = `${basePath}/v3/conversations/${encodeURIComponent(reference.conversation.id)}/activities/${encodeURIComponent(reference.activityId)}`;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function buildReplyActivity(reference: MicrosoftTeamsConversationReference, text: string): Record<string, unknown> {
  return {
    type: "message",
    from: reference.bot,
    recipient: reference.user,
    conversation: reference.conversation,
    locale: reference.locale,
    replyToId: reference.activityId,
    text,
    channelData: {
      tenant: reference.tenantId ? { id: reference.tenantId } : undefined,
      team: reference.teamId ? { id: reference.teamId } : undefined,
      channel: reference.teamsChannelId ? { id: reference.teamsChannelId } : undefined,
    },
  };
}

function requireAccount(value: unknown, label: string): MicrosoftTeamsChannelAccount | MicrosoftTeamsConversationAccount {
  const account = requireRecord(value, label);
  const id = requireString(account.id, `${label} ID`);
  return {
    id,
    name: readRequiredString(account.name),
    aadObjectId: readRequiredString(account.aadObjectId),
    conversationType: readRequiredString(account.conversationType),
    isGroup: typeof account.isGroup === "boolean" ? account.isGroup : undefined,
  };
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw authError("jwt_malformed", `${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function requireString(value: unknown, label: string): string {
  const stringValue = readRequiredString(value);
  if (!stringValue) {
    throw new MicrosoftBotAuthError("service_url_invalid", `${label} is required.`, 403);
  }
  return stringValue;
}

function readRequiredString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function readPositiveNumber(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function readTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.abs(value) < 10_000_000_000 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) {
      return Math.abs(numeric) < 10_000_000_000 ? numeric * 1000 : numeric;
    }
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function readJwtNumericDateMs(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value * 1000 : null;
}

async function readJsonRecord(response: Response, operation: HttpOperation): Promise<Record<string, unknown>> {
  try {
    return requireRecord(await response.json(), `${operation.label} response`);
  } catch (error) {
    if (error instanceof MicrosoftBotAuthError && error.code !== "jwt_malformed") {
      throw error;
    }
    throw new MicrosoftBotAuthError(
      operation.failureCode,
      `Microsoft ${operation.label} response is not valid JSON.`,
      502,
      true,
    );
  }
}

function parseOptionalRecord(value: string): Record<string, unknown> | null {
  if (!value.trim()) {
    return null;
  }
  try {
    return optionalRecord(JSON.parse(value) as unknown);
  } catch {
    return null;
  }
}

function tokenCacheKey(credentials: MicrosoftBotCredentials): string {
  const secretFingerprint = createHash("sha256").update(credentials.clientSecret).digest("base64url");
  return [credentials.microsoftAppId, credentials.applicationType, credentials.tenantId ?? "", secretFingerprint].join(":");
}

function parseRetryAfterMs(value: string | null, nowMs: number): number | null {
  if (!value) {
    return null;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1000);
  }
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - nowMs) : null;
}

function okDiagnostic(check: MicrosoftBotDiagnostic["check"], message: string): MicrosoftBotDiagnostic {
  return { check, ok: true, code: "ok", message, retryable: false };
}

function errorDiagnostic(check: MicrosoftBotDiagnostic["check"], error: unknown): MicrosoftBotDiagnostic {
  if (error instanceof MicrosoftBotAuthError) {
    return { check, ok: false, code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    check,
    ok: false,
    code: "microsoft_service_unavailable",
    message: "Microsoft service diagnostic failed.",
    retryable: true,
  };
}

function authError(code: MicrosoftBotAuthErrorCode, message: string): MicrosoftBotAuthError {
  return new MicrosoftBotAuthError(code, message, 401);
}

function clampPositive(value: number, maximum: number): number {
  return Math.min(Math.max(1, Number.isFinite(value) ? value : 1), maximum);
}

function clampNonNegative(value: number): number {
  return Math.max(0, Number.isFinite(value) ? value : 0);
}
