import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { toErrorResponse, syncRoute, requireTrimmedString, parseTrimmedString } from "./route-utils.js";
import type { CreateTaskInput, UpdateTaskInput } from "../contracts/project-management-types.js";

export function registerTaskRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/tasks", syncRoute((req, res) => {
    try {
      const sprintId = parseTrimmedString(req.query.sprintId);
      res.json(deps.listTasks(requireTrimmedString(req.params.projectId, "projectId"), sprintId));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list tasks"));
    }
  }));

  router.post("/api/projects/:projectId/tasks", syncRoute((req, res) => {
    try {
      res.status(201).json(deps.createTask(requireTrimmedString(req.params.projectId, "projectId"), req.body as CreateTaskInput));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to create task"));
    }
  }));

  router.patch("/api/tasks/:taskId", syncRoute((req, res) => {
    try {
      res.json(deps.updateTask(requireTrimmedString(req.params.taskId, "taskId"), req.body as UpdateTaskInput));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update task"));
    }
  }));

  router.delete("/api/tasks/:taskId", syncRoute((req, res) => {
    try {
      deps.deleteTask(requireTrimmedString(req.params.taskId, "taskId"));
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to delete task"));
    }
  }));
}
