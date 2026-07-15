import type {
  ChatProviderBridgeMode,
  ChatProviderConnectionRecord,
  ChatProviderConnectorHealth,
  ChatProviderKind,
  ChatProviderSetupGuidance,
  ChatProviderVerificationOutcome,
  ChatProviderVerificationStatus,
} from "../contracts/chat-provider-types.js";
import {
  CHAT_CONNECTOR_REGISTRY,
  type ChatConnectorRegistry,
} from "../domain/chat-connectors/registry.js";
import type {
  ChatConnectorHttpOutboundRequest,
  ChatConnectorLiveVerificationResult,
  ChatConnectorProfile,
  ChatConnectorVerificationResult,
} from "../domain/chat-connectors/types.js";
import { supportsLiveConnectorVerification } from "../domain/chat-connectors/types.js";
import type { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type { Logger } from "../shared/logging/logger.js";
import { getCorrelationId } from "../shared/logging/correlation-id.js";
import { redactText } from "../shared/security/redaction.js";
import type { ChatProviderSecretService } from "./chat-provider-secret-service.js";

const DEFAULT_VERIFICATION_TIMEOUT_MS = 15_000;
const OMITTED_DIAGNOSTIC_KEY = /(?:authorization|cookie|header|payload|request|response|body|text|token|secret|password|signature|signed|url|uri)/i;

export interface ChatProviderVerificationServiceDependencies {
  chatProviderRepository: ChatProviderRepository;
  chatProviderSecretService: ChatProviderSecretService;
  connectorRegistry?: ChatConnectorRegistry;
  logger?: Logger;
  fetchImplementation?: typeof fetch;
  timeoutMs?: number;
}

export class ChatProviderVerificationService {
  private readonly registry: ChatConnectorRegistry;
  private readonly fetchImplementation: typeof fetch;
  private readonly timeoutMs: number;

  constructor(private readonly deps: ChatProviderVerificationServiceDependencies) {
    this.registry = deps.connectorRegistry ?? CHAT_CONNECTOR_REGISTRY;
    this.fetchImplementation = deps.fetchImplementation ?? globalThis.fetch;
    this.timeoutMs = deps.timeoutMs ?? DEFAULT_VERIFICATION_TIMEOUT_MS;
  }

  async verifyConnection(connectionId: string): Promise<ChatProviderVerificationOutcome> {
    const connection = await this.deps.chatProviderSecretService.resolveConnection(connectionId);
    const profile = this.registry.getForMode(connection.providerKind, connection.bridgeMode);
    const setupGuidance = buildSetupGuidance(profile, connection.bridgeMode);
    this.deps.chatProviderSecretService.updateVerification(connectionId, "pending", {
      capabilities: [...profile.verification.capabilities],
      setupGuidance,
    });

    let result: ChatConnectorLiveVerificationResult;
    let providerErrorCode: string | null = null;
    let retryable = false;
    try {
      const configured = profile.verification.verifyConfiguration(
        connection.bridgeMode,
        connection.setup,
        connection.secrets,
      );
      if (!configured.valid) {
        result = configured;
        providerErrorCode = "configuration_invalid";
      } else {
        result = await this.withTimeout(
          this.verifyLive(profile, connection.bridgeMode, connection.setup, connection.secrets, configured),
        );
        providerErrorCode = result.valid ? null : readProviderErrorCode(result, connection.secrets) ?? "provider_verification_failed";
        retryable = readRetryable(result);
      }
    } catch (error) {
      const timedOut = error instanceof ChatProviderVerificationTimeoutError;
      providerErrorCode = timedOut ? "verification_timeout" : "verification_error";
      retryable = true;
      result = {
        valid: false,
        issues: [timedOut ? "Provider verification timed out." : sanitizeIssue(error, connection.secrets)],
      };
    }

    const details = {
      capabilities: [...profile.verification.capabilities],
      providerErrorCode,
      retryable,
      issues: result.issues.map((issue) => sanitizeIssue(issue, connection.secrets)),
      diagnostics: sanitizeDiagnostics(result.diagnostics ?? null, connection.secrets),
      setupGuidance,
    };
    const updated = this.deps.chatProviderSecretService.updateVerification(
      connectionId,
      result.valid ? "verified" : "failed",
      details,
    );
    if (!result.valid && connection.status === "active") {
      this.deps.chatProviderRepository.updateConnection(connectionId, { status: "error" });
    }
    this.deps.logger?.[result.valid ? "info" : "warn"]("Chat provider connection verification completed", {
      logPurpose: "integration",
      correlationId: getCorrelationId(),
      providerConnectionId: connectionId,
      providerKind: connection.providerKind,
      bridgeMode: connection.bridgeMode,
      outcome: result.valid ? "verified" : "failed",
      providerErrorCode,
      retryable,
    });
    return {
      providerConnectionId: connectionId,
      providerKind: connection.providerKind,
      status: result.valid ? "verified" : "failed",
      verifiedAt: updated.verifiedAt,
      capabilities: [...profile.verification.capabilities],
      providerErrorCode,
      retryable,
      issues: details.issues,
      diagnostics: details.diagnostics,
      setupGuidance,
    };
  }

  async validateActivation(connectionId: string): Promise<ChatProviderConnectionRecord> {
    const connection = this.deps.chatProviderRepository.getConnection(connectionId);
    if (!connection) throw new Error(`Chat provider connection not found: ${connectionId}`);
    if (connection.verificationStatus !== "verified") {
      throw new Error("Chat provider connection must be verified before it can be activated.");
    }
    const internal = await this.deps.chatProviderSecretService.resolveConnection(connectionId);
    const profile = this.registry.getForMode(internal.providerKind, internal.bridgeMode);
    const validation = profile.verification.verifyConfiguration(internal.bridgeMode, internal.setup, internal.secrets);
    if (!validation.valid) {
      throw new Error(`Chat provider connection configuration is no longer valid: ${validation.issues.join(" ")}`);
    }
    return connection;
  }

  getHealth(): ChatProviderConnectorHealth {
    const connections = this.deps.chatProviderRepository.listConnections();
    return {
      configuredCount: connections.length,
      activeCount: connections.filter((connection) => connection.enabled && connection.status === "active").length,
      verifiedCount: connections.filter((connection) => connection.verificationStatus === "verified").length,
      errorCount: connections.filter((connection) => connection.status === "error" || connection.verificationStatus === "failed").length,
      lastVerificationOutcomes: connections
        .filter((connection) => connection.verificationStatus !== "unverified")
        .map((connection) => ({
          providerConnectionId: connection.id,
          providerKind: connection.providerKind,
          status: connection.verificationStatus,
          verifiedAt: connection.verifiedAt,
          providerErrorCode: readString(connection.verificationDetails?.providerErrorCode),
          retryable: connection.verificationDetails?.retryable === true,
        })),
    };
  }

  private async verifyLive(
    profile: ChatConnectorProfile,
    mode: Parameters<ChatConnectorProfile["verification"]["verifyConfiguration"]>[0],
    setup: Record<string, unknown>,
    secrets: Record<string, unknown> | null,
    configured: ChatConnectorVerificationResult,
  ): Promise<ChatConnectorLiveVerificationResult> {
    if (!supportsLiveConnectorVerification(profile, mode)) return configured;
    if (profile.verification.verifyLive) {
      return profile.verification.verifyLive(mode, setup, secrets, this.fetchImplementation);
    }
    if (!profile.verification.live) return configured;
    const request = profile.verification.live.buildRequest({
      setup,
      correlationId: getCorrelationId() ?? "chat-provider-verification",
    });
    const response = await this.executeHttpVerification(request, secrets);
    return profile.verification.live.parseResponse(response.body, {
      statusCode: response.statusCode,
      headers: response.headers,
    }, setup);
  }

  private async executeHttpVerification(
    request: ChatConnectorHttpOutboundRequest,
    secrets: Record<string, unknown> | null,
  ): Promise<{ statusCode: number; headers: Record<string, string>; body: string }> {
    const headers = { ...request.headers };
    const bearer = firstSecret(secrets, request.bearerSecretKeys);
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    const response = await this.fetchImplementation(request.url, {
      method: "POST",
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
      signal: AbortSignal.timeout(Math.min(request.timeoutMs, this.timeoutMs)),
    });
    return {
      statusCode: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: await response.text().catch(() => ""),
    };
  }

  private async withTimeout<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new ChatProviderVerificationTimeoutError()), this.timeoutMs);
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

