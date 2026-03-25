import re

with open("src/server/dashboard-server.ts", "r") as f:
    content = f.read()

# Add imports
imports = """
import type {
  CreateQuicksprintTemplateInput,
  QuicksprintExecutionInput,
  QuicksprintTemplateRecord,
  UpdateQuicksprintTemplateInput,
} from "../contracts/quicksprint-types.js";
import type { QuicksprintService } from "../services/quicksprint-service.js";
"""

content = content.replace('import type {\n  AgentPresetRecord,', imports + 'import type {\n  AgentPresetRecord,')

# Add to DashboardServerOptions
options_add = """
  improveSprintPrompt?: (projectId: string, input: ImprovePromptInput, signal?: AbortSignal) => Promise<unknown>;
  planSprint?: (projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal) => Promise<unknown>;
  quicksprintService?: QuicksprintService;
"""
content = content.replace('  improveSprintPrompt?: (projectId: string, input: ImprovePromptInput, signal?: AbortSignal) => Promise<unknown>;\n  planSprint?: (projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal) => Promise<unknown>;', options_add)

# Add routes
routes_add = """
  app.post("/api/projects/:projectId/planning/improve-sprint-prompt", async (req, res) => {
"""

routes_new = """
  app.get("/api/projects/:projectId/quicksprints/templates", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      res.json(options.quicksprintService.listTemplates(projectId));
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to list quicksprint templates") });
    }
  });

  app.get("/api/projects/:projectId/quicksprints/templates/:templateId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const templateId = String(req.params.templateId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      const template = options.quicksprintService.getTemplate(projectId, templateId);
      if (!template) {
        res.status(404).json({ error: "Template not found" });
        return;
      }
      res.json(template);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to get quicksprint template") });
    }
  });

  app.post("/api/projects/:projectId/quicksprints/templates", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      const template = options.quicksprintService.createCustomTemplate(projectId, req.body as CreateQuicksprintTemplateInput);
      res.status(201).json(template);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to create custom quicksprint template") });
    }
  });

  app.patch("/api/projects/:projectId/quicksprints/templates/:templateId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const templateId = String(req.params.templateId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      const template = options.quicksprintService.updateCustomTemplate(projectId, templateId, req.body as UpdateQuicksprintTemplateInput);
      res.json(template);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to update custom quicksprint template") });
    }
  });

  app.delete("/api/projects/:projectId/quicksprints/templates/:templateId", (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      const templateId = String(req.params.templateId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      options.quicksprintService.deleteCustomTemplate(projectId, templateId);
      res.json({ ok: true });
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to delete custom quicksprint template") });
    }
  });

  app.post("/api/projects/:projectId/quicksprints/execute", async (req, res) => {
    try {
      const projectId = String(req.params.projectId || "").trim();
      if (!options.quicksprintService) {
        res.status(404).json({ error: "Quicksprint service is not enabled." });
        return;
      }
      const sprint = await options.quicksprintService.executeQuicksprint(projectId, req.body as QuicksprintExecutionInput);
      res.status(201).json(sprint);
    } catch (error) {
      res.status(400).json({ error: toErrorMessage(error, "Failed to execute quicksprint") });
    }
  });

  app.post("/api/projects/:projectId/planning/improve-sprint-prompt", async (req, res) => {
"""
content = content.replace(routes_add, routes_new)

with open("src/server/dashboard-server.ts", "w") as f:
    f.write(content)
