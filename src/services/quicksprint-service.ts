import * as fs from "fs";
import * as path from "path";
import { randomUUID } from "crypto";
import type {
  CreateQuicksprintTemplateInput,
  QuicksprintExecutionInput,
  QuicksprintTemplateRecord,
  UpdateQuicksprintTemplateInput
} from "../contracts/quicksprint-types.js";
import { BUILTIN_QUICKSPRINT_TEMPLATES } from "../domain/quicksprint/quicksprint-catalog.js";
import type { CreateSprintInput, PlanSprintOptions, SprintRecord } from "../contracts/project-management-types.js";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";

export class QuicksprintService {
  private templateCache: Map<string, { mtimeMs: number; templates: QuicksprintTemplateRecord[] }> = new Map();

  constructor(
    private readonly projectBaseDirResolver: (projectId: string) => string,
    private readonly createSprint: (projectId: string, input: CreateSprintInput) => SprintRecord,
    private readonly planSprint: (projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal) => Promise<unknown>,
    private readonly resolveAgentPreset?: (agentPresetId: string) => AgentPresetRecord | null,
  ) {}

  private getQuicksprintsDir(projectId: string): string {
    const baseDir = this.projectBaseDirResolver(projectId);
    const dir = path.join(baseDir, ".quicksprints");
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  }

  listTemplates(projectId: string): QuicksprintTemplateRecord[] {
    try {
      const dir = this.getQuicksprintsDir(projectId);
      const stat = fs.statSync(dir);
      const mtimeMs = stat.mtimeMs;

      const cached = this.templateCache.get(projectId);
      if (cached && cached.mtimeMs === mtimeMs) {
        return [...BUILTIN_QUICKSPRINT_TEMPLATES, ...cached.templates];
      }

      const customTemplates: QuicksprintTemplateRecord[] = [];
      const files = fs.readdirSync(dir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = fs.readFileSync(path.join(dir, file), "utf-8");
          customTemplates.push(JSON.parse(content));
        }
      }

      this.templateCache.set(projectId, { mtimeMs, templates: customTemplates });
      return [...BUILTIN_QUICKSPRINT_TEMPLATES, ...customTemplates];
    } catch (e) {
      return [...BUILTIN_QUICKSPRINT_TEMPLATES];
    }
  }

  getTemplate(projectId: string, templateId: string): QuicksprintTemplateRecord | null {
    const builtin = BUILTIN_QUICKSPRINT_TEMPLATES.find(t => t.id === templateId);
    if (builtin) return builtin;

    try {
      const dir = this.getQuicksprintsDir(projectId);
      const filePath = path.join(dir, `${templateId}.json`);
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, "utf-8"));
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  createCustomTemplate(projectId: string, input: CreateQuicksprintTemplateInput): QuicksprintTemplateRecord {
    const dir = this.getQuicksprintsDir(projectId);
    const now = new Date().toISOString();
    const template: QuicksprintTemplateRecord = {
      ...input,
      id: `qs-custom-${randomUUID()}`,
      projectId,
      isBuiltIn: false,
      defaultTaskCount: input.defaultTaskCount || 5,
      createdAt: now,
      updatedAt: now,
    };

    fs.writeFileSync(path.join(dir, `${template.id}.json`), JSON.stringify(template, null, 2));
    this.templateCache.delete(projectId);
    return template;
  }

  updateCustomTemplate(projectId: string, templateId: string, input: UpdateQuicksprintTemplateInput): QuicksprintTemplateRecord {
    if (BUILTIN_QUICKSPRINT_TEMPLATES.some(t => t.id === templateId)) {
      throw new Error("Cannot update built-in templates");
    }

    const dir = this.getQuicksprintsDir(projectId);
    const filePath = path.join(dir, `${templateId}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Template ${templateId} not found`);
    }

    const existing: QuicksprintTemplateRecord = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const updated: QuicksprintTemplateRecord = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    fs.writeFileSync(filePath, JSON.stringify(updated, null, 2));
    this.templateCache.delete(projectId);
    return updated;
  }

  deleteCustomTemplate(projectId: string, templateId: string): void {
    if (BUILTIN_QUICKSPRINT_TEMPLATES.some(t => t.id === templateId)) {
      throw new Error("Cannot delete built-in templates");
    }

    const dir = this.getQuicksprintsDir(projectId);
    const filePath = path.join(dir, `${templateId}.json`);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Template ${templateId} not found`);
    }

    fs.unlinkSync(filePath);
    this.templateCache.delete(projectId);
  }

  async executeQuicksprint(projectId: string, input: QuicksprintExecutionInput, signal?: AbortSignal): Promise<SprintRecord> {
    const template = this.getTemplate(projectId, input.templateId);
    if (!template) {
      throw new Error(`Template ${input.templateId} not found`);
    }

    let agentContext = "";
    const effectiveAgentPresetId = input.agentPresetId || template.agentPresetId;
    if (effectiveAgentPresetId && this.resolveAgentPreset) {
      const agent = this.resolveAgentPreset(effectiveAgentPresetId);
      if (agent?.instructionMarkdown) {
        agentContext = `## Agent Context\n\nYou are operating as the "${agent.name}" agent. Follow these agent-specific instructions:\n\n${agent.instructionMarkdown}\n\n---\n\n`;
      }
    }

    const additionalContext = input.additionalPrompt
      ? `\n\n## Additional Instructions\n\n${input.additionalPrompt}`
      : "";

    const sprintName = `QS: ${template.name}`;
    const sprintGoal = `${agentContext}${template.agentInstructionMarkdown}${additionalContext}\n\nProduce exactly ${input.taskCount} subtasks.`;

    const sprint = this.createSprint(projectId, {
      name: sprintName,
      goal: sprintGoal,
      showcasePinned: true,
    });

    const autoStart = input.submitMode === "plan_and_start";

    // We orchestrate the plan request but don't strictly await it if it's meant to be fire-and-forget,
    // though the prompt implies we return the created sprint.
    // Dashboard router returns accepted (202) for plan Sprint, and returns the plan ID/response.
    // Let's call planSprint.
    await this.planSprint(projectId, sprint.id, {
      autoStart,
      replan: false,
      overrides: input.planningOverrides ?? (input.modelOverride ? { virtualModel: input.modelOverride } : undefined),
    }, signal);

    return sprint;
  }
}
