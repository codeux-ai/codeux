import * as fs from "fs/promises";
import * as path from "path";
import { buildSearchRoots } from "../../shared/config/search-paths.js";

export class FileTemplateRepository {
  constructor(
    private readonly projectRoot: string,
    private readonly relativeSearchDirectories: readonly string[],
  ) {}

  protected buildCandidatePaths(name: string, repoPath?: string): string[] {
    const roots = buildSearchRoots(this.projectRoot, repoPath);
    const candidatePaths = roots.flatMap((root) =>
      this.relativeSearchDirectories.map((relativeDirectory) => path.resolve(path.join(root, relativeDirectory, name))),
    );
    return [...new Set(candidatePaths)];
  }

  async loadFile(name: string, repoPath?: string): Promise<string> {
    for (const candidatePath of this.buildCandidatePaths(name, repoPath)) {
      try {
        await fs.access(candidatePath);
        return await fs.readFile(candidatePath, "utf-8");
      } catch {
        continue;
      }
    }

    throw new Error(`Template not found: ${name}`);
  }
}
