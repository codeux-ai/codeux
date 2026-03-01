import * as fs from "fs/promises";
import * as path from "path";
import os from "os";

export class GuideRepository {
  constructor(private readonly projectRoot: string) {}

  private getSearchPaths(relativePath: string): string[] {
    const paths = [
      path.join(process.cwd(), relativePath),
      path.join(this.projectRoot, relativePath),
      path.join(os.homedir(), relativePath),
    ];
    return [...new Set(paths)];
  }

  async getGuideContent(guideName: string, repoPath?: string): Promise<string> {
    const relativePath = path.join(".jules-subagents", "agents", guideName);
    let searchPaths = this.getSearchPaths(relativePath);

    if (repoPath) {
      const repoScopedPath = path.join(repoPath, relativePath);
      if (!searchPaths.includes(repoScopedPath)) {
        searchPaths.unshift(repoScopedPath);
      }
    }

    for (const searchPath of searchPaths) {
      try {
        await fs.access(searchPath);
        return await fs.readFile(searchPath, "utf-8");
      } catch {
        continue;
      }
    }

    throw new Error(`Guide not found: ${guideName}`);
  }
}
