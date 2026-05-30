import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceManager } from "../../../src/infrastructure/providers/cli/workspace-manager.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

const git = async (cwd: string, args: string[]) => runCommandStrict("git", args, cwd);

describe("WorkspaceManager", () => {
  it("starts a new worker workspace from the existing remote worker branch when available", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-workspace-manager-"));
    tempDirs.push(root);
    const originPath = path.join(root, "origin.git");
    const repoPath = path.join(root, "repo");
    const worktreePath = path.join(root, "worker");

    await git(root, ["init", "--bare", originPath]);
    await git(root, ["clone", originPath, repoPath]);
    await git(repoPath, ["config", "user.name", "Test User"]);
    await git(repoPath, ["config", "user.email", "test@example.com"]);
    await fs.writeFile(path.join(repoPath, "file.txt"), "main\n", "utf8");
    await git(repoPath, ["add", "file.txt"]);
    await git(repoPath, ["commit", "-m", "initial"]);
    await git(repoPath, ["branch", "-M", "main"]);
    await git(repoPath, ["push", "-u", "origin", "main"]);

    await git(repoPath, ["checkout", "-b", "feature/sprint-1"]);
    await fs.writeFile(path.join(repoPath, "file.txt"), "feature\n", "utf8");
    await git(repoPath, ["commit", "-am", "feature"]);
    await git(repoPath, ["push", "-u", "origin", "feature/sprint-1"]);

    await git(repoPath, ["checkout", "-b", "task/feature-sprint-1-t1-qwen"]);
    await fs.writeFile(path.join(repoPath, "file.txt"), "worker\n", "utf8");
    await git(repoPath, ["commit", "-am", "worker"]);
    await git(repoPath, ["push", "-u", "origin", "task/feature-sprint-1-t1-qwen"]);
    const remoteWorkerHead = (await git(repoPath, ["rev-parse", "origin/task/feature-sprint-1-t1-qwen"])).stdout.trim();

    await git(repoPath, ["checkout", "main"]);
    await git(repoPath, ["branch", "-D", "task/feature-sprint-1-t1-qwen"]);

    const manager = new WorkspaceManager();
    await manager.prepareWorktree(
      repoPath,
      worktreePath,
      "task/feature-sprint-1-t1-qwen",
      "feature/sprint-1",
    );

    const workspaceHead = (await git(worktreePath, ["rev-parse", "HEAD"])).stdout.trim();
    const workspaceContent = await fs.readFile(path.join(worktreePath, "file.txt"), "utf8");
    expect(workspaceHead).toBe(remoteWorkerHead);
    expect(workspaceContent).toBe("worker\n");
  });
});
