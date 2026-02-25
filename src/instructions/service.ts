import { DEFAULT_INSTRUCTION_TEMPLATES, INSTRUCTION_TEMPLATE_PATHS, type InstructionTemplateId } from "./catalog.js";
import { InstructionRepository } from "./repository.js";
import { renderTemplate, type TemplateVariables } from "./template-engine.js";

export class InstructionService {
  private readonly repository: InstructionRepository;

  constructor(projectRoot: string) {
    this.repository = new InstructionRepository(projectRoot);
  }

  async render(templateId: InstructionTemplateId, variables: TemplateVariables, repoPath?: string): Promise<string> {
    const relativePath = INSTRUCTION_TEMPLATE_PATHS[templateId];
    let template: string;

    try {
      template = await this.repository.loadInstruction(relativePath, repoPath);
    } catch {
      template = DEFAULT_INSTRUCTION_TEMPLATES[templateId];
    }

    return renderTemplate(template, variables);
  }
}
