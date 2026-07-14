import { randomUUID } from "node:crypto";
import type {
  ChatProviderConnectionInternalRecord,
  ChatProviderConnectionRecord,
  ChatProviderSecretConfig,
  ChatProviderVerificationStatus,
  CreateChatProviderConnectionInput,
  UpdateChatProviderConnectionInput,
} from "../contracts/chat-provider-types.js";
import { EncryptedSqliteSecretStore } from "../infrastructure/security/encrypted-sqlite-secret-store.js";
import type { ChatProviderRepository } from "../repositories/chat-provider-repository.js";
import type { KeyProvider } from "./credentials/key-provider.js";
import type { SecretContext, SecretStore } from "./credentials/secret-store.js";

const CONNECTOR_SECRET_PROJECT = "chat-provider-connectors";
const CONNECTOR_SECRET_WORKSPACE = "global";

export interface ChatProviderSecretMigrationFailure {
  connectionId: string;
  reason: string;
}

export interface ChatProviderSecretMigrationResult {
  status: "ready" | "blocked" | "partial";
  migrated: number;
  pending: number;
  failures: ChatProviderSecretMigrationFailure[];
  reason?: string;
}

export class ChatProviderSecretService {
  private readonly secretStore: SecretStore;

  constructor(
    private readonly repository: ChatProviderRepository,
    private readonly keyProvider: KeyProvider,
    secretStore?: SecretStore,
  ) {
    this.secretStore = secretStore ?? new EncryptedSqliteSecretStore(repository, keyProvider);
  }

  async createConnection(input: CreateChatProviderConnectionInput): Promise<ChatProviderConnectionRecord> {
    const connectionId = randomUUID();
    const secrets = normalizeSecrets(input.secrets ?? null);
    const envelope = secrets ? await this.seal(connectionId, secrets) : null;
    const { secrets: _secrets, ...metadata } = input;
    return this.repository.createConnectionWithEnvelope(metadata, connectionId, envelope, configuredSecretKeys(secrets));
  }

  async updateConnection(
    connectionId: string,
    input: UpdateChatProviderConnectionInput,
  ): Promise<ChatProviderConnectionRecord> {
    const existing = this.requireConnection(connectionId);
    let envelope: Awaited<ReturnType<SecretStore["seal"]>> | null | undefined;
    let secretKeys: string[] = [];
    if (input.secrets !== undefined) {
      const normalized = input.secrets === null
        ? null
        : normalizeSecrets({ ...(await this.resolveConnection(connectionId)).secrets, ...input.secrets });
      envelope = normalized ? await this.seal(connectionId, normalized) : null;
      secretKeys = configuredSecretKeys(normalized);
    }

    const { secrets: _secrets, ...metadata } = input;
    if (envelope === undefined) return this.repository.updateConnection(connectionId, metadata);
    return this.repository.updateConnectionWithEnvelope(
      connectionId,
      metadata,
      existing.secretVersion,
      envelope,
      secretKeys,
    );
  }

  async resolveConnection(connectionId: string): Promise<ChatProviderConnectionInternalRecord> {
    const connection = this.repository.getConnectionInternal(connectionId);
    if (!connection) throw new Error(`Chat provider connection not found: ${connectionId}`);
    const envelope = this.repository.getEnvelope(connectionId);
    if (!envelope) {
      return { ...connection, secrets: connection.secrets ? { ...connection.secrets } : null };
    }
    const plaintext = await this.secretStore.get(this.context(connectionId));
    try {
      return { ...connection, secrets: parseSecrets(plaintext.toString("utf8"), connectionId) };
    } finally {
      plaintext.fill(0);
    }
  }

  updateVerification(
    connectionId: string,
    status: ChatProviderVerificationStatus,
    details: Record<string, unknown> | null,
  ): ChatProviderConnectionRecord {
    return this.repository.updateVerification(connectionId, status, details);
  }

  async migrateLegacySecrets(): Promise<ChatProviderSecretMigrationResult> {
    const pendingAtStart = this.repository.listLegacySecrets();
    if (pendingAtStart.length === 0) {
      return { status: "ready", migrated: 0, pending: 0, failures: [] };
    }
    let health;
    try {
      health = await this.keyProvider.health();
    } catch (error) {
      return blockedResult(pendingAtStart.length, error);
    }
    if (!health.available || !health.secure) {
      return {
        status: "blocked",
        migrated: 0,
        pending: pendingAtStart.length,
        failures: [],
        reason: health.reason ?? `Secure connector key provider ${health.provider} is not ready.`,
      };
    }

    let migrated = 0;
    const failures: ChatProviderSecretMigrationFailure[] = [];
    for (const legacy of pendingAtStart) {
      let plaintext: Buffer | null = null;
      try {
        const secrets = parseSecrets(legacy.secretJson, legacy.connectionId);
        plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
        const envelope = await this.secretStore.seal(this.context(legacy.connectionId), plaintext);
        const committed = this.repository.commitLegacySecretMigration(
          legacy.connectionId,
          legacy.secretJson,
          legacy.secretVersion,
          envelope,
          configuredSecretKeys(secrets),
        );
        if (committed) migrated += 1;
      } catch (error) {
        failures.push({
          connectionId: legacy.connectionId,
          reason: error instanceof Error ? error.message : "Connector secret encryption failed.",
        });
      } finally {
        plaintext?.fill(0);
      }
    }
    const pending = this.repository.listLegacySecrets().length;
    return {
      status: pending === 0 ? "ready" : migrated > 0 ? "partial" : "blocked",
      migrated,
      pending,
      failures,
      ...(pending > 0 ? { reason: "Some legacy connector secrets remain unsealed; restore key readiness and rerun the migration." } : {}),
    };
  }

  private async seal(connectionId: string, secrets: ChatProviderSecretConfig) {
    const plaintext = Buffer.from(JSON.stringify(secrets), "utf8");
    try {
      return await this.secretStore.seal(this.context(connectionId), plaintext);
    } finally {
      plaintext.fill(0);
    }
  }

  private context(connectionId: string): SecretContext {
    return {
      credentialId: connectionId,
      projectId: CONNECTOR_SECRET_PROJECT,
      workspaceId: CONNECTOR_SECRET_WORKSPACE,
    };
  }

  private requireConnection(connectionId: string): ChatProviderConnectionRecord {
    const connection = this.repository.getConnection(connectionId);
    if (!connection) throw new Error(`Chat provider connection not found: ${connectionId}`);
    return connection;
  }
}

function normalizeSecrets(secrets: ChatProviderSecretConfig | null): ChatProviderSecretConfig | null {
  if (!secrets) return null;
  return Object.keys(secrets).length > 0 ? { ...secrets } : null;
}

function configuredSecretKeys(secrets: ChatProviderSecretConfig | null): string[] {
  return Object.entries(secrets ?? {})
    .filter(([, value]) => typeof value === "string" ? value.length > 0 : value !== null && value !== undefined)
    .map(([key]) => key);
}

function parseSecrets(value: string, connectionId: string): ChatProviderSecretConfig {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Legacy connector secret for ${connectionId} is not a JSON object.`);
  }
  return parsed as ChatProviderSecretConfig;
}

function blockedResult(pending: number, error: unknown): ChatProviderSecretMigrationResult {
  return {
    status: "blocked",
    migrated: 0,
    pending,
    failures: [],
    reason: error instanceof Error ? error.message : "Secure connector key provider readiness could not be checked.",
  };
}
