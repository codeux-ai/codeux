import type { CliWorkflowSettings, ProviderId, ThinkingMode } from "../contracts/app-types.js";

export const DEFAULT_CLI_WORKFLOW_SETTINGS: CliWorkflowSettings = {
  cleanupWorktreeOnSuccess: true,
  cleanupWorktreeOnFailure: false,
  retryOnReadFileNotFound: true,
  retryOnQuotaReset: true,
  retryOnRateLimit: true,
  rateLimitRetryDelaySeconds: 10,
  maxRateLimitRetries: 5,
  maxParsingRetries: 3,
  resumeFailedTaskInSameWorkspace: true,
  gitMode: "remote",
  executionMode: "DOCKER",
  containerImage: "node:24-bookworm",
  containerSetupScriptPath: "",
  containerCacheSetupScriptImage: true,
  containerMountGitConfig: false,
  containerGitUserName: "Code UX",
  containerGitUserEmail: "agents@codeux.ai",
  containerMountGithubAuth: false,
  containerMountGeminiAuth: false,
  containerMountCodexAuth: false,
  containerMountClaudeCodeAuth: false,
  containerMountQwenCodeAuth: false,
  containerMountOpenCodeAuth: false,
  containerMountAntigravityAuth: true,
  containerGithubAuthPath: "~/.config/gh",
  containerGeminiAuthPath: "~/.gemini",
  containerCodexAuthPath: "~/.codex",
  containerClaudeCodeAuthPath: "~/.claude",
  containerQwenCodeAuthPath: "~/.qwen",
  containerOpenCodeAuthPath: "~/.local/share/opencode",
  containerAntigravityAuthPath: "~/.antigravity",
  maxPlanningJsonRetries: 3,
  maxQuotaRetriesWithoutTimer: 5,
};

export const CONTAINER_SETUP_SCRIPT = "/opt/jules/setup.sh";

export const sanitizeToken = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

/**
 * The stable portion of a worker branch name — everything {@link buildWorkerBranch}
 * produces except the trailing time-based suffix. Used to find an existing worker
 * branch for a task by prefix when the recorded `worker_branch` evidence was lost
 * (e.g. cleared during a LOCAL-mode QA re-run cycle).
 */
export const buildWorkerBranchPrefix = (featureBranch: string, taskId: string, provider?: ProviderId): string => {
  const feature = sanitizeToken(featureBranch.replace(/\//g, "-"));
  const task = sanitizeToken(taskId);
  return provider ? `task/${feature}-${task}-${provider}-` : `task/${feature}-${task}-`;
};

export const buildWorkerBranch = (featureBranch: string, taskId: string, provider: ProviderId): string => {
  const suffix = Date.now().toString(36);
  return `${buildWorkerBranchPrefix(featureBranch, taskId, provider)}${suffix}`;
};

export const buildProviderPrompt = (prompt: string, thinkingMode: ThinkingMode): string => {
  return [
    "# Thinking Mode",
    `Use ${thinkingMode} reasoning depth.`,
    "",
    prompt,
  ].join("\n");
};
