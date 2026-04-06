import type { Express } from "express";
import type { DashboardDependencies } from "./dashboard-server.js";
import { asyncRoute, syncRoute, requireTrimmedString } from "./route-utils.js";
import type {
  CreateQuicksprintTemplateInput,
  QuicksprintExecutionInput,
  UpdateQuicksprintTemplateInput,
} from "../contracts/quicksprint-types.js";

export function registerQuicksprintRoutes(router: Express, deps: DashboardDependencies): void {
  router.get("/api/projects/:projectId/quicksprints/templates", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    res.json(deps.quicksprintService.listTemplates(projectId));
  }));

  router.get("/api/projects/:projectId/quicksprints/templates/:templateId", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = deps.quicksprintService.getTemplate(projectId, templateId);
    if (!template) {
      res.status(404).json({ error: "Template not found" });
      return;
    }
    res.json(template);
  }));

  router.post("/api/projects/:projectId/quicksprints/templates", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = deps.quicksprintService.createCustomTemplate(projectId, req.body as CreateQuicksprintTemplateInput);
    res.status(201).json(template);
  }));

  router.patch("/api/projects/:projectId/quicksprints/templates/:templateId", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    const template = deps.quicksprintService.updateCustomTemplate(projectId, templateId, req.body as UpdateQuicksprintTemplateInput);
    res.json(template);
  }));

  router.delete("/api/projects/:projectId/quicksprints/templates/:templateId", syncRoute((req, res) => {
    const projectId = requireTrimmedString(req.params.projectId, "projectId");
    const templateId = requireTrimmedString(req.params.templateId, "templateId");
    if (!deps.quicksprintService) {
      res.status(404).json({ error: "Quicksprint service is not enabled." });
      return;
    }
    deps.quicksprintService.deleteCustomTemplate(projectId, templateId);
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
    const sprint = await deps.quicksprintService.executeQuicksprint(projectId, req.body as QuicksprintExecutionInput, ac.signal);
    res.status(201).json(sprint);
  }));
}
