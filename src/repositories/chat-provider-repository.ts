import { randomUUID } from "crypto";
import type {
  ChatProviderBridgeMode,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionInternalRecord,
  ChatProviderConnectionRecord,
  ChatProviderConnectionStatus,
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
  "processed",
  "failed",
  "duplicate",
  "cancelled",
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
  created_at: string;
  updated_at: string;
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

export interface ListChatProviderDeliveriesOptions {
  providerConnectionId?: string;
  channelBindingId?: string;
  direction?: ChatProviderDeliveryDirection;
  limit?: number;
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
    const providerKind = this.requireProviderKind(input.providerKind);
    const bridgeMode = this.resolveBridgeMode(providerKind, input.bridgeMode);
    const status = input.status ? this.requireConnectionStatus(input.status) : "draft";
    const now = new Date().toISOString();
    const id = randomUUID();
    const setup = this.sanitizeSetup(providerKind, input.setup ?? {});

    this.db.prepare(`
      INSERT INTO chat_provider_connections (
        id, provider_kind, display_name, bridge_mode, status, enabled, setup_json, secret_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      providerKind,
      this.requireNonEmpty(input.displayName, "displayName"),
      bridgeMode,
      status,
      input.enabled === false ? 0 : 1,
      this.stringifyJson(setup),
      this.stringifyNullableJson(input.secrets ?? null),
      now,
      now,
    );

    return this.requireConnection(id);
  }

  updateConnection(connectionId: string, input: UpdateChatProviderConnectionInput): ChatProviderConnectionRecord {
    const existing = this.requireConnectionInternal(connectionId);
    const providerKind = existing.providerKind;
    const bridgeMode = input.bridgeMode
      ? this.resolveBridgeMode(providerKind, input.bridgeMode)
      : existing.bridgeMode;
    const status = input.status ? this.requireConnectionStatus(input.status) : existing.status;
    const setup = input.setup !== undefined
      ? this.sanitizeSetup(providerKind, input.setup)
      : existing.setup;
    const secrets = input.secrets !== undefined ? input.secrets : existing.secrets;
    const now = new Date().toISOString();

    this.db.prepare(`
      UPDATE chat_provider_connections
      SET
        display_name = ?,
        bridge_mode = ?,
        status = ?,
        enabled = ?,
        setup_json = ?,
        secret_json = ?,
        updated_at = ?
      WHERE id = ?
    `).run(
      input.displayName !== undefined ? this.requireNonEmpty(input.displayName, "displayName") : existing.displayName,
      bridgeMode,
      status,
      input.enabled !== undefined ? (input.enabled ? 1 : 0) : (existing.enabled ? 1 : 0),
      this.stringifyJson(setup),
      this.stringifyNullableJson(secrets),
      now,
      connectionId,
    );

    return this.requireConnection(connectionId);
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
      SELECT *
      FROM chat_provider_connections
      ${where}
      ORDER BY updated_at DESC, display_name ASC
    `).all(...params) as unknown as ChatProviderConnectionRow[];
    return rows.map((row) => this.mapConnection(row));
  }

  deleteConnection(connectionId: string): boolean {
    const result = this.db.prepare("DELETE FROM chat_provider_connections WHERE id = ?").run(connectionId);
    return result.changes > 0;
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
      this.requireChannelBinding(input.channelBindingId);
    }
    const externalMessageId = this.requireNonEmpty(input.externalMessageId, "externalMessageId");
    const duplicate = this.findInboundDelivery(input.providerConnectionId, externalMessageId);
    if (duplicate) {
      return { delivery: duplicate, duplicate: true };
    }

    const id = randomUUID();
    const now = new Date().toISOString();
    const status = input.status ? this.requireDeliveryStatus(input.status) : "processed";
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
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'inbound', ?, 0, NULL, ?, ?, ?, ?, ?)
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

    return { delivery: this.requireDelivery(id), duplicate: false };
  }

  upsertOutboundDelivery(input: UpsertOutboundChatProviderDeliveryInput): ChatProviderMessageDeliveryRecord {
    this.requireConnectionInternal(input.providerConnectionId);
    if (input.channelBindingId) {
      this.requireChannelBinding(input.channelBindingId);
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
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, 'outbound', ?, ?, ?, ?, ?, ?, ?, ?)
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
        updated_at = ?
      WHERE id = ?
    `).run(
      this.requireDeliveryStatus(input.status),
      input.attemptCount !== undefined ? this.requireNonNegativeInteger(input.attemptCount, "attemptCount") : existing.attemptCount,
      input.lastError !== undefined ? input.lastError : existing.lastError,
      input.externalMessageId !== undefined ? input.externalMessageId : existing.externalMessageId,
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
        AND d.status IN ('pending', 'sending')
      ORDER BY d.updated_at ASC
      LIMIT ${boundedLimit}
    `).all() as unknown as ChatProviderMessageDeliveryRow[];
    return rows.map((row) => this.mapDelivery(row));
  }

  private getConnectionRow(connectionId: string): ChatProviderConnectionRow | null {
    const row = this.db.prepare(`
      SELECT *
      FROM chat_provider_connections
      WHERE id = ?
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
    return {
      id: internal.id,
      providerKind: internal.providerKind,
      displayName: internal.displayName,
      bridgeMode: internal.bridgeMode,
      status: internal.status,
      enabled: internal.enabled,
      setup: internal.setup,
      credentials: this.redactCredentials(internal.providerKind, internal.bridgeMode, internal.secrets),
      createdAt: internal.createdAt,
      updatedAt: internal.updatedAt,
    };
  }

  private mapConnectionInternal(row: ChatProviderConnectionRow): ChatProviderConnectionInternalRecord {
    const providerKind = this.requireProviderKind(row.provider_kind);
    return {
      id: row.id,
      providerKind,
      displayName: row.display_name,
      bridgeMode: this.resolveBridgeMode(providerKind, row.bridge_mode),
      status: this.requireConnectionStatus(row.status),
      enabled: toBoolean(row.enabled),
      setup: this.parseJsonRecord(row.setup_json) ?? {},
      secrets: this.parseJsonRecord(row.secret_json),
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
}

export { EntityNotFoundError };
