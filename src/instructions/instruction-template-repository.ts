import * as path from "path";
import { FileTemplateRepository } from "../infrastructure/repositories/file-template-repository.js";

const INSTRUCTION_DIR_CANDIDATES = [
  path.join(".jules-subagents", "instructions"),
  path.join(".jules-subagents", "intructions"),
];

export class InstructionRepository {
  private readonly repository: FileTemplateRepository;

  constructor(projectRoot: string) {
    this.repository = new FileTemplateRepository(projectRoot, INSTRUCTION_DIR_CANDIDATES);
  }

  async loadInstruction(relativeInstructionPath: string, repoPath?: string): Promise<string> {
    const normalizedRepoPath = repoPath?.trim() ? repoPath : undefined;

    try {
      return await this.repository.loadFile(relativeInstructionPath, normalizedRepoPath);
    } catch {
      throw new Error(`Instruction template not found: ${relativeInstructionPath}`);
    }
  }
}
