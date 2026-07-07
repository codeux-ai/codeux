import { createHmac, timingSafeEqual } from "crypto";
import type { ChatProviderConnectionInternalRecord, ChatProviderSecretConfig } from "../contracts/chat-provider-types.js";

export interface ChatProviderIngressSecurityRequest {
  headers: Record<string, string | string[] | undefined>;
  rawBody: string;
  now?: Date;
}

export interface ChatProviderIngressSecurityResult {
  authenticated: true;
  method: "bearer" | "hmac";
}

export class ChatProviderIngressSecurityError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 401) {
    super(message);
    this.name = "ChatProviderIngressSecurityError";
  }
}

interface ReplayEntry {
  expiresAt: number;
}

const DEFAULT_TIMESTAMP_TOLERANCE_MS = 5 * 60 * 1000;
const MAX_REPLAY_CACHE_SIZE = 2_000;
const HMAC_SECRET_KEYS = ["signingSecret", "webhookSecret", "botAppPassword"];

export class ChatProviderIngressSecurity {
  private readonly replayCache = new Map<string, ReplayEntry>();

  constructor(private readonly timestampToleranceMs = DEFAULT_TIMESTAMP_TOLERANCE_MS) {}

  verify(
    connection: ChatProviderConnectionInternalRecord,
    request: ChatProviderIngressSecurityRequest,
  ): ChatProviderIngressSecurityResult {
    if (!connection.enabled || connection.status !== "active") {
      throw new ChatProviderIngressSecurityError("connection_disabled", "Chat provider connection is not enabled.", 403);
    }

    const nowMs = (request.now ?? new Date()).getTime();
    const timestamp = this.requireFreshTimestamp(request.headers, nowMs);
    const signature = firstHeader(request.headers, [
      "x-code-ux-signature",
      "x-openclaw-signature",
      "x-hub-signature-256",
      "x-slack-signature",
      "x-signature",
    ]);

    if (connection.bridgeMode === "webhook") {
      const hmacSecret = firstConfiguredSecret(connection.secrets, HMAC_SECRET_KEYS);
      if (!hmacSecret) {
        throw new ChatProviderIngressSecurityError("missing_hmac_secret", "Webhook signing secret is not configured.", 403);
      }
      if (!signature) {
        throw new ChatProviderIngressSecurityError("missing_signature", "Missing chat provider ingress signature.", 401);
      }
      this.verifyHmacSignature({
        connectionId: connection.id,
        signature,
        timestamp,
        rawBody: request.rawBody,
        secret: hmacSecret,
        nowMs,
      });
      return { authenticated: true, method: "hmac" };
    }

    const expectedBearer = firstConfiguredSecret(
      connection.secrets,
      connection.bridgeMode === "native_bridge" ? ["bridgeToken"] : ["openclawApiKey"],
    );
    if (!expectedBearer) {
      throw new ChatProviderIngressSecurityError("missing_bridge_secret", "Chat provider bridge secret is not configured.", 403);
    }

    const actualBearer = parseBearerToken(request.headers);
    if (!actualBearer || !constantTimeEquals(actualBearer, expectedBearer)) {
      throw new ChatProviderIngressSecurityError("invalid_bearer_token", "Invalid chat provider bridge token.", 401);
    }

    const nonce = firstHeader(request.headers, ["x-code-ux-nonce", "x-openclaw-nonce", "x-request-id"]);
    if (nonce) {
      this.preventReplay({
        connectionId: connection.id,
        key: `bearer:${nonce}`,
        nowMs,
      });
    }
    return { authenticated: true, method: "bearer" };
  }

