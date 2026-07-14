import { createHash } from "node:crypto";
import type {
  ChatProviderBridgeMode,
  ChatProviderChannelBindingRecord,
  ChatProviderConnectionRecord,
  ChatProviderConnectionStatus,
  ChatProviderDeliveryStatus,
  ChatProviderDeliveryDirection,
  ChatProviderMessageDeliveryRecord,
  ChatProviderKind,
  ChatProviderRoutingHints,
  ChatProviderSecretConfig,
  ChatProviderSetupConfig,
  ExternalChannelMetadata,
} from "../../contracts/chat-provider-types.js";
import type { ManageCodeUxArgs, ManagementResponseEnvelope } from "../../contracts/internal-management-types.js";
import type { ChatProviderRepository } from "../../repositories/chat-provider-repository.js";
import type { ChatProviderSecretService } from "../../services/chat-provider-secret-service.js";
import type { ChatProviderVerificationService } from "../../services/chat-provider-verification-service.js";
import type { ChatProviderOutboundService } from "../../services/chat-provider-outbound-service.js";
import { CHAT_CONNECTOR_REGISTRY, type ChatConnectorRegistry } from "../../domain/chat-connectors/registry.js";
import { redactText } from "../../shared/security/redaction.js";
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
  "Chat provider credential or transport replacement queued and waiting for human confirmation.",
  "Ask the user to confirm this exact secret, executable, or provider-endpoint change before calling the tool again.",
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
const DELIVERY_DIRECTIONS: readonly ChatProviderDeliveryDirection[] = ["inbound", "outbound"];

