import * as path from "path";
import { FileTemplateRepository } from "../infrastructure/repositories/file-template-repository.js";

export class GuideRepository {
  private readonly repository: FileTemplateRepository;

  constructor(projectRoot: string) {
    this.repository = new FileTemplateRepository(projectRoot, [path.join(".jules-subagents", "agents")]);
  }

  async getGuideContent(guideName: string, repoPath?: string): Promise<string> {
    try {
      return await this.repository.loadFile(guideName, repoPath);
    } catch {
      throw new Error(`Guide not found: ${guideName}`);
    }
  }
}
