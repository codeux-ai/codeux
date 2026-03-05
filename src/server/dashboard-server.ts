import express, { type Express } from "express";
import * as fs from "fs";
import * as path from "path";
import type { Server } from "http";
import { createServer } from "http";
import type { DashboardSettings, ExternalSettingsHints, GitTrackingStatus, JulesActivity, ReadinessProbeStatus } from "../contracts/app-types.js";
import { correlationIdMiddleware } from "../shared/logging/correlation-id.js";
import { createLogger, type Logger } from "../shared/logging/logger.js";

export interface DashboardServerOptions {
  app: Express;
  dashboardDir: string;
  port: number;
  liveActivityCacheMs: number;
  getStatus: () => unknown;
  getLiveActivities: () => Promise<Record<string, JulesActivity[]>>;
  getGitStatus: () => Promise<GitTrackingStatus>;
  getExternalSettingsHints: () => ExternalSettingsHints;
  getSettings: () => DashboardSettings;
  saveSettings: (settings: DashboardSettings) => DashboardSettings;
  rerunTask: (taskId: string) => Promise<unknown>;
  logger?: Logger;
  isReady?: () => ReadinessProbeStatus;
  isHealthy?: () => ReadinessProbeStatus;
}

export interface DashboardServerHandle {
  port: number;
  server: Server;
}

const bindDashboardServer = async (
  app: Express,
  startPort: number,
  logger: Logger
): Promise<DashboardServerHandle> => {
  let port = Math.max(1, Math.min(65535, Math.round(startPort)));

  while (port <= 65535) {
    try {
      const server = await new Promise<Server>((resolve, reject) => {
        const listeningServer = createServer(app);
        listeningServer.listen(port, "127.0.0.1", () => resolve(listeningServer));
        listeningServer.on("error", reject);
      });
      return { port, server };
    } catch (error) {
      const message = error as NodeJS.ErrnoException;
      if (message.code !== "EADDRINUSE") {
        throw error;
      }
      logger.warn("Dashboard port in use. Trying next port.", {
        attemptedPort: port,
        nextPort: port + 1,
      });
      port += 1;
    }
  }

  throw new Error("No available dashboard port found in range 1-65535.");
};

export const setupDashboardServer = async (options: DashboardServerOptions): Promise<DashboardServerHandle> => {
  const {
    app,
    dashboardDir,
    port,
    liveActivityCacheMs,
    getStatus,
    getLiveActivities,
    getGitStatus,
    getExternalSettingsHints,
    getSettings,
    saveSettings,
    rerunTask,
    logger,
    isReady,
  } = options;

  const dashboardLogger = logger ?? createLogger({ bindings: { component: "dashboard-server" } });

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

  app.use(express.json({ limit: "1mb" }));

  app.get("/health", (req, res) => {
    const healthy = options.isHealthy ? options.isHealthy() : { status: "UP" as const };
    if (healthy.status === "UP") {
      res.json(healthy);
    } else {
      res.status(503).json(healthy);
    }
  });

  app.get("/ready", (req, res) => {
    const ready = isReady ? isReady() : { status: "READY" as const };
    if (ready.status === "READY" || ready.status === "UP") {
      res.json(ready);
    } else {
      res.status(503).json(ready);
    }
  });

  app.get("/api/status", (req, res) => {
    res.json(getStatus());
  });

  app.get("/api/live-activities", async (req, res) => {
    try {
      const activitiesBySession = await getLiveActivities();
      res.json({
        activitiesBySession,
        polledAt: new Date().toISOString(),
        cacheTtlMs: liveActivityCacheMs,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Failed to fetch live activities: ${message}` });
    }
  });

  app.get("/api/settings", (req, res) => {
    res.json(getSettings());
  });

  app.get("/api/settings/import-sources", (req, res) => {
    res.json(getExternalSettingsHints());
  });

  app.get("/api/git-status", async (req, res) => {
    try {
      const status = await getGitStatus();
      res.json(status);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: `Failed to fetch git status: ${message}` });
    }
  });

  app.put("/api/settings", (req, res) => {
    try {
      const saved = saveSettings(req.body as DashboardSettings);
      res.json(saved);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: `Failed to save settings: ${message}` });
    }
  });

  app.post("/api/tasks/:taskId/rerun", async (req, res) => {
    try {
      const taskId = String(req.params.taskId || "").trim();
      if (!taskId) {
        res.status(400).json({ error: "Missing task id." });
        return;
      }
      const task = await rerunTask(taskId);
      res.json({ ok: true, task });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(400).json({ error: `Failed to rerun task: ${message}` });
    }
  });

  app.get("/favicon.ico", (req, res) => res.status(204).end());

  const builtDashboardDir = path.join(path.resolve(dashboardDir), "dist");
  const staticDir = fs.existsSync(builtDashboardDir) ? builtDashboardDir : path.resolve(dashboardDir);
  app.use(express.static(staticDir));

  const handle = await bindDashboardServer(app, port, dashboardLogger);

  dashboardLogger.info("Dashboard server started", {
    port: handle.port,
    localhostUrl: `http://localhost:${handle.port}`,
    loopbackUrl: `http://127.0.0.1:${handle.port}`,
  });

  return handle;
};
