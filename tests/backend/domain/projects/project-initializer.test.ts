import { beforeEach, describe, it, expect, vi } from "vitest";
import { initializeProject } from "../../../../src/domain/projects/project-initializer.js";
import { CODE_UX_AWARD_WINNING_STYLEGUIDE_ID } from "../../../../src/domain/settings/design-guidance-catalog.js";

vi.mock("../../../../src/infrastructure/git/local-repo-initializer.js", () => ({
  initLocalRepo: vi.fn(),
}));

const observedHostTokens = vi.hoisted(() => [] as Array<string | undefined>);
vi.mock("../../../../src/infrastructure/git/remote-repo-creator.js", () => ({
  createGitHubRepo: vi.fn(async (options: { withHostCredential: RemoteGitCredentialProvider }) => {
    for (const operation of ["api", "clone", "push"] as const) {
      await options.withHostCredential(operation, async (token: string | undefined) => { observedHostTokens.push(token); });
    }
    return { remoteUrl: "https://github.com/a/b", localPath: "/tmp/a/b" };
  }),
  createGitLabRepo: vi.fn(async (options: { withHostCredential: RemoteGitCredentialProvider }) => {
    for (const operation of ["api", "clone", "push"] as const) {
      await options.withHostCredential(operation, async (token: string | undefined) => { observedHostTokens.push(token); });
    }
    return { remoteUrl: "https://gitlab.com/a/b", localPath: "/tmp/a/b" };
  }),
}));

import * as path from "node:path";
import * as os from "node:os";
import { createGitHubRepo, createGitLabRepo } from "../../../../src/infrastructure/git/remote-repo-creator.js";
import type { RemoteGitCredentialProvider } from "../../../../src/infrastructure/git/remote-repo-creator.js";

