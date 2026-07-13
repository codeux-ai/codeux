import { createHash } from "node:crypto";
import type {
  ChatProviderBridgeMode,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionRecord,
  ChatProviderConnectionStatus,
  ChatProviderDeliveryStatus,
  ChatProviderKind,
  ChatProviderRoutingHints,
  ChatProviderSecretConfig,
  ChatProviderSetupConfig,
  ExternalChannelMetadata,
} from "../../contracts/chat-provider-types.js";
import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { ChatProviderRepository } from "../../repositories/chat-provider-repository.js";
import {
  buildMcpApprovalFingerprint,
  managementValidationError,
  parseOptionalBoolean,
  parseOptionalEnumStrict,
  parseOptionalIntegerStrict,
  parseOptionalNullableString,
  parseOptionalObject,
  parseOptionalString,
  parseOptionalStringArray,
  parseRequiredString,
} from "./payload-parsers.js";

const CHAT_PROVIDER_DOMAIN = "chat_providers";
const DEFAULT_INGRESS_BASE_URL = "http://localhost:4444";
const SECRET_APPROVAL_TTL_MS = 15 * 60 * 1000;
const SECRET_APPROVAL_MESSAGE = [
  "Chat provider secret replacement queued and waiting for human confirmation.",
  "Ask the user to confirm this exact secret replacement before calling the tool again.",
  "DO NOT call this chat provider endpoint again with approval.confirmed: true unless the user explicitly confirms.",
  "This approval is one-use, bound to this exact action and redacted payload, and expires in 15 minutes.",
].join(" ");

const PROVIDER_KINDS: readonly ChatProviderKind[] = [
  "whatsapp",
  "imessage",
  "telegram",
  "slack",
  "microsoft-teams",
  "discord",
];

const BRIDGE_MODES: readonly ChatProviderBridgeMode[] = ["managed_bridge", "webhook", "native_bridge", "official_api"];
const CONNECTION_STATUSES: readonly ChatProviderConnectionStatus[] = ["draft", "active", "disabled", "error"];
const DELIVERY_STATUSES: readonly ChatProviderDeliveryStatus[] = [
  "pending",
  "sending",
  "delivered",
  "retryable_failure",
  "processed",
  "failed",
  "duplicate",
  "cancelled",
];

interface IngressUrls {
  connectionIngressUrl: string;
  channelIngressUrlTemplate: string;
  channelIngressUrl?: string;
}

interface ConnectionManagementRecord extends ChatProviderConnectionRecord {
  ingressUrls: IngressUrls;
}

