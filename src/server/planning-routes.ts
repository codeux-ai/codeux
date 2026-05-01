import type { Express } from "express";
import type { Response } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, requireTrimmedString, parseImprovePromptInput, parsePlanSprintOptions } from "./route-utils.js";
import type {
  ImprovePromptInput,
  PlanSprintOptions,
} from "../contracts/project-management-types.js";

const activePlanningRequests = new Map<string, AbortController>();

function trackPlanningRequest(clientRequestId: string | undefined, controller: AbortController): () => void {
  const key = clientRequestId?.trim();
  if (!key) {
    return () => undefined;
  }
  activePlanningRequests.set(key, controller);
  return () => {
    if (activePlanningRequests.get(key) === controller) {
      activePlanningRequests.delete(key);
    }
  };
}

function sendJsonIfOpen(res: Response, statusCode: number, body: unknown): void {
  if (res.destroyed || res.writableEnded) {
    return;
  }
  res.status(statusCode).json(body);
}

export function registerPlanningRoutes(app: Express, options: DashboardDependencies): void {
  app.post("/api/projects/:projectId/planning/improve-sprint-prompt", asyncRoute(async (req, res) => {
    if (!options.improveSprintPrompt) {
      res.status(404).json({ error: "Sprint prompt improvement is not enabled." });
      return;
    }
    const ac = new AbortController();
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const input: ImprovePromptInput = parseImprovePromptInput(req.body);
    const cleanup = trackPlanningRequest(input.clientRequestId, ac);
    try {
      sendJsonIfOpen(res, 202, await options.improveSprintPrompt(projectId, input, ac.signal));
    } finally {
      cleanup();
    }
  }));

  app.post("/api/projects/:projectId/sprints/:sprintId/plan", asyncRoute(async (req, res) => {
    if (!options.planSprint) {
      res.status(404).json({ error: "Sprint planning is not enabled." });
      return;
    }
    const ac = new AbortController();
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
    const optionsInput: PlanSprintOptions = parsePlanSprintOptions(req.body);
    const cleanup = trackPlanningRequest(optionsInput.clientRequestId, ac);
    try {
      sendJsonIfOpen(res, 202, await options.planSprint(projectId, sprintId, optionsInput, ac.signal));
    } finally {
      cleanup();
    }
  }));

  app.post("/api/planning-requests/:clientRequestId/cancel", asyncRoute(async (req, res) => {
    const clientRequestId = requireTrimmedString(req.params.clientRequestId, "clientRequestId");
    const controller = activePlanningRequests.get(clientRequestId);
    if (controller) {
      controller.abort("dashboard_cancel");
      activePlanningRequests.delete(clientRequestId);
    }
    res.status(202).json({ ok: true, cancelled: Boolean(controller) });
  }));
}
