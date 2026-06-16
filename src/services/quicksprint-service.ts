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
import { formatQuicksprintTemplateMarkdown, parseQuicksprintTemplateMarkdown } from "../domain/quicksprint/quicksprint-template-markdown.js";
import type { CreateSprintInput, PlanSprintOptions, SprintRecord } from "../contracts/project-management-types.js";
import type { AgentPresetRecord } from "../contracts/agent-preset-types.js";
import { getHomeCodeUxPath, getRepoCodeUxPath } from "../shared/config/code-ux-paths.js";
import { ensureDefaultCodeUxAssetsInstalled } from "./code-ux-default-assets-service.js";
import type { Logger } from "../shared/logging/logger.js";

interface QuicksprintServiceOptions {
  projectRoot?: string;
  logger?: Pick<Logger, "info" | "warn">;
}

type QuicksprintTemplateSourceScope = "project" | "home" | "default" | "fallback";

interface TemplateDirectory {
  directory: string;
  sourceScope: QuicksprintTemplateSourceScope;
  isBuiltIn: boolean;
  projectId: string | null;
  ensure?: boolean;
}

interface TemplateCacheEntry {
  signature: string;
  templates: QuicksprintTemplateRecord[];
}

export class QuicksprintService {
  private templateCache: Map<string, TemplateCacheEntry> = new Map();

  constructor(
    private readonly projectBaseDirResolver: (projectId: string) => string,
    private readonly createSprint: (projectId: string, input: CreateSprintInput) => SprintRecord,
    private readonly planSprint: (projectId: string, sprintId: string, options: PlanSprintOptions, signal?: AbortSignal) => Promise<unknown>,
    private readonly resolveAgentPreset?: (agentPresetId: string) => AgentPresetRecord | null,
    private readonly options: QuicksprintServiceOptions = {},
  ) {}

  private async getQuicksprintsDir(projectId: string): Promise<string> {
    const baseDir = this.projectBaseDirResolver(projectId);
    const dir = getRepoCodeUxPath(baseDir, "quicksprints", "templates");
    await fs.mkdir(dir, { recursive: true });
    return dir;
  }

  async listTemplates(projectId: string): Promise<QuicksprintTemplateRecord[]> {
    const directories = await this.resolveTemplateDirectories(projectId);
    const signature = await this.buildTemplateCacheSignature(directories);

    const cached = this.templateCache.get(projectId);
    if (cached && cached.signature === signature) {
      return cached.templates;
    }

    const templatesById = new Map<string, QuicksprintTemplateRecord>();

    for (const directory of directories) {
      const templates = await this.readTemplatesFromDirectory(directory);
      for (const template of templates) {
        if (!templatesById.has(template.id)) {
          templatesById.set(template.id, template);
        }
      }
    }

    for (const fallbackTemplate of this.fallbackBuiltInTemplates()) {
      if (!templatesById.has(fallbackTemplate.id)) {
        templatesById.set(fallbackTemplate.id, fallbackTemplate);
      }
    }

    const templates = Array.from(templatesById.values());
    this.templateCache.set(projectId, { signature, templates });
    return templates;
  }

  async getTemplate(projectId: string, templateId: string): Promise<QuicksprintTemplateRecord | null> {
    const templates = await this.listTemplates(projectId);
    return templates.find(t => t.id === templateId) || null;
  }

  private async resolveTemplateDirectories(projectId: string): Promise<TemplateDirectory[]> {
    const projectTemplateDir = await this.getQuicksprintsDir(projectId);
    const directories: TemplateDirectory[] = [
      { directory: projectTemplateDir, sourceScope: "project", isBuiltIn: false, projectId, ensure: true },
    ];

    if (this.options.projectRoot) {
      await ensureDefaultCodeUxAssetsInstalled({
        projectRoot: this.options.projectRoot,
        logger: this.options.logger,
      });
      directories.push(
        { directory: getHomeCodeUxPath("quicksprints", "templates"), sourceScope: "home", isBuiltIn: true, projectId: null },
        { directory: getRepoCodeUxPath(this.options.projectRoot, "quicksprints", "templates"), sourceScope: "default", isBuiltIn: true, projectId: null },
      );
    }

    return directories;
  }

  private async buildTemplateCacheSignature(directories: TemplateDirectory[]): Promise<string> {
    const parts: string[] = [];
    for (const directory of directories) {
      const stat = await fs.stat(directory.directory).catch(() => null);
      const files = await fs.readdir(directory.directory).catch(() => []);
      const fileParts: string[] = [];
      for (const file of files.filter((entry) => this.isTemplateFile(entry)).sort()) {
        const fileStat = await fs.stat(path.join(directory.directory, file)).catch(() => null);
        fileParts.push(`${file}:${fileStat?.mtimeMs ?? "missing"}`);
      }
      parts.push(`${directory.sourceScope}:${directory.directory}:${stat?.mtimeMs ?? "missing"}:${fileParts.join(",")}`);
    }
    return parts.join("|");
  }