interface ChannelBindingManagementRecord extends ChatProviderChannelBindingRecord {
  ingressUrls: IngressUrls;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function hasConfiguredSecretValue(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  return value !== undefined && value !== null && value !== false;
}

function hasNonEmptySecretPayload(secrets: ChatProviderSecretConfig | null | undefined): boolean {
  return isPlainObject(secrets) && Object.values(secrets).some((value) => hasConfiguredSecretValue(value));
}

function redactSecretPayload(payload: Record<string, unknown>): Record<string, unknown> {
  const redacted = { ...payload };
  if (isPlainObject(payload.secrets)) {
    redacted.secrets = {
      configuredKeys: Object.keys(payload.secrets).sort(),
      payloadHash: createHash("sha256").update(stableStringify(payload.secrets)).digest("hex"),
    };
  }
  return redacted;
}

function parseOptionalProviderKind(payload: Record<string, unknown>): ChatProviderKind | undefined {
  return parseOptionalEnumStrict(payload, "providerKind", PROVIDER_KINDS);
}

function parseRequiredProviderKind(payload: Record<string, unknown>): ChatProviderKind {
  const providerKind = parseOptionalProviderKind(payload);
  if (!providerKind) {
    throw managementValidationError("providerKind is required", "providerKind");
  }
  return providerKind;
}

function parseOptionalNullableObject<T extends Record<string, unknown>>(
  payload: Record<string, unknown>,
  key: string,
): T | null | undefined {
  if (!(key in payload) || payload[key] === undefined) {
    return undefined;
  }
  if (payload[key] === null) {
    return null;
  }
  const parsed = parseOptionalObject<T>(payload, key);
  if (parsed !== undefined) {
    return parsed;
  }
  throw managementValidationError(`${key} must be an object or null`, key);
}

function parseConnectionId(payload: Record<string, unknown>): string {
  return parseOptionalString(payload, "providerConnectionId")
    ?? parseOptionalString(payload, "connectionId")
    ?? (() => {
      throw managementValidationError("providerConnectionId is required", "providerConnectionId");
    })();
}

function parseChannelBindingId(payload: Record<string, unknown>): string {
  return parseOptionalString(payload, "channelBindingId")
    ?? parseOptionalString(payload, "bindingId")
    ?? (() => {
      throw managementValidationError("channelBindingId is required", "channelBindingId");
    })();
}

function normalizeBaseUrl(payload: Record<string, unknown>): string {
  const baseUrl = parseOptionalString(payload, "baseUrl") ?? DEFAULT_INGRESS_BASE_URL;
  return baseUrl.replace(/\/+$/, "");
}

function buildIngressUrls(baseUrl: string, providerConnectionId: string, externalChannelId?: string | null): IngressUrls {
  const encodedConnectionId = encodeURIComponent(providerConnectionId);
  const connectionIngressUrl = `${baseUrl}/api/chat-providers/${encodedConnectionId}/ingress`;
  const channelIngressUrlTemplate = `${baseUrl}/api/chat-providers/${encodedConnectionId}/channels/{externalChannelId}/ingress`;
  return {
    connectionIngressUrl,
    channelIngressUrlTemplate,
    ...(externalChannelId ? { channelIngressUrl: `${baseUrl}/api/chat-providers/${encodedConnectionId}/channels/${encodeURIComponent(externalChannelId)}/ingress` } : {}),
  };
}

function withConnectionIngress(connection: ChatProviderConnectionRecord, baseUrl: string): ConnectionManagementRecord {
  return {
    ...connection,
    ingressUrls: buildIngressUrls(baseUrl, connection.id),
  };
}

function withBindingIngress(binding: ChatProviderChannelBindingRecord, baseUrl: string): ChannelBindingManagementRecord {
  return {
    ...binding,
    ingressUrls: buildIngressUrls(baseUrl, binding.providerConnectionId, binding.externalChannelId),
  };
}

function success(action: string, data: Record<string, unknown>): ManagementResponseEnvelope {
  return {
    result: {
      status: "success",
      domain: CHAT_PROVIDER_DOMAIN,
      action,
      ...data,
    },
  };
}

export class ChatProviderActions {
  private readonly pendingSecretApprovals = new Map<string, number>();

  constructor(private readonly chatProviderRepository: ChatProviderRepository) {}

  async handleChatProviderAction(args: ManageCodeUxArgs): Promise<ManagementResponseEnvelope> {
    const payload = args.payload || {};

    switch (args.action) {
      case "list_provider_definitions":
        return this.listProviderDefinitions(args.action, payload);
      case "list_connections":
        return this.listConnections(args.action, payload);
      case "get_connection":
        return this.getConnection(args.action, payload);
      case "create_connection":
        return this.createConnection(args.action, payload);
      case "update_connection":
        return this.updateConnection(args, payload);
      case "delete_connection":
        return this.deleteConnection(args, payload);
      case "list_channel_bindings":
        return this.listChannelBindings(args.action, payload);
      case "create_channel_binding":
        return this.createChannelBinding(args.action, payload);
      case "update_channel_binding":
        return this.updateChannelBinding(args.action, payload);
      case "delete_channel_binding":
        return this.deleteChannelBinding(args, payload);
      case "list_outbound_deliveries":
        return this.listOutboundDeliveries(args.action, payload);
      default:
        throw new Error(`Unknown chat provider action: ${args.action}`);
    }
  }

  private cleanupSecretApprovals(now = Date.now()): void {
    for (const [fingerprint, createdAt] of this.pendingSecretApprovals.entries()) {
      if (now - createdAt > SECRET_APPROVAL_TTL_MS) {
        this.pendingSecretApprovals.delete(fingerprint);
      }
    }
  }

