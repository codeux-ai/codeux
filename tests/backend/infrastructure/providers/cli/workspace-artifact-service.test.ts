import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { IWorkspaceManager, WorkspaceCommandOptions } from "../../../../../src/infrastructure/providers/cli/workspace-manager.js";
import { WorkspaceArtifactService } from "../../../../../src/infrastructure/providers/cli/workspace-artifact-service.js";
import { runCommandStrict } from "../../../../../src/services/cli-process-runner.js";

async function runGit(
  repoPath: string,
  args: string[],
  options: { trimOutput?: boolean } = {},
): Promise<string> {
  const result = await runCommandStrict("git", args, repoPath, process.env, {
    trimOutput: options.trimOutput,
  });
  return result.stdout;
}

describe("WorkspaceArtifactService", () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    await Promise.all(cleanupPaths.splice(0).map((target) => fs.rm(target, { recursive: true, force: true })));
  });

  it("preserves whitespace-sensitive diff output so exported patches still apply", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const hostRepoPath = path.join(tempRoot, "host-repo");
    const workspaceRepoPath = path.join(tempRoot, "workspace-repo");

    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, hostRepoPath], tempRoot);

    await runGit(hostRepoPath, ["config", "user.name", "Sprint OS Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "sprint-os@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "file.txt"), "hello\n", "utf8");
    await runGit(hostRepoPath, ["add", "file.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);

    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Sprint OS Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "sprint-os@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", "origin/main"]);
    await fs.writeFile(path.join(workspaceRepoPath, "file.txt"), "hello\n   \n", "utf8");

    const seenOptions: WorkspaceCommandOptions[] = [];
    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => {
        seenOptions.push(options);
        return await runCommandStrict(command, args, workspaceRepoPath, process.env, {
          trimOutput: options.trimOutput,
          signal: options.signal,
        });
      },
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);

    expect(seenOptions).toEqual([{ trimOutput: false }]);
    expect(patchText).toContain("+   \n");

    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "test patch apply",
    });

    expect(result.hasChanges).toBe(true);
    expect(result.commitSha).toBeTruthy();

    const branchFile = await runGit(
      hostRepoPath,
      ["show", `refs/heads/worker/test:file.txt`],
      { trimOutput: false },
    );
    expect(branchFile).toBe("hello\n   \n");
  });
});
