import { beforeEach, describe, it, expect, vi } from "vitest";
import { initializeProject } from "../../../../src/domain/projects/project-initializer.js";

vi.mock("../../../../src/infrastructure/git/local-repo-initializer.js", () => ({
  initLocalRepo: vi.fn(),
}));

vi.mock("../../../../src/infrastructure/git/remote-repo-creator.js", () => ({
  createGitHubRepo: vi.fn().mockResolvedValue({ remoteUrl: "https://github.com/a/b", localPath: "/tmp/a/b" }),
  createGitLabRepo: vi.fn().mockResolvedValue({ remoteUrl: "https://gitlab.com/a/b", localPath: "/tmp/a/b" }),
}));

import * as path from "node:path";
import * as os from "node:os";
import { createGitHubRepo } from "../../../../src/infrastructure/git/remote-repo-creator.js";

describe("initializeProject validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("allows valid local repos", async () => {
    const validPath = path.resolve(process.cwd(), "valid-local-repo");
    await expect(
      initializeProject(
        { initMode: "new-local", sourceRef: validPath, name: "valid", sourceType: "local" },
        { createProject: vi.fn().mockResolvedValue({}), getGithubToken: vi.fn() }
      )
    ).resolves.toBeTruthy();
  });

  it("rejects local repo outside allowed root", async () => {
    const allowedRoot = process.cwd();
    const evilPath = path.resolve(allowedRoot, "..", "evil-repo");
    await expect(
      initializeProject(
        { initMode: "new-local", sourceRef: evilPath, cloneDir: allowedRoot, name: "evil", sourceType: "local" },
        { createProject: vi.fn().mockResolvedValue({}), getGithubToken: vi.fn() }
      )
    ).rejects.toThrow();
  });


  it("allows valid remote repos", async () => {
    await expect(
      initializeProject(
        { initMode: "new-remote", remoteProvider: "github", sourceRef: "valid-remote-repo", name: "valid", sourceType: "git" },
        { createProject: vi.fn().mockResolvedValue({}), getGithubToken: vi.fn().mockReturnValue("tok") }
      )
    ).resolves.toBeTruthy();
  });

  it("defaults new remote repos to the home Code UX projects root", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      { initMode: "new-remote", remoteProvider: "github", sourceRef: "valid-remote-repo", name: "valid", sourceType: "git" },
      { createProject, getGithubToken: vi.fn().mockReturnValue("tok") }
    );

    const expectedCloneRoot = path.join(os.homedir(), ".code-ux", "projects");
    expect(createGitHubRepo).toHaveBeenCalledWith(expect.objectContaining({
      repoName: "valid-remote-repo",
      cloneParentDir: expectedCloneRoot,
    }));
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "git",
      sourceRef: "https://github.com/a/b",
      cloneDir: expectedCloneRoot,
      initMode: undefined,
    }));
  });

  it("resolves relative new remote clone dirs from the home directory", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      {
        initMode: "new-remote",
        remoteProvider: "github",
        sourceRef: "relative-clone-repo",
        name: "valid",
        sourceType: "git",
        cloneDir: "codeux-projects",
      },
      { createProject, getGithubToken: vi.fn().mockReturnValue("tok") }
    );

    const expectedCloneRoot = path.join(os.homedir(), "codeux-projects");
    expect(createGitHubRepo).toHaveBeenCalledWith(expect.objectContaining({
      repoName: "relative-clone-repo",
      cloneParentDir: expectedCloneRoot,
    }));
    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      cloneDir: expectedCloneRoot,
    }));
  });

  it("rejects absolute paths for repo names", async () => {
    await expect(
      initializeProject(
        { initMode: "new-remote", remoteProvider: "github", sourceRef: "/evil/repo", name: "evil", sourceType: "git" },
        { createProject: vi.fn(), getGithubToken: vi.fn().mockReturnValue("tok") }
      )
    ).rejects.toThrow();
  });

  it("rejects path traversal in repo names", async () => {
    await expect(
      initializeProject(
        { initMode: "new-remote", remoteProvider: "github", sourceRef: "../evil", name: "evil", sourceType: "git" },
        { createProject: vi.fn(), getGithubToken: vi.fn().mockReturnValue("tok") }
      )
    ).rejects.toThrow();
  });

  it("rejects control characters in repo names", async () => {
    await expect(
      initializeProject(
        { initMode: "new-remote", remoteProvider: "github", sourceRef: "repo\x00name", name: "evil", sourceType: "git" },
        { createProject: vi.fn(), getGithubToken: vi.fn().mockReturnValue("tok") }
      )
    ).rejects.toThrow();
  });
});
