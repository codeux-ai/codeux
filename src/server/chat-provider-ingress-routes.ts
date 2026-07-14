import type { Express, Request } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { HttpRouteError } from "./http-errors.js";
import { requireTrimmedString } from "./request-parsers.js";
import { ChatProviderIngressSecurity, ChatProviderIngressSecurityError } from "../services/chat-provider-security.js";
import { getChatConnectorProfileForMode } from "../domain/chat-connectors/registry.js";
import { redactText } from "../shared/security/redaction.js";

const defaultSecurityVerifier = new ChatProviderIngressSecurity();

export function registerChatProviderIngressRoutes(router: Express, deps: DashboardDependencies): void {
  if (!deps.chatProviderRepository || !deps.chatProviderIngressService) {
    return;
  }

  const handler = asyncRoute(async (req, res) => {
    const providerConnectionId = requireTrimmedString(
      req.params.providerConnectionId ?? req.params.connectionId,
      "providerConnectionId",
    );
    const connection = deps.chatProviderRepository!.getConnectionInternal(providerConnectionId);
    if (!connection) {
      throw new HttpRouteError(404, "Chat provider connection not found.");
    }

    try {
      defaultSecurityVerifier.verify(connection, {
        headers: req.headers,
        rawBody: buildRequestBodyForSignature(req),
      });
    } catch (error) {
      if (error instanceof ChatProviderIngressSecurityError) {
        deps.logger?.warn("Rejected chat provider ingress authentication", {
          logPurpose: "security",
          providerConnectionId,
          providerKind: connection.providerKind,
          reason: error.code,
          statusCode: error.status,
        });
        throw new HttpRouteError(error.status, error.message);
      }
      throw error;
    }

    const profile = getChatConnectorProfileForMode(connection.providerKind, connection.bridgeMode);
    const payload = requirePayloadRecord(req.body);
    const handshake = profile.ingress.handshake;
    if (handshake.type === "challenge" && handshake.modes?.includes(connection.bridgeMode)) {
      const challenge = handshake.challengeField ? payload[handshake.challengeField] : undefined;
      if (payload.type === "url_verification" && typeof challenge === "string" && challenge) {
        res.status(200).json({ [handshake.responseField ?? handshake.challengeField ?? "challenge"]: challenge });
        return;
      }
    }

    if (profile.ingress.ignore?.(payload, connection.bridgeMode) && connection.bridgeMode === "official_api") {
      sendAcknowledgement(res, profile.ingress.acknowledgement);
      return;
    }

    if (profile.ingress.acknowledgement.immediateModes?.includes(connection.bridgeMode)) {
      sendAcknowledgement(res, profile.ingress.acknowledgement);
      setImmediate(() => {
        void deps.chatProviderIngressService!.processInbound({
          providerConnectionId,
          payload,
        }).catch((error) => {
          deps.logger?.error("Failed to process acknowledged chat provider ingress", {
            logPurpose: "integration",
            providerConnectionId,
            providerKind: connection.providerKind,
            error: redactText(error instanceof Error ? error.message : String(error)),
          });
        });
      });
      return;
    }

    const result = await deps.chatProviderIngressService!.processInbound({
      providerConnectionId,
      payload,
    });

    const statusCode = statusCodeForIngressResult(result.status);
    res.status(statusCode).json(result);
  });

  const handshakeHandler = asyncRoute(async (req, res) => {
    const providerConnectionId = requireTrimmedString(
      req.params.providerConnectionId ?? req.params.connectionId,
      "providerConnectionId",
    );
    const connection = deps.chatProviderRepository!.getConnectionInternal(providerConnectionId);
    if (!connection) {
      throw new HttpRouteError(404, "Chat provider connection not found.");
    }
    if (!connection.enabled || connection.status !== "active") {
      throw new HttpRouteError(403, "Chat provider connection is not enabled.");
    }

    const profile = getChatConnectorProfileForMode(connection.providerKind, connection.bridgeMode);
    const handshake = profile.ingress.handshake;
    if (handshake.type !== "challenge" || !handshake.modes.includes(connection.bridgeMode) || !handshake.handle) {
      throw new HttpRouteError(404, "Chat provider handshake is not configured for this connection.");
    }

    const result = handshake.handle({
      query: req.query as Record<string, unknown>,
      setup: connection.setup,
      secrets: connection.secrets,
    });
    for (const [name, value] of Object.entries(result.headers)) {
      res.setHeader(name, value);
    }
    if (result.statusCode !== 200) {
      deps.logger?.warn("Rejected chat provider webhook handshake", {
        logPurpose: "security",
        providerConnectionId,
        providerKind: connection.providerKind,
        statusCode: result.statusCode,
      });
    }
    res.status(result.statusCode).send(result.body ?? "");
  });

  router.post("/api/chat-providers/ingress/:providerConnectionId", handler);
  router.post("/api/chat-providers/connections/:connectionId/ingress", handler);
  router.get("/api/chat-providers/ingress/:providerConnectionId", handshakeHandler);
  router.get("/api/chat-providers/connections/:connectionId/ingress", handshakeHandler);
}

function requirePayloadRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpRouteError(400, "Invalid chat provider ingress payload.");
  }
  return value as Record<string, unknown>;
}

function sendAcknowledgement(
  res: Parameters<Parameters<typeof asyncRoute>[0]>[1],
  acknowledgement: {
    statusCode: number;
    headers: Readonly<Record<string, string>>;
    body: string | null;
  },
): void {
  for (const [name, value] of Object.entries(acknowledgement.headers)) {
    res.setHeader(name, value);
  }
  if (acknowledgement.body === null) {
    res.status(acknowledgement.statusCode).end();
    return;
  }
  res.status(acknowledgement.statusCode).send(acknowledgement.body);
}

function buildRequestBodyForSignature(req: Request): string {
  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  if (typeof rawBody === "string") {
    return rawBody;
  }
  if (Buffer.isBuffer(rawBody)) {
    return rawBody.toString("utf8");
  }
  return JSON.stringify(req.body ?? {});
}

function statusCodeForIngressResult(status: string): number {
  switch (status) {
    case "accepted":
      return 202;
    case "duplicate":
    case "ignored":
      return 200;
    case "ambiguous":
      return 409;
    case "unbound":
      return 404;
    case "rejected":
      return 404;
    default:
      return 500;
  }
}
