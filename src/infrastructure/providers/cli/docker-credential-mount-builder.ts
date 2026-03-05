import * as fs from "fs/promises";
import { resolveConfiguredPath, ContainerMount } from "../../../services/cli-docker-utils.js";
import { CliWorkflowSettings } from "../../../contracts/app-types.js";
import {
  CODEX_CREDENTIALS_MOUNT,
  GITHUB_CREDENTIALS_MOUNT,
  GEMINI_CREDENTIALS_MOUNT,
  CLAUDE_CODE_CREDENTIALS_MOUNT,
  GITCONFIG_CREDENTIALS_MOUNT,
} from "./docker-bootstrap-builder.js";

export class DockerCredentialMountBuilder {
  async build(
    workflowSettings: CliWorkflowSettings,
    repoPath: string,
    onActivity: (desc: string) => void
  ): Promise<ContainerMount[]> {
    if (!workflowSettings.containerMountCredentials) {
      onActivity("Credential mounts are disabled in workflow settings.");
      return [];
    }

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
    await addMount(workflowSettings.containerMountGeminiAuth, workflowSettings.containerGeminiAuthPath, GEMINI_CREDENTIALS_MOUNT, "Gemini");
    await addMount(workflowSettings.containerMountCodexAuth, workflowSettings.containerCodexAuthPath, CODEX_CREDENTIALS_MOUNT, "Codex");
    await addMount(workflowSettings.containerMountClaudeCodeAuth, workflowSettings.containerClaudeCodeAuthPath, CLAUDE_CODE_CREDENTIALS_MOUNT, "Claude Code");

    return mounts;
  }
}