  private requireFreshTimestamp(headers: Record<string, string | string[] | undefined>, nowMs: number): { raw: string; value: number } {
    const rawTimestamp = firstHeader(headers, [
      "x-code-ux-timestamp",
      "x-openclaw-timestamp",
      "x-provider-timestamp",
      "x-slack-request-timestamp",
    ]);
    if (!rawTimestamp) {
      throw new ChatProviderIngressSecurityError("missing_timestamp", "Missing chat provider ingress timestamp.", 401);
    }

    const parsed = Number(rawTimestamp);
    const timestampMs = Number.isFinite(parsed)
      ? rawTimestamp.length <= 10
        ? parsed * 1000
        : parsed
      : Date.parse(rawTimestamp);
    if (!Number.isFinite(timestampMs)) {
      throw new ChatProviderIngressSecurityError("invalid_timestamp", "Invalid chat provider ingress timestamp.", 401);
    }
    if (Math.abs(nowMs - timestampMs) > this.timestampToleranceMs) {
      throw new ChatProviderIngressSecurityError("stale_timestamp", "Chat provider ingress timestamp is outside the allowed window.", 401);
    }
    return { raw: rawTimestamp, value: timestampMs };
  }

  private verifyHmacSignature(input: {
    connectionId: string;
    signature: string;
    timestamp: { raw: string; value: number };
    rawBody: string;
    secret: string;
    nowMs: number;
  }): void {
    const normalizedSignature = normalizeSignature(input.signature);
    if (!normalizedSignature) {
      throw new ChatProviderIngressSecurityError("invalid_signature", "Invalid chat provider ingress signature.", 401);
    }

    const candidates = [
      createHmac("sha256", input.secret).update(`${input.timestamp.raw}.${input.rawBody}`).digest("hex"),
      createHmac("sha256", input.secret).update(`v0:${input.timestamp.raw}:${input.rawBody}`).digest("hex"),
      createHmac("sha256", input.secret).update(input.rawBody).digest("hex"),
    ];
    const valid = candidates.some((candidate) => constantTimeEquals(candidate, normalizedSignature));
    if (!valid) {
      throw new ChatProviderIngressSecurityError("signature_mismatch", "Invalid chat provider ingress signature.", 401);
    }

    this.preventReplay({
      connectionId: input.connectionId,
      key: `hmac:${input.timestamp.value}:${normalizedSignature}`,
      nowMs: input.nowMs,
    });
  }

  private preventReplay(input: { connectionId: string; key: string; nowMs: number }): void {
    this.pruneReplayCache(input.nowMs);
    const replayKey = `${input.connectionId}:${input.key}`;
    if (this.replayCache.has(replayKey)) {
      throw new ChatProviderIngressSecurityError("replay_detected", "Duplicate chat provider ingress request.", 409);
    }
    this.replayCache.set(replayKey, { expiresAt: input.nowMs + this.timestampToleranceMs });
    if (this.replayCache.size > MAX_REPLAY_CACHE_SIZE) {
      const oldestKey = this.replayCache.keys().next().value as string | undefined;
      if (oldestKey) {
        this.replayCache.delete(oldestKey);
      }
    }
  }

  private pruneReplayCache(nowMs: number): void {
    for (const [key, entry] of this.replayCache.entries()) {
      if (entry.expiresAt <= nowMs) {
        this.replayCache.delete(key);
      }
    }
  }
}

function parseBearerToken(headers: Record<string, string | string[] | undefined>): string | null {
  const authorization = firstHeader(headers, ["authorization"]);
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || firstHeader(headers, ["x-code-ux-bridge-token", "x-openclaw-token"]) || null;
}

function firstConfiguredSecret(secrets: ChatProviderSecretConfig | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = secrets?.[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function firstHeader(headers: Record<string, string | string[] | undefined>, names: string[]): string | undefined {
  const normalized = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
  for (const name of names) {
    const value = normalized.get(name.toLowerCase());
    const candidate = Array.isArray(value) ? value[0] : value;
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return undefined;
}

function normalizeSignature(value: string): string | null {
  const trimmed = value.trim();
  const match = trimmed.match(/^(?:sha256=|v0=)?([a-f0-9]{64})$/i);
  return match?.[1]?.toLowerCase() || null;
}

function constantTimeEquals(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}
