import type { Express, Request, Response } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import {
  parseChatProviderKind,
  parseChatProviderDeliveryDirection,
  parseChatProviderDeliveryStatus,
  parseConfirmedApproval,
  parseCreateChatProviderChannelBindingInput,
  parseCreateChatProviderConnectionInput,
  parseOptionalBoolean,
  parseOptionalInteger,
  parseUpdateChatProviderChannelBindingInput,
  parseUpdateChatProviderConnectionInput,
  requireTrimmedString,
} from "./request-parsers.js";
import { HttpRouteError } from "./http-errors.js";
import type {
  ChatProviderBridgeMode,
  ChatProviderBridgeSetupSchema,
  ChatProviderConnectionRecord,
  ChatProviderMessageDeliveryRecord,
  ChatProviderKind,
  ChatProviderSetupSchema,
} from "../contracts/chat-provider-types.js";
import { getChatProviderSetupSchema } from "../contracts/chat-provider-types.js";
import { CHAT_CONNECTOR_REGISTRY } from "../domain/chat-connectors/registry.js";
import { supportsLiveConnectorVerification } from "../domain/chat-connectors/types.js";
import { redactText } from "../shared/security/redaction.js";

interface ChatProviderSetupHints {
  bridgeModeLabel: string;
  integration: string;
  requiredSetupFields: string[];
  requiredSecretFields: string[];
}

interface DashboardChatProviderConnectionRecord extends ChatProviderConnectionRecord {
  ingressUrl: string;
  setupHints: ChatProviderSetupHints;
}