  private async readTemplatesFromDirectory(source: TemplateDirectory): Promise<QuicksprintTemplateRecord[]> {
    if (source.ensure) {
      await fs.mkdir(source.directory, { recursive: true }).catch(() => undefined);
    }

    const files = await fs.readdir(source.directory).catch(() => []);
    const templates: QuicksprintTemplateRecord[] = [];

    for (const file of files.filter((entry) => this.isTemplateFile(entry)).sort()) {
      const filePath = path.join(source.directory, file);
      try {
        const content = await fs.readFile(filePath, "utf-8");
        const parsed = parseQuicksprintTemplateMarkdown(content);
        const raw = parsed.metadata;
        const template = await this.normalizeTemplate(raw, {
          filePath,
          fallbackId: this.stripTemplateExtension(file),
          agentInstructionMarkdown: parsed.agentInstructionMarkdown,
          source,
        });
        if (template) {
          templates.push(template);
        }
      } catch {
        // Ignore malformed template files so one bad custom template does not hide the catalog.
      }
    }

    return templates;
  }

  private async normalizeTemplate(raw: Partial<QuicksprintTemplateRecord>, args: {
    filePath: string;
    fallbackId: string;
    agentInstructionMarkdown: string;
    source: TemplateDirectory;
  }): Promise<QuicksprintTemplateRecord | null> {
    const id = typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : args.fallbackId;
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    const agentInstructionMarkdown = args.agentInstructionMarkdown.trim();
    if (!id || !name || !agentInstructionMarkdown) {
      return null;
    }

    const stat = await fs.stat(args.filePath).catch(() => null);
    const timestamp = stat?.mtimeMs ? new Date(stat.mtimeMs).toISOString() : new Date().toISOString();

    return {
      id,
      projectId: args.source.projectId,
      name,
      description: typeof raw.description === "string" ? raw.description : "",
      icon: typeof raw.icon === "string" && raw.icon.trim() ? raw.icon : "Sparkles",
      category: typeof raw.category === "string" && raw.category.trim() ? raw.category : "engineering",
      categoryColor: typeof raw.categoryColor === "string" ? raw.categoryColor : undefined,
      agentInstructionMarkdown,
      defaultTaskCount: typeof raw.defaultTaskCount === "number" && Number.isFinite(raw.defaultTaskCount) && raw.defaultTaskCount > 0
        ? raw.defaultTaskCount
        : 5,
      isBuiltIn: args.source.isBuiltIn,
      agentPresetId: typeof raw.agentPresetId === "string" ? raw.agentPresetId : undefined,
      purpose: typeof raw.purpose === "string" ? raw.purpose : undefined,
      purposeLabel: typeof raw.purposeLabel === "string" ? raw.purposeLabel : undefined,
      purposeDescription: typeof raw.purposeDescription === "string" ? raw.purposeDescription : undefined,
      createdAt: typeof raw.createdAt === "string" ? raw.createdAt : timestamp,
      updatedAt: timestamp,
    };
  }

  private fallbackBuiltInTemplates(): QuicksprintTemplateRecord[] {
    return BUILTIN_QUICKSPRINT_TEMPLATES.map((template) => ({
      ...template,
      projectId: null,
      isBuiltIn: true,
    }));
  }

  private isTemplateFile(fileName: string): boolean {
    return fileName.toLowerCase().endsWith(".md");
  }

  private stripTemplateExtension(fileName: string): string {
    return fileName.replace(/\.md$/i, "");
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

    await fs.writeFile(path.join(dir, `${template.id}.md`), formatQuicksprintTemplateMarkdown(template), "utf8");
    this.templateCache.delete(projectId);
    return template;
  }

  async updateCustomTemplate(projectId: string, templateId: string, input: UpdateQuicksprintTemplateInput): Promise<QuicksprintTemplateRecord> {
    const existing = await this.getTemplate(projectId, templateId);
    if (existing?.isBuiltIn) {
      throw new Error("Cannot update built-in templates");
    }

    const dir = await this.getQuicksprintsDir(projectId);
    const filePath = path.join(dir, `${templateId}.md`);
    if (!existing) {
      throw new Error(`Template ${templateId} not found`);
    }

    const updated: QuicksprintTemplateRecord = {
      ...existing,
      ...input,
      projectId,
      isBuiltIn: false,
      updatedAt: new Date().toISOString(),
    };

    await fs.writeFile(filePath, formatQuicksprintTemplateMarkdown(updated), "utf8");
    this.templateCache.delete(projectId);
    return updated;
  }

  async deleteCustomTemplate(projectId: string, templateId: string): Promise<void> {
    const existing = await this.getTemplate(projectId, templateId);
    if (existing?.isBuiltIn) {
      throw new Error("Cannot delete built-in templates");
    }

    const dir = await this.getQuicksprintsDir(projectId);
    const filePath = path.join(dir, `${templateId}.md`);
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
