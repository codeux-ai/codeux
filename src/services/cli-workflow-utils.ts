import { createHash } from "node:crypto";
import type { CliWorkflowSettings, ProviderId, ThinkingMode } from "../contracts/app-types.js";
import { normalizeProviderThinkingMode } from "../repositories/settings-defaults.js";

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
  containerMemoryLimitMb: 6144,
  containerCacheSetupScriptImage: true,
  containerInstallPlaywrightBrowsers: true,
  containerRunAsRoot: false,
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

const WORKER_BRANCH_FEATURE_TOKEN_LENGTH = 16;
const WORKER_BRANCH_TASK_TOKEN_LENGTH = 18;
const WORKER_BRANCH_PROVIDER_TOKEN_LENGTH = 10;
const WORKER_BRANCH_HASH_LENGTH = 8;

const shortHash = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, WORKER_BRANCH_HASH_LENGTH);

const trimBranchToken = (value: string, maxLength: number, fallback: string): string => {
  const trimmed = value.slice(0, maxLength).replace(/[._-]+$/g, "");
  return trimmed || fallback;
};

/**
 * The stable portion of a worker branch name — everything {@link buildWorkerBranch}
 * produces except the trailing time-based suffix. Used to find an existing worker
 * branch for a task by prefix when the recorded `worker_branch` evidence was lost
 * (e.g. cleared during a LOCAL-mode QA re-run cycle).
 */
export const buildWorkerBranchPrefix = (featureBranch: string, taskId: string, provider?: ProviderId): string => {
  const feature = trimBranchToken(sanitizeToken(featureBranch.replace(/\//g, "-")), WORKER_BRANCH_FEATURE_TOKEN_LENGTH, "feature");
  const task = trimBranchToken(sanitizeToken(taskId), WORKER_BRANCH_TASK_TOKEN_LENGTH, "task");
  const hash = shortHash(`${featureBranch}\0${taskId}\0${provider ?? ""}`);
  if (!provider) {
    return `task/${feature}-${task}-${hash}-`;
  }
  const providerToken = trimBranchToken(sanitizeToken(provider), WORKER_BRANCH_PROVIDER_TOKEN_LENGTH, "provider");
  return `task/${feature}-${task}-${providerToken}-${hash}-`;
};

export const buildWorkerBranch = (featureBranch: string, taskId: string, provider: ProviderId): string => {
  const suffix = Date.now().toString(36);
  return `${buildWorkerBranchPrefix(featureBranch, taskId, provider)}${suffix}`;
};

export const buildProviderPrompt = (prompt: string, thinkingMode: ThinkingMode, provider?: ProviderId): string => {
  if (provider === "codex" || provider === "claude-code" || provider === "qwen-code" || provider === "opencode") {
    return prompt;
  }
  if (provider === "jules" || provider === "mockup-cli") {
    return prompt;
  }
  if (provider === "gemini") {
    const mode = normalizeProviderThinkingMode(provider, thinkingMode);
    return [
      "# Gemini Thinking Level",
      `Use Gemini thinking_level "${mode}" when the selected model supports it.`,
      "",
      prompt,
    ].join("\n");
  }
  if (provider === "antigravity") {
    const mode = normalizeProviderThinkingMode(provider, thinkingMode);
    return [
      "# Antigravity Reasoning",
      `Use ${mode} reasoning effort for this task.`,
      "",
      prompt,
    ].join("\n");
  }
  return [
    "# Thinking Mode",
    `Use ${String(thinkingMode)} reasoning depth.`,
    "",
    prompt,
  ].join("\n");
};
