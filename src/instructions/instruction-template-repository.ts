import * as path from "path";
import { FileTemplateRepository } from "../infrastructure/repositories/file-template-repository.js";

const INSTRUCTION_DIR_CANDIDATES = ["instructions", "intructions"];
const INSTRUCTION_SEARCH_DIRS = INSTRUCTION_DIR_CANDIDATES.map((dirName) =>
  path.join(".jules-subagents", dirName)
);

export class InstructionRepository {
  private readonly fileTemplateRepository: FileTemplateRepository;

  constructor(projectRoot: string) {
    this.fileTemplateRepository = new FileTemplateRepository(projectRoot, INSTRUCTION_SEARCH_DIRS);
  }

  async loadInstruction(relativeInstructionPath: string, repoPath?: string): Promise<string> {
    try {
      return await this.fileTemplateRepository.loadFile(relativeInstructionPath, repoPath);
    } catch {
      throw new Error(`Instruction template not found: ${relativeInstructionPath}`);
    }
  }
}
