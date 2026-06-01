import type { Express } from "express";
import type { DashboardDependencies } from "../dashboard-server.js";
import { asyncRoute, requireTrimmedString } from "../route-utils.js";

export function registerLiveTaskRoutes(app: Express, deps: DashboardDependencies): void {
  /**
   * Force-completes a live task by terminating active execution and setting its state to COMPLETED.
   */
  app.post("/api/projects/:projectId/tasks/:taskId/force-complete", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const taskId = requireTrimmedString(req.params.taskId, "taskId");
    const { reason } = req.body;

    if (typeof reason !== "string" || reason.trim().length === 0) {
      res.status(400).json({ error: "A reason is required to force-complete a task." });
      return;
    }

    await deps.forceCompleteTask(projectId, taskId, reason.trim());

    res.json({ ok: true });
  }));
}
