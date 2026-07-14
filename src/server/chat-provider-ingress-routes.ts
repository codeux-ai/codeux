import type { Express, Request } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { HttpRouteError } from "./http-errors.js";
import { requireTrimmedString } from "./request-parsers.js";
import { ChatProviderIngressSecurity, ChatProviderIngressSecurityError } from "../services/chat-provider-security.js";
import { getChatConnectorProfileForMode } from "../domain/chat-connectors/registry.js";
import { redactText } from "../shared/security/redaction.js";

export function registerChatProviderIngressRoutes(router: Express, deps: DashboardDependencies): void {
  if (!deps.chatProviderRepository || !deps.chatProviderIngressService) {
    return;
  }
  const securityVerifier = new ChatProviderIngressSecurity(undefined, deps.chatProviderRepository);

  const handler = asyncRoute(async (req, res) => {
    const providerConnectionId = requireTrimmedString(
      req.params.providerConnectionId ?? req.params.connectionId,
      "providerConnectionId",
    );
    const connection = deps.chatProviderSecretService
      ? await deps.chatProviderSecretService.resolveConnection(providerConnectionId).catch(() => null)
      : deps.chatProviderRepository!.getConnectionInternal(providerConnectionId);
    if (!connection) {
      throw new HttpRouteError(404, "Chat provider connection not found.");
    }

    try {
      const securityResult = securityVerifier.verify(connection, {
        headers: req.headers,
        rawBody: buildRequestBodyForSignature(req),
      });
      if (securityResult.immediateResponse) {
        res.set({ ...securityResult.immediateResponse.headers });
        res.status(securityResult.immediateResponse.statusCode).send(securityResult.immediateResponse.body);
        return;
      }
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

    if (profile.ingress.ignore?.(payload) && connection.bridgeMode === "official_api") {
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

  router.post("/api/chat-providers/ingress/:providerConnectionId", handler);
  router.post("/api/chat-providers/connections/:connectionId/ingress", handler);
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

function buildRequestBodyForSignature(req: Request): string | Uint8Array {
  const rawBody = (req as Request & { rawBody?: unknown }).rawBody;
  if (typeof rawBody === "string") {
    return rawBody;
  }
  if (Buffer.isBuffer(rawBody)) {
    return rawBody;
  }
  return JSON.stringify(req.body ?? {});
}

function statusCodeForIngressResult(status: string): number {
  switch (status) {
    case "accepted":
      return 202;
    case "duplicate":
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