  private requireSecretReplacementApproval(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope | null {
    const secrets = parseOptionalNullableObject<ChatProviderSecretConfig>(payload, "secrets");
    if (!hasNonEmptySecretPayload(secrets)) {
      return null;
    }

    const now = Date.now();
    this.cleanupSecretApprovals(now);
    const fingerprint = buildMcpApprovalFingerprint({
      domain: CHAT_PROVIDER_DOMAIN,
      action: args.action,
      payload: redactSecretPayload(payload),
    });
    const pendingCreatedAt = this.pendingSecretApprovals.get(fingerprint);
    if (args.approval?.confirmed === true && pendingCreatedAt !== undefined && now - pendingCreatedAt <= SECRET_APPROVAL_TTL_MS) {
      this.pendingSecretApprovals.delete(fingerprint);
      return null;
    }

    this.pendingSecretApprovals.set(fingerprint, now);
    return {
      approvalRequired: true,
      approvalMessage: SECRET_APPROVAL_MESSAGE,
    };
  }

  private listProviderDefinitions(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const providerKind = parseOptionalProviderKind(payload);
    const baseUrl = normalizeBaseUrl(payload);
    const definitions = this.chatProviderRepository.getSetupSchemas()
      .filter((schema) => !providerKind || schema.kind === providerKind)
      .map((schema) => ({
        ...schema,
        setupGuidance: {
          providerKind: schema.kind,
          defaultBridgeMode: schema.defaultBridgeMode,
          supportedBridgeModes: schema.bridgeModes.map((bridge) => bridge.mode),
          ingressUrlTemplate: `${baseUrl}/api/chat-providers/{providerConnectionId}/channels/{externalChannelId}/ingress`,
        },
      }));
    return success(action, { providerDefinitions: definitions });
  }

  private listConnections(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const baseUrl = normalizeBaseUrl(payload);
    const connections = this.chatProviderRepository.listConnections({
      providerKind: parseOptionalProviderKind(payload),
      enabledOnly: parseOptionalBoolean(payload, "enabledOnly"),
    }).map((connection) => withConnectionIngress(connection, baseUrl));
    return success(action, { connections });
  }

  private getConnection(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const connectionId = parseConnectionId(payload);
    const connection = this.chatProviderRepository.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Chat provider connection not found: ${connectionId}`);
    }
    return success(action, { connection: withConnectionIngress(connection, normalizeBaseUrl(payload)) });
  }

  private createConnection(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const setup = parseOptionalObject<ChatProviderSetupConfig>(payload, "setup");
    const secrets = parseOptionalNullableObject<ChatProviderSecretConfig>(payload, "secrets");
    const connection = this.chatProviderRepository.createConnection({
      providerKind: parseRequiredProviderKind(payload),
      displayName: parseRequiredString(payload, "displayName"),
      bridgeMode: parseOptionalEnumStrict(payload, "bridgeMode", BRIDGE_MODES),
      status: parseOptionalEnumStrict(payload, "status", CONNECTION_STATUSES),
      enabled: parseOptionalBoolean(payload, "enabled"),
      ...(setup !== undefined ? { setup } : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    });
    return success(action, { connection: withConnectionIngress(connection, normalizeBaseUrl(payload)) });
  }

  private updateConnection(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const approval = this.requireSecretReplacementApproval(args, payload);
    if (approval) {
      return approval;
    }

    const setup = parseOptionalObject<ChatProviderSetupConfig>(payload, "setup");
    const secrets = parseOptionalNullableObject<ChatProviderSecretConfig>(payload, "secrets");
    const connection = this.chatProviderRepository.updateConnection(parseConnectionId(payload), {
      displayName: parseOptionalString(payload, "displayName"),
      bridgeMode: parseOptionalEnumStrict(payload, "bridgeMode", BRIDGE_MODES),
      status: parseOptionalEnumStrict(payload, "status", CONNECTION_STATUSES),
      enabled: parseOptionalBoolean(payload, "enabled"),
      ...(setup !== undefined ? { setup } : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    });
    return success(args.action, { connection: withConnectionIngress(connection, normalizeBaseUrl(payload)) });
  }

  private deleteConnection(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const connectionId = parseConnectionId(payload);
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Deleting chat provider connection ${connectionId} also removes its channel bindings and delivery records. Confirm before retrying with approval.confirmed set to true.`,
      };
    }
    return success(args.action, {
      providerConnectionId: connectionId,
      deleted: this.chatProviderRepository.deleteConnection(connectionId),
    });
  }