export function registerChatProviderRoutes(router: Express, deps: DashboardDependencies): void {
  if (!deps.chatProviderRepository) {
    return;
  }
  const repository = deps.chatProviderRepository;

  router.get("/api/chat-providers/setup-definitions", syncRoute((req, res) => {
    res.json({
      providers: repository.getSetupSchemas().map((schema) => decorateSetupDefinition(req, schema)),
    });
  }));

  router.get("/api/chat-providers/connections", syncRoute((req, res) => {
    const providerKind = parseChatProviderKind(req.query.providerKind, "providerKind");
    const enabledOnly = parseOptionalBoolean(req.query.enabledOnly, "enabledOnly");
    res.json({
      connections: repository.listConnections({ providerKind, enabledOnly })
        .map((connection) => decorateConnection(req, connection)),
    });
  }));

  router.get("/api/chat-providers/connections/:connectionId", syncRoute((req, res) => {
    const connection = requireConnection(repository.getConnection(requireTrimmedString(req.params.connectionId, "connectionId")));
    res.json(decorateConnection(req, connection));
  }));

  router.post("/api/chat-providers/connections", asyncRoute(async (req, res) => {
    const input = parseCreateChatProviderConnectionInput(req.body);
    const registry = deps.chatConnectorRegistry ?? CHAT_CONNECTOR_REGISTRY;
    const mode = input.bridgeMode ?? registry.get(input.providerKind).setupSchema.defaultBridgeMode;
    let configurationVerified = false;
    if (input.status === "active") {
      const profile = registry.getForMode(input.providerKind, mode);
      const verification = profile.verification.verifyConfiguration(mode, input.setup ?? {}, input.secrets ?? null);
      if (!verification.valid) throw new HttpRouteError(400, verification.issues.join(" "));
      if (supportsLiveConnectorVerification(profile, mode)) {
        throw new HttpRouteError(409, "Run connection verification before activating this provider mode.");
      }
      configurationVerified = true;
    }
    const created = deps.chatProviderSecretService
      ? await deps.chatProviderSecretService.createConnection(input)
      : repository.createConnection(input);
    const verified = configurationVerified
      ? repository.updateVerification(created.id, "verified", {
        capabilities: [...registry.get(input.providerKind).verification.capabilities],
        providerErrorCode: null,
        retryable: false,
        issues: [],
      })
      : created;
    res.status(201).json(decorateConnection(req, verified));
  }));

  router.patch("/api/chat-providers/connections/:connectionId", asyncRoute(async (req, res) => {
    const connectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    const existing = requireConnection(repository.getConnection(connectionId));
    let input = parseUpdateChatProviderConnectionInput(req.body, existing);
    const transportChanged = input.bridgeMode !== undefined || input.setup !== undefined || input.secrets !== undefined;
    if (input.status === "active") {
      if (deps.chatProviderVerificationService) {
        try {
          await deps.chatProviderVerificationService.validateActivation(connectionId);
        } catch (error) {
          throw new HttpRouteError(
            409,
            error instanceof Error ? error.message : "Chat provider connection cannot be activated.",
          );
        }
      } else if (existing.verificationStatus !== "verified") {
        throw new HttpRouteError(409, "Chat provider connection must be verified before it can be activated.");
      }
      if (transportChanged) {
        throw new HttpRouteError(409, "Verify connection changes before activating the connection.");
      }
    } else if (transportChanged && existing.status === "active") {
      input = { ...input, status: "draft" };
    }
    const updated = deps.chatProviderSecretService
      ? await deps.chatProviderSecretService.updateConnection(connectionId, input)
      : repository.updateConnection(connectionId, input);
    res.json(decorateConnection(req, updated));
  }));

  router.delete("/api/chat-providers/connections/:connectionId", syncRoute((req, res) => {
    const connectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    for (const binding of repository.listChannelBindings({ providerConnectionId: connectionId })) {
      requireProjectAuthorization(res, binding.projectId);
    }
    const deleted = repository.deleteConnection(connectionId);
    if (!deleted) {
      throw new HttpRouteError(404, "Chat provider connection not found.");
    }
    res.json({ ok: true });
  }));

  router.get("/api/chat-providers/channel-bindings", syncRoute((req, res) => {
    const providerConnectionId = typeof req.query.providerConnectionId === "string"
      ? req.query.providerConnectionId.trim()
      : undefined;
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId.trim() : undefined;
    const externalChannelId = typeof req.query.externalChannelId === "string"
      ? req.query.externalChannelId.trim()
      : undefined;
    const enabledOnly = parseOptionalBoolean(req.query.enabledOnly, "enabledOnly");
    const bindings = repository.listChannelBindings({
        providerConnectionId: providerConnectionId || undefined,
        projectId: projectId || undefined,
        externalChannelId: externalChannelId || undefined,
        enabledOnly,
      }).filter((binding) => isProjectAuthorized(res, binding.projectId));
    res.json({ bindings });
  }));

  router.get("/api/chat-providers/connections/:connectionId/channel-bindings", syncRoute((req, res) => {
    const providerConnectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    requireConnection(repository.getConnection(providerConnectionId));
    res.json({
      bindings: repository.listChannelBindings({ providerConnectionId })
        .filter((binding) => isProjectAuthorized(res, binding.projectId)),
    });
  }));

  router.post("/api/chat-providers/channel-bindings", syncRoute((req, res) => {
    const input = parseCreateChatProviderChannelBindingInput(req.body);
    requireProjectAuthorization(res, input.projectId);
    const created = repository.createChannelBinding(input);
    res.status(201).json(created);
  }));

  router.patch("/api/chat-providers/channel-bindings/:bindingId", syncRoute((req, res) => {
    const bindingId = requireTrimmedString(req.params.bindingId, "bindingId");
    const existing = requireBinding(repository.getChannelBinding(bindingId));
    requireProjectAuthorization(res, existing.projectId);
    const input = parseUpdateChatProviderChannelBindingInput(req.body);
    if (input.projectId) requireProjectAuthorization(res, input.projectId);
    res.json(repository.updateChannelBinding(bindingId, input));
  }));

  router.delete("/api/chat-providers/channel-bindings/:bindingId", syncRoute((req, res) => {
    const bindingId = requireTrimmedString(req.params.bindingId, "bindingId");
    const existing = requireBinding(repository.getChannelBinding(bindingId));
    requireProjectAuthorization(res, existing.projectId);
    const deleted = repository.deleteChannelBinding(bindingId);
    if (!deleted) {
      throw new HttpRouteError(404, "Chat provider channel binding not found.");
    }
    res.json({ ok: true });
  }));

  router.get("/api/chat-providers/connections/:connectionId/delivery-status", syncRoute((req, res) => {
    const providerConnectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    requireConnection(repository.getConnection(providerConnectionId));
    res.json({
      deliveries: sanitizeDeliveries(filterAuthorizedDeliveries(res, repository, repository.listDeliveries({
        providerConnectionId,
        direction: "outbound",
        limit: parseDeliveryLimit(req.query.limit),
      }))),
    });
  }));

  router.get("/api/chat-providers/channel-bindings/:bindingId/delivery-status", syncRoute((req, res) => {
    const channelBindingId = requireTrimmedString(req.params.bindingId, "bindingId");
    const binding = requireBinding(repository.getChannelBinding(channelBindingId));
    requireProjectAuthorization(res, binding.projectId);
    res.json({
      deliveries: sanitizeDeliveries(repository.listDeliveries({
        channelBindingId,
        direction: "outbound",
        limit: parseDeliveryLimit(req.query.limit),
      })),
    });
  }));

  router.post("/api/chat-providers/connections/:connectionId/verify", asyncRoute(async (req, res) => {
    if (!deps.chatProviderVerificationService) throw new HttpRouteError(503, "Chat provider verification is unavailable.");
    const connectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    requireConnection(repository.getConnection(connectionId));
    res.json(await deps.chatProviderVerificationService.verifyConnection(connectionId));
  }));

  const healthHandler = syncRoute((_req, res) => {
    if (!deps.chatProviderVerificationService) throw new HttpRouteError(503, "Chat provider diagnostics are unavailable.");
    res.json(deps.chatProviderVerificationService.getHealth());
  });
  router.get("/api/chat-providers/health", healthHandler);
  router.get("/api/chat-providers/diagnostics", healthHandler);

  router.get("/api/chat-providers/deliveries", syncRoute((req, res) => {
    const deliveries = repository.listDeliveries({
      providerConnectionId: optionalQueryString(req.query.providerConnectionId),
      channelBindingId: optionalQueryString(req.query.channelBindingId),
      externalChannelId: optionalQueryString(req.query.externalChannelId),
      direction: parseChatProviderDeliveryDirection(req.query.direction),
      status: parseChatProviderDeliveryStatus(req.query.status ?? req.query.deliveryStatus),
      limit: parseDeliveryLimit(req.query.limit),
    });
    res.json({ deliveries: sanitizeDeliveries(filterAuthorizedDeliveries(res, repository, deliveries)) });
  }));

  router.get("/api/chat-providers/deliveries/:deliveryId", syncRoute((req, res) => {
    const delivery = requireDelivery(repository.getDelivery(requireTrimmedString(req.params.deliveryId, "deliveryId")));
    requireDeliveryAuthorization(res, repository, delivery);
    res.json(sanitizeDelivery(delivery));
  }));

  router.post("/api/chat-providers/deliveries/:deliveryId/retry", asyncRoute(async (req, res) => {
    if (!deps.chatProviderOutboundService) throw new HttpRouteError(503, "Chat provider delivery control is unavailable.");
    parseConfirmedApproval(req.body);
    const deliveryId = requireTrimmedString(req.params.deliveryId, "deliveryId");
    const delivery = requireDelivery(repository.getDelivery(deliveryId));
    requireDeliveryAuthorization(res, repository, delivery);
    res.json(sanitizeDelivery(await deps.chatProviderOutboundService.retryDelivery(deliveryId)));
  }));

  router.post("/api/chat-providers/deliveries/:deliveryId/cancel", asyncRoute(async (req, res) => {
    if (!deps.chatProviderOutboundService) throw new HttpRouteError(503, "Chat provider delivery control is unavailable.");
    const deliveryId = requireTrimmedString(req.params.deliveryId, "deliveryId");
    const delivery = requireDelivery(repository.getDelivery(deliveryId));
    requireDeliveryAuthorization(res, repository, delivery);
    res.json(sanitizeDelivery(await deps.chatProviderOutboundService.cancelDelivery(deliveryId)));
  }));
}

