import * as path from "path";
import { FileTemplateRepository } from "../infrastructure/repositories/file-template-repository.js";

const GUIDE_SEARCH_DIRS = [path.join(".jules-subagents", "agents")];

export class GuideRepository {
  private readonly fileTemplateRepository: FileTemplateRepository;

  constructor(projectRoot: string) {
    this.fileTemplateRepository = new FileTemplateRepository(projectRoot, GUIDE_SEARCH_DIRS);
  }

  async getGuideContent(guideName: string, repoPath?: string): Promise<string> {
    try {
      return await this.fileTemplateRepository.loadFile(guideName, repoPath);
    } catch {
      throw new Error(`Guide not found: ${guideName}`);
    }
  }
}
