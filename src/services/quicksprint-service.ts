import * as fs from "fs/promises";
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

  private async getQuicksprintsDir(projectId: string): Promise<string> {
    const baseDir = this.projectBaseDirResolver(projectId);
    const dir = path.join(baseDir, ".quicksprints");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async listTemplates(projectId: string): Promise<QuicksprintTemplateRecord[]> {
    try {
      const dir = await this.getQuicksprintsDir(projectId);
      const stat = await fs.stat(dir);
      const mtimeMs = stat.mtimeMs;

      const cached = this.templateCache.get(projectId);
      if (cached && cached.mtimeMs === mtimeMs) {
        return [...BUILTIN_QUICKSPRINT_TEMPLATES, ...cached.templates];
      }

      const customTemplates: QuicksprintTemplateRecord[] = [];
      const files = await fs.readdir(dir);
      for (const file of files) {
        if (file.endsWith(".json")) {
          const content = await fs.readFile(path.join(dir, file), "utf-8");
          customTemplates.push(JSON.parse(content));
        }
      }

      this.templateCache.set(projectId, { mtimeMs, templates: customTemplates });
      return [...BUILTIN_QUICKSPRINT_TEMPLATES, ...customTemplates];
    } catch (e) {
      return [...BUILTIN_QUICKSPRINT_TEMPLATES];
    }
  }

  async getTemplate(projectId: string, templateId: string): Promise<QuicksprintTemplateRecord | null> {
    const builtin = BUILTIN_QUICKSPRINT_TEMPLATES.find(t => t.id === templateId);
    if (builtin) return builtin;

    try {
      const dir = await this.getQuicksprintsDir(projectId);
      const filePath = path.join(dir, `${templateId}.json`);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        return JSON.parse(content);
      } catch {
        return null;
      }
    } catch (e) {
      // ignore
    }
    return null;
  }

  async createCustomTemplate(projectId: string, input: CreateQuicksprintTemplateInput): Promise<QuicksprintTemplateRecord> {
    const dir = await this.getQuicksprintsDir(projectId);
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

    await fs.writeFile(path.join(dir, `${template.id}.json`), JSON.stringify(template, null, 2));
    this.templateCache.delete(projectId);
    return template;
  }

  async updateCustomTemplate(projectId: string, templateId: string, input: UpdateQuicksprintTemplateInput): Promise<QuicksprintTemplateRecord> {
    if (BUILTIN_QUICKSPRINT_TEMPLATES.some(t => t.id === templateId)) {
      throw new Error("Cannot update built-in templates");
    }

    const dir = await this.getQuicksprintsDir(projectId);
    const filePath = path.join(dir, `${templateId}.json`);
    
    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new Error(`Template ${templateId} not found`);
    }

    const existing: QuicksprintTemplateRecord = JSON.parse(content);
    const updated: QuicksprintTemplateRecord = {
      ...existing,
      ...input,
      updatedAt: new Date().toISOString(),
    };

    await fs.writeFile(filePath, JSON.stringify(updated, null, 2));
    this.templateCache.delete(projectId);
    return updated;
  }

  async deleteCustomTemplate(projectId: string, templateId: string): Promise<void> {
    if (BUILTIN_QUICKSPRINT_TEMPLATES.some(t => t.id === templateId)) {
      throw new Error("Cannot delete built-in templates");
    }

    const dir = await this.getQuicksprintsDir(projectId);
    const filePath = path.join(dir, `${templateId}.json`);
    try {
      await fs.unlink(filePath);
    } catch {
      throw new Error(`Template ${templateId} not found`);
    }
    this.templateCache.delete(projectId);
  }

  async executeQuicksprint(projectId: string, input: QuicksprintExecutionInput, signal?: AbortSignal): Promise<SprintRecord> {
    const template = await this.getTemplate(projectId, input.templateId);
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

    await this.planSprint(projectId, sprint.id, {
      autoStart,
      replan: false,
      overrides: input.planningOverrides ?? (input.modelOverride ? { virtualModel: input.modelOverride } : undefined),
    }, signal);

    return sprint;
  }
}
