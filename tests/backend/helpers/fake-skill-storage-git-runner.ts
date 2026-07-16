import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  SkillStorageGitResult,
  SkillStorageGitRunner,
} from "../../../src/services/skill-storage-version-control-service.js";

export class FakeSkillStorageGitRunner implements SkillStorageGitRunner {
  readonly calls: Array<{ args: string[]; cwd: string }> = [];
  private committedSnapshot: string | null = null;
  private revision = 0;
  private stagedSnapshot: string | null = null;

  async run(args: string[], cwd: string): Promise<SkillStorageGitResult> {
    this.calls.push({ args: [...args], cwd });
    if (args[0] === "init") {
      await fs.mkdir(path.join(cwd, ".git", "refs", "heads"), { recursive: true });
      await fs.writeFile(path.join(cwd, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    } else if (args[0] === "add") {
      this.stagedSnapshot = await this.readMaterializedSnapshot(cwd);
      await fs.writeFile(path.join(cwd, ".git", "index"), this.stagedSnapshot, "utf8");
    } else if (args[0] === "commit") {
      this.revision++;
      this.committedSnapshot = this.stagedSnapshot;
      await fs.writeFile(
        path.join(cwd, ".git", "refs", "heads", "main"),
        `${this.revision.toString(16).padStart(40, "0")}\n`,
        "utf8",
      );
    }
    const stdout = args[0] === "status"
      ? this.stagedSnapshot === this.committedSnapshot ? "" : "M storage.json"
      : args[0] === "rev-parse"
        ? this.revision.toString(16).padStart(40, "0")
        : "";
    return { stdout, stderr: "" };
  }

  private async readMaterializedSnapshot(cwd: string): Promise<string> {
    const storage = await fs.readFile(path.join(cwd, "storage.json"), "utf8");
    const skillsPath = path.join(cwd, "skills");
    const skillDirectories = await fs.readdir(skillsPath, { withFileTypes: true });
    const skills: string[] = [];
    for (const entry of skillDirectories.filter((candidate) => candidate.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      skills.push(entry.name, await fs.readFile(path.join(skillsPath, entry.name, "SKILL.md"), "utf8"));
    }
    return JSON.stringify({ storage, skills });
  }
}
