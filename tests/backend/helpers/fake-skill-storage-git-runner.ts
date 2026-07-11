import * as fs from "node:fs/promises";
import * as path from "node:path";
import type {
  SkillStorageGitResult,
  SkillStorageGitRunner,
} from "../../../src/services/skill-storage-version-control-service.js";

export class FakeSkillStorageGitRunner implements SkillStorageGitRunner {
  readonly calls: Array<{ args: string[]; cwd: string }> = [];
  private revision = 0;

  async run(args: string[], cwd: string): Promise<SkillStorageGitResult> {
    this.calls.push({ args: [...args], cwd });
    if (args[0] === "init") {
      await fs.mkdir(path.join(cwd, ".git"), { recursive: true });
    } else if (args[0] === "commit") {
      this.revision++;
    }
    const stdout = args[0] === "status"
      ? "M storage.json"
      : args[0] === "rev-parse"
        ? this.revision.toString(16).padStart(40, "0")
        : "";
    return { stdout, stderr: "" };
  }
}
