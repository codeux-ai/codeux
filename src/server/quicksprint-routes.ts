import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute } from "./route-utils.js";
import { requireTrimmedString } from "./request-parsers.js";
import type {
  CreateQuicksprintTemplateInput,
  QuicksprintExecutionInput,
  UpdateQuicksprintTemplateInput,
} from "../contracts/quicksprint-types.js";

function parseQuicksprintExecutionInput(body: unknown): QuicksprintExecutionInput {
  if (!body || typeof body !== "object") {
    throw new Error("Invalid input: body must be an object");
  }

  const input = body as Record<string, unknown>;
  const templateId = typeof input.templateId === "string" ? input.templateId.trim() : "";
  if (!templateId) {
    throw new Error("Missing or empty required field: templateId");
  }

  const taskCount = typeof input.taskCount === "number" && Number.isFinite(input.taskCount)
    ? Math.floor(input.taskCount)
    : undefined;
  if (taskCount === undefined || taskCount <= 0) {
    throw new Error("Missing or invalid required field: taskCount");
  }

  if (input.submitMode !== "plan_only" && input.submitMode !== "plan_and_start") {
    throw new Error("Invalid submitMode. Must be 'plan_only' or 'plan_and_start'.");
  }

  return {
    templateId,
    taskCount,
    submitMode: input.submitMode,
    routeOverride: typeof input.routeOverride === "string" ? input.routeOverride : undefined,
    modelOverride: typeof input.modelOverride === "string" ? input.modelOverride : undefined,
    agentPresetId: typeof input.agentPresetId === "string" ? input.agentPresetId : undefined,
    additionalPrompt: typeof input.additionalPrompt === "string" ? input.additionalPrompt : undefined,
    planningOverrides: input.planningOverrides && typeof input.planningOverrides === "object"
      ? input.planningOverrides as QuicksprintExecutionInput["planningOverrides"]
      : undefined,
  };
}

export function registerQuicksprintRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/quicksprints/templates", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const templates = await deps.quicksprintService.listTemplates(projectId);
    res.json(templates);
  }));

  router.get("/api/projects/:projectId/quicksprints/templates/:templateId", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = await deps.quicksprintService.getTemplate(projectId, templateId);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  }));

  router.post("/api/projects/:projectId/quicksprints/templates", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = await deps.quicksprintService.createCustomTemplate(projectId, req.body as CreateQuicksprintTemplateInput);
    res.status(201).json(template);
  }));

  router.patch("/api/projects/:projectId/quicksprints/templates/:templateId", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = await deps.quicksprintService.updateCustomTemplate(projectId, templateId, req.body as UpdateQuicksprintTemplateInput);
    res.json(template);
  }));

  router.delete("/api/projects/:projectId/quicksprints/templates/:templateId", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    await deps.quicksprintService.deleteCustomTemplate(projectId, templateId);
    res.json({ ok: true });
  }));

  router.post("/api/projects/:projectId/quicksprints/execute", asyncRoute(async (req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableFinished) ac.abort(); });
    const sprint = await deps.quicksprintService.executeQuicksprint(projectId, parseQuicksprintExecutionInput(req.body), ac.signal);
    res.status(201).json(sprint);
  }));
}