export interface ChatProviderActionsOptions {
  chatProviderVerificationService?: ChatProviderVerificationService;
  chatProviderOutboundService?: ChatProviderOutboundService;
  connectorRegistry?: ChatConnectorRegistry;
  authorizeProject?: (projectId: string) => boolean;
  allowCredentialMutation?: () => boolean;
}

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
  if (isPlainObject(payload.setup)) {
    redacted.setup = {
      configuredKeys: Object.keys(payload.setup).sort(),
      payloadHash: createHash("sha256").update(stableStringify(payload.setup)).digest("hex"),
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
  const connectionIngressUrl = `${baseUrl}/api/chat-providers/ingress/${encodedConnectionId}`;
  const channelIngressUrlTemplate = `${baseUrl}/api/chat-providers/ingress/${encodedConnectionId}`;
  return {
    connectionIngressUrl,
    channelIngressUrlTemplate,
    ...(externalChannelId ? { channelIngressUrl: connectionIngressUrl } : {}),
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
  private readonly registry: ChatConnectorRegistry;

  constructor(
    private readonly chatProviderRepository: ChatProviderRepository,
    private readonly chatProviderSecretService?: ChatProviderSecretService,
    private readonly options: ChatProviderActionsOptions = {},
  ) {
    this.registry = options.connectorRegistry ?? CHAT_CONNECTOR_REGISTRY;
  }

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
      case "verify_connection":
        return this.verifyConnection(args.action, payload);
      case "get_health":
        return this.getHealth(args.action);
      case "list_deliveries":
        return this.listDeliveries(args.action, payload);
      case "list_outbound_deliveries":
        return this.listOutboundDeliveries(args.action, payload);
      case "retry_delivery":
        return this.retryDelivery(args, payload);
      case "cancel_delivery":
        return this.cancelDelivery(args.action, payload);
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

  private requireOneUseApproval(
    args: ManageCodeUxArgs,
    payload: Record<string, unknown>,
    message: string,
  ): ManagementResponseEnvelope | null {
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
    return { approvalRequired: true, approvalMessage: message };
  }

  private requireCredentialMutationAccess(): void {
    if (this.options.allowCredentialMutation?.() === false) {
      throw new Error("Chat provider credential administration is disabled for this MCP client.");
    }
  }

  private authorizeProject(projectId: string): void {
    if (this.options.authorizeProject?.(projectId) === false) {
      throw new Error("The authenticated MCP principal is not authorized for this project.");
    }
  }

  private isProjectAuthorized(projectId: string): boolean {
    return this.options.authorizeProject?.(projectId) !== false;
  }

  private authorizeDelivery(delivery: ChatProviderMessageDeliveryRecord): void {
    const binding = delivery.channelBindingId
      ? this.chatProviderRepository.getChannelBinding(delivery.channelBindingId)
      : null;
    if (!binding) {
      if (this.options.authorizeProject) throw new Error("Delivery project ownership could not be resolved.");
      return;
    }
    this.authorizeProject(binding.projectId);
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
          ingressUrlTemplate: `${baseUrl}/api/chat-providers/ingress/{providerConnectionId}`,
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

  private async createConnection(action: string, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const setup = parseOptionalObject<ChatProviderSetupConfig>(payload, "setup");
    const secrets = parseOptionalNullableObject<ChatProviderSecretConfig>(payload, "secrets");
    const status = parseOptionalEnumStrict(payload, "status", CONNECTION_STATUSES);
    const providerKind = parseRequiredProviderKind(payload);
    const bridgeMode = parseOptionalEnumStrict(payload, "bridgeMode", BRIDGE_MODES)
      ?? this.registry.get(providerKind).setupSchema.defaultBridgeMode;
    if (secrets !== undefined || setupContainsSensitiveTransport(providerKind, bridgeMode, setup, this.registry)) {
      this.requireCredentialMutationAccess();
    }
    let configurationVerified = false;
    if (status === "active") {
      const profile = this.registry.getForMode(providerKind, bridgeMode);
      const verification = profile.verification.verifyConfiguration(bridgeMode, setup ?? {}, secrets ?? null);
      if (!verification.valid) throw new Error(verification.issues.join(" "));
      if (profile.liveTest.available && profile.liveTest.modes.includes(bridgeMode)) {
        throw new Error("Run verify_connection before activating a connection that requires live verification.");
      }
      configurationVerified = true;
    }
    const input = {
      providerKind,
      displayName: parseRequiredString(payload, "displayName"),
      bridgeMode,
      status,
      enabled: parseOptionalBoolean(payload, "enabled"),
      ...(setup !== undefined ? { setup } : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    };
    const connection = this.chatProviderSecretService
      ? await this.chatProviderSecretService.createConnection(input)
      : this.chatProviderRepository.createConnection(input);
    const verifiedConnection = configurationVerified
      ? this.chatProviderRepository.updateVerification(connection.id, "verified", {
        capabilities: [...this.registry.get(providerKind).verification.capabilities],
        providerErrorCode: null,
        retryable: false,
        issues: [],
      })
      : connection;
    return success(action, { connection: withConnectionIngress(verifiedConnection, normalizeBaseUrl(payload)) });
  }

  private async updateConnection(args: ManageCodeUxArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    const connectionId = parseConnectionId(payload);
    const existing = this.chatProviderRepository.getConnection(connectionId);
    if (!existing) throw new Error(`Chat provider connection not found: ${connectionId}`);
    const setup = parseOptionalObject<ChatProviderSetupConfig>(payload, "setup");
    const secrets = parseOptionalNullableObject<ChatProviderSecretConfig>(payload, "secrets");
    const transportChanged = payload.bridgeMode !== undefined || setup !== undefined || secrets !== undefined;
    const requestedBridgeMode = parseOptionalEnumStrict(payload, "bridgeMode", BRIDGE_MODES);
    const sensitiveTransportChanged = secrets !== undefined
      || setupContainsSensitiveTransport(existing.providerKind, requestedBridgeMode ?? existing.bridgeMode, setup, this.registry)
      || (requestedBridgeMode !== undefined && (
        bridgeUsesSensitiveTransport(existing.providerKind, existing.bridgeMode, this.registry)
        || bridgeUsesSensitiveTransport(existing.providerKind, requestedBridgeMode, this.registry)
      ));
    if (sensitiveTransportChanged) this.requireCredentialMutationAccess();
    const approval = hasNonEmptySecretPayload(secrets) || sensitiveTransportChanged
      ? this.requireOneUseApproval(args, payload, SECRET_APPROVAL_MESSAGE)
      : this.requireSecretReplacementApproval(args, payload);
    if (approval) {
      return approval;
    }
    const requestedStatus = parseOptionalEnumStrict(payload, "status", CONNECTION_STATUSES);
    if (requestedStatus === "active") {
      await this.options.chatProviderVerificationService?.validateActivation(connectionId);
      if (!this.options.chatProviderVerificationService || transportChanged) {
        throw new Error("Verify the chat provider connection before activating it.");
      }
    }
    const input = {
      displayName: parseOptionalString(payload, "displayName"),
      bridgeMode: requestedBridgeMode,
      status: requestedStatus ?? (transportChanged && existing.status === "active" ? "draft" : undefined),
      enabled: parseOptionalBoolean(payload, "enabled"),
      ...(setup !== undefined ? { setup } : {}),
      ...(secrets !== undefined ? { secrets } : {}),
    };
    const connection = this.chatProviderSecretService
      ? await this.chatProviderSecretService.updateConnection(connectionId, input)
      : this.chatProviderRepository.updateConnection(connectionId, input);
    return success(args.action, { connection: withConnectionIngress(connection, normalizeBaseUrl(payload)) });
  }

  private deleteConnection(args: ManageCodeUxArgs, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const connectionId = parseConnectionId(payload);
    for (const binding of this.chatProviderRepository.listChannelBindings({ providerConnectionId: connectionId })) {
      this.authorizeProject(binding.projectId);
    }
    const approval = this.requireOneUseApproval(
      args,
      payload,
      `Deleting chat provider connection ${connectionId} also removes its channel bindings and delivery records. Confirm before retrying with approval.confirmed set to true.`,
    );
    if (approval) return approval;
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
    }).filter((binding) => this.isProjectAuthorized(binding.projectId))
      .filter((binding) => !projectIds || projectIds.includes(binding.projectId))
      .map((binding) => withBindingIngress(binding, baseUrl));
    return success(action, { channelBindings: bindings });
  }

  private createChannelBinding(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const externalChannelMetadata = parseOptionalNullableObject<ExternalChannelMetadata>(payload, "externalChannelMetadata");
    const routingHints = parseOptionalNullableObject<ChatProviderRoutingHints>(payload, "routingHints");
    const projectId = parseRequiredString(payload, "projectId");
    this.authorizeProject(projectId);
    const binding = this.chatProviderRepository.createChannelBinding({
      providerConnectionId: parseConnectionId(payload),
      externalChannelId: parseRequiredString(payload, "externalChannelId"),
      externalChannelName: parseRequiredString(payload, "externalChannelName"),
      projectId,
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
    const bindingId = parseChannelBindingId(payload);
    const existing = this.chatProviderRepository.getChannelBinding(bindingId);
    if (!existing) throw new Error(`Chat provider channel binding not found: ${bindingId}`);
    this.authorizeProject(existing.projectId);
    const projectId = parseOptionalString(payload, "projectId");
    if (projectId) this.authorizeProject(projectId);
    const binding = this.chatProviderRepository.updateChannelBinding(bindingId, {
      externalChannelName: parseOptionalString(payload, "externalChannelName"),
      projectId,
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
    const existing = this.chatProviderRepository.getChannelBinding(channelBindingId);
    if (!existing) throw new Error(`Chat provider channel binding not found: ${channelBindingId}`);
    this.authorizeProject(existing.projectId);
    const approval = this.requireOneUseApproval(
      args,
      payload,
      `Deleting chat provider channel binding ${channelBindingId} stops routing for that external channel/project pair. Confirm before retrying with approval.confirmed set to true.`,
    );
    if (approval) return approval;
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
    const authorized = deliveries.filter((delivery) => {
      try {
        this.authorizeDelivery(delivery);
        return true;
      } catch {
        return false;
      }
    });
    return success(action, { deliveries: authorized.map(sanitizeDelivery) });
  }

  private async verifyConnection(action: string, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    this.requireCredentialMutationAccess();
    if (!this.options.chatProviderVerificationService) throw new Error("Chat provider verification is unavailable.");
    const verification = await this.options.chatProviderVerificationService.verifyConnection(parseConnectionId(payload));
    return success(action, { verification });
  }

  private getHealth(action: string): ManagementResponseEnvelope {
    if (!this.options.chatProviderVerificationService) throw new Error("Chat provider health diagnostics are unavailable.");
    return success(action, { health: this.options.chatProviderVerificationService.getHealth() });
  }

  private listDeliveries(action: string, payload: Record<string, unknown>): ManagementResponseEnvelope {
    const providerConnectionId = parseOptionalString(payload, "providerConnectionId") ?? parseOptionalString(payload, "connectionId");
    const channelBindingId = parseOptionalString(payload, "channelBindingId") ?? parseOptionalString(payload, "bindingId");
    const externalChannelId = parseOptionalString(payload, "externalChannelId");
    const status = parseOptionalEnumStrict(payload, "deliveryStatus", DELIVERY_STATUSES);
    const direction = parseOptionalEnumStrict(payload, "direction", DELIVERY_DIRECTIONS);
    const limit = parseOptionalIntegerStrict(payload, "limit", { min: 1, max: 500 }) ?? 100;
    const deliveries = this.chatProviderRepository.listDeliveries({
      ...(providerConnectionId ? { providerConnectionId } : {}),
      ...(channelBindingId ? { channelBindingId } : {}),
      ...(externalChannelId ? { externalChannelId } : {}),
      ...(status ? { status } : {}),
      ...(direction ? { direction } : {}),
      limit,
    }).filter((delivery) => {
      try {
        this.authorizeDelivery(delivery);
        return true;
      } catch {
        return false;
      }
    });
    return success(action, { deliveries: deliveries.map(sanitizeDelivery) });
  }

  private async retryDelivery(args: ManageCodeUxArgs, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    if (!this.options.chatProviderOutboundService) throw new Error("Chat provider delivery control is unavailable.");
    const deliveryId = parseRequiredString(payload, "deliveryId");
    const delivery = this.chatProviderRepository.getDelivery(deliveryId);
    if (!delivery) throw new Error(`Chat provider delivery not found: ${deliveryId}`);
    this.authorizeDelivery(delivery);
    const approval = this.requireOneUseApproval(
      args,
      payload,
      `Retrying chat provider delivery ${deliveryId} can send a provider message again. Confirm this exact delivery retry before calling with approval.confirmed true.`,
    );
    if (approval) return approval;
    return success(args.action, { delivery: sanitizeDelivery(await this.options.chatProviderOutboundService.retryDelivery(deliveryId)) });
  }

  private async cancelDelivery(action: string, payload: Record<string, unknown>): Promise<ManagementResponseEnvelope> {
    if (!this.options.chatProviderOutboundService) throw new Error("Chat provider delivery control is unavailable.");
    const deliveryId = parseRequiredString(payload, "deliveryId");
    const delivery = this.chatProviderRepository.getDelivery(deliveryId);
    if (!delivery) throw new Error(`Chat provider delivery not found: ${deliveryId}`);
    this.authorizeDelivery(delivery);
    return success(action, { delivery: sanitizeDelivery(await this.options.chatProviderOutboundService.cancelDelivery(deliveryId)) });
  }
}

function setupContainsSensitiveTransport(
  providerKind: ChatProviderKind,
  bridgeMode: ChatProviderBridgeMode | undefined,
  setup: ChatProviderSetupConfig | undefined,
  registry: ChatConnectorRegistry,
): boolean {
  if (!setup) return false;
  const profile = registry.get(providerKind);
  const resolvedMode = bridgeMode ?? profile.setupSchema.defaultBridgeMode;
  const schema = profile.setupSchema.bridgeModes.find((candidate) => candidate.mode === resolvedMode);
  return schema?.setupFields.some((field) => (field.type === "command" || field.type === "url") && field.key in setup) === true;
}

function bridgeUsesSensitiveTransport(
  providerKind: ChatProviderKind,
  bridgeMode: ChatProviderBridgeMode,
  registry: ChatConnectorRegistry,
): boolean {
  const schema = registry.get(providerKind).setupSchema.bridgeModes.find((candidate) => candidate.mode === bridgeMode);
  return schema?.setupFields.some((field) => field.type === "command" || field.type === "url") === true;
}

function sanitizeDelivery(delivery: ChatProviderMessageDeliveryRecord): Record<string, unknown> {
  const { payload: _payload, leaseOwner: _leaseOwner, leaseExpiresAt: _leaseExpiresAt, ...safe } = delivery;
  return {
    ...safe,
    lastError: safe.lastError
      ? redactText(safe.lastError).replace(/https?:\/\/[^\s)\]}]+/gi, "[REDACTED_URL]").slice(0, 500)
      : null,
  };
}