  private listChannelBindings(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const projectIds = parseOptionalStringArray(payload, "projectIds");
    const baseUrl = normalizeBaseUrl(payload);
    const bindings = this.chatProviderRepository.listChannelBindings({
      providerConnectionId: parseOptionalString(payload, "providerConnectionId") ?? parseOptionalString(payload, "connectionId"),
      projectId: parseOptionalString(payload, "projectId"),
      externalChannelId: parseOptionalString(payload, "externalChannelId"),
      enabledOnly: parseOptionalBoolean(payload, "enabledOnly"),
    }).filter((binding) => !projectIds || projectIds.includes(binding.projectId))
      .map((binding) => withBindingIngress(binding, baseUrl));
    return success(action, { channelBindings: bindings });
  }

  private createChannelBinding(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const externalChannelMetadata = parseOptionalNullableObject<ExternalChannelMetadata>(payload, "externalChannelMetadata");
    const routingHints = parseOptionalNullableObject<ChatProviderRoutingHints>(payload, "routingHints");
    const binding = this.chatProviderRepository.createChannelBinding({
      providerConnectionId: parseConnectionId(payload),
      externalChannelId: parseRequiredString(payload, "externalChannelId"),
      externalChannelName: parseRequiredString(payload, "externalChannelName"),
      projectId: parseRequiredString(payload, "projectId"),
      agentPresetId: parseOptionalNullableString(payload, "agentPresetId"),
      enabled: parseOptionalBoolean(payload, "enabled"),
      inboundEnabled: parseOptionalBoolean(payload, "inboundEnabled"),
      outboundEnabled: parseOptionalBoolean(payload, "outboundEnabled"),
      suppressRichWidgets: parseOptionalBoolean(payload, "suppressRichWidgets"),
      ...(externalChannelMetadata !== undefined ? { externalChannelMetadata } : {}),
      ...(routingHints !== undefined ? { routingHints } : {}),
    });
    return success(action, { channelBinding: withBindingIngress(binding, normalizeBaseUrl(payload)) });
  }

  private updateChannelBinding(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const externalChannelMetadata = parseOptionalNullableObject<ExternalChannelMetadata>(payload, "externalChannelMetadata");
    const routingHints = parseOptionalNullableObject<ChatProviderRoutingHints>(payload, "routingHints");
    const binding = this.chatProviderRepository.updateChannelBinding(parseChannelBindingId(payload), {
      externalChannelName: parseOptionalString(payload, "externalChannelName"),
      projectId: parseOptionalString(payload, "projectId"),
      agentPresetId: parseOptionalNullableString(payload, "agentPresetId"),
      enabled: parseOptionalBoolean(payload, "enabled"),
      inboundEnabled: parseOptionalBoolean(payload, "inboundEnabled"),
      outboundEnabled: parseOptionalBoolean(payload, "outboundEnabled"),
      suppressRichWidgets: parseOptionalBoolean(payload, "suppressRichWidgets"),
      ...(externalChannelMetadata !== undefined ? { externalChannelMetadata } : {}),
      ...(routingHints !== undefined ? { routingHints } : {}),
    });
    return success(action, { channelBinding: withBindingIngress(binding, normalizeBaseUrl(payload)) });
  }

  private deleteChannelBinding(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const channelBindingId = parseChannelBindingId(payload);
    if (args.approval?.confirmed !== true) {
      return {
        approvalRequired: true,
        approvalMessage: `Deleting chat provider channel binding ${channelBindingId} stops routing for that external channel/project pair. Confirm before retrying with approval.confirmed set to true.`,
      };
    }
    return success(args.action, {
      channelBindingId,
      deleted: this.chatProviderRepository.deleteChannelBinding(channelBindingId),
    });
  }

  private listOutboundDeliveries(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const providerConnectionId = parseOptionalString(payload, "providerConnectionId") ?? parseOptionalString(payload, "connectionId");
    const channelBindingId = parseOptionalString(payload, "channelBindingId") ?? parseOptionalString(payload, "bindingId");
    const externalChannelId = parseOptionalString(payload, "externalChannelId");
    const deliveryStatus = parseOptionalEnumStrict(payload, "deliveryStatus", DELIVERY_STATUSES);
    const limit = parseOptionalIntegerStrict(payload, "limit", { min: 1, max: 500 }) ?? 100;
    const deliveries = this.chatProviderRepository.listOutboundDeliveries({
      ...(providerConnectionId ? { providerConnectionId } : {}),
      ...(channelBindingId ? { channelBindingId } : {}),
      ...(externalChannelId ? { externalChannelId } : {}),
      ...(deliveryStatus ? { status: deliveryStatus } : {}),
      limit,
    });
    return success(action, { deliveries });
  }
}
