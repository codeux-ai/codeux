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

    await runGit(hostRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "file.txt"), "hello\n", "utf8");
    await runGit(hostRepoPath, ["add", "file.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);

    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
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

    expect(seenOptions).toEqual([{ trimOutput: false }, { trimOutput: false }]);
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

  it("exports untracked workspace files while excluding transient and runtime-home files", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const hostRepoPath = path.join(tempRoot, "host-repo");
    const workspaceRepoPath = path.join(tempRoot, "workspace-repo");

    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, hostRepoPath], tempRoot);

    await runGit(hostRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "existing.txt"), "hello\n", "utf8");
    await runGit(hostRepoPath, ["add", "existing.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);

    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", "origin/main"]);
    await fs.mkdir(path.join(workspaceRepoPath, ".code-ux-home", ".gemini"), { recursive: true });
    await fs.mkdir(path.join(workspaceRepoPath, ".code-ux-home", ".cache", "node-gyp"), { recursive: true });
    await fs.writeFile(path.join(workspaceRepoPath, ".code-ux-home", ".gemini", "settings.json"), "{}\n", "utf8");
    await runGit(workspaceRepoPath, ["add", ".code-ux-home/.gemini/settings.json"]);
    await runGit(workspaceRepoPath, ["commit", "-m", "provider runtime state"]);
    await fs.writeFile(
      path.join(workspaceRepoPath, ".code-ux-home", ".cache", "node-gyp", "header.h"),
      "#define RUNTIME_CACHE 1\n",
      "utf8",
    );
    await fs.writeFile(path.join(workspaceRepoPath, "new-component.tsx"), "export const value = 1;\n", "utf8");
    await fs.writeFile(path.join(workspaceRepoPath, ".task-learnings.md"), "## Category: learning\n- Do not commit this file.\n", "utf8");
    await fs.mkdir(path.join(workspaceRepoPath, "logs", "openai"), { recursive: true });
    await fs.writeFile(path.join(workspaceRepoPath, "logs", "openai", "openai-123.json"), "{}", "utf8");
    await fs.writeFile(path.join(workspaceRepoPath, "logs", "openai", "request.log"), "log", "utf8");

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);

    expect(patchText).toContain("diff --git a/new-component.tsx b/new-component.tsx");
    expect(patchText).not.toContain(".task-learnings.md");
    expect(patchText).not.toContain(".code-ux-home");
    expect(patchText).not.toContain("logs/openai");

    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "test untracked export",
    });

    expect(result.hasChanges).toBe(true);
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:new-component.tsx"], { trimOutput: false }))
      .toBe("export const value = 1;\n");
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:.task-learnings.md"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:.code-ux-home/.gemini/settings.json"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:.code-ux-home/.cache/node-gyp/header.h"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:logs/openai/openai-123.json"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:logs/openai/request.log"]))
      .rejects.toThrow();
  });

  it("can preserve an additional merge parent when applying a resolved merge patch", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const hostRepoPath = path.join(tempRoot, "host-repo");
    const workspaceRepoPath = path.join(tempRoot, "workspace-repo");

    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, hostRepoPath], tempRoot);

    await runGit(hostRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "file.txt"), "base\n", "utf8");
    await runGit(hostRepoPath, ["add", "file.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);

    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runGit(hostRepoPath, ["checkout", "-b", "target", baseRef]);
    await fs.writeFile(path.join(hostRepoPath, "target.txt"), "target\n", "utf8");
    await runGit(hostRepoPath, ["add", "target.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "target"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "target"]);
    const targetRef = (await runGit(hostRepoPath, ["rev-parse", "origin/target"])).trim();

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", baseRef]);
    await fs.writeFile(path.join(workspaceRepoPath, "file.txt"), "base\nworker\n", "utf8");

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "test merge parent",
      parentRefs: ["origin/target"],
    });

    expect(result.hasChanges).toBe(true);
    const parents = (await runGit(hostRepoPath, ["show", "-s", "--format=%P", result.commitSha!])).trim().split(" ");
    expect(parents).toEqual([baseRef, targetRef]);
  });

  it("records and pushes a merge commit when the conflict is resolved by keeping the source side (empty diff)", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const hostRepoPath = path.join(tempRoot, "host-repo");

    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, hostRepoPath], tempRoot);

    await runGit(hostRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "test.md"), "Original\n", "utf8");
    await runGit(hostRepoPath, ["add", "test.md"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);
    const baseMain = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    // Target branch changes the same line ("Conflict Value C").
    await runGit(hostRepoPath, ["checkout", "-b", "target", baseMain]);
    await fs.writeFile(path.join(hostRepoPath, "test.md"), "Conflict Value C\n", "utf8");
    await runGit(hostRepoPath, ["add", "test.md"]);
    await runGit(hostRepoPath, ["commit", "-m", "target change"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "target"]);
    const targetRef = (await runGit(hostRepoPath, ["rev-parse", "origin/target"])).trim();

    // Source (worker) branch changes the same line ("Conflict Value B").
    await runGit(hostRepoPath, ["checkout", "-b", "worker/test", baseMain]);
    await fs.writeFile(path.join(hostRepoPath, "test.md"), "Conflict Value B\n", "utf8");
    await runGit(hostRepoPath, ["add", "test.md"]);
    await runGit(hostRepoPath, ["commit", "-m", "worker change"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "worker/test"]);
    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    // Sanity: the target is not yet contained in the source branch.
    await expect(
      runGit(hostRepoPath, ["merge-base", "--is-ancestor", "origin/target", "refs/heads/worker/test"]),
    ).rejects.toThrow();

    const service = new WorkspaceArtifactService({} as IWorkspaceManager);

    // The worker resolved the conflict by keeping the source side, so the resolved tree is
    // identical to the source tip and the exported patch is empty.
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText: "",
      commitMessage: "fix(merge): resolve target into worker",
      parentRefs: ["origin/target"],
      forceMergeCommit: true,
      githubMode: "REMOTE",
    });

    expect(result.hasChanges).toBe(true);
    expect(result.commitSha).toBeTruthy();

    // The new commit is a real merge commit recording the target as a parent.
    const parents = (await runGit(hostRepoPath, ["show", "-s", "--format=%P", result.commitSha!])).trim().split(" ");
    expect(parents).toEqual([baseRef, targetRef]);

    // The source side is preserved.
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:test.md"], { trimOutput: false }))
      .toBe("Conflict Value B\n");

    // The target is now contained in the source branch locally and on the remote, so the
    // upstream PR will stop reporting the conflict.
    await runGit(hostRepoPath, ["merge-base", "--is-ancestor", "origin/target", "refs/heads/worker/test"]);
    await runGit(hostRepoPath, ["fetch", "origin"]);
    await runGit(hostRepoPath, ["merge-base", "--is-ancestor", "origin/target", "origin/worker/test"]);
  });

  it("does not create a redundant merge commit when the target is already contained in the source", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const hostRepoPath = path.join(tempRoot, "host-repo");

    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, hostRepoPath], tempRoot);

    await runGit(hostRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "test.md"), "Original\n", "utf8");
    await runGit(hostRepoPath, ["add", "test.md"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);
    const baseMain = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runGit(hostRepoPath, ["checkout", "-b", "target", baseMain]);
    await fs.writeFile(path.join(hostRepoPath, "other.txt"), "target\n", "utf8");
    await runGit(hostRepoPath, ["add", "other.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "target change"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "target"]);

    // Worker branch already merged the target in.
    await runGit(hostRepoPath, ["checkout", "-b", "worker/test", baseMain]);
    await runGit(hostRepoPath, ["merge", "--no-edit", "origin/target"]);
    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    const service = new WorkspaceArtifactService({} as IWorkspaceManager);
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText: "",
      commitMessage: "fix(merge): resolve target into worker",
      parentRefs: ["origin/target"],
      forceMergeCommit: true,
      githubMode: "REMOTE",
    });

    expect(result.hasChanges).toBe(false);
    expect((await runGit(hostRepoPath, ["rev-parse", "refs/heads/worker/test"])).trim()).toBe(baseRef);
  });

  it("uses the configured git identity for host-side commit-tree materialization", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const hostRepoPath = path.join(tempRoot, "host-repo");
    const workspaceRepoPath = path.join(tempRoot, "workspace-repo");

    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, hostRepoPath], tempRoot);

    await runGit(hostRepoPath, ["config", "user.name", "Initial Author"]);
    await runGit(hostRepoPath, ["config", "user.email", "initial@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "file.txt"), "base\n", "utf8");
    await runGit(hostRepoPath, ["add", "file.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);
    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runGit(hostRepoPath, ["config", "--unset", "user.name"]);
    await runGit(hostRepoPath, ["config", "--unset", "user.email"]);

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Workspace Author"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "workspace@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", "origin/main"]);
    await fs.writeFile(path.join(workspaceRepoPath, "file.txt"), "base\nworker\n", "utf8");

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "test identity",
      gitIdentity: {
        name: "Code UX",
        email: "agents@codeux.ai",
      },
    });

    expect(result.hasChanges).toBe(true);
    const author = await runGit(hostRepoPath, ["show", "-s", "--format=%an <%ae>", result.commitSha!]);
    const committer = await runGit(hostRepoPath, ["show", "-s", "--format=%cn <%ce>", result.commitSha!]);
    expect(author.trim()).toBe("Code UX <agents@codeux.ai>");
    expect(committer.trim()).toBe("Code UX <agents@codeux.ai>");
  });
});
