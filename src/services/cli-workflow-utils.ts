import type { CliWorkflowSettings, ProviderId, ThinkingMode } from "../contracts/app-types.js";

export const DEFAULT_CLI_WORKFLOW_SETTINGS: CliWorkflowSettings = {
  cleanupWorktreeOnSuccess: true,
  cleanupWorktreeOnFailure: false,
  retryOnReadFileNotFound: true,
  resumeFailedTaskInSameWorkspace: true,
  executionMode: "HOST",
  containerImage: "node:24-bookworm",
  containerSetupScriptPath: "",
  containerCacheSetupScriptImage: false,
  containerMountGitConfig: true,
  containerMountGithubAuth: true,
  containerMountGeminiAuth: true,
  containerMountCodexAuth: true,
  containerMountClaudeCodeAuth: true,
  containerGithubAuthPath: "~/.config/gh",
  containerGeminiAuthPath: "~/.gemini",
  containerCodexAuthPath: "~/.codex",
  containerClaudeCodeAuthPath: "~/.claude",
};

export const CONTAINER_SETUP_SCRIPT = "/opt/jules/setup.sh";

export const sanitizeToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

export const buildWorkerBranch = (featureBranch: string, taskId: string, provider: ProviderId): string => {
  const feature = sanitizeToken(featureBranch.replace(/\//g, "-"));
  const task = sanitizeToken(taskId);
  const suffix = Date.now().toString(36);
  return `task/${feature}-${task}-${provider}-${suffix}`;
};

export const buildProviderPrompt = (prompt: string, thinkingMode: ThinkingMode): string => {
  return [
    "# Thinking Mode",
    `Use ${thinkingMode} reasoning depth.`,
    "",
    prompt,
  ].join("\n");
};
