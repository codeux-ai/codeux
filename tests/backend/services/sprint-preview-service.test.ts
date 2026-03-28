import { afterEach, describe, expect, it } from "vitest";
import * as fs from "fs/promises";
import * as os from "os";
import * as path from "path";
import { execFile as execFileCallback } from "node:child_process";
import { promisify } from "node:util";
import { SprintPreviewService } from "../../../src/services/sprint-preview-service.js";

const execFile = promisify(execFileCallback);
const tempDirs: string[] = [];

const run = async (command: string, args: string[], cwd?: string): Promise<void> => {
  await execFile(command, args, cwd ? { cwd } : undefined);
};

const writeFile = async (targetPath: string, content: string): Promise<void> => {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  await fs.writeFile(targetPath, content, "utf8");
};

const configureGitIdentity = async (repoPath: string): Promise<void> => {
  await run("git", ["config", "user.name", "Sprint OS Test"], repoPath);
  await run("git", ["config", "user.email", "sprint-os@example.com"], repoPath);
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("SprintPreviewService workspace export", () => {
  it("exports a remote-only sprint branch into an isolated preview workspace", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "sprint-preview-service-"));
    tempDirs.push(root);

    const originPath = path.join(root, "origin.git");
    const projectPath = path.join(root, "project");
    const publisherPath = path.join(root, "publisher");
    const workspacePath = path.join(root, "preview-workspace");

    await run("git", ["init", "--bare", originPath]);
    await run("git", ["clone", originPath, projectPath]);
    await configureGitIdentity(projectPath);

    await run("git", ["checkout", "-b", "main"], projectPath);
    await writeFile(path.join(projectPath, "package.json"), JSON.stringify({
      name: "preview-app",
      private: true,
      scripts: {
        build: "echo build",
        start: "node server.js",
      },
    }, null, 2));
    await writeFile(path.join(projectPath, "README.md"), "base\n");
    await run("git", ["add", "."], projectPath);
    await run("git", ["commit", "-m", "base"], projectPath);
    await run("git", ["push", "-u", "origin", "main"], projectPath);

    await run("git", ["clone", originPath, publisherPath]);
    await configureGitIdentity(publisherPath);
    await run("git", ["checkout", "-b", "feature/sprint-51", "origin/main"], publisherPath);
    await writeFile(path.join(publisherPath, "src", "preview-marker.txt"), "remote-only branch\n");
    await run("git", ["add", "."], publisherPath);
    await run("git", ["commit", "-m", "preview change"], publisherPath);
    await run("git", ["push", "-u", "origin", "feature/sprint-51"], publisherPath);

    const service = new SprintPreviewService({
      sprintPreviewRepository: {} as any,
      projectManagementRepository: {} as any,
      executionRepository: {} as any,
      settingsRepository: {} as any,
    });

    await (service as any).materializePreviewWorkspace(projectPath, workspacePath, "feature/sprint-51", "main");

    await expect(fs.readFile(path.join(workspacePath, "src", "preview-marker.txt"), "utf8"))
      .resolves.toBe("remote-only branch\n");
    await expect(fs.access(path.join(workspacePath, ".git"))).rejects.toThrow();
  });
});