function requireConnection(connection: ChatProviderConnectionRecord | null): ChatProviderConnectionRecord {
  if (!connection) {
    throw new HttpRouteError(404, "Chat provider connection not found.");
  }
  return connection;
}

function requireBinding<T>(binding: T | null): T {
  if (!binding) {
    throw new HttpRouteError(404, "Chat provider channel binding not found.");
  }
  return binding;
}

function requireDelivery(delivery: ChatProviderMessageDeliveryRecord | null): ChatProviderMessageDeliveryRecord {
  if (!delivery) throw new HttpRouteError(404, "Chat provider delivery not found.");
  return delivery;
}

function optionalQueryString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function principalProjectIds(res: Response): string[] | null {
  const value = res.locals.codeUxPrincipal?.projectIds;
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string") ? value : null;
}

function isProjectAuthorized(res: Response, projectId: string): boolean {
  const projectIds = principalProjectIds(res);
  return projectIds === null || projectIds.includes("*") || projectIds.includes(projectId);
}

function requireProjectAuthorization(res: Response, projectId: string): void {
  if (!isProjectAuthorized(res, projectId)) {
    throw new HttpRouteError(403, "The authenticated principal is not authorized for this project.");
  }
}

function requireDeliveryAuthorization(
  res: Response,
  repository: DashboardDependencies["chatProviderRepository"],
  delivery: ChatProviderMessageDeliveryRecord,
): void {
  const projectIds = principalProjectIds(res);
  if (projectIds === null || projectIds.includes("*")) return;
  const binding = delivery.channelBindingId ? repository?.getChannelBinding(delivery.channelBindingId) : null;
  if (!binding || !projectIds.includes(binding.projectId)) {
    throw new HttpRouteError(403, "The authenticated principal is not authorized for this delivery project.");
  }
}

