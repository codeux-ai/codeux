import type { Express, Request } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute } from "./route-utils.js";
import {
  parseChatProviderKind,
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
  ChatProviderKind,
  ChatProviderSetupSchema,
} from "../contracts/chat-provider-types.js";
import { getChatProviderSetupSchema } from "../contracts/chat-provider-types.js";

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
    const created = deps.chatProviderSecretService
      ? await deps.chatProviderSecretService.createConnection(input)
      : repository.createConnection(input);
    res.status(201).json(decorateConnection(req, created));
  }));

  router.patch("/api/chat-providers/connections/:connectionId", asyncRoute(async (req, res) => {
    const connectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    const existing = requireConnection(repository.getConnection(connectionId));
    const input = parseUpdateChatProviderConnectionInput(req.body, existing);
    const updated = deps.chatProviderSecretService
      ? await deps.chatProviderSecretService.updateConnection(connectionId, input)
      : repository.updateConnection(connectionId, input);
    res.json(decorateConnection(req, updated));
  }));

  router.delete("/api/chat-providers/connections/:connectionId", syncRoute((req, res) => {
    const deleted = repository.deleteConnection(requireTrimmedString(req.params.connectionId, "connectionId"));
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
    res.json({
      bindings: repository.listChannelBindings({
        providerConnectionId: providerConnectionId || undefined,
        projectId: projectId || undefined,
        externalChannelId: externalChannelId || undefined,
        enabledOnly,
      }),
    });
  }));

  router.get("/api/chat-providers/connections/:connectionId/channel-bindings", syncRoute((req, res) => {
    const providerConnectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    requireConnection(repository.getConnection(providerConnectionId));
    res.json({
      bindings: repository.listChannelBindings({ providerConnectionId }),
    });
  }));

  router.post("/api/chat-providers/channel-bindings", syncRoute((req, res) => {
    const created = repository.createChannelBinding(parseCreateChatProviderChannelBindingInput(req.body));
    res.status(201).json(created);
  }));

  router.patch("/api/chat-providers/channel-bindings/:bindingId", syncRoute((req, res) => {
    const bindingId = requireTrimmedString(req.params.bindingId, "bindingId");
    requireBinding(repository.getChannelBinding(bindingId));
    res.json(repository.updateChannelBinding(bindingId, parseUpdateChatProviderChannelBindingInput(req.body)));
  }));

  router.delete("/api/chat-providers/channel-bindings/:bindingId", syncRoute((req, res) => {
    const deleted = repository.deleteChannelBinding(requireTrimmedString(req.params.bindingId, "bindingId"));
    if (!deleted) {
      throw new HttpRouteError(404, "Chat provider channel binding not found.");
    }
    res.json({ ok: true });
  }));

  router.get("/api/chat-providers/connections/:connectionId/delivery-status", syncRoute((req, res) => {
    const providerConnectionId = requireTrimmedString(req.params.connectionId, "connectionId");
    requireConnection(repository.getConnection(providerConnectionId));
    res.json({
      deliveries: repository.listDeliveries({
        providerConnectionId,
        direction: "outbound",
        limit: parseDeliveryLimit(req.query.limit),
      }),
    });
  }));

  router.get("/api/chat-providers/channel-bindings/:bindingId/delivery-status", syncRoute((req, res) => {
    const channelBindingId = requireTrimmedString(req.params.bindingId, "bindingId");
    requireBinding(repository.getChannelBinding(channelBindingId));
    res.json({
      deliveries: repository.listDeliveries({
        channelBindingId,
        direction: "outbound",
        limit: parseDeliveryLimit(req.query.limit),
      }),
    });
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
