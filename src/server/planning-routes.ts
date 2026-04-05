import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, requireTrimmedString, parseImprovePromptInput, parsePlanSprintOptions } from "./route-utils.js";
import type {
  ImprovePromptInput,
  PlanSprintOptions,
} from "../contracts/project-management-types.js";

export function registerPlanningRoutes(app: Express, options: DashboardDependencies): void {
  app.post("/api/projects/:projectId/planning/improve-sprint-prompt", asyncRoute(async (req, res) => {
    if (!options.improveSprintPrompt) {
      res.status(404).json({ error: "Sprint prompt improvement is not enabled." });
      return;
    }
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const input: ImprovePromptInput = parseImprovePromptInput(req.body);
    res.status(202).json(await options.improveSprintPrompt(projectId, input, ac.signal));
  }));

  app.post("/api/projects/:projectId/sprints/:sprintId/plan", asyncRoute(async (req, res) => {
    if (!options.planSprint) {
      res.status(404).json({ error: "Sprint planning is not enabled." });
      return;
    }
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const sprintId = requireTrimmedString(req.params.sprintId, "sprintId");
    const optionsInput: PlanSprintOptions = parsePlanSprintOptions(req.body);
    res.status(202).json(await options.planSprint(projectId, sprintId, optionsInput, ac.signal));
  }));
}
