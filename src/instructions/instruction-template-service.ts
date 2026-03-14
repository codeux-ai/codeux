import { DEFAULT_INSTRUCTION_TEMPLATES, type InstructionTemplateId } from "./instruction-template-catalog.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import { renderTemplate, type TemplateVariables } from "./instruction-template-renderer.js";

interface InstructionServiceDeps {
  settingsRepository: SettingsRepository;
  projectManagementRepository: ProjectManagementRepository;
}

export class InstructionService {
  constructor(private readonly deps: InstructionServiceDeps) {}

  async render(templateId: InstructionTemplateId, variables: TemplateVariables, repoPath?: string): Promise<string> {
    const template = this.resolveTemplate(templateId, repoPath);
    return renderTemplate(template, variables);
  }

  private resolveTemplate(templateId: InstructionTemplateId, repoPath?: string): string {
    const normalizedRepoPath = repoPath?.trim() ? repoPath.trim() : undefined;
    if (!normalizedRepoPath) {
      return this.deps.settingsRepository.getSystemSettings().defaults.agents.instructionTemplates[templateId]
        || DEFAULT_INSTRUCTION_TEMPLATES[templateId];
    }

    const project = this.deps.projectManagementRepository.findProjectByBaseDir(normalizedRepoPath);
    if (!project) {
      return this.deps.settingsRepository.getSystemSettings().defaults.agents.instructionTemplates[templateId]
        || DEFAULT_INSTRUCTION_TEMPLATES[templateId];
    }

    return this.deps.settingsRepository.getProjectResolvedSettings(project.id).agents.instructionTemplates[templateId]
      || DEFAULT_INSTRUCTION_TEMPLATES[templateId];
  }
}
