import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString, parseRerunTaskOptions } from "./request-parsers.js";

export function registerExecutionControlRoutes(app: Express, options: DashboardDependencies): void {
  app.post("/api/tasks/:taskId/rerun", asyncRoute(async (req, res) => {
    const taskId = requireTrimmedString(req.params.taskId, "taskId");
    const parsedOptions = parseRerunTaskOptions(req.body);
    const task = await options.rerunTask(taskId, parsedOptions);
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

  app.post("/api/sprint-runs/:sprintRunId/resume", asyncRoute(async (req, res) => {
    if (!options.resumeSprintRun) {
      res.status(404).json({ error: "Sprint resume control is not available." });
      return;
    }
    res.json(await options.resumeSprintRun(requireTrimmedString(req.params.sprintRunId, "sprintRunId")));
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
