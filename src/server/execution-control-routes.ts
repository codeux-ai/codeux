import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, requireTrimmedString } from "./route-utils.js";

export function registerExecutionControlRoutes(app: Express, options: DashboardDependencies): void {
  app.post("/api/tasks/:taskId/rerun", asyncRoute(async (req, res) => {
    const taskId = requireTrimmedString(req.params.taskId, "taskId");
    const body = req.body as { provider?: string; clearWorktree?: boolean; resetDependents?: boolean } | undefined;
    const task = await options.rerunTask(taskId, {
      provider: typeof body?.provider === "string" ? body.provider : undefined,
      clearWorktree: body?.clearWorktree === true,
      resetDependents: body?.resetDependents === true,
    });
    res.json({ ok: true, task });
  }));

  app.post("/api/projects/:projectId/sprints/:sprintId/orchestrate", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
    const result = await options.orchestrateSprint(projectId, sprintId);
    res.status(202).json(result);
  }));

  app.post("/api/sprint-runs/:sprintRunId/pause", asyncRoute(async (req, res) => {
    res.json(await options.pauseSprintRun(requireTrimmedString(req.params.sprintRunId, "sprintRunId")));
  }));

  app.post("/api/sprint-runs/:sprintRunId/cancel", asyncRoute(async (req, res) => {
    res.json(await options.cancelSprintRun(requireTrimmedString(req.params.sprintRunId, "sprintRunId")));
  }));

  app.post("/api/sprint-runs/:sprintRunId/force-cancel", asyncRoute(async (req, res) => {
    res.json(await options.forceCancelSprintRun(requireTrimmedString(req.params.sprintRunId, "sprintRunId")));
  }));

  app.post("/api/task-dispatches/:dispatchId/cancel", asyncRoute(async (req, res) => {
    res.json(await options.cancelTaskDispatch(requireTrimmedString(req.params.dispatchId, "dispatchId")));
  }));

  app.post("/api/task-dispatches/:dispatchId/force-cancel", asyncRoute(async (req, res) => {
    res.json(await options.forceCancelTaskDispatch(requireTrimmedString(req.params.dispatchId, "dispatchId")));
  }));

  app.post("/api/task-dispatches/:dispatchId/retry", asyncRoute(async (req, res) => {
    res.json(await options.retryTaskDispatch(requireTrimmedString(req.params.dispatchId, "dispatchId")));
  }));
}
