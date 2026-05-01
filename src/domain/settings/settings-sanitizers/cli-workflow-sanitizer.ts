import type { CliExecutionMode, DashboardSettings } from "../../../contracts/app-types.js";
import { readBoolean, readInteger, readString } from "../../../shared/config/value-readers.js";
import {
  CLI_EXECUTION_MODES,
  DEFAULT_DASHBOARD_SETTINGS,
} from "../../../repositories/settings-defaults.js";

export const sanitizeCliWorkflow = (
  input: Partial<DashboardSettings> | undefined
): DashboardSettings["cliWorkflow"] => {
  const cliInput = (input?.cliWorkflow && typeof input.cliWorkflow === "object"
    ? input.cliWorkflow
    : {}) as Partial<DashboardSettings["cliWorkflow"]>;

  const normalizedExecutionMode = CLI_EXECUTION_MODES.includes(cliInput.executionMode as CliExecutionMode)
    ? (cliInput.executionMode as CliExecutionMode)
    : DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.executionMode;

  const containerImage = readString(
    cliInput.containerImage,
    DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerImage
  ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerImage;

  return {
    cleanupWorktreeOnSuccess: readBoolean(
      cliInput.cleanupWorktreeOnSuccess,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.cleanupWorktreeOnSuccess
    ),
    cleanupWorktreeOnFailure: readBoolean(
      cliInput.cleanupWorktreeOnFailure,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.cleanupWorktreeOnFailure
    ),
    retryOnReadFileNotFound: readBoolean(
      cliInput.retryOnReadFileNotFound,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.retryOnReadFileNotFound
    ),
    retryOnQuotaReset: readBoolean(
      cliInput.retryOnQuotaReset,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.retryOnQuotaReset
    ),
    retryOnRateLimit: readBoolean(
      cliInput.retryOnRateLimit,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.retryOnRateLimit
    ),
    rateLimitRetryDelaySeconds: Math.max(1, Math.min(3600, readInteger(
      cliInput.rateLimitRetryDelaySeconds,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.rateLimitRetryDelaySeconds
    ))),
    maxRateLimitRetries: Math.max(1, Math.min(100, readInteger(
      cliInput.maxRateLimitRetries,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.maxRateLimitRetries
    ))),
    maxParsingRetries: Math.max(0, Math.min(10, readInteger(
      cliInput.maxParsingRetries,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.maxParsingRetries
    ))),
    resumeFailedTaskInSameWorkspace: readBoolean(
      cliInput.resumeFailedTaskInSameWorkspace,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.resumeFailedTaskInSameWorkspace
    ),
    executionMode: normalizedExecutionMode,
    containerImage,
    containerSetupScriptPath: readString(
      cliInput.containerSetupScriptPath,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerSetupScriptPath
    ).trim(),
    containerCacheSetupScriptImage: readBoolean(
      cliInput.containerCacheSetupScriptImage,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerCacheSetupScriptImage
    ),
    containerMountGitConfig: readBoolean(
      cliInput.containerMountGitConfig,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountGitConfig
    ),
    containerMountGithubAuth: readBoolean(
      cliInput.containerMountGithubAuth,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountGithubAuth
    ),
    containerMountGeminiAuth: readBoolean(
      cliInput.containerMountGeminiAuth,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountGeminiAuth
    ),
    containerMountCodexAuth: readBoolean(
      cliInput.containerMountCodexAuth,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountCodexAuth
    ),
    containerMountClaudeCodeAuth: readBoolean(
      cliInput.containerMountClaudeCodeAuth,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountClaudeCodeAuth
    ),
    containerMountQwenCodeAuth: readBoolean(
      cliInput.containerMountQwenCodeAuth,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountQwenCodeAuth
    ),
    containerMountOpenCodeAuth: readBoolean(
      cliInput.containerMountOpenCodeAuth,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountOpenCodeAuth
    ),
    containerGithubAuthPath: readString(
      cliInput.containerGithubAuthPath,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerGithubAuthPath
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerGithubAuthPath,
    containerGeminiAuthPath: readString(
      cliInput.containerGeminiAuthPath,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerGeminiAuthPath
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerGeminiAuthPath,
    containerCodexAuthPath: readString(
      cliInput.containerCodexAuthPath,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerCodexAuthPath
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerCodexAuthPath,
    containerClaudeCodeAuthPath: readString(
      cliInput.containerClaudeCodeAuthPath,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerClaudeCodeAuthPath
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerClaudeCodeAuthPath,
    containerQwenCodeAuthPath: readString(
      cliInput.containerQwenCodeAuthPath,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerQwenCodeAuthPath
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerQwenCodeAuthPath,
    containerOpenCodeAuthPath: readString(
      cliInput.containerOpenCodeAuthPath,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerOpenCodeAuthPath
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerOpenCodeAuthPath,
    maxPlanningJsonRetries: Math.max(0, Math.min(10, readInteger(
      cliInput.maxPlanningJsonRetries,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.maxPlanningJsonRetries
    ))),
    maxQuotaRetriesWithoutTimer: Math.max(1, Math.min(20, readInteger(
      cliInput.maxQuotaRetriesWithoutTimer,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.maxQuotaRetriesWithoutTimer
    ))),
  };
};
