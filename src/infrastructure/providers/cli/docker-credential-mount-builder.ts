import * as fs from "fs/promises";
import * as path from "path";
import { resolveConfiguredPath, ContainerMount } from "../../../services/cli-docker-utils.js";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import {
  CODEX_CREDENTIALS_MOUNT,
  GITHUB_CREDENTIALS_MOUNT,
  GEMINI_CREDENTIALS_MOUNT,
  CLAUDE_CODE_CREDENTIALS_MOUNT,
  CLAUDE_CODE_AUTH_JSON_MOUNT,
  QWEN_CODE_CREDENTIALS_MOUNT,
  GITCONFIG_CREDENTIALS_MOUNT,
} from "./docker-bootstrap-builder.js";

export class DockerCredentialMountBuilder {
  async build(
    workflowSettings: CliWorkflowSettings,
    repoPath: string,
    onActivity: (desc: string) => void,
    providerAuthOverride?: {
      provider: "gemini" | "codex" | "claude-code" | "qwen-code";
      enabled: boolean;
      path: string;
    },
  ): Promise<ContainerMount[]> {
    const mounts: ContainerMount[] = [];

    const addMount = async (enabled: boolean, source: string, dest: string, label: string) => {
      if (!enabled) {
        onActivity(`Credential mount for ${label} is disabled.`);
        return;
      }

      if (!source || source.trim().length === 0) {
        onActivity(`Credential mount for ${label} is enabled but source path is empty.`);
        return;
      }

      const p = resolveConfiguredPath(repoPath, source);
      try {
        await fs.access(p);
        mounts.push({ source: p, destination: dest, readonly: true });
        onActivity(`Resolved credential mount for ${label}: ${p} -> ${dest}`);
      } catch {
        onActivity(`Credential mount for ${label} is enabled but source path does not exist: ${p}`);
      }
    };

    await addMount(workflowSettings.containerMountGitConfig, "~/.gitconfig", GITCONFIG_CREDENTIALS_MOUNT, "GitConfig");
    await addMount(workflowSettings.containerMountGithubAuth, workflowSettings.containerGithubAuthPath, GITHUB_CREDENTIALS_MOUNT, "GitHub");
    await addMount(
      providerAuthOverride?.provider === "gemini" ? providerAuthOverride.enabled : workflowSettings.containerMountGeminiAuth,
      providerAuthOverride?.provider === "gemini" ? providerAuthOverride.path : workflowSettings.containerGeminiAuthPath,
      GEMINI_CREDENTIALS_MOUNT,
      "Gemini",
    );
    await addMount(
      providerAuthOverride?.provider === "codex" ? providerAuthOverride.enabled : workflowSettings.containerMountCodexAuth,
      providerAuthOverride?.provider === "codex" ? providerAuthOverride.path : workflowSettings.containerCodexAuthPath,
      CODEX_CREDENTIALS_MOUNT,
      "Codex",
    );
    const claudeMountEnabled = providerAuthOverride?.provider === "claude-code"
      ? providerAuthOverride.enabled
      : workflowSettings.containerMountClaudeCodeAuth;
    const claudeMountPath = providerAuthOverride?.provider === "claude-code"
      ? providerAuthOverride.path
      : workflowSettings.containerClaudeCodeAuthPath;
    await addMount(claudeMountEnabled, claudeMountPath, CLAUDE_CODE_CREDENTIALS_MOUNT, "Claude Code");
    if (claudeMountEnabled && claudeMountPath.trim().length > 0) {
      const claudeAuthDir = resolveConfiguredPath(repoPath, claudeMountPath);
      const claudeAuthJsonPath = path.join(path.dirname(claudeAuthDir), ".claude.json");
      try {
        await fs.access(claudeAuthJsonPath);
        mounts.push({ source: claudeAuthJsonPath, destination: CLAUDE_CODE_AUTH_JSON_MOUNT, readonly: true });
        onActivity(`Resolved credential mount for Claude Code auth JSON: ${claudeAuthJsonPath} -> ${CLAUDE_CODE_AUTH_JSON_MOUNT}`);
      } catch {
        onActivity(`Optional credential mount for Claude Code auth JSON not found: ${claudeAuthJsonPath}`);
      }
    }
    await addMount(
      providerAuthOverride?.provider === "qwen-code" ? providerAuthOverride.enabled : workflowSettings.containerMountQwenCodeAuth,
      providerAuthOverride?.provider === "qwen-code" ? providerAuthOverride.path : workflowSettings.containerQwenCodeAuthPath,
      QWEN_CODE_CREDENTIALS_MOUNT,
      "Qwen Code",
    );

    if (mounts.length === 0) {
      onActivity("No container credential mounts were enabled or resolved.");
    }

    return mounts;
  }
}
