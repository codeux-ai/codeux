import * as fs from "fs/promises";
import * as path from "path";
import { buildSearchRoots } from "../../shared/config/search-paths.js";

export class FileTemplateRepository {
  constructor(
    private readonly projectRoot: string,
    private readonly relativeSearchDirs: readonly string[]
  ) {}

  private buildCandidatePaths(name: string, repoPath?: string): string[] {
    const roots = buildSearchRoots(this.projectRoot, repoPath);
    const candidatePaths: string[] = [];

    for (const root of roots) {
      for (const relativeSearchDir of this.relativeSearchDirs) {
        candidatePaths.push(path.resolve(path.join(root, relativeSearchDir, name)));
      }
    }

    return [...new Set(candidatePaths)];
  }

  async loadFile(name: string, repoPath?: string): Promise<string> {
    for (const candidatePath of this.buildCandidatePaths(name, repoPath)) {
      try {
        return await fs.readFile(candidatePath, "utf-8");
      } catch {
        continue;
      }
    }

    throw new Error(`Template file not found: ${name}`);
  }
}
