import * as fs from "fs/promises";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DockerBootstrapBuilder,
  CODEX_CREDENTIALS_MOUNT,
  GITHUB_CREDENTIALS_MOUNT,
  GEMINI_CREDENTIALS_MOUNT,
  CLAUDE_CODE_CREDENTIALS_MOUNT,
  GITCONFIG_CREDENTIALS_MOUNT,
} from "../../../../../src/infrastructure/providers/cli/docker-bootstrap-builder.js";
import { CONTAINER_SETUP_SCRIPT } from "../../../../../src/services/cli-workflow-utils.js";
import { DockerCredentialMountBuilder } from "../../../../../src/infrastructure/providers/cli/docker-credential-mount-builder.js";
import { CliWorkflowSettings } from "../../../../../src/contracts/app-types.js";

describe("DockerBootstrapBuilder", () => {
  const builder = new DockerBootstrapBuilder();

  it("should build a complete script with default options", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    };

    const script = builder.build(options);

    expect(script).toMatchSnapshot();
  });

  it("should include fallback install cases for specified providers", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
      fallbackProviders: ["gemini"],
    };

    const script = builder.build(options);

    expect(script).toMatchSnapshot();
  });

  it("should handle claude specific auth", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    };

    const script = builder.build(options);

    expect(script).toContain("if [ \"$1\" = \"claude\" ]; then");
    expect(script).toMatchSnapshot();
  });

  it("should not include fallback install if no providers specified", () => {
    const options = {
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
      fallbackProviders: [],
    };

    const script = builder.build(options);
    expect(script).toMatchSnapshot();
  });
});

vi.mock("fs/promises");

describe("DockerCredentialMountBuilder", () => {
  const mockRepoPath = "/mock/repo";
  const mockSettings = {
    containerMountCredentials: true,
    containerMountGitConfig: false,
    containerMountGithubAuth: false,
    containerMountGeminiAuth: false,
    containerMountCodexAuth: false,
    containerMountClaudeCodeAuth: false,
    containerGithubAuthPath: "/mock/gh",
    containerGeminiAuthPath: "/mock/gemini",
    containerCodexAuthPath: "/mock/codex",
    containerClaudeCodeAuthPath: "/mock/claude",
  } as unknown as CliWorkflowSettings;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array if containerMountCredentials is false", async () => {
    const builder = new DockerCredentialMountBuilder();
    const settings = { ...mockSettings, containerMountCredentials: false };
    const onActivity = vi.fn();

    const mounts = await builder.build(settings, mockRepoPath, onActivity);

    expect(mounts).toEqual([]);
    expect(onActivity).toHaveBeenCalledWith("Credential mounts are disabled in workflow settings.");
  });

  it("resolves enabled mounts correctly", async () => {
    const builder = new DockerCredentialMountBuilder();
    const settings = {
      ...mockSettings,
      containerMountGitConfig: true,
      containerMountGithubAuth: true,
      containerMountGeminiAuth: true,
      containerMountCodexAuth: true,
      containerMountClaudeCodeAuth: true,
    };
    const onActivity = vi.fn();

    vi.mocked(fs.access).mockResolvedValue(undefined);

    const mounts = await builder.build(settings, mockRepoPath, onActivity);

    expect(mounts).toHaveLength(5);
    expect(mounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ destination: GITCONFIG_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: GITHUB_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: GEMINI_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: CODEX_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: CLAUDE_CODE_CREDENTIALS_MOUNT }),
    ]));
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Resolved credential mount for GitConfig"));
  });

  it("skips mounts if source path does not exist", async () => {
    const builder = new DockerCredentialMountBuilder();
    const settings = {
      ...mockSettings,
      containerMountGitConfig: true,
      containerMountGithubAuth: true,
    };
    const onActivity = vi.fn();

    vi.mocked(fs.access).mockRejectedValue(new Error("ENOENT"));

    const mounts = await builder.build(settings, mockRepoPath, onActivity);

    expect(mounts).toHaveLength(0);
    expect(onActivity).toHaveBeenCalledWith(expect.stringContaining("Credential mount for GitConfig is enabled but source path does not exist:"));
  });

  it("skips mount if source path is empty string", async () => {
    const builder = new DockerCredentialMountBuilder();
    const settings = {
      ...mockSettings,
      containerMountGithubAuth: true,
      containerGithubAuthPath: "", // Empty path
    };
    const onActivity = vi.fn();

    const mounts = await builder.build(settings, mockRepoPath, onActivity);

    expect(mounts).toHaveLength(0);
    expect(onActivity).toHaveBeenCalledWith("Credential mount for GitHub is enabled but source path is empty.");
  });
});
