import express from "express";
import { request as httpRequest } from "http";
import type { IncomingMessage } from "http";
import type { DashboardServerOptions } from "./dashboard-server.js";
import { toErrorResponse } from "./route-utils.js";
import {
  PREVIEW_BRIDGE_PATH,
  PREVIEW_REBUILD_PATH,
  PREVIEW_START_PATH,
  PREVIEW_STATUS_PATH,
  buildPreviewBridgeScript,
  buildPreviewProxyRequestHeaders,
  buildPreviewStandbyHtml,
  injectPreviewBridgeIntoHtml,
  parsePreviewSessionIdFromHost,
  requestBufferedPreviewResponse,
  rewritePreviewLocationHeader,
  sendBufferedPreviewResponse,
  shouldAttemptPreviewSpaFallback,
} from "./preview-host-utils.js";
import type { SprintPreviewSession } from "../contracts/app-types.js";

export function createPreviewHostMiddleware(options: DashboardServerOptions): express.RequestHandler {
  return async (req, res, next) => {
    const sessionId = parsePreviewSessionIdFromHost(req.headers.host);
    if (!sessionId) {
      next();
      return;
    }
    if (req.path === PREVIEW_BRIDGE_PATH) {
      res.type("application/javascript").send(buildPreviewBridgeScript());
      return;
    }
    if (!options.getSprintPreviewSession) {
      res.status(503).send("Sprint preview runtime is unavailable.");
      return;
    }

    let session: SprintPreviewSession | null = null;
    try {
      session = await options.getSprintPreviewSession(sessionId);
    } catch (error) {
      res.status(502).send(toErrorResponse(error, "Failed to resolve sprint preview session").error);
      return;
    }
    if (!session) {
      res.status(404).send("Sprint preview session is unavailable.");
      return;
    }

    if (req.path === PREVIEW_STATUS_PATH) {
      res.json(session);
      return;
    }

    if (req.path === PREVIEW_START_PATH) {
      if (!options.startSprintPreviewSession) {
        res.status(503).send("Sprint preview start is unavailable.");
        return;
      }
      try {
        const started = await options.startSprintPreviewSession(session.projectId, session.sprintId);
        res.json(started);
      } catch (error) {
        res.status(502).send(toErrorResponse(error, "Failed to start sprint preview session").error);
      }
      return;
    }

    if (req.path === PREVIEW_REBUILD_PATH) {
      if (!options.rebuildSprintPreviewSession) {
        res.status(503).send("Sprint preview rebuild is unavailable.");
        return;
      }
      try {
        const rebuilt = await options.rebuildSprintPreviewSession(session.id);
        res.json(rebuilt);
      } catch (error) {
        res.status(502).send(toErrorResponse(error, "Failed to rebuild sprint preview session").error);
      }
      return;
    }

    if (!session.hostPort) {
      res.status(200).type("html").send(buildPreviewStandbyHtml({
        req,
        session,
        reason: session.lastError || "Preview host port is not assigned yet.",
      }));
      return;
    }

    const upstreamHeaders = buildPreviewProxyRequestHeaders(req, session.hostPort);
    const targetPath = req.originalUrl || req.url || "/";
    if (shouldAttemptPreviewSpaFallback(req)) {
      try {
        const primaryResponse = await requestBufferedPreviewResponse({
          method: req.method,
          upstreamPort: session.hostPort,
          targetPath,
          headers: upstreamHeaders,
        });
        const response = primaryResponse.statusCode === 404
          ? await requestBufferedPreviewResponse({
            method: req.method,
            upstreamPort: session.hostPort,
            targetPath: "/",
            headers: upstreamHeaders,
          })
          : primaryResponse;
        sendBufferedPreviewResponse({
          req,
          res,
          upstreamPort: session.hostPort,
          response,
        });
      } catch (error) {
        res.status(200).type("html").send(buildPreviewStandbyHtml({
          req,
          session,
          reason: error instanceof Error ? error.message : String(error),
        }));
      }
      return;
    }

    const proxyRequest = httpRequest({
      protocol: "http:",
      hostname: "127.0.0.1",
      port: session.hostPort,
      method: req.method,
      path: targetPath,
      headers: upstreamHeaders,
    }, (proxyResponse: IncomingMessage) => {
      const contentType = String(proxyResponse.headers["content-type"] || "");
      const isHtml = contentType.toLowerCase().includes("text/html");
      if (!isHtml) {
        const responseHeaders = { ...proxyResponse.headers };
        if (typeof responseHeaders.location === "string") {
          responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, req, session.hostPort!);
        }
        res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
        proxyResponse.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      proxyResponse.on("data", (chunk: any) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      proxyResponse.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const injected = injectPreviewBridgeIntoHtml(body);
        const responseHeaders = { ...proxyResponse.headers };
        delete responseHeaders["content-length"];
        delete responseHeaders["content-security-policy"];
        delete responseHeaders["content-security-policy-report-only"];
        if (typeof responseHeaders.location === "string") {
          responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, req, session.hostPort!);
        }
        res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
        res.end(injected);
      });
    });

    proxyRequest.on("error", (error: any) => {
      if (!res.headersSent) {
        const accept = String(req.headers.accept || "").toLowerCase();
        if (req.method === "GET" && accept.includes("text/html")) {
          res.status(200).type("html").send(buildPreviewStandbyHtml({
            req,
            session,
            reason: error instanceof Error ? error.message : String(error),
          }));
          return;
        }
        res.status(502).send(toErrorResponse(error, "Failed to proxy sprint preview host request").error);
      } else {
        res.end();
      }
    });

    req.pipe(proxyRequest);
  };
}