function filterAuthorizedDeliveries(
  res: Response,
  repository: NonNullable<DashboardDependencies["chatProviderRepository"]>,
  deliveries: ChatProviderMessageDeliveryRecord[],
): ChatProviderMessageDeliveryRecord[] {
  const projectIds = principalProjectIds(res);
  if (projectIds === null || projectIds.includes("*")) return deliveries;
  return deliveries.filter((delivery) => {
    const binding = delivery.channelBindingId ? repository.getChannelBinding(delivery.channelBindingId) : null;
    return Boolean(binding && projectIds.includes(binding.projectId));
  });
}

function sanitizeDeliveries(deliveries: ChatProviderMessageDeliveryRecord[]): Array<Omit<ChatProviderMessageDeliveryRecord, "payload" | "leaseOwner" | "leaseExpiresAt">> {
  return deliveries.map(sanitizeDelivery);
}

function sanitizeDelivery(delivery: ChatProviderMessageDeliveryRecord): Omit<ChatProviderMessageDeliveryRecord, "payload" | "leaseOwner" | "leaseExpiresAt"> {
  const { payload: _payload, leaseOwner: _leaseOwner, leaseExpiresAt: _leaseExpiresAt, ...safe } = delivery;
  return {
    ...safe,
    lastError: safe.lastError
      ? redactText(safe.lastError).replace(/https?:\/\/[^\s)\]}]+/gi, "[REDACTED_URL]").slice(0, 500)
      : null,
  };
}

function parseDeliveryLimit(value: unknown): number | undefined {
  return parseOptionalInteger(value, 1, 500, "limit");
}

function decorateSetupDefinition(req: Request, schema: ChatProviderSetupSchema): ChatProviderSetupSchema & {
  ingressUrlTemplate: string;
  bridgeModes: Array<ChatProviderSetupSchema["bridgeModes"][number] & { setupHints: ChatProviderSetupHints }>;
} {
  return {
    ...schema,
    ingressUrlTemplate: `${getRequestOrigin(req)}/api/chat-providers/ingress/{connectionId}`,
    bridgeModes: schema.bridgeModes.map((bridgeMode) => ({
      ...bridgeMode,
      setupHints: buildSetupHints(schema.kind, bridgeMode.mode),
    })),
  };
}

function decorateConnection(
  req: Request,
  connection: ChatProviderConnectionRecord,
): DashboardChatProviderConnectionRecord {
  return {
    ...connection,
    ingressUrl: buildIngressUrl(req, connection.id),
    setupHints: buildSetupHints(connection.providerKind, connection.bridgeMode),
  };
}

function buildIngressUrl(req: Request, connectionId: string): string {
  return `${getRequestOrigin(req)}/api/chat-providers/ingress/${encodeURIComponent(connectionId)}`;
}

function buildSetupHints(providerKind: ChatProviderKind, bridgeMode: ChatProviderBridgeMode): ChatProviderSetupHints {
  const schema = resolveBridgeSchema(providerKind, bridgeMode);
  return {
    bridgeModeLabel: schema.label,
    integration: schema.integration,
    requiredSetupFields: schema.setupFields.filter((field) => field.required).map((field) => field.key),
    requiredSecretFields: schema.secretFields.filter((field) => field.required).map((field) => field.key),
  };
}

function resolveBridgeSchema(providerKind: ChatProviderKind, bridgeMode: ChatProviderBridgeMode): ChatProviderBridgeSetupSchema {
  const bridgeSchema = getChatProviderSetupSchema(providerKind).bridgeModes.find((entry) => entry.mode === bridgeMode);
  if (!bridgeSchema) {
    throw new HttpRouteError(400, `Unsupported bridge mode for ${providerKind}: ${bridgeMode}`);
  }
  return bridgeSchema;
}

function getRequestOrigin(req: Request): string {
  const forwardedProto = firstHeaderValue(req.headers["x-forwarded-proto"]);
  const proto = forwardedProto || req.protocol || "http";
  const forwardedHost = firstHeaderValue(req.headers["x-forwarded-host"]);
  const host = forwardedHost || req.get("host") || "localhost";
  return `${proto}://${host}`;
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  if (Array.isArray(value)) {
    return value[0]?.split(",")[0]?.trim() || undefined;
  }
  return value?.split(",")[0]?.trim() || undefined;
}
