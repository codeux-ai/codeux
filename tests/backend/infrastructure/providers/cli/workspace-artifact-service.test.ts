import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import type { IWorkspaceManager, WorkspaceCommandOptions } from "../../../../../src/infrastructure/providers/cli/workspace-manager.js";
import { WorkspaceArtifactService } from "../../../../../src/infrastructure/providers/cli/workspace-artifact-service.js";
import { runCommandStrict } from "../../../../../src/services/cli-process-runner.js";
import * as cliProcessRunner from "../../../../../src/services/cli-process-runner.js";

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
    vi.restoreAllMocks();
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
          stdinFile: options.stdinFile,
        });
      },
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);

    expect(seenOptions.some((options) => options.trimOutput === false && options.env?.GIT_INDEX_FILE)).toBe(true);
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

  it("exports a Docker-volume patch through one fused helper invocation", async () => {
    const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-fused-export-"));
    cleanupPaths.push(repoPath);
    await runGit(repoPath, ["init"]);
    await runGit(repoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(repoPath, ["config", "user.email", "code-ux@example.com"]);
    await fs.writeFile(path.join(repoPath, "tracked.txt"), "base\n", "utf8");
    await runGit(repoPath, ["add", "."]);
    await runGit(repoPath, ["commit", "-m", "base"]);
    const baseRef = (await runGit(repoPath, ["rev-parse", "HEAD"])).trim();
    await fs.writeFile(path.join(repoPath, "tracked.txt"), "updated\n", "utf8");
    await fs.writeFile(path.join(repoPath, "new.txt"), "new\n", "utf8");

    const calls: Array<{ command: string; args: string[]; options: WorkspaceCommandOptions }> = [];
    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => {
        calls.push({ command, args, options });
        return await runCommandStrict(command, args, repoPath, options.env ?? process.env, {
          trimOutput: options.trimOutput,
          signal: options.signal,
          stdinFile: options.stdinFile,
        });
      },
    } as IWorkspaceManager;

    const patchText = await new WorkspaceArtifactService(workspaceManager)
      .exportBinaryPatch("docker-volume://workspace", baseRef);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ command: "sh", options: { trimOutput: false } });
    expect(patchText).toContain("diff --git a/new.txt b/new.txt");
    expect(patchText).toContain("diff --git a/tracked.txt b/tracked.txt");
    expect((await fs.readdir(repoPath)).some((entry) => entry.startsWith(".code-ux-export-"))).toBe(false);
  });

  it("parents retry commits on the existing remote worker branch to avoid non-fast-forward push", async () => {
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

    await runGit(hostRepoPath, ["checkout", "-b", "worker/test", baseRef]);
    await fs.writeFile(path.join(hostRepoPath, "remote.txt"), "remote worker tip\n", "utf8");
    await runGit(hostRepoPath, ["add", "remote.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "remote worker"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "worker/test"]);
    const remoteWorkerTip = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", baseRef]);
    await fs.writeFile(path.join(workspaceRepoPath, "file.txt"), "base\nretry docs\n", "utf8");

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
          stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "retry docs",
      githubMode: "REMOTE",
    });

    expect(result.hasChanges).toBe(true);
    expect(result.commitSha).toBeTruthy();
    expect((await runGit(hostRepoPath, ["show", "-s", "--format=%P", result.commitSha!])).trim()).toBe(remoteWorkerTip);
    expect((await runGit(hostRepoPath, ["rev-parse", "origin/worker/test"])).trim()).toBe(result.commitSha);
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:file.txt"], { trimOutput: false }))
      .toBe("base\nretry docs\n");
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:remote.txt"], { trimOutput: false }))
      .toBe("remote worker tip\n");
  });

  it("preserves concurrent local branch commits when materializing a stale workspace patch", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const hostRepoPath = path.join(tempRoot, "host-repo");
    const workspaceRepoPath = path.join(tempRoot, "workspace-repo");

    await runCommandStrict("git", ["init", hostRepoPath], tempRoot);
    await runGit(hostRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "feature/test"]);
    await fs.writeFile(path.join(hostRepoPath, "base.txt"), "base\n", "utf8");
    await runGit(hostRepoPath, ["add", "base.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    const baseRef = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runCommandStrict("git", ["clone", hostRepoPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["checkout", "feature/test"]);
    await fs.writeFile(path.join(workspaceRepoPath, "ci-fix.txt"), "ci fix\n", "utf8");

    await fs.writeFile(path.join(hostRepoPath, "task-output.txt"), "task output\n", "utf8");
    await runGit(hostRepoPath, ["add", "task-output.txt"]);
    await runGit(hostRepoPath, ["commit", "-m", "merge task output"]);
    const concurrentTip = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
        stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "feature/test",
      patchText,
      commitMessage: "fix local CI",
      githubMode: "LOCAL",
    });

    expect(result.hasChanges).toBe(true);
    expect((await runGit(hostRepoPath, ["show", "-s", "--format=%P", result.commitSha!])).trim()).toBe(concurrentTip);
    expect(await runGit(hostRepoPath, ["show", "refs/heads/feature/test:task-output.txt"], { trimOutput: false }))
      .toBe("task output\n");
    expect(await runGit(hostRepoPath, ["show", "refs/heads/feature/test:ci-fix.txt"], { trimOutput: false }))
      .toBe("ci fix\n");
  });

  it("keeps a checked-out worker branch clean after materializing a patch", async () => {
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

    await runGit(hostRepoPath, ["checkout", "-b", "worker/test", baseRef]);

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", "origin/main"]);
    await fs.writeFile(path.join(workspaceRepoPath, "file.txt"), "base\nworker change\n", "utf8");

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
          stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "worker change",
    });

    expect(result.hasChanges).toBe(true);
    expect((await runGit(hostRepoPath, ["branch", "--show-current"])).trim()).toBe("worker/test");
    expect(await runGit(hostRepoPath, ["status", "--porcelain"], { trimOutput: false })).toBe("");
    expect(await fs.readFile(path.join(hostRepoPath, "file.txt"), "utf8")).toBe("base\nworker change\n");
  });

  it("materializes local patches with a single host shell command", async () => {
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

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", "origin/main"]);
    await fs.writeFile(path.join(workspaceRepoPath, "file.txt"), "base\nworker change\n", "utf8");

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
          stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);

    const actualRunCommandStrict = cliProcessRunner.runCommandStrict;
    const hostCommands: Array<{ command: string; args: string[] }> = [];
    vi.spyOn(cliProcessRunner, "runCommandStrict").mockImplementation(async (command, args, cwd, env, options) => {
      if (cwd === hostRepoPath) {
        hostCommands.push({ command, args: [...args] });
      }
      return actualRunCommandStrict(command, args, cwd, env, options);
    });

    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "worker change",
      githubMode: "LOCAL",
    });

    expect(result.hasChanges).toBe(true);
    expect(result.stats).toEqual({ filesChanged: 1, insertions: 1, deletions: 0 });
    expect(hostCommands.some((call) => call.command === "sh")).toBe(false);
    expect(hostCommands).toEqual(expect.arrayContaining([
      expect.objectContaining({ command: "git", args: ["read-tree", baseRef] }),
      expect.objectContaining({ command: "git", args: ["apply", "--cached", "--binary", expect.stringContaining("workspace.patch")] }),
      expect.objectContaining({ command: "git", args: ["write-tree"] }),
      expect.objectContaining({ command: "git", args: expect.arrayContaining(["commit-tree"]) }),
      expect.objectContaining({ command: "git", args: ["update-ref", "refs/heads/worker/test", expect.any(String)] }),
    ]));
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:file.txt"], { trimOutput: false }))
      .toBe("base\nworker change\n");
  });

  it("three-way materializes a stale workspace patch onto an advanced local worker branch", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-stale-local-"));
    cleanupPaths.push(tempRoot);

    const originPath = path.join(tempRoot, "origin.git");
    const hostRepoPath = path.join(tempRoot, "host-repo");
    const workspaceRepoPath = path.join(tempRoot, "workspace-repo");
    await runCommandStrict("git", ["init", "--bare", originPath], tempRoot);
    await runCommandStrict("git", ["clone", originPath, hostRepoPath], tempRoot);
    await runGit(hostRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(hostRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(hostRepoPath, ["checkout", "-b", "main"]);
    await fs.writeFile(path.join(hostRepoPath, "base.txt"), "base\n", "utf8");
    await runGit(hostRepoPath, ["add", "."]);
    await runGit(hostRepoPath, ["commit", "-m", "base"]);
    await runGit(hostRepoPath, ["push", "-u", "origin", "main"]);
    const staleBase = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", "origin/main"]);
    await fs.writeFile(path.join(workspaceRepoPath, "already-landed.txt"), "same content\n", "utf8");
    await fs.writeFile(path.join(workspaceRepoPath, "follow-up.txt"), "follow-up change\n", "utf8");

    await runGit(hostRepoPath, ["checkout", "-b", "worker/test", staleBase]);
    await fs.writeFile(path.join(hostRepoPath, "already-landed.txt"), "same content\n", "utf8");
    await runGit(hostRepoPath, ["add", "."]);
    await runGit(hostRepoPath, ["commit", "-m", "original task materialized on host"]);
    const advancedTip = (await runGit(hostRepoPath, ["rev-parse", "HEAD"])).trim();
    await runGit(hostRepoPath, ["checkout", "main"]);

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
        stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;
    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", staleBase);

    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef: staleBase,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "qa follow-up",
      githubMode: "LOCAL",
    });

    expect(result).toMatchObject({
      hasChanges: true,
      stats: { filesChanged: 1, insertions: 1, deletions: 0 },
    });
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:already-landed.txt"], { trimOutput: false }))
      .toBe("same content\n");
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:follow-up.txt"], { trimOutput: false }))
      .toBe("follow-up change\n");
    expect((await runGit(hostRepoPath, ["rev-parse", "refs/heads/worker/test^"])).trim()).toBe(advancedTip);
  });

  it("retries killed branch pushes after materializing the resolved commit locally", async () => {
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

    await runCommandStrict("git", ["clone", originPath, workspaceRepoPath], tempRoot);
    await runGit(workspaceRepoPath, ["config", "user.name", "Code UX Test"]);
    await runGit(workspaceRepoPath, ["config", "user.email", "code-ux@example.com"]);
    await runGit(workspaceRepoPath, ["checkout", "-b", "worker/test", "origin/main"]);
    await fs.writeFile(path.join(workspaceRepoPath, "file.txt"), "base\nresolved\n", "utf8");

    const actualRunCommandStrict = cliProcessRunner.runCommandStrict;
    let pushAttempts = 0;
    vi.spyOn(cliProcessRunner, "runCommandStrict").mockImplementation(async (command, args, cwd, env, options) => {
      if (
        command === "git"
        && args[0] === "push"
        && args.includes("refs/heads/worker/test:refs/heads/worker/test")
      ) {
        pushAttempts += 1;
        if (pushAttempts === 1) {
          throw new Error("git push -u origin refs/heads/worker/test:refs/heads/worker/test failed: Unknown error (exit code 137, no output captured)");
        }
      }
      return actualRunCommandStrict(command, args, cwd, env, options);
    });

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
          stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);
    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "resolve conflict",
      githubMode: "REMOTE",
    });

    expect(result.hasChanges).toBe(true);
    expect(pushAttempts).toBe(2);
    expect((await runGit(hostRepoPath, ["rev-parse", "origin/worker/test"])).trim()).toBe(result.commitSha);
    expect(await runGit(hostRepoPath, ["show", "origin/worker/test:file.txt"], { trimOutput: false }))
      .toBe("base\nresolved\n");
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
    await fs.writeFile(path.join(hostRepoPath, ".gitignore"), ".pnpm-store\n", "utf8");
    await runGit(hostRepoPath, ["add", "existing.txt", ".gitignore"]);
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
    await fs.mkdir(path.join(workspaceRepoPath, ".pnpm-store", "v10", "files", "00"), { recursive: true });
    await fs.writeFile(
      path.join(workspaceRepoPath, ".pnpm-store", "v10", "files", "00", "cache-object"),
      "cached dependency artifact\n",
      "utf8",
    );
    await fs.mkdir(path.join(workspaceRepoPath, "logs", "openai"), { recursive: true });
    await fs.writeFile(path.join(workspaceRepoPath, "logs", "openai", "openai-123.json"), "{}", "utf8");
    await fs.writeFile(path.join(workspaceRepoPath, "logs", "openai", "request.log"), "log", "utf8");
    await fs.rm(path.join(workspaceRepoPath, "existing.txt"));

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
          stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);

    expect(patchText).toContain("diff --git a/new-component.tsx b/new-component.tsx");
    expect(patchText).toContain("diff --git a/existing.txt b/existing.txt");
    expect(patchText).toContain("deleted file mode");
    expect(patchText).not.toContain(".task-learnings.md");
    expect(patchText).not.toContain(".code-ux-home");
    expect(patchText).not.toContain(".pnpm-store");
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
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:existing.txt"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:.task-learnings.md"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:.code-ux-home/.gemini/settings.json"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:.code-ux-home/.cache/node-gyp/header.h"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:.pnpm-store/v10/files/00/cache-object"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:logs/openai/openai-123.json"]))
      .rejects.toThrow();
    await expect(runGit(hostRepoPath, ["show", "refs/heads/worker/test:logs/openai/request.log"]))
      .rejects.toThrow();
  });

  it("lets git stage workspace export paths without passing each generated path through argv", async () => {
    const untrackedPaths = Array.from({ length: 1_201 }, (_, index) => `src/generated/file-${index}.ts`);
    const workspaceCalls: Array<{ command: string; args: string[] }> = [];

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
      ) => {
        workspaceCalls.push({ command, args });
        if (command === "git" && args[0] === "ls-files") {
          return {
            ok: true,
            code: 0,
            stdout: `${untrackedPaths.join("\0")}\0`,
            stderr: "",
          };
        }
        if (command === "git" && args[0] === "diff") {
          return {
            ok: true,
            code: 0,
            stdout: "diff --git a/src/generated/file-0.ts b/src/generated/file-0.ts\n",
            stderr: "",
          };
        }
        return {
          ok: true,
          code: 0,
          stdout: "",
          stderr: "",
        };
      },
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", "HEAD");

    expect(patchText).toContain("diff --git");
    expect(workspaceCalls.map((call) => [call.command, call.args[0]])).toEqual([
      ["git", "read-tree"],
      ["git", "ls-files"],
      ["git", "add"],
      ["git", "diff"],
    ]);
    expect(workspaceCalls[1].args).toEqual(expect.arrayContaining(["ls-files", "--modified", "--deleted", "--others", "--exclude-standard", "-z", "--", "."]));
    expect(workspaceCalls[2].args).toEqual(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"]);
    expect(workspaceCalls[3].args).toEqual(expect.arrayContaining(["diff", "--binary", "--cached", "HEAD", "--", "."]));
    for (const untrackedPath of untrackedPaths) {
      for (const call of workspaceCalls) {
        expect(call.args).not.toContain(untrackedPath);
      }
    }
  });

  it("uses an absolute temporary Git index for host worktree exports", async () => {
    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-artifact-service-"));
    cleanupPaths.push(tempRoot);

    const seenIndexFiles: string[] = [];
    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => {
        const indexFile = options.env?.GIT_INDEX_FILE;
        if (typeof indexFile === "string") {
          seenIndexFiles.push(indexFile);
        }
        if (command === "git" && args[0] === "diff") {
          return {
            ok: true,
            code: 0,
            stdout: "diff --git a/src/generated/file-0.ts b/src/generated/file-0.ts\n",
            stderr: "",
          };
        }
        return {
          ok: true,
          code: 0,
          stdout: "",
          stderr: "",
        };
      },
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch(tempRoot, "HEAD");

    expect(patchText).toContain("diff --git");
    expect(seenIndexFiles.length).toBeGreaterThan(0);
    expect(new Set(seenIndexFiles).size).toBe(1);
    const [indexFile] = seenIndexFiles;
    expect(path.isAbsolute(indexFile)).toBe(true);
    expect(indexFile.startsWith(`${tempRoot}${path.sep}`)).toBe(true);
    expect(path.basename(indexFile)).toMatch(/^\.code-ux-export-.*\.index$/);
  });

  it("excludes stale Code UX export index files from preserved workspaces", async () => {
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
    await fs.writeFile(path.join(workspaceRepoPath, "docs.md"), "docs\n", "utf8");
    await fs.writeFile(path.join(workspaceRepoPath, ".code-ux-export-123-456-deadbeef.index"), "stale index\n", "utf8");

    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
        trimOutput: options.trimOutput,
        signal: options.signal,
          stdinFile: options.stdinFile,
      }),
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);

    expect(patchText).toContain("diff --git a/docs.md b/docs.md");
    expect(patchText).not.toContain(".code-ux-export-123-456-deadbeef.index");
  });

  it("scopes the untracked-file scan away from the provider sprint HOME so a churning snapshot store cannot break the export", async () => {
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

    // Simulate opencode's snapshot store: a bare git repo (HEAD/objects/refs laid
    // out directly, no nested `.git`) full of loose objects living under the
    // provider sprint HOME. Without shared excludes, Git would mark every one of
    // these objects as intent-to-add and they would enter the exported patch.
    const snapshotRepo = path.join(
      workspaceRepoPath,
      ".code-ux-home", ".local", "share", "opencode", "snapshot", "a".repeat(40), "b".repeat(40),
    );
    await fs.mkdir(path.join(snapshotRepo, "objects", "2d"), { recursive: true });
    await fs.writeFile(path.join(snapshotRepo, "HEAD"), "ref: refs/heads/main\n", "utf8");
    for (let i = 0; i < 50; i += 1) {
      await fs.writeFile(
        path.join(snapshotRepo, "objects", "2d", `${i}`.padStart(38, "0")),
        "snapshot-object",
        "utf8",
      );
    }

    await fs.writeFile(path.join(workspaceRepoPath, "new-component.tsx"), "export const value = 1;\n", "utf8");

    const workspaceCalls: Array<{ command: string; args: string[] }> = [];
    const workspaceManager = {
      runWorkspaceCommand: async (
        _worktreePath: string,
        command: string,
        args: string[],
        options: WorkspaceCommandOptions = {},
      ) => {
        workspaceCalls.push({ command, args: [...args] });
        return await runCommandStrict(command, args, workspaceRepoPath, options.env ?? process.env, {
          trimOutput: options.trimOutput,
          signal: options.signal,
          stdinFile: options.stdinFile,
        });
      },
    } as IWorkspaceManager;

    const service = new WorkspaceArtifactService(workspaceManager);
    const patchText = await service.exportBinaryPatch("workspace", baseRef);

    const lsFilesCall = workspaceCalls.find((call) => call.command === "git" && call.args[0] === "ls-files");
    expect(lsFilesCall?.args).toEqual(expect.arrayContaining([
      "ls-files",
      "--modified",
      "--deleted",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      ".",
      ":(exclude).code-ux-home",
      ":(exclude).code-ux-home/**",
      ":(exclude).code-ux-export-*",
    ]));
    const addCall = workspaceCalls.find((call) => call.command === "git" && call.args[0] === "add");
    expect(addCall?.args).toEqual(["add", "-A", "--pathspec-from-file=-", "--pathspec-file-nul"]);
    const diffCall = workspaceCalls.find((call) => call.command === "git" && call.args[0] === "diff");
    expect(diffCall?.args).toEqual(expect.arrayContaining(["diff", "--binary", "--cached", baseRef, "--", "."]));

    expect(patchText).toContain("diff --git a/new-component.tsx b/new-component.tsx");
    expect(patchText).not.toContain(".code-ux-home");
    expect(patchText).not.toContain("snapshot");

    const result = await service.applyPatchToBranch({
      repoPath: hostRepoPath,
      baseRef,
      workerBranch: "worker/test",
      patchText,
      commitMessage: "test snapshot-safe export",
    });

    expect(result.hasChanges).toBe(true);
    expect(await runGit(hostRepoPath, ["show", "refs/heads/worker/test:new-component.tsx"], { trimOutput: false }))
      .toBe("export const value = 1;\n");
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
          stdinFile: options.stdinFile,
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
          stdinFile: options.stdinFile,
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
