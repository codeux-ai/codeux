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
  PREVIEW_MAX_REQUEST_BODY_BYTES,
  PREVIEW_MAX_BUFFERED_RESPONSE_BYTES,
  PREVIEW_MAX_STREAMED_HTML_BYTES,
  PREVIEW_UPSTREAM_TIMEOUT_MS,
  applyPreviewCorsHeaders,
  buildPreviewBridgeScript,
  buildPreviewProxyRequestHeaders,
  buildPreviewStandbyHtml,
  injectPreviewBridgeIntoHtml,
  isAllowedPreviewControlOrigin,
  mergePreviewCorsHeaders,
  parseSelectedPreviewPortFromRequest,
  parsePreviewSessionIdFromHost,
  requestBufferedPreviewResponse,
  resolvePreviewHostPort,
  rewritePreviewLocationHeader,
  sanitizePreviewDocumentHeaders,
  sendBufferedPreviewResponse,
  shouldAttemptPreviewSpaFallback,
  stripPreviewPortSelectorFromPath,
} from "./preview-host-utils.js";
import type { SprintPreviewSession } from "../contracts/app-types.js";

export function createPreviewHostMiddleware(options: DashboardServerOptions): express.RequestHandler {
  return async (req, res, next) => {
    const sessionId = parsePreviewSessionIdFromHost(req.headers.host);
    if (!sessionId) {
      next();
      return;
    }
    const isControlPath = req.path === PREVIEW_START_PATH || req.path === PREVIEW_REBUILD_PATH || req.path === PREVIEW_STATUS_PATH;
    if (isControlPath && !isAllowedPreviewControlOrigin(req)) {
      res.status(403).send("Forbidden");
      return;
    }
    applyPreviewCorsHeaders(req, res, isControlPath);
    if (req.method === "OPTIONS") {
      res.status(204).end();
      return;
    }
    if (req.path === PREVIEW_BRIDGE_PATH) {
      res.setHeader("Cache-Control", "no-store");
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

    let selectedHostPort: number | null;
    try {
      selectedHostPort = resolvePreviewHostPort(
        session,
        parseSelectedPreviewPortFromRequest(req.originalUrl || req.url || "/", req.headers["x-code-ux-preview-port"]),
      );
    } catch (error) {
      res.status(400).send(toErrorResponse(error, "Invalid sprint preview port selection").error);
      return;
    }

    if (!selectedHostPort) {
      res.status(200).type("html").send(buildPreviewStandbyHtml({
        req,
        session,
        reason: session.lastError || "Preview host port is not assigned yet.",
      }));
      return;
    }

    const upstreamHeaders = buildPreviewProxyRequestHeaders(req, selectedHostPort);
    const targetPath = stripPreviewPortSelectorFromPath(req.originalUrl || req.url || "/");
    if (shouldAttemptPreviewSpaFallback(req)) {
      try {
        const primaryResponse = await requestBufferedPreviewResponse({
          method: req.method,
          upstreamPort: selectedHostPort,
          targetPath,
          headers: upstreamHeaders,
        });
        const response = primaryResponse.statusCode === 404
          ? await requestBufferedPreviewResponse({
            method: req.method,
            upstreamPort: selectedHostPort,
            targetPath: "/",
            headers: upstreamHeaders,
          })
          : primaryResponse;
        sendBufferedPreviewResponse({
          req,
          res,
          upstreamPort: selectedHostPort,
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
      port: selectedHostPort,
      method: req.method,
      path: targetPath,
      headers: upstreamHeaders,
      timeout: PREVIEW_UPSTREAM_TIMEOUT_MS,
    }, (proxyResponse: IncomingMessage) => {
      const contentType = String(proxyResponse.headers["content-type"] || "");
      const isHtml = contentType.toLowerCase().includes("text/html");
      if (!isHtml) {
        const responseHeaders = { ...proxyResponse.headers };
        mergePreviewCorsHeaders(req, responseHeaders, false);
        if (typeof responseHeaders.location === "string") {
          responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, req, selectedHostPort);
        }
        res.writeHead(proxyResponse.statusCode || 502, responseHeaders);

        let binarySize = 0;
        proxyResponse.on("data", (chunk: any) => {
          binarySize += Buffer.byteLength(chunk);
          if (binarySize > PREVIEW_MAX_BUFFERED_RESPONSE_BYTES) {
            proxyRequest.destroy(new Error("Response body exceeds maximum allowed size"));
          }
        });

        proxyResponse.pipe(res);
        return;
      }

      const chunks: Buffer[] = [];
      let htmlSize = 0;
      proxyResponse.on("data", (chunk: any) => {
        const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        htmlSize += buf.length;
        if (htmlSize > PREVIEW_MAX_STREAMED_HTML_BYTES) {
          proxyRequest.destroy(new Error("Response body exceeds maximum allowed size for HTML injection"));
          return;
        }
        chunks.push(buf);
      });
      proxyResponse.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const injected = injectPreviewBridgeIntoHtml(body);
        const responseHeaders = { ...proxyResponse.headers };
        sanitizePreviewDocumentHeaders(responseHeaders);
        mergePreviewCorsHeaders(req, responseHeaders, false);
        if (typeof responseHeaders.location === "string") {
          responseHeaders.location = rewritePreviewLocationHeader(responseHeaders.location, req, selectedHostPort);
        }
        res.writeHead(proxyResponse.statusCode || 502, responseHeaders);
        res.end(injected);
      });
    });

    proxyRequest.on("error", (error: any) => {
      if (!res.headersSent) {
        if (error.message && error.message.includes("Request body exceeds maximum allowed size")) {
          res.status(413).send(toErrorResponse(error, "Request Entity Too Large").error);
          req.destroy();
          return;
        }
        if (error.message && error.message.includes("Response body exceeds maximum allowed size")) {
          res.status(502).send(toErrorResponse(error, "Bad Gateway").error);
          req.destroy();
          return;
        }
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

    let reqSize = 0;
    req.on("data", (chunk: any) => {
      reqSize += Buffer.byteLength(chunk);
      if (reqSize > PREVIEW_MAX_REQUEST_BODY_BYTES) {
        proxyRequest.destroy(new Error("Request body exceeds maximum allowed size"));
      }
    });

    req.pipe(proxyRequest);
  };
}