describe("initializeProject validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    observedHostTokens.length = 0;
  });

  it("allows valid local repos", async () => {
    const validPath = path.resolve(process.cwd(), "valid-local-repo");
    await expect(
      initializeProject(
        { initMode: "new-local", sourceRef: validPath, name: "valid", sourceType: "local" },
        { createProject: vi.fn().mockResolvedValue({}), withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
      )
    ).resolves.toBeTruthy();
  });

  it("pins imported projects to the built-in Project manager dashboard reply fallback", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      { sourceRef: path.resolve(process.cwd(), "imported-repo"), name: "imported", sourceType: "local" },
      { createProject, withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      initMode: "existing",
      settingsOverrides: expect.objectContaining({
        agents: expect.objectContaining({
          routing: expect.objectContaining({
            dashboardReply: { agentPresetId: null },
          }),
        }),
      }),
    }));
  });

  it("preserves an explicit create-time dashboard reply route", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      {
        sourceRef: path.resolve(process.cwd(), "imported-repo"),
        name: "imported",
        sourceType: "local",
        settingsOverrides: {
          agents: { routing: { dashboardReply: { agentPresetId: "custom-manager" } } },
        },
      },
      { createProject, withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      settingsOverrides: expect.objectContaining({
        agents: expect.objectContaining({
          routing: expect.objectContaining({
            dashboardReply: { agentPresetId: "custom-manager" },
          }),
        }),
      }),
    }));
  });

  it("resolves relative new local repo paths from the home directory", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      { initMode: "new-local", sourceRef: "valid-local-repo", name: "valid", sourceType: "local" },
      { createProject, withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "local",
      sourceRef: path.join(os.homedir(), "valid-local-repo"),
      initMode: "new-local",
    }));
  });

  it("seeds new local projects with the Code UX styleguide override", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      { initMode: "new-local", sourceRef: "valid-local-repo", name: "valid", sourceType: "local" },
      { createProject, withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      settingsOverrides: expect.objectContaining({
        designGuidance: expect.objectContaining({
          selectedStyleguideId: CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
        }),
      }),
    }));
  });

  it("allows absolute new local repo paths selected outside the Code UX working directory", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    const selectedPath = path.join(os.tmpdir(), "code-ux-selected-local-repo");

    await initializeProject(
      { initMode: "new-local", sourceRef: selectedPath, name: "valid", sourceType: "local" },
      { createProject, withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      sourceRef: path.resolve(selectedPath),
    }));
  });

  it("rejects local repo outside allowed root", async () => {
    const allowedRoot = process.cwd();
    const evilPath = path.resolve(allowedRoot, "..", "evil-repo");
    await expect(
      initializeProject(
        { initMode: "new-local", sourceRef: evilPath, cloneDir: allowedRoot, name: "evil", sourceType: "local" },
        { createProject: vi.fn().mockResolvedValue({}), withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
      )
    ).rejects.toThrow();
  });

  it("rejects relative new local paths that escape the home directory", async () => {
    await expect(
      initializeProject(
        { initMode: "new-local", sourceRef: "../evil-repo", name: "evil", sourceType: "local" },
        { createProject: vi.fn(), withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer() }
      )
    ).rejects.toThrow();
  });


  it("allows valid remote repos", async () => {
    await expect(
      initializeProject(
        { initMode: "new-remote", remoteProvider: "github", sourceRef: "valid-remote-repo", name: "valid", sourceType: "git" },
        { createProject: vi.fn().mockResolvedValue({}), withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer("tok") }
      )
    ).resolves.toBeTruthy();
  });

  it("resolves the selected host credential for every remote creation operation", async () => {
    const tokens = ["api-v1", "clone-v1", "push-v1", "api-v2", "clone-v2", "push-v2"];
    const withRemoteGitCredential = vi.fn(async (_provider, _operation, consumer) => await consumer(tokens.shift()));
    const input = {
      initMode: "new-remote" as const,
      remoteProvider: "github" as const,
      sourceRef: "rotation-repo",
      name: "rotation",
      sourceType: "git" as const,
    };

    await initializeProject(input, { createProject: vi.fn().mockResolvedValue({}), withRemoteGitCredential });
    await initializeProject(input, { createProject: vi.fn().mockResolvedValue({}), withRemoteGitCredential });

    expect(withRemoteGitCredential).toHaveBeenCalledTimes(6);
    expect(withRemoteGitCredential).toHaveBeenNthCalledWith(1, "github", "api", expect.any(Function));
    expect(withRemoteGitCredential).toHaveBeenNthCalledWith(2, "github", "clone", expect.any(Function));
    expect(withRemoteGitCredential).toHaveBeenNthCalledWith(3, "github", "push", expect.any(Function));
    expect(observedHostTokens).toEqual(["api-v1", "clone-v1", "push-v1", "api-v2", "clone-v2", "push-v2"]);
  });

  it("fails closed before remote egress when credential resolution is denied", async () => {
    const denial = new Error("Credential is not active.");
    const withRemoteGitCredential = vi.fn(async () => { throw denial; });

    await expect(initializeProject({
      initMode: "new-remote",
      remoteProvider: "gitlab",
      sourceRef: "denied-repo",
      name: "denied",
      sourceType: "git",
    }, { createProject: vi.fn(), withRemoteGitCredential })).rejects.toBe(denial);

    expect(createGitLabRepo).toHaveBeenCalledOnce();
    expect(observedHostTokens).toEqual([]);
  });

  it("defaults new remote repos to the home Code UX projects root", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      { initMode: "new-remote", remoteProvider: "github", sourceRef: "valid-remote-repo", name: "valid", sourceType: "git" },
      { createProject, withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer("tok") }
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
      initMode: "new-remote",
      settingsOverrides: expect.objectContaining({
        designGuidance: expect.objectContaining({
          selectedStyleguideId: CODE_UX_AWARD_WINNING_STYLEGUIDE_ID,
        }),
      }),
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
      { createProject, withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer("tok") }
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
        { createProject: vi.fn(), withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer("tok") }
      )
    ).rejects.toThrow();
  });

  it("rejects path traversal in repo names", async () => {
    await expect(
      initializeProject(
        { initMode: "new-remote", remoteProvider: "github", sourceRef: "../evil", name: "evil", sourceType: "git" },
        { createProject: vi.fn(), withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer("tok") }
      )
    ).rejects.toThrow();
  });

  it("rejects control characters in repo names", async () => {
    await expect(
      initializeProject(
        { initMode: "new-remote", remoteProvider: "github", sourceRef: "repo\x00name", name: "evil", sourceType: "git" },
        { createProject: vi.fn(), withRemoteGitCredential: async (_provider, _operation, consumer) => await consumer("tok") }
      )
    ).rejects.toThrow();
  });
});
