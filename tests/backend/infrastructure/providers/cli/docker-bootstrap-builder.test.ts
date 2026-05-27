import * as fs from "fs/promises";
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  DockerBootstrapBuilder,
  CODEX_CREDENTIALS_MOUNT,
  GITHUB_CREDENTIALS_MOUNT,
  GEMINI_CREDENTIALS_MOUNT,
  CLAUDE_CODE_CREDENTIALS_MOUNT,
  CLAUDE_CODE_AUTH_JSON_MOUNT,
  QWEN_CODE_CREDENTIALS_MOUNT,
  OPENCODE_CREDENTIALS_MOUNT,
  GITCONFIG_CREDENTIALS_MOUNT,
  CLAUDE_CODE_MCP_CONFIG_MOUNT,
  GEMINI_MCP_SETTINGS_MOUNT,
  CODEX_MCP_CONFIG_MOUNT,
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

    expect(script).toContain("export PNPM_STORE_DIR=\"$NPM_CONFIG_CACHE/pnpm-store\"");
    expect(script).toContain("export pnpm_config_store_dir=\"$PNPM_STORE_DIR\"");
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

  it("syncs only Gemini auth artifacts instead of recursively copying Gemini runtime state", () => {
    const script = builder.build({
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    });

    expect(script).toContain("if [ \"$1\" = \"gemini\" ]; then");
    expect(script).toContain("ensure_json_file \"$HOME/.gemini/projects.json\" '{\"projects\":{}}'");
    expect(script).toContain("oauth_creds.json");
    expect(script).not.toContain(`sync_dir_contents "${GEMINI_CREDENTIALS_MOUNT}" "$HOME/.gemini"`);
  });

  it("copies provider-generated MCP config into runtime home instead of mounting it there directly", () => {
    const script = builder.build({
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    });

    expect(script).toContain(`merge_json_file "${CLAUDE_CODE_MCP_CONFIG_MOUNT}" "$HOME/.mcp.json"`);
    expect(script).toContain(`merge_json_file "${GEMINI_MCP_SETTINGS_MOUNT}" "$HOME/.gemini/settings.json"`);
    expect(script).toContain(`append_if_missing_literal "${CODEX_MCP_CONFIG_MOUNT}" "$HOME/.codex/config.toml" "[mcp_servers.code-ux]"`);
    expect(script).toContain(`merge_json_file "/opt/provider-config/qwen-settings.json" "$HOME/.qwen/settings.json"`);
  });

  it("writes generated OpenCode config content to the runtime config path", () => {
    const script = builder.build({
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    });

    expect(script).toContain("materialize_opencode_config()");
    expect(script).toContain("printf '%s\\n' \"$OPENCODE_CONFIG_CONTENT\" > \"$destination\"");
    expect(script).toContain("export OPENCODE_CONFIG=\"$destination\"");
    expect(script).toContain("  materialize_opencode_config");
  });

  it("can source provider argv from a mounted file before executing the provider command", () => {
    const script = builder.build({
      runtimeNpmPrefix: "/runtime/npm-global",
      runtimeNpmCache: "/runtime/npm-cache",
    });

    expect(script).toContain("CODE_UX_PROVIDER_ARGS=()");
    expect(script).toContain("source \"$CODE_UX_PROVIDER_ARGV_FILE\"");
    expect(script).toContain("exec \"$1\" \"${CODE_UX_PROVIDER_ARGS[@]}\"");
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
    containerMountGitConfig: false,
    containerMountGithubAuth: false,
    containerMountGeminiAuth: false,
    containerMountCodexAuth: false,
    containerMountClaudeCodeAuth: false,
    containerMountQwenCodeAuth: false,
    containerMountOpenCodeAuth: false,
    containerGithubAuthPath: "/mock/gh",
    containerGeminiAuthPath: "/mock/gemini",
    containerCodexAuthPath: "/mock/codex",
    containerClaudeCodeAuthPath: "/mock/claude",
    containerQwenCodeAuthPath: "/mock/qwen",
    containerOpenCodeAuthPath: "/mock/opencode",
  } as unknown as CliWorkflowSettings;

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array if no credential mounts are enabled", async () => {
    const builder = new DockerCredentialMountBuilder();
    const settings = { ...mockSettings };
    const onActivity = vi.fn();

    const mounts = await builder.build(settings, mockRepoPath, onActivity);

    expect(mounts).toEqual([]);
    expect(onActivity).toHaveBeenCalledWith("No container credential mounts were enabled or resolved.");
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
      containerMountQwenCodeAuth: true,
      containerMountOpenCodeAuth: true,
    };
    const onActivity = vi.fn();

    vi.mocked(fs.access).mockResolvedValue(undefined);

    const mounts = await builder.build(settings, mockRepoPath, onActivity);

    expect(mounts).toHaveLength(8);
    expect(mounts).toEqual(expect.arrayContaining([
      expect.objectContaining({ destination: GITCONFIG_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: GITHUB_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: GEMINI_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: CODEX_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: CLAUDE_CODE_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: CLAUDE_CODE_AUTH_JSON_MOUNT }),
      expect.objectContaining({ destination: QWEN_CODE_CREDENTIALS_MOUNT }),
      expect.objectContaining({ destination: OPENCODE_CREDENTIALS_MOUNT }),
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
