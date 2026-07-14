import { beforeEach, describe, it, expect, vi } from "vitest";
import { initializeProject } from "../../../../src/domain/projects/project-initializer.js";
import { DESIGN_GUIDANCE_NONE_ID } from "../../../../src/domain/settings/design-guidance-catalog.js";

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

  it("pins imported projects to None guidance and the built-in Project manager dashboard reply fallback", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      { sourceRef: path.resolve(process.cwd(), "imported-repo"), name: "imported", sourceType: "local" },
      { createProject, getGithubToken: vi.fn() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      initMode: "existing",
      settingsOverrides: expect.objectContaining({
        designGuidance: expect.objectContaining({
          selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
          selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
        }),
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
      { createProject, getGithubToken: vi.fn() }
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
      { createProject, getGithubToken: vi.fn() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      sourceType: "local",
      sourceRef: path.join(os.homedir(), "valid-local-repo"),
      initMode: "new-local",
    }));
  });

  it("starts new local projects with both guidance selections set to None", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    await initializeProject(
      { initMode: "new-local", sourceRef: "valid-local-repo", name: "valid", sourceType: "local" },
      { createProject, getGithubToken: vi.fn() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      settingsOverrides: expect.objectContaining({
        designGuidance: expect.objectContaining({
          selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
          selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
        }),
      }),
    }));
  });

  it("allows absolute new local repo paths selected outside the Code UX working directory", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    const selectedPath = path.join(os.tmpdir(), "code-ux-selected-local-repo");

    await initializeProject(
      { initMode: "new-local", sourceRef: selectedPath, name: "valid", sourceType: "local" },
      { createProject, getGithubToken: vi.fn() }
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
        { createProject: vi.fn().mockResolvedValue({}), getGithubToken: vi.fn() }
      )
    ).rejects.toThrow();
  });

  it("rejects relative new local paths that escape the home directory", async () => {
    await expect(
      initializeProject(
        { initMode: "new-local", sourceRef: "../evil-repo", name: "evil", sourceType: "local" },
        { createProject: vi.fn(), getGithubToken: vi.fn() }
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
      initMode: "new-remote",
      settingsOverrides: expect.objectContaining({
        designGuidance: expect.objectContaining({
          selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
          selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
        }),
      }),
    }));
  });

  it("normalizes caller-provided guidance selections while preserving unrelated guidance fields", async () => {
    const createProject = vi.fn().mockResolvedValue({});
    const customTechStack = {
      id: "custom-stack",
      name: "Custom Stack",
      summary: "Custom stack summary",
      instructionMarkdown: "Use the custom stack.",
    };
    const customStyleguide = {
      id: "custom-styleguide",
      name: "Custom Styleguide",
      summary: "Custom styleguide summary",
      instructionMarkdown: "Use the custom styleguide.",
    };

    await initializeProject(
      {
        sourceRef: path.resolve(process.cwd(), "imported-repo"),
        name: "imported",
        sourceType: "local",
        settingsOverrides: {
          designGuidance: {
            selectedTechStackId: customTechStack.id,
            selectedStyleguideId: customStyleguide.id,
            hideDefaultStyleguides: true,
            customTechStacks: [customTechStack],
            customStyleguides: [customStyleguide],
          },
        },
      },
      { createProject, getGithubToken: vi.fn() }
    );

    expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
      settingsOverrides: expect.objectContaining({
        designGuidance: {
          selectedTechStackId: DESIGN_GUIDANCE_NONE_ID,
          selectedStyleguideId: DESIGN_GUIDANCE_NONE_ID,
          hideDefaultStyleguides: true,
          customTechStacks: [customTechStack],
          customStyleguides: [customStyleguide],
        },
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
