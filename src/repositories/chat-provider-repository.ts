import { randomUUID } from "crypto";
import type {
  ChatProviderBridgeMode,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderConnectionRecord,
  ChatProviderConnectionStatus,
  ChatProviderVerificationStatus,
  ChatProviderIngressReplayReceiptRecord,
  ChatProviderSessionStateRecord,
  ClaimChatProviderDeliveriesInput,
  CreateChatProviderSessionStateInput,
  ChatProviderDeliveryDirection,
  ChatProviderDeliveryStatus,
  ChatProviderKind,
  ChatProviderMessageDeliveryRecord,
  ChatProviderSecretConfig,
  ChatProviderSetupConfig,
  CreateChatProviderChannelBindingInput,
  CreateChatProviderConnectionInput,
  RecordInboundChatProviderMessageInput,
  RedactedCredentialField,
  ReleaseChatProviderDeliveryInput,
  UpdateChatProviderChannelBindingInput,
  UpdateChatProviderConnectionInput,
  UpdateChatProviderDeliveryStateInput,
  UpsertOutboundChatProviderDeliveryInput,
} from "../contracts/chat-provider-types.js";
import {
  CHAT_PROVIDER_SETUP_SCHEMAS,
  getChatProviderSetupSchema,
} from "../contracts/chat-provider-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DatabaseAdapter } from "./db/database-adapter.js";
import { EntityNotFoundError, requireRecord, toBoolean, toNumber, ValidationError } from "./repository-utils.js";
import type { StoredSecretEnvelope } from "../services/credentials/secret-store.js";
import { redactMetadata } from "../shared/security/redaction.js";

const CHAT_PROVIDER_KINDS = new Set<ChatProviderKind>([
  "whatsapp",
  "imessage",
  "telegram",
  "slack",
  "microsoft-teams",
  "discord",
]);

const CONNECTION_STATUSES = new Set<ChatProviderConnectionStatus>([
  "draft",
  "active",
  "disabled",
  "error",
]);

const DELIVERY_STATUSES = new Set<ChatProviderDeliveryStatus>([
  "pending",
  "sending",
  "delivered",
  "retryable_failure",
  "processed",
  "failed",
  "duplicate",
  "cancelled",
]);

const VERIFICATION_STATUSES = new Set<ChatProviderVerificationStatus>([
  "unverified",
  "pending",
  "verified",
  "failed",
]);

interface ChatProviderConnectionRow {
  id: string;
  provider_kind: string;
  display_name: string;
  bridge_mode: string;
  status: string;
  enabled: number | string;
  setup_json: string | null;
  secret_json: string | null;
  secret_keys_json?: string | null;
  verification_status: string;
  verification_details_json: string | null;
  verified_at: string | null;
  secret_version: number | string;
  created_at: string;
  updated_at: string;
}

interface ChatProviderChannelBindingRow {
  id: string;
  provider_connection_id: string;
  provider_kind: string;
  external_channel_id: string;
  external_channel_name: string;
  external_channel_metadata_json: string | null;
  project_id: string;
  agent_preset_id: string | null;
  routing_hints_json: string | null;
  enabled: number | string;
  inbound_enabled: number | string;
  outbound_enabled: number | string;
  suppress_rich_widgets: number | string;
  created_at: string;
  updated_at: string;
}

interface ChatProviderMessageDeliveryRow {
  id: string;
  provider_connection_id: string;
  provider_kind: string;
  channel_binding_id: string | null;
  external_channel_id: string;
  external_message_id: string | null;
  direction: string;
  status: string;
  attempt_count: number | string;
  last_error: string | null;
  conversation_thread_id: string | null;
  conversation_message_id: string | null;
  payload_json: string | null;
  next_attempt_at: string | null;
  lease_owner: string | null;
  lease_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface ChatProviderSecretRow {
  provider_connection_id: string;
  ciphertext: Buffer;
  nonce: Buffer;
  auth_tag: Buffer;
  wrapped_data_key: Buffer;
  wrap_nonce: Buffer;
  wrap_auth_tag: Buffer;
  key_id: string;
  key_version: number | string;
  secret_keys_json: string;
}

interface ChatProviderReplayReceiptRow {
  id: string;
  provider_connection_id: string;
  receipt_key: string;
  expires_at: string;
  created_at: string;
}

interface ChatProviderSessionRow {
  id: string;
  provider_connection_id: string;
  channel_binding_id: string | null;
  external_channel_id: string;
  session_key: string;
  state_json: string;
  version: number | string;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface PreparedChatProviderConnectionUpdate {
  displayName: string;
  bridgeMode: ChatProviderBridgeMode;
  status: ChatProviderConnectionStatus;
  enabled: boolean;
  setup: ChatProviderSetupConfig;
  transportChanged: boolean;
}

export class ChatProviderConcurrentModificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatProviderConcurrentModificationError";
  }
}

export interface ListChatProviderConnectionsOptions {
  providerKind?: ChatProviderKind;
  enabledOnly?: boolean;
}

export interface ListChatProviderChannelBindingsOptions {
  providerConnectionId?: string;
  projectId?: string;
  externalChannelId?: string;
  enabledOnly?: boolean;
}

export interface ListChatProviderOutboundDeliveriesOptions {
  providerConnectionId?: string;
  channelBindingId?: string;
  externalChannelId?: string;
  status?: ChatProviderDeliveryStatus;
  direction?: ChatProviderDeliveryDirection;
  limit?: number;
}

export interface ListChatProviderDeliveriesOptions extends ListChatProviderOutboundDeliveriesOptions {
  direction?: ChatProviderDeliveryDirection;
}

export interface RecordInboundChatProviderMessageResult {
  delivery: ChatProviderMessageDeliveryRecord;
  duplicate: boolean;
}

export class ChatProviderRepository {
  private readonly db: DatabaseAdapter;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  getSetupSchemas(): typeof CHAT_PROVIDER_SETUP_SCHEMAS {
    return CHAT_PROVIDER_SETUP_SCHEMAS;
  }

  createConnection(input: CreateChatProviderConnectionInput): ChatProviderConnectionRecord {
    if (input.secrets !== undefined && input.secrets !== null) {
      throw new ValidationError("Connector secrets must be written through ChatProviderSecretService.");
    }
    return this.createConnectionRecord(input, randomUUID(), null, []);
  }

  createConnectionWithEnvelope(
    input: Omit<CreateChatProviderConnectionInput, "secrets">,
    connectionId: string,
    envelope: StoredSecretEnvelope | null,
    secretKeys: string[],
  ): ChatProviderConnectionRecord {
    if (envelope && envelope.credentialId !== connectionId) {
      throw new ValidationError("Connector secret envelope id does not match its connection metadata.");
    }
    return this.createConnectionRecord(input, connectionId, envelope, secretKeys);
  }

