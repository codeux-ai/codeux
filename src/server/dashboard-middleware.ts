import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Logger } from "../shared/logging/logger.js";
import { correlationIdMiddleware } from "../shared/logging/correlation-id.js";
import { createPreviewHostMiddleware } from "./preview-host-middleware.js";
import { parsePreviewSessionIdFromHost } from "./preview-host-utils.js";
import type { DashboardServerOptions } from "./dashboard-server.js";

export const applyDashboardPreRouteMiddleware = (
  app: Express,
  options: DashboardServerOptions,
  dashboardLogger: Logger
): void => {
  app.use(correlationIdMiddleware());
  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on("finish", () => {
      dashboardLogger.info("Dashboard request completed", {
        method: req.method,
        path: req.originalUrl,
        statusCode: res.statusCode,
        durationMs: Date.now() - startedAt,
      });
    });
    next();
  });

  app.use(createPreviewHostMiddleware(options));
  app.use(express.json({ limit: "1mb" }));
};

export const applyDashboardPostRouteMiddleware = (
  app: Express,
  dashboardDir: string
): void => {
  app.get("/favicon.ico", (req, res) => res.status(204).end());

  const builtDashboardDir = path.join(path.resolve(dashboardDir), "dist");
  const staticDir = fs.existsSync(builtDashboardDir) ? builtDashboardDir : path.resolve(dashboardDir);

  app.use(express.static(staticDir));
  app.use((req, res, next) => {
    const isGet = req.method === "GET";
    const isApi = req.path.startsWith("/api/") || req.path.startsWith("/health") || req.path.startsWith("/ready");
    const isExtensionless = path.extname(req.path) === "";
    const isPreviewHost = parsePreviewSessionIdFromHost(req.headers.host) !== null;

    if (isGet && !isApi && isExtensionless && !isPreviewHost) {
      const indexPath = path.join(path.resolve(staticDir), "index.html");
      res.sendFile(indexPath, (err: any) => {
        if (err) {
          if ((err as any).code === "ENOENT" || (err as any).status === 404) {
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