class ChatProviderVerificationTimeoutError extends Error {
  constructor() {
    super("Chat provider verification timed out.");
    this.name = "ChatProviderVerificationTimeoutError";
  }
}

function buildSetupGuidance(profile: ChatConnectorProfile, bridgeMode: ChatProviderBridgeMode): ChatProviderSetupGuidance {
  const bridge = profile.setupSchema.bridgeModes.find((candidate) => candidate.mode === bridgeMode);
  return {
    providerKind: profile.kind,
    bridgeMode,
    requiredSetupFields: bridge?.setupFields.filter((field) => field.required).map((field) => field.key) ?? [],
    requiredSecretFields: bridge?.secretFields.filter((field) => field.required).map((field) => field.key) ?? [],
    capabilities: [...profile.verification.capabilities],
    liveVerificationAvailable: supportsLiveConnectorVerification(profile, bridgeMode),
  };
}

function firstSecret(secrets: Record<string, unknown> | null, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = secrets?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function sanitizeIssue(value: unknown, secrets: Record<string, unknown> | null): string {
  return sanitizeSensitiveText(value instanceof Error ? value.message : String(value), secrets)
    .slice(0, 500);
}

function sanitizeSensitiveText(value: string, secrets: Record<string, unknown> | null): string {
  return redactKnownSecrets(redactText(value), secrets)
    .replace(/https?:\/\/[^\s)\]}]+/gi, "[REDACTED_URL]")
    .replace(/\b(authorization|cookie)\s*[:=]\s*[^\s,;]+/gi, "$1=[REDACTED]");
}

