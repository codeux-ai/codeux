import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { toErrorResponse, syncRoute } from "./route-utils.js";
import { requireTrimmedString, parseTrimmedString , parseCreateTaskInput , parseUpdateTaskInput } from "./request-parsers.js";
import type { CreateTaskInput, UpdateTaskInput } from "../contracts/project-management-types.js";

export function registerTaskRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/tasks", syncRoute((req, res) => {
    try {
      const sprintId = parseTrimmedString(req.query.sprintId);
      const projectId = requireTrimmedString(req.params.projectId, "projectId");
      const view = parseTrimmedString(req.query.view);
      if (view === "overview" && !sprintId && deps.listTaskOverviews) {
        res.json(deps.listTaskOverviews(projectId));
        return;
      }
      res.json(deps.listTasks(projectId, sprintId));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to list tasks"));
    }
  }));

  router.post("/api/projects/:projectId/tasks", syncRoute((req, res) => {
    try {
      res.status(201).json(deps.createTask(requireTrimmedString(req.params.projectId, "projectId"), parseCreateTaskInput(req.body)));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to create task"));
    }
  }));

  router.patch("/api/tasks/:taskId", syncRoute((req, res) => {
    try {
      const taskId = requireTrimmedString(req.params.taskId, "taskId");
      const task = deps.getTask(taskId);
      if (!task) {
        res.status(404).json({ error: `Task not found: ${taskId}` });
        return;
      }
      const projectId = parseTrimmedString(req.body?.projectId) || parseTrimmedString(req.query.projectId);
      if (projectId && task.projectId !== projectId) {
        res.status(400).json({ error: `Task ${taskId} does not belong to project ${projectId}` });
        return;
      }
      res.json(deps.updateTask(taskId, parseUpdateTaskInput(req.body)));
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to update task"));
    }
  }));

  router.delete("/api/tasks/:taskId", syncRoute((req, res) => {
    try {
      const taskId = requireTrimmedString(req.params.taskId, "taskId");
      const task = deps.getTask(taskId);
      if (!task) {
        res.status(404).json({ error: `Task not found: ${taskId}` });
        return;
      }
      const projectId = parseTrimmedString(req.body?.projectId) || parseTrimmedString(req.query.projectId);
      if (projectId && task.projectId !== projectId) {
        res.status(400).json({ error: `Task ${taskId} does not belong to project ${projectId}` });
        return;
      }
      deps.deleteTask(taskId);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json(toErrorResponse(error, "Failed to delete task"));
    }
  }));
}