  private createConnectionRecord(
    input: CreateChatProviderConnectionInput,
    id: string,
    envelope: StoredSecretEnvelope | null,
    secretKeys: string[],
  ): ChatProviderConnectionRecord {
    const providerKind = this.requireProviderKind(input.providerKind);
    const bridgeMode = this.resolveBridgeMode(providerKind, input.bridgeMode);
    const status = input.status ? this.requireConnectionStatus(input.status) : "draft";
    const now = new Date().toISOString();
    const setup = this.sanitizeSetup(providerKind, input.setup ?? {});
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO chat_provider_connections (
          id, provider_kind, display_name, bridge_mode, status, enabled, setup_json, secret_json,
          verification_status, verification_details_json, verified_at, secret_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, 'unverified', NULL, NULL, ?, ?, ?)
      `).run(
        id,
        providerKind,
        this.requireNonEmpty(input.displayName, "displayName"),
        bridgeMode,
        status,
        input.enabled === false ? 0 : 1,
        this.stringifyJson(setup),
        envelope ? 1 : 0,
        now,
        now,
      );
      if (envelope) {
        this.putEnvelope(envelope, secretKeys);
      }
    });
    return this.requireConnection(id);
  }

  updateConnection(connectionId: string, input: UpdateChatProviderConnectionInput): ChatProviderConnectionRecord {
    if (input.secrets !== undefined) {
      throw new ValidationError("Connector secrets must be written through ChatProviderSecretService.");
    }
    const existing = this.requireConnectionInternal(connectionId);
    const update = this.prepareConnectionUpdate(existing, input);
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE chat_provider_connections
      SET
        display_name = ?,
        bridge_mode = ?,
        status = ?,
        enabled = ?,
        setup_json = ?,
        verification_status = CASE WHEN ? THEN 'unverified' ELSE verification_status END,
        verification_details_json = CASE WHEN ? THEN NULL ELSE verification_details_json END,
        verified_at = CASE WHEN ? THEN NULL ELSE verified_at END,
        updated_at = ?
      WHERE id = ?
    `).run(
      update.displayName,
      update.bridgeMode,
      update.status,
      update.enabled ? 1 : 0,
      this.stringifyJson(update.setup),
      update.transportChanged ? 1 : 0,
      update.transportChanged ? 1 : 0,
      update.transportChanged ? 1 : 0,
      now,
      connectionId,
    );
    return this.requireConnection(connectionId);
  }

  updateConnectionWithEnvelope(
    connectionId: string,
    input: Omit<UpdateChatProviderConnectionInput, "secrets">,
    expectedSecretVersion: number,
    envelope: StoredSecretEnvelope | null,
    secretKeys: string[],
  ): ChatProviderConnectionRecord {
    if (envelope && envelope.credentialId !== connectionId) {
      throw new ValidationError("Connector secret envelope id does not match its connection metadata.");
    }
    const existing = this.requireConnectionInternal(connectionId);
    const update = this.prepareConnectionUpdate(existing, input);
    const expectedVersion = this.requireNonNegativeInteger(expectedSecretVersion, "expectedSecretVersion");
    return this.db.transaction(() => {
      const now = new Date().toISOString();
      const result = this.db.prepare(`
        UPDATE chat_provider_connections
        SET display_name = ?, bridge_mode = ?, status = ?, enabled = ?, setup_json = ?,
            verification_status = 'unverified', verification_details_json = NULL, verified_at = NULL,
            secret_version = secret_version + 1, secret_json = NULL, updated_at = ?
        WHERE id = ? AND secret_version = ?
      `).run(
        update.displayName,
        update.bridgeMode,
        update.status,
        update.enabled ? 1 : 0,
        this.stringifyJson(update.setup),
        now,
        connectionId,
        expectedVersion,
      );
      if (result.changes !== 1) {
        throw new ChatProviderConcurrentModificationError("Connector secrets changed concurrently; retry the operation.");
      }
      if (envelope) {
        this.putEnvelope(envelope, secretKeys);
      } else {
        this.db.prepare("DELETE FROM chat_provider_connection_secrets WHERE provider_connection_id = ?").run(connectionId);
      }
      return this.requireConnection(connectionId);
    });
  }

  getConnection(connectionId: string): ChatProviderConnectionRecord | null {
    const row = this.getConnectionRow(connectionId);
    return row ? this.mapConnection(row) : null;
  }

  getConnectionInternal(connectionId: string): ChatProviderConnectionInternalRecord | null {
    const row = this.getConnectionRow(connectionId);
    return row ? this.mapConnectionInternal(row) : null;
  }

  listConnections(options: ListChatProviderConnectionsOptions = {}): ChatProviderConnectionRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.providerKind) {
      clauses.push("provider_kind = ?");
      params.push(this.requireProviderKind(options.providerKind));
    }
    if (options.enabledOnly) {
      clauses.push("enabled = 1");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT c.*, s.secret_keys_json
      FROM chat_provider_connections c
      LEFT JOIN chat_provider_connection_secrets s ON s.provider_connection_id = c.id
      ${where}
      ORDER BY c.updated_at DESC, c.display_name ASC
    `).all(...params) as unknown as ChatProviderConnectionRow[];
    return rows.map((row) => this.mapConnection(row));
  }

  deleteConnection(connectionId: string): boolean {
    const result = this.db.prepare("DELETE FROM chat_provider_connections WHERE id = ?").run(connectionId);
    return result.changes > 0;
  }

  getEnvelope(connectionId: string): StoredSecretEnvelope | null {
    const row = this.db.prepare("SELECT * FROM chat_provider_connection_secrets WHERE provider_connection_id = ?")
      .get(connectionId) as ChatProviderSecretRow | undefined;
    return row ? {
      credentialId: row.provider_connection_id,
      ciphertext: row.ciphertext,
      nonce: row.nonce,
      authTag: row.auth_tag,
      wrappedDataKey: row.wrapped_data_key,
      wrapNonce: row.wrap_nonce,
      wrapAuthTag: row.wrap_auth_tag,
      keyId: row.key_id,
      keyVersion: toNumber(row.key_version),
    } : null;
  }

  replaceSecretEnvelope(
    connectionId: string,
    expectedVersion: number,
    envelope: StoredSecretEnvelope,
    secretKeys: string[],
  ): ChatProviderConnectionRecord {
    return this.updateConnectionWithEnvelope(connectionId, {}, expectedVersion, envelope, secretKeys);
  }

  clearConnectionSecrets(connectionId: string, expectedVersion: number): ChatProviderConnectionRecord {
    return this.updateConnectionWithEnvelope(connectionId, {}, expectedVersion, null, []);
  }

  updateVerification(
    connectionId: string,
    status: ChatProviderVerificationStatus,
    details: Record<string, unknown> | null,
  ): ChatProviderConnectionRecord {
    const verificationStatus = this.requireVerificationStatus(status);
    const now = new Date().toISOString();
    const sanitizedDetails = details === null ? null : redactMetadata(details) as Record<string, unknown>;
    const update = this.db.prepare(`
      UPDATE chat_provider_connections
      SET verification_status = ?, verification_details_json = ?, verified_at = ?, updated_at = ?
      WHERE id = ?
    `).run(
      verificationStatus,
      this.stringifyNullableJson(sanitizedDetails),
      verificationStatus === "verified" || verificationStatus === "failed" ? now : null,
      now,
      connectionId,
    );
    if (update.changes !== 1) throw new EntityNotFoundError(`Chat provider connection not found: ${connectionId}`);
    return this.requireConnection(connectionId);
  }

  listLegacySecrets(): Array<{ connectionId: string; secretJson: string; secretVersion: number }> {
    return this.db.prepare(`
      SELECT id AS connectionId, secret_json AS secretJson, secret_version AS secretVersion
      FROM chat_provider_connections
      WHERE secret_json IS NOT NULL AND TRIM(secret_json) <> ''
      ORDER BY created_at ASC
    `).all() as Array<{ connectionId: string; secretJson: string; secretVersion: number }>;
  }

  commitLegacySecretMigration(
    connectionId: string,
    expectedSecretJson: string,
    expectedVersion: number,
    envelope: StoredSecretEnvelope,
    secretKeys: string[],
  ): boolean {
    if (envelope.credentialId !== connectionId) throw new ValidationError("Connector secret envelope id does not match its connection metadata.");
    return this.db.transaction(() => {
      const update = this.db.prepare(`
        UPDATE chat_provider_connections
        SET secret_json = NULL, secret_version = secret_version + 1, updated_at = ?
        WHERE id = ? AND secret_json = ? AND secret_version = ?
      `).run(new Date().toISOString(), connectionId, expectedSecretJson, expectedVersion);
      if (update.changes !== 1) return false;
      this.putEnvelope(envelope, secretKeys);
      return true;
    });
  }

  createChannelBinding(input: CreateChatProviderChannelBindingInput): ChatProviderChannelBindingRecord {
    const connection = this.requireConnectionInternal(input.providerConnectionId);
    requireRecord(this.db.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId), "Project", input.projectId);
    if (input.agentPresetId) {
      requireRecord(this.db.prepare("SELECT id FROM agent_presets WHERE id = ?").get(input.agentPresetId), "Agent preset", input.agentPresetId);
    }
    const now = new Date().toISOString();
    const id = randomUUID();

    this.db.prepare(`
      INSERT INTO chat_provider_channel_bindings (
        id,
        provider_connection_id,
        external_channel_id,
        external_channel_name,
        external_channel_metadata_json,
        project_id,
        agent_preset_id,
        routing_hints_json,
        enabled,
        inbound_enabled,
        outbound_enabled,
        suppress_rich_widgets,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      connection.id,
      this.requireNonEmpty(input.externalChannelId, "externalChannelId"),
      this.requireNonEmpty(input.externalChannelName, "externalChannelName"),
      this.stringifyNullableJson(input.externalChannelMetadata ?? null),
      input.projectId,
      input.agentPresetId ?? null,
      this.stringifyNullableJson(input.routingHints ?? null),
      input.enabled === false ? 0 : 1,
      input.inboundEnabled === false ? 0 : 1,
      input.outboundEnabled === false ? 0 : 1,
      input.suppressRichWidgets === false ? 0 : 1,
      now,
      now,
    );

    return this.requireChannelBinding(id);
  }

  updateChannelBinding(bindingId: string, input: UpdateChatProviderChannelBindingInput): ChatProviderChannelBindingRecord {
    const existing = this.requireChannelBinding(bindingId);
    if (input.projectId) {
      requireRecord(this.db.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId), "Project", input.projectId);
    }
    if (input.agentPresetId) {
      requireRecord(this.db.prepare("SELECT id FROM agent_presets WHERE id = ?").get(input.agentPresetId), "Agent preset", input.agentPresetId);
    }
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE chat_provider_channel_bindings
      SET
        external_channel_name = ?,
        external_channel_metadata_json = ?,
        project_id = ?,
        agent_preset_id = ?,
        routing_hints_json = ?,
        enabled = ?,
        inbound_enabled = ?,
        outbound_enabled = ?,
        suppress_rich_widgets = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.externalChannelName !== undefined
        ? this.requireNonEmpty(input.externalChannelName, "externalChannelName")
        : existing.externalChannelName,
      input.externalChannelMetadata !== undefined
        ? this.stringifyNullableJson(input.externalChannelMetadata)
        : this.stringifyNullableJson(existing.externalChannelMetadata),
      input.projectId ?? existing.projectId,
      input.agentPresetId !== undefined ? input.agentPresetId : existing.agentPresetId,
      input.routingHints !== undefined
        ? this.stringifyNullableJson(input.routingHints)
        : this.stringifyNullableJson(existing.routingHints),
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      input.inboundEnabled !== undefined ? (input.inboundEnabled ? 1 : 0) : (existing.inboundEnabled ? 1 : 0),
      input.outboundEnabled !== undefined ? (input.outboundEnabled ? 1 : 0) : (existing.outboundEnabled ? 1 : 0),
      input.suppressRichWidgets !== undefined
        ? (input.suppressRichWidgets ? 1 : 0)
        : (existing.suppressRichWidgets ? 1 : 0),
      now,
      bindingId,
    );

    return this.requireChannelBinding(bindingId);
  }

  getChannelBinding(bindingId: string): ChatProviderChannelBindingRecord | null {
    const row = this.getChannelBindingRow(bindingId);
    return row ? this.mapChannelBinding(row) : null;
  }

  listChannelBindings(options: ListChatProviderChannelBindingsOptions = {}): ChatProviderChannelBindingRecord[] {
    const clauses: string[] = [];
    const params: Array<string | number> = [];
    if (options.providerConnectionId) {
      clauses.push("b.provider_connection_id = ?");
      params.push(options.providerConnectionId);
    }
    if (options.projectId) {
      clauses.push("b.project_id = ?");
      params.push(options.projectId);
    }
    if (options.externalChannelId) {
      clauses.push("b.external_channel_id = ?");
      params.push(options.externalChannelId);
    }
    if (options.enabledOnly) {
      clauses.push("b.enabled = 1");
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT b.*, c.provider_kind
      FROM chat_provider_channel_bindings b
      INNER JOIN chat_provider_connections c ON c.id = b.provider_connection_id
      ${where}
      ORDER BY b.updated_at DESC, b.external_channel_name ASC, b.project_id ASC
    `).all(...params) as unknown as ChatProviderChannelBindingRow[];
    return rows.map((row) => this.mapChannelBinding(row));
  }

  deleteChannelBinding(bindingId: string): boolean {
    const result = this.db.prepare("DELETE FROM chat_provider_channel_bindings WHERE id = ?").run(bindingId);
    return result.changes > 0;
  }

  findInboundDelivery(providerConnectionId: string, externalMessageId: string): ChatProviderMessageDeliveryRecord | null {
    const row = this.db.prepare(`
      SELECT d.*, c.provider_kind
      FROM chat_provider_message_deliveries d
      INNER JOIN chat_provider_connections c ON c.id = d.provider_connection_id
      WHERE d.provider_connection_id = ?
        AND d.external_message_id = ?
        AND d.direction = 'inbound'
      LIMIT 1
    `).get(providerConnectionId, this.requireNonEmpty(externalMessageId, "externalMessageId")) as ChatProviderMessageDeliveryRow | undefined;

    return row ? this.mapDelivery(row) : null;
  }

  recordInboundMessage(input: RecordInboundChatProviderMessageInput): RecordInboundChatProviderMessageResult {
    this.requireConnectionInternal(input.providerConnectionId);
    if (input.channelBindingId) {
      this.requireOwnedChannelBinding(input.channelBindingId, input.providerConnectionId);
    }
    const externalMessageId = this.requireNonEmpty(input.externalMessageId, "externalMessageId");
    const id = randomUUID();
    const now = new Date().toISOString();
    const status = input.status ? this.requireDeliveryStatus(input.status) : "processed";
    const insert = this.db.prepare(`
      INSERT INTO chat_provider_message_deliveries (
        id,
        provider_connection_id,
        channel_binding_id,
        external_channel_id,
        external_message_id,
        direction,
        status,
        attempt_count,
        last_error,
        conversation_thread_id,
        conversation_message_id,
        payload_json,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'inbound', ?, 0, NULL, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_connection_id, external_message_id) WHERE direction = 'inbound' AND external_message_id IS NOT NULL
      DO NOTHING
    `).run(
      id,
      input.providerConnectionId,
      input.channelBindingId ?? null,
      this.requireNonEmpty(input.externalChannelId, "externalChannelId"),
      externalMessageId,
      status,
      input.conversationThreadId ?? null,
      input.conversationMessageId ?? null,
      this.stringifyNullableJson(input.payload ?? null),
      now,
      now,
    );

    if (insert.changes === 1) {
      return { delivery: this.requireDelivery(id), duplicate: false };
    }
    const duplicate = this.findInboundDelivery(input.providerConnectionId, externalMessageId);
    return { delivery: requireRecord(duplicate, "Inbound chat provider delivery", externalMessageId), duplicate: true };
  }

  upsertOutboundDelivery(input: UpsertOutboundChatProviderDeliveryInput): ChatProviderMessageDeliveryRecord {
    this.requireConnectionInternal(input.providerConnectionId);
    if (input.channelBindingId) {
      this.requireOwnedChannelBinding(input.channelBindingId, input.providerConnectionId);
    }
    const conversationMessageId = this.requireNonEmpty(input.conversationMessageId, "conversationMessageId");
    const existing = this.getOutboundDeliveryByMessage(input.providerConnectionId, conversationMessageId);
    const now = new Date().toISOString();
    const status = input.status ? this.requireDeliveryStatus(input.status) : "pending";
    const attemptCount = input.attemptCount !== undefined ? this.requireNonNegativeInteger(input.attemptCount, "attemptCount") : 0;

    if (existing) {
      this.db.prepare(`
        UPDATE chat_provider_message_deliveries
        SET
          channel_binding_id = ?,
          external_channel_id = ?,
          external_message_id = ?,
          status = ?,
          attempt_count = ?,
          last_error = ?,
          conversation_thread_id = ?,
          payload_json = ?,
          next_attempt_at = ?,
          lease_owner = NULL,
          lease_expires_at = NULL,
          updated_at = ?
        WHERE id = ?
      `).run(
        input.channelBindingId ?? existing.channelBindingId,
        this.requireNonEmpty(input.externalChannelId, "externalChannelId"),
        input.externalMessageId !== undefined ? input.externalMessageId : existing.externalMessageId,
        status,
        input.attemptCount !== undefined ? attemptCount : existing.attemptCount,
        input.lastError !== undefined ? input.lastError : existing.lastError,
        input.conversationThreadId !== undefined ? input.conversationThreadId : existing.conversationThreadId,
        input.payload !== undefined ? this.stringifyNullableJson(input.payload) : this.stringifyNullableJson(existing.payload),
        input.nextAttemptAt !== undefined ? input.nextAttemptAt : existing.nextAttemptAt,
        now,
        existing.id,
      );
      return this.requireDelivery(existing.id);
    }

    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO chat_provider_message_deliveries (
        id,
        provider_connection_id,
        channel_binding_id,
        external_channel_id,
        external_message_id,
        direction,
        status,
        attempt_count,
        last_error,
        conversation_thread_id,
        conversation_message_id,
        payload_json,
        next_attempt_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      input.providerConnectionId,
      input.channelBindingId ?? null,
      this.requireNonEmpty(input.externalChannelId, "externalChannelId"),
      input.externalMessageId ?? null,
      status,
      attemptCount,
      input.lastError ?? null,
      input.conversationThreadId ?? null,
      conversationMessageId,
      this.stringifyNullableJson(input.payload ?? null),
      input.nextAttemptAt ?? null,
      now,
      now,
    );

    return this.requireDelivery(id);
  }

  updateDeliveryState(deliveryId: string, input: UpdateChatProviderDeliveryStateInput): ChatProviderMessageDeliveryRecord {
    const existing = this.requireDelivery(deliveryId);
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE chat_provider_message_deliveries
      SET
        status = ?,
        attempt_count = ?,
        last_error = ?,
        external_message_id = ?,
        conversation_thread_id = ?,
        conversation_message_id = ?,
        payload_json = ?,
        next_attempt_at = ?,
        lease_owner = CASE WHEN ? IN ('pending', 'retryable_failure', 'delivered', 'failed', 'cancelled') THEN NULL ELSE lease_owner END,
        lease_expires_at = CASE WHEN ? IN ('pending', 'retryable_failure', 'delivered', 'failed', 'cancelled') THEN NULL ELSE lease_expires_at END,
        updated_at = ?
      WHERE id = ?
    `).run(
      this.requireDeliveryStatus(input.status),
      input.attemptCount !== undefined ? this.requireNonNegativeInteger(input.attemptCount, "attemptCount") : existing.attemptCount,
      input.lastError !== undefined ? input.lastError : existing.lastError,
      input.externalMessageId !== undefined ? input.externalMessageId : existing.externalMessageId,
      input.conversationThreadId !== undefined ? input.conversationThreadId : existing.conversationThreadId,
      input.conversationMessageId !== undefined ? input.conversationMessageId : existing.conversationMessageId,
      input.payload !== undefined ? this.stringifyNullableJson(input.payload) : this.stringifyNullableJson(existing.payload),
      input.nextAttemptAt !== undefined ? input.nextAttemptAt : existing.nextAttemptAt,
      input.status,
      input.status,
      now,
      deliveryId,
    );
    return this.requireDelivery(deliveryId);
  }

  getDelivery(deliveryId: string): ChatProviderMessageDeliveryRecord | null {
    const row = this.getDeliveryRow(deliveryId);
    return row ? this.mapDelivery(row) : null;
  }

  listDeliveries(options: ListChatProviderDeliveriesOptions = {}): ChatProviderMessageDeliveryRecord[] {
    const clauses: string[] = [];
    const params: string[] = [];
    if (options.providerConnectionId) {
      clauses.push("d.provider_connection_id = ?");
      params.push(options.providerConnectionId);
    }
    if (options.channelBindingId) {
      clauses.push("d.channel_binding_id = ?");
      params.push(options.channelBindingId);
    }
    if (options.direction) {
      clauses.push("d.direction = ?");
      params.push(this.requireDeliveryDirection(options.direction));
    }
    const boundedLimit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 500));
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`
      SELECT d.*, c.provider_kind
      FROM chat_provider_message_deliveries d
      INNER JOIN chat_provider_connections c ON c.id = d.provider_connection_id
      ${where}
      ORDER BY d.updated_at DESC, d.created_at DESC
      LIMIT ${boundedLimit}
    `).all(...params) as unknown as ChatProviderMessageDeliveryRow[];
    return rows.map((row) => this.mapDelivery(row));
  }

  listPendingOutboundDeliveries(limit = 100): ChatProviderMessageDeliveryRecord[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(limit), 500));
    const rows = this.db.prepare(`
      SELECT d.*, c.provider_kind
      FROM chat_provider_message_deliveries d
      INNER JOIN chat_provider_connections c ON c.id = d.provider_connection_id
      WHERE d.direction = 'outbound'
        AND d.status IN ('pending', 'sending', 'retryable_failure')
        AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= ?)
        AND (d.lease_owner IS NULL OR d.lease_expires_at <= ?)
      ORDER BY d.updated_at ASC
      LIMIT ${boundedLimit}
    `).all(new Date().toISOString(), new Date().toISOString()) as unknown as ChatProviderMessageDeliveryRow[];
    return rows.map((row) => this.mapDelivery(row));
  }

  listOutboundDeliveries(options: ListChatProviderOutboundDeliveriesOptions = {}): ChatProviderMessageDeliveryRecord[] {
    const clauses = ["d.direction = 'outbound'"];
    const params: Array<string | number> = [];
    if (options.providerConnectionId) {
      clauses.push("d.provider_connection_id = ?");
      params.push(options.providerConnectionId);
    }
    if (options.channelBindingId) {
      clauses.push("d.channel_binding_id = ?");
      params.push(options.channelBindingId);
    }
    if (options.externalChannelId) {
      clauses.push("d.external_channel_id = ?");
      params.push(this.requireNonEmpty(options.externalChannelId, "externalChannelId"));
    }
    if (options.status) {
      clauses.push("d.status = ?");
      params.push(this.requireDeliveryStatus(options.status));
    }
    const boundedLimit = Math.max(1, Math.min(Math.trunc(options.limit ?? 100), 500));
    const rows = this.db.prepare(`
      SELECT d.*, c.provider_kind
      FROM chat_provider_message_deliveries d
      INNER JOIN chat_provider_connections c ON c.id = d.provider_connection_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY d.updated_at DESC, d.created_at DESC
      LIMIT ${boundedLimit}
    `).all(...params) as unknown as ChatProviderMessageDeliveryRow[];
    return rows.map((row) => this.mapDelivery(row));
  }

  insertIngressReplayReceipt(
    providerConnectionId: string,
    receiptKey: string,
    expiresAt: string,
    now = new Date(),
  ): boolean {
    this.requireConnectionInternal(providerConnectionId);
    const normalizedKey = this.requireNonEmpty(receiptKey, "receiptKey");
    const normalizedExpiry = this.requireIsoDate(expiresAt, "expiresAt");
    return this.db.transaction(() => {
      const nowIso = now.toISOString();
      this.db.prepare("DELETE FROM chat_provider_ingress_replay_receipts WHERE expires_at <= ?").run(nowIso);
      const result = this.db.prepare(`
        INSERT INTO chat_provider_ingress_replay_receipts (
          id, provider_connection_id, receipt_key, expires_at, created_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(provider_connection_id, receipt_key) DO NOTHING
      `).run(randomUUID(), providerConnectionId, normalizedKey, normalizedExpiry, nowIso);
      return result.changes === 1;
    });
  }

  listIngressReplayReceipts(providerConnectionId: string): ChatProviderIngressReplayReceiptRecord[] {
    const rows = this.db.prepare(`
      SELECT * FROM chat_provider_ingress_replay_receipts
      WHERE provider_connection_id = ? ORDER BY created_at ASC
    `).all(providerConnectionId) as ChatProviderReplayReceiptRow[];
    return rows.map((row) => ({
      id: row.id,
      providerConnectionId: row.provider_connection_id,
      receiptKey: row.receipt_key,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    }));
  }

  cleanupExpiredIngressReplayReceipts(now = new Date()): number {
    return this.db.prepare("DELETE FROM chat_provider_ingress_replay_receipts WHERE expires_at <= ?")
      .run(now.toISOString()).changes;
  }

  createProviderSession(input: CreateChatProviderSessionStateInput): ChatProviderSessionStateRecord {
    this.requireConnectionInternal(input.providerConnectionId);
    if (input.channelBindingId) this.requireOwnedChannelBinding(input.channelBindingId, input.providerConnectionId);
    const now = new Date().toISOString();
    const id = randomUUID();
    this.db.prepare(`
      INSERT INTO chat_provider_sessions (
        id, provider_connection_id, channel_binding_id, external_channel_id, session_key,
        state_json, version, expires_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `).run(
      id,
      input.providerConnectionId,
      input.channelBindingId ?? null,
      this.requireNonEmpty(input.externalChannelId, "externalChannelId"),
      this.requireNonEmpty(input.sessionKey, "sessionKey"),
      this.stringifyJson(input.state),
      input.expiresAt ? this.requireIsoDate(input.expiresAt, "expiresAt") : null,
      now,
      now,
    );
    return this.requireProviderSession(id);
  }

  getProviderSession(providerConnectionId: string, sessionKey: string): ChatProviderSessionStateRecord | null {
    const row = this.db.prepare(`
      SELECT * FROM chat_provider_sessions WHERE provider_connection_id = ? AND session_key = ? LIMIT 1
    `).get(providerConnectionId, this.requireNonEmpty(sessionKey, "sessionKey")) as ChatProviderSessionRow | undefined;
    return row ? this.mapProviderSession(row) : null;
  }

  listProviderSessions(options: { providerConnectionId?: string; limit?: number } = {}): ChatProviderSessionStateRecord[] {
    const boundedLimit = Math.max(1, Math.min(Math.trunc(options.limit ?? 500), 500));
    const rows = options.providerConnectionId
      ? this.db.prepare(`
          SELECT * FROM chat_provider_sessions
          WHERE provider_connection_id = ?
          ORDER BY updated_at ASC
          LIMIT ${boundedLimit}
        `).all(options.providerConnectionId) as unknown as ChatProviderSessionRow[]
      : this.db.prepare(`
          SELECT * FROM chat_provider_sessions
          ORDER BY updated_at ASC
          LIMIT ${boundedLimit}
        `).all() as unknown as ChatProviderSessionRow[];
    return rows.map((row) => this.mapProviderSession(row));
  }

  compareAndSetProviderSession(
    sessionId: string,
    expectedVersion: number,
    state: Record<string, unknown>,
    expiresAt?: string | null,
  ): ChatProviderSessionStateRecord {
    const existing = this.requireProviderSession(sessionId);
    const result = this.db.prepare(`
      UPDATE chat_provider_sessions
      SET state_json = ?, version = version + 1, expires_at = ?, updated_at = ?
      WHERE id = ? AND version = ?
    `).run(
      this.stringifyJson(state),
      expiresAt === undefined ? existing.expiresAt : expiresAt === null ? null : this.requireIsoDate(expiresAt, "expiresAt"),
      new Date().toISOString(),
      sessionId,
      this.requireNonNegativeInteger(expectedVersion, "expectedVersion"),
    );
    if (result.changes !== 1) {
      throw new ChatProviderConcurrentModificationError("Connector session changed concurrently; reload it before retrying.");
    }
    return this.requireProviderSession(sessionId);
  }

  cleanupExpiredProviderSessions(now = new Date()): number {
    return this.db.prepare("DELETE FROM chat_provider_sessions WHERE expires_at IS NOT NULL AND expires_at <= ?")
      .run(now.toISOString()).changes;
  }

  claimOutboundDeliveries(input: ClaimChatProviderDeliveriesInput): ChatProviderMessageDeliveryRecord[] {
    const leaseOwner = this.requireNonEmpty(input.leaseOwner, "leaseOwner");
    if (!Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
      throw new ValidationError("leaseDurationMs must be greater than zero");
    }
    const limit = Math.max(1, Math.min(Math.trunc(input.limit ?? 1), 100));
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs).toISOString();
    return this.db.transaction(() => {
      const claimedIds: string[] = [];
      for (let index = 0; index < limit; index += 1) {
        const candidate = this.db.prepare(`
          SELECT id FROM chat_provider_message_deliveries
          WHERE direction = 'outbound'
            AND status IN ('pending', 'sending', 'retryable_failure')
            AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
          ORDER BY COALESCE(next_attempt_at, created_at) ASC, created_at ASC
          LIMIT 1
        `).get(nowIso, nowIso) as { id: string } | undefined;
        if (!candidate) break;
        const update = this.db.prepare(`
          UPDATE chat_provider_message_deliveries
          SET status = 'sending', lease_owner = ?, lease_expires_at = ?, updated_at = ?
          WHERE id = ?
            AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
        `).run(leaseOwner, leaseExpiresAt, nowIso, candidate.id, nowIso);
        if (update.changes === 1) claimedIds.push(candidate.id);
      }
      return claimedIds.map((id) => this.requireDelivery(id));
    });
  }

  claimOutboundDelivery(
    deliveryId: string,
    input: Omit<ClaimChatProviderDeliveriesInput, "limit">,
  ): ChatProviderMessageDeliveryRecord | null {
    const leaseOwner = this.requireNonEmpty(input.leaseOwner, "leaseOwner");
    if (!Number.isFinite(input.leaseDurationMs) || input.leaseDurationMs <= 0) {
      throw new ValidationError("leaseDurationMs must be greater than zero");
    }
    const now = input.now ?? new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseDurationMs).toISOString();
    const update = this.db.prepare(`
      UPDATE chat_provider_message_deliveries
      SET status = 'sending', lease_owner = ?, lease_expires_at = ?, updated_at = ?
      WHERE id = ?
        AND direction = 'outbound'
        AND status IN ('pending', 'sending', 'retryable_failure')
        AND (next_attempt_at IS NULL OR next_attempt_at <= ?)
        AND (lease_owner IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?)
    `).run(leaseOwner, leaseExpiresAt, nowIso, deliveryId, nowIso, nowIso);
    return update.changes === 1 ? this.requireDelivery(deliveryId) : null;
  }

  completeOutboundDelivery(
    deliveryId: string,
    leaseOwner: string,
    input: UpdateChatProviderDeliveryStateInput,
  ): ChatProviderMessageDeliveryRecord {
    const existing = this.requireDelivery(deliveryId);
    const status = this.requireDeliveryStatus(input.status);
    const update = this.db.prepare(`
      UPDATE chat_provider_message_deliveries
      SET status = ?, attempt_count = ?, last_error = ?, external_message_id = ?,
          conversation_thread_id = ?, conversation_message_id = ?, payload_json = ?, next_attempt_at = ?,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND direction = 'outbound' AND lease_owner = ?
    `).run(
      status,
      input.attemptCount !== undefined ? this.requireNonNegativeInteger(input.attemptCount, "attemptCount") : existing.attemptCount,
      input.lastError !== undefined ? input.lastError : existing.lastError,
      input.externalMessageId !== undefined ? input.externalMessageId : existing.externalMessageId,
      input.conversationThreadId !== undefined ? input.conversationThreadId : existing.conversationThreadId,
      input.conversationMessageId !== undefined ? input.conversationMessageId : existing.conversationMessageId,
      input.payload !== undefined ? this.stringifyNullableJson(input.payload) : this.stringifyNullableJson(existing.payload),
      input.nextAttemptAt !== undefined ? input.nextAttemptAt : existing.nextAttemptAt,
      new Date().toISOString(),
      deliveryId,
      this.requireNonEmpty(leaseOwner, "leaseOwner"),
    );
    if (update.changes !== 1) throw new ChatProviderConcurrentModificationError("Outbound delivery lease is not owned by this worker.");
    return this.requireDelivery(deliveryId);
  }

  releaseOutboundDelivery(
    deliveryId: string,
    leaseOwner: string,
    input: ReleaseChatProviderDeliveryInput = {},
  ): ChatProviderMessageDeliveryRecord {
    const status = input.status ?? "pending";
    const update = this.db.prepare(`
      UPDATE chat_provider_message_deliveries
      SET status = ?, next_attempt_at = ?, last_error = ?, lease_owner = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE id = ? AND direction = 'outbound' AND lease_owner = ?
    `).run(
      status,
      input.nextAttemptAt ?? null,
      input.lastError ?? null,
      new Date().toISOString(),
      deliveryId,
      this.requireNonEmpty(leaseOwner, "leaseOwner"),
    );
    if (update.changes !== 1) throw new ChatProviderConcurrentModificationError("Outbound delivery lease is not owned by this worker.");
    return this.requireDelivery(deliveryId);
  }

  private getConnectionRow(connectionId: string): ChatProviderConnectionRow | null {
    const row = this.db.prepare(`
      SELECT c.*, s.secret_keys_json
      FROM chat_provider_connections c
      LEFT JOIN chat_provider_connection_secrets s ON s.provider_connection_id = c.id
      WHERE c.id = ?
    `).get(connectionId) as ChatProviderConnectionRow | undefined;
    return row ?? null;
  }

  private requireConnection(connectionId: string): ChatProviderConnectionRecord {
    return requireRecord(this.getConnection(connectionId), "Chat provider connection", connectionId);
  }

  private requireConnectionInternal(connectionId: string): ChatProviderConnectionInternalRecord {
    return requireRecord(this.getConnectionInternal(connectionId), "Chat provider connection", connectionId);
  }

  private getChannelBindingRow(bindingId: string): ChatProviderChannelBindingRow | null {
    const row = this.db.prepare(`
      SELECT b.*, c.provider_kind
      FROM chat_provider_channel_bindings b
      INNER JOIN chat_provider_connections c ON c.id = b.provider_connection_id
      WHERE b.id = ?
    `).get(bindingId) as ChatProviderChannelBindingRow | undefined;
    return row ?? null;
  }

  private requireChannelBinding(bindingId: string): ChatProviderChannelBindingRecord {
    return requireRecord(this.getChannelBinding(bindingId), "Chat provider channel binding", bindingId);
  }

  private requireOwnedChannelBinding(bindingId: string, providerConnectionId: string): ChatProviderChannelBindingRecord {
    const binding = this.requireChannelBinding(bindingId);
    if (binding.providerConnectionId !== providerConnectionId) {
      throw new ValidationError("Channel binding does not belong to the referenced chat provider connection.");
    }
    return binding;
  }

  private getProviderSessionRow(sessionId: string): ChatProviderSessionRow | null {
    return (this.db.prepare("SELECT * FROM chat_provider_sessions WHERE id = ?").get(sessionId) as ChatProviderSessionRow | undefined) ?? null;
  }

  private requireProviderSession(sessionId: string): ChatProviderSessionStateRecord {
    const row = this.getProviderSessionRow(sessionId);
    return requireRecord(row ? this.mapProviderSession(row) : null, "Chat provider session", sessionId);
  }

  private getDeliveryRow(deliveryId: string): ChatProviderMessageDeliveryRow | null {
    const row = this.db.prepare(`
      SELECT d.*, c.provider_kind
      FROM chat_provider_message_deliveries d
      INNER JOIN chat_provider_connections c ON c.id = d.provider_connection_id
      WHERE d.id = ?
    `).get(deliveryId) as ChatProviderMessageDeliveryRow | undefined;
    return row ?? null;
  }

  private requireDelivery(deliveryId: string): ChatProviderMessageDeliveryRecord {
    return requireRecord(this.getDelivery(deliveryId), "Chat provider message delivery", deliveryId);
  }

  private getOutboundDeliveryByMessage(providerConnectionId: string, conversationMessageId: string): ChatProviderMessageDeliveryRecord | null {
    const row = this.db.prepare(`
      SELECT d.*, c.provider_kind
      FROM chat_provider_message_deliveries d
      INNER JOIN chat_provider_connections c ON c.id = d.provider_connection_id
      WHERE d.provider_connection_id = ?
        AND d.conversation_message_id = ?
        AND d.direction = 'outbound'
      LIMIT 1
    `).get(providerConnectionId, conversationMessageId) as ChatProviderMessageDeliveryRow | undefined;
    return row ? this.mapDelivery(row) : null;
  }

  private mapConnection(row: ChatProviderConnectionRow): ChatProviderConnectionRecord {
    const internal = this.mapConnectionInternal(row);
    const configuredSecrets = internal.secrets ?? this.secretKeyRecord(row.secret_keys_json);
    return {
      id: internal.id,
      providerKind: internal.providerKind,
      displayName: internal.displayName,
      bridgeMode: internal.bridgeMode,
      status: internal.status,
      enabled: internal.enabled,
      setup: internal.setup,
      credentials: this.redactCredentials(internal.providerKind, internal.bridgeMode, configuredSecrets),
      verificationStatus: internal.verificationStatus,
      verificationDetails: internal.verificationDetails,
      verifiedAt: internal.verifiedAt,
      secretVersion: internal.secretVersion,
      createdAt: internal.createdAt,
      updatedAt: internal.updatedAt,
    };
  }

  private mapConnectionInternal(row: ChatProviderConnectionRow): ChatProviderConnectionInternalRecord {
    const providerKind = this.requireProviderKind(row.provider_kind);
    const secrets = this.parseJsonRecord(row.secret_json);
    return {
      id: row.id,
      providerKind,
      displayName: row.display_name,
      bridgeMode: this.resolveBridgeMode(providerKind, row.bridge_mode),
      status: this.requireConnectionStatus(row.status),
      enabled: toBoolean(row.enabled),
      setup: this.parseJsonRecord(row.setup_json) ?? {},
      secrets: secrets ? { ...secrets } : null,
      verificationStatus: this.requireVerificationStatus(row.verification_status),
      verificationDetails: this.parseJsonRecord(row.verification_details_json),
      verifiedAt: row.verified_at,
      secretVersion: toNumber(row.secret_version),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapChannelBinding(row: ChatProviderChannelBindingRow): ChatProviderChannelBindingRecord {
    return {
      id: row.id,
      providerConnectionId: row.provider_connection_id,
      providerKind: this.requireProviderKind(row.provider_kind),
      externalChannelId: row.external_channel_id,
      externalChannelName: row.external_channel_name,
      externalChannelMetadata: this.parseJsonRecord(row.external_channel_metadata_json),
      projectId: row.project_id,
      agentPresetId: row.agent_preset_id,
      routingHints: this.parseJsonRecord(row.routing_hints_json),
      enabled: toBoolean(row.enabled),
      inboundEnabled: toBoolean(row.inbound_enabled),
      outboundEnabled: toBoolean(row.outbound_enabled),
      suppressRichWidgets: toBoolean(row.suppress_rich_widgets),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapDelivery(row: ChatProviderMessageDeliveryRow): ChatProviderMessageDeliveryRecord {
    return {
      id: row.id,
      providerConnectionId: row.provider_connection_id,
      providerKind: this.requireProviderKind(row.provider_kind),
      channelBindingId: row.channel_binding_id,
      externalChannelId: row.external_channel_id,
      externalMessageId: row.external_message_id,
      direction: this.requireDeliveryDirection(row.direction),
      status: this.requireDeliveryStatus(row.status),
      attemptCount: toNumber(row.attempt_count),
      lastError: row.last_error,
      conversationThreadId: row.conversation_thread_id,
      conversationMessageId: row.conversation_message_id,
      payload: this.parseJsonRecord(row.payload_json),
      nextAttemptAt: row.next_attempt_at,
      leaseOwner: row.lease_owner,
      leaseExpiresAt: row.lease_expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapProviderSession(row: ChatProviderSessionRow): ChatProviderSessionStateRecord {
    return {
      id: row.id,
      providerConnectionId: row.provider_connection_id,
      channelBindingId: row.channel_binding_id,
      externalChannelId: row.external_channel_id,
      sessionKey: row.session_key,
      state: this.parseJsonRecord(row.state_json) ?? {},
      version: toNumber(row.version),
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private redactCredentials(
    providerKind: ChatProviderKind,
    bridgeMode: ChatProviderBridgeMode,
    secrets: ChatProviderSecretConfig | null,
  ): RedactedCredentialField[] {
    const bridgeSchema = getChatProviderSetupSchema(providerKind).bridgeModes.find((schema) => schema.mode === bridgeMode);
    const knownFields = bridgeSchema?.secretFields ?? [];
    const secretKeys = new Set<string>(knownFields.map((field) => field.key));
    const extraKeys = Object.keys(secrets ?? {}).filter((key) => !secretKeys.has(key)).sort();
    return [
      ...knownFields.map((field) => ({
        key: field.key,
        label: field.label,
        configured: this.hasConfiguredSecret(secrets?.[field.key]),
        redactedValue: this.hasConfiguredSecret(secrets?.[field.key]) ? "********" : null,
      })),
      ...extraKeys.map((key) => ({
        key,
        label: key,
        configured: this.hasConfiguredSecret(secrets?.[key]),
        redactedValue: this.hasConfiguredSecret(secrets?.[key]) ? "********" : null,
      })),
    ];
  }

  private sanitizeSetup(providerKind: ChatProviderKind, setup: ChatProviderSetupConfig): ChatProviderSetupConfig {
    const secretKeys = new Set(
      getChatProviderSetupSchema(providerKind).bridgeModes.flatMap((bridge) => bridge.secretFields.map((field) => field.key)),
    );
    const sanitized: ChatProviderSetupConfig = {};
    for (const [key, value] of Object.entries(setup)) {
      if (!secretKeys.has(key)) {
        sanitized[key] = value;
      }
    }
    return sanitized;
  }

  private prepareConnectionUpdate(
    existing: ChatProviderConnectionInternalRecord,
    input: Omit<UpdateChatProviderConnectionInput, "secrets">,
  ): PreparedChatProviderConnectionUpdate {
    const bridgeMode = input.bridgeMode
      ? this.resolveBridgeMode(existing.providerKind, input.bridgeMode)
      : existing.bridgeMode;
    const status = input.status ? this.requireConnectionStatus(input.status) : existing.status;
    const setup = input.setup !== undefined
      ? this.sanitizeSetup(existing.providerKind, input.setup)
      : existing.setup;
    const enabled = input.enabled ?? existing.enabled;
    return {
      displayName: input.displayName !== undefined
        ? this.requireNonEmpty(input.displayName, "displayName")
        : existing.displayName,
      bridgeMode,
      status,
      enabled,
      setup,
      transportChanged: bridgeMode !== existing.bridgeMode
        || this.stringifyJson(setup) !== this.stringifyJson(existing.setup)
        || enabled !== existing.enabled
        || status !== existing.status,
    };
  }

  private resolveBridgeMode(providerKind: ChatProviderKind, bridgeMode: string | undefined): ChatProviderBridgeMode {
    const schema = getChatProviderSetupSchema(providerKind);
    const mode = bridgeMode ?? schema.defaultBridgeMode;
    const match = schema.bridgeModes.find((entry) => entry.mode === mode);
    if (!match) {
      throw new ValidationError(`Unsupported bridge mode for ${providerKind}: ${mode}`);
    }
    return match.mode;
  }

  private requireProviderKind(value: string): ChatProviderKind {
    if (!CHAT_PROVIDER_KINDS.has(value as ChatProviderKind)) {
      throw new ValidationError(`Unsupported chat provider kind: ${value}`);
    }
    return value as ChatProviderKind;
  }

  private requireConnectionStatus(value: string): ChatProviderConnectionStatus {
    if (!CONNECTION_STATUSES.has(value as ChatProviderConnectionStatus)) {
      throw new ValidationError(`Unsupported chat provider connection status: ${value}`);
    }
    return value as ChatProviderConnectionStatus;
  }

  private requireVerificationStatus(value: string): ChatProviderVerificationStatus {
    if (!VERIFICATION_STATUSES.has(value as ChatProviderVerificationStatus)) {
      throw new ValidationError(`Unsupported chat provider verification status: ${value}`);
    }
    return value as ChatProviderVerificationStatus;
  }

  private requireDeliveryStatus(value: string): ChatProviderDeliveryStatus {
    if (!DELIVERY_STATUSES.has(value as ChatProviderDeliveryStatus)) {
      throw new ValidationError(`Unsupported chat provider delivery status: ${value}`);
    }
    return value as ChatProviderDeliveryStatus;
  }

  private requireDeliveryDirection(value: string): ChatProviderDeliveryDirection {
    if (value !== "inbound" && value !== "outbound") {
      throw new ValidationError(`Unsupported chat provider delivery direction: ${value}`);
    }
    return value;
  }

  private requireNonEmpty(value: string, fieldName: string): string {
    const trimmed = value.trim();
    if (trimmed.length === 0) {
      throw new ValidationError(`${fieldName} is required`);
    }
    return trimmed;
  }

  private requireNonNegativeInteger(value: number, fieldName: string): number {
    if (!Number.isInteger(value) || value < 0) {
      throw new ValidationError(`${fieldName} must be a non-negative integer`);
    }
    return value;
  }

  private requireIsoDate(value: string, fieldName: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) throw new ValidationError(`${fieldName} must be a valid date`);
    return date.toISOString();
  }

  private parseJsonRecord(value: string | null | undefined): Record<string, unknown> | null {
    if (!value || value.trim().length === 0) {
      return null;
    }
    try {
      const parsed = JSON.parse(value) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      return null;
    }
    return null;
  }

  private stringifyJson(value: Record<string, unknown>): string {
    return JSON.stringify(value);
  }

  private stringifyNullableJson(value: Record<string, unknown> | null): string | null {
    return value === null ? null : JSON.stringify(value);
  }

  private hasConfiguredSecret(value: unknown): boolean {
    return typeof value === "string" ? value.length > 0 : value !== null && value !== undefined;
  }

  private secretKeyRecord(value: string | null | undefined): ChatProviderSecretConfig | null {
    if (!value) return null;
    try {
      const parsed = JSON.parse(value) as unknown;
      if (!Array.isArray(parsed)) return null;
      return Object.fromEntries(parsed.filter((key): key is string => typeof key === "string").map((key) => [key, true]));
    } catch {
      return null;
    }
  }

  private putEnvelope(envelope: StoredSecretEnvelope, secretKeys: string[]): void {
    this.db.prepare(`
      INSERT INTO chat_provider_connection_secrets (
        provider_connection_id, ciphertext, nonce, auth_tag, wrapped_data_key, wrap_nonce, wrap_auth_tag,
        key_id, key_version, secret_keys_json, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(provider_connection_id) DO UPDATE SET
        ciphertext = excluded.ciphertext, nonce = excluded.nonce, auth_tag = excluded.auth_tag,
        wrapped_data_key = excluded.wrapped_data_key, wrap_nonce = excluded.wrap_nonce,
        wrap_auth_tag = excluded.wrap_auth_tag, key_id = excluded.key_id, key_version = excluded.key_version,
        secret_keys_json = excluded.secret_keys_json, updated_at = excluded.updated_at
    `).run(
      envelope.credentialId,
      envelope.ciphertext,
      envelope.nonce,
      envelope.authTag,
      envelope.wrappedDataKey,
      envelope.wrapNonce,
      envelope.wrapAuthTag,
      envelope.keyId,
      envelope.keyVersion,
      JSON.stringify([...new Set(secretKeys)].sort()),
      new Date().toISOString(),
    );
  }
}

export { EntityNotFoundError };