function sanitizeDiagnostics(value: unknown, secrets: Record<string, unknown> | null, key = ""): unknown {
  if (key && OMITTED_DIAGNOSTIC_KEY.test(key)) return undefined;
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnostics(entry, secrets)).filter((entry) => entry !== undefined);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .map(([entryKey, entryValue]) => [entryKey, sanitizeDiagnostics(entryValue, secrets, entryKey)] as const)
      .filter((entry): entry is readonly [string, unknown] => entry[1] !== undefined));
  }
  return typeof value === "string" ? sanitizeSensitiveText(value, secrets).slice(0, 500) : value;
}

function readProviderErrorCode(
  result: ChatConnectorLiveVerificationResult,
  secrets: Record<string, unknown> | null,
): string | null {
  const value = (result as ChatConnectorLiveVerificationResult & { providerErrorCode?: unknown }).providerErrorCode;
  const code = readString(value);
  if (!code) return null;
  const sanitized = redactKnownSecrets(code, secrets);
  return sanitized === code ? sanitized : null;
}

function readRetryable(result: ChatConnectorLiveVerificationResult): boolean {
  return (result as ChatConnectorLiveVerificationResult & { retryable?: unknown }).retryable === true;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? redactText(value.trim()).slice(0, 100) : null;
}

function redactKnownSecrets(value: string, secrets: Record<string, unknown> | null): string {
  const configuredSecrets = [...new Set(Object.values(secrets ?? {})
    .filter((secret): secret is string => typeof secret === "string" && secret.length > 0))]
    .sort((left, right) => right.length - left.length);
  return configuredSecrets.reduce(
    (sanitized, secret) => sanitized.split(secret).join("[REDACTED]"),
    value,
  );
}
