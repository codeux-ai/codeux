import { afterEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { ProjectInitMode, ProjectSummary } from "../../../src/contracts/project-management-types.js";
import { runCommandStrict } from "../../../src/services/cli-process-runner.js";
import { ProjectInitializationStateService } from "../../../src/services/project-initialization-state-service.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createSeededRepository(): Promise<string> {
  const repoPath = await fs.mkdtemp(path.join(os.tmpdir(), "code-ux-initial-state-"));
  tempDirs.push(repoPath);
  await runCommandStrict("git", ["init", "-b", "main"], repoPath);
  await fs.writeFile(path.join(repoPath, "README.md"), "# Seeded\n\nInitialized with Code UX.\n");
  await fs.writeFile(path.join(repoPath, ".gitignore"), ".code-ux/\n");
  await runCommandStrict("git", ["add", "README.md", ".gitignore"], repoPath);
  await runCommandStrict("git", ["-c", "user.name=Code UX", "-c", "user.email=codeux@example.test", "commit", "-m", "Initial commit"], repoPath);
  return repoPath;
}

function createService(projectId: string, baseDir: string, initializationMode: ProjectInitMode) {
  return new ProjectInitializationStateService((id) => id === projectId ? ({
    id: projectId,
    baseDir,
    initializationMode,
  } as Pick<ProjectSummary, "id" | "baseDir" | "initializationMode">) : null);
}

describe("ProjectInitializationStateService", () => {
  it.each(["new-local", "new-remote"] as const)("allows a clean one-commit %s seed", async (mode) => {
    const repoPath = await createSeededRepository();
    const state = await createService("project-1", repoPath, mode).getProjectInitializationState("project-1");

    expect(state).toEqual({
      projectId: "project-1",
      initializationMode: mode,
      repositoryState: "initial",
      canCreateInitialAppQuickactions: true,
    });
  });

  it("rejects extra tracked files", async () => {
    const repoPath = await createSeededRepository();
    await fs.writeFile(path.join(repoPath, "package.json"), "{}\n");
    await runCommandStrict("git", ["add", "package.json"], repoPath);
    await runCommandStrict("git", ["-c", "user.name=Code UX", "-c", "user.email=codeux@example.test", "commit", "--amend", "--no-edit"], repoPath);

    const state = await createService("project-1", repoPath, "new-local").getProjectInitializationState("project-1");
    expect(state.repositoryState).toBe("modified");
    expect(state.canCreateInitialAppQuickactions).toBe(false);
  });

  it("rejects dirty repositories and ignored setup artifacts", async () => {
    const repoPath = await createSeededRepository();
    await fs.writeFile(path.join(repoPath, "README.md"), "dirty\n");
    let state = await createService("project-1", repoPath, "new-local").getProjectInitializationState("project-1");
    expect(state.repositoryState).toBe("modified");

    await runCommandStrict("git", ["restore", "README.md"], repoPath);
    await fs.mkdir(path.join(repoPath, ".code-ux"));
    state = await createService("project-1", repoPath, "new-local").getProjectInitializationState("project-1");
    expect(state.repositoryState).toBe("modified");
    expect(state.canCreateInitialAppQuickactions).toBe(false);
  });

  it("rejects repositories with additional commits", async () => {
    const repoPath = await createSeededRepository();
    await fs.writeFile(path.join(repoPath, "README.md"), "# Changed\n");
    await runCommandStrict("git", ["add", "README.md"], repoPath);
    await runCommandStrict("git", ["-c", "user.name=Code UX", "-c", "user.email=codeux@example.test", "commit", "-m", "Change README"], repoPath);

    const state = await createService("project-1", repoPath, "new-local").getProjectInitializationState("project-1");
    expect(state.repositoryState).toBe("modified");
    expect(state.canCreateInitialAppQuickactions).toBe(false);
  });

  it("fails closed for existing projects, missing checkouts, and unknown projects", async () => {
    const existing = await createService("project-1", "/not/inspected", "existing").getProjectInitializationState("project-1");
    expect(existing).toMatchObject({ repositoryState: "unavailable", canCreateInitialAppQuickactions: false });

    const missing = await createService("project-1", "/definitely/missing", "new-local").getProjectInitializationState("project-1");
    expect(missing).toMatchObject({ repositoryState: "unavailable", canCreateInitialAppQuickactions: false });

    const unknown = await createService("project-1", "/unused", "new-local").getProjectInitializationState("other");
    expect(unknown).toMatchObject({ initializationMode: "existing", repositoryState: "unavailable", canCreateInitialAppQuickactions: false });
  });
});
