import express, { type Express } from "express";
import * as path from "path";
import type { JulesActivity } from "./types.js";

export interface DashboardServerOptions {
  app: Express;
  dashboardDir: string;
  port: number;
  liveActivityCacheMs: number;
  getStatus: () => unknown;
  getLiveActivities: () => Promise<Record<string, JulesActivity[]>>;
}

export const setupDashboardServer = async (options: DashboardServerOptions): Promise<void> => {
  const { app, dashboardDir, port, liveActivityCacheMs, getStatus, getLiveActivities } = options;

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

  app.get("/favicon.ico", (req, res) => res.status(204).end());
  app.use(express.static(path.resolve(dashboardDir)));

  await new Promise<void>((resolve) => {
    app.listen(port, "localhost", () => {
      console.error(`\n🚀 [DASHBOARD] Live status available at:`);
      console.error(`   - http://localhost:${port}`);
      console.error(`   - http://127.0.0.1:${port}\n`);
      resolve();
    }).on("error", (err: any) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Warning: Dashboard port ${port} is already in use. Dashboard will not be available.`);
      } else {
        console.error(`Warning: Failed to start dashboard server: ${err.message}`);
      }
      resolve();
    });
  });
};
