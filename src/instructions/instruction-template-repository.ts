import * as fs from "fs/promises";
import os from "os";
import * as path from "path";

const INSTRUCTION_DIR_CANDIDATES = ["instructions", "intructions"];

export class InstructionRepository {
  constructor(private readonly projectRoot: string) {}

  private buildBaseSearchRoots(repoPath?: string): string[] {
    const roots = [process.cwd(), this.projectRoot, os.homedir()];
    if (repoPath && repoPath.trim().length > 0) {
      roots.unshift(repoPath);
    }
    return [...new Set(roots)];
  }

  private buildCandidatePaths(relativeInstructionPath: string, repoPath?: string): string[] {
    const roots = this.buildBaseSearchRoots(repoPath);
    const paths: string[] = [];

    for (const root of roots) {
      for (const dirName of INSTRUCTION_DIR_CANDIDATES) {
        paths.push(path.join(root, ".jules-subagents", dirName, relativeInstructionPath));
      }
    }

    return paths;
  }

  async loadInstruction(relativeInstructionPath: string, repoPath?: string): Promise<string> {
    for (const candidatePath of this.buildCandidatePaths(relativeInstructionPath, repoPath)) {
      try {
        await fs.access(candidatePath);
        return await fs.readFile(candidatePath, "utf-8");
      } catch {
        continue;
      }
    }

    throw new Error(`Instruction template not found: ${relativeInstructionPath}`);
  }
}
