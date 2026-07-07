import type { Express, Request } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { HttpRouteError } from "./http-errors.js";
import { requireTrimmedString } from "./request-parsers.js";
import { ChatProviderIngressSecurity, ChatProviderIngressSecurityError } from "../services/chat-provider-security.js";

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

    const result = await deps.chatProviderIngressService!.processInbound({
      providerConnectionId,
      payload: req.body,
    });

    const statusCode = statusCodeForIngressResult(result.status);
    res.status(statusCode).json(result);
  });

  router.post("/api/chat-providers/ingress/:providerConnectionId", handler);
  router.post("/api/chat-providers/connections/:connectionId/ingress", handler);
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
