import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { toErrorMessage } from "./dashboard-server.js";
import type { CreateTaskInput, UpdateTaskInput } from "../contracts/project-management-types.js";

export function registerTaskRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/tasks", (req, res) => {
    try {
      const sprintId = typeof req.query.sprintId === "string" && req.query.sprintId.trim()
        ? req.query.sprintId.trim()
        : undefined;
      res.json(deps.listTasks(String(req.params.projectId || "").trim(), sprintId));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list tasks") });
    }
  });

  router.post("/api/projects/:projectId/tasks", (req, res) => {
    try {
      res.status(201).json(deps.createTask(String(req.params.projectId || "").trim(), req.body as CreateTaskInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create task") });
    }
  });

  router.patch("/api/tasks/:taskId", (req, res) => {
    try {
      res.json(deps.updateTask(String(req.params.taskId || "").trim(), req.body as UpdateTaskInput));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update task") });
    }
  });

  router.delete("/api/tasks/:taskId", (req, res) => {
    try {
      deps.deleteTask(String(req.params.taskId || "").trim());
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete task") });
    }
  });
}
