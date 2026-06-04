import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Logger } from "../shared/logging/logger.js";
import { correlationIdMiddleware } from "../shared/logging/correlation-id.js";
import { createPreviewHostMiddleware } from "./preview-host-middleware.js";
import { parsePreviewSessionIdFromHost } from "./preview-host-utils.js";
import type { DashboardServerOptions } from "./dashboard-server.js";

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

export const applyDashboardPreRouteMiddleware = (
  app: Express,
  options: DashboardServerOptions,
  dashboardLogger: Logger
): void => {
  app.use(correlationIdMiddleware());
  app.use((req, res, next) => {
    const isRuntimeDataPath = req.path.startsWith("/api/")
      || req.path === "/health"
      || req.path === "/ready";
    if (isRuntimeDataPath) {
      res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
      res.setHeader("Pragma", "no-cache");
      res.setHeader("Expires", "0");
      res.setHeader("Surrogate-Control", "no-store");
    }
    next();
  });
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      dashboardLogger.info("Dashboard request completed", {
        logPurpose: "request",
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  app.use(createPreviewHostMiddleware(options));
  // Settings payloads can embed a base64 background-image data URL, which the
  // dashboard warns about past ~5MB. base64 inflates bytes by ~33%, so allow
  // generous headroom to keep appearance saves from failing with HTTP 413.
  app.use(express.json({ limit: "25mb" }));
};

export const applyDashboardPostRouteMiddleware = (
  app: Express,
  dashboardDir: string
): void => {
  app.get("/favicon.ico", (req, res) => res.status(204).end());

  const builtDashboardDir = path.join(path.resolve(dashboardDir), "dist");
  const staticDir = fs.existsSync(builtDashboardDir) ? builtDashboardDir : path.resolve(dashboardDir);

  app.use(express.static(staticDir, {
    setHeaders: (res, filePath) => {
      // Vite emits content-hashed, immutable bundles under /assets (e.g. index-3f9a2c1b.js).
      // A new build produces a new filename, so these can be cached forever — this removes the
      // per-asset revalidation round-trips that otherwise run on every load. index.html (and any
      // other non-hashed entry) must stay revalidated so a new build is picked up immediately.
      const isHashedAsset = path.join(path.resolve(staticDir), "assets") === path.dirname(filePath);
      if (isHashedAsset) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (filePath.endsWith(".html")) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  }));
  app.use((req, res, next) => {
    const isGet = req.method === "GET";
    const isApi = req.path.startsWith("/api/") || req.path.startsWith("/health") || req.path.startsWith("/ready");
    const isExtensionless = path.extname(req.path) === "";
    const isPreviewHost = parsePreviewSessionIdFromHost(req.headers.host) !== null;

    if (isGet && !isApi && isExtensionless && !isPreviewHost) {
      const indexPath = path.join(path.resolve(staticDir), "index.html");
      res.sendFile(indexPath, (err: unknown) => {
        if (err) {
          const isEnoent = isErrnoException(err) && err.code === "ENOENT";
          const is404 = typeof err === "object" && err !== null && "status" in err && (err as { status: number }).status === 404;

          if (isEnoent || is404) {
            next();
          } else {
            next(err);
          }
        }
      });
      return;
    }
    next();
  });
};
