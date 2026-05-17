import type { DashboardSettings, ExternalSettingsHints } from "../../../contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../repositories/settings-defaults.js";

export const sanitizeGit = (
  input: Partial<DashboardSettings> | undefined,
  externalHints?: ExternalSettingsHints
): DashboardSettings["git"] => {
  const gitInput = (input?.git && typeof input.git === "object" ? input.git : {}) as Partial<DashboardSettings["git"]>;

  return {
    githubMode: gitInput.githubMode === "LOCAL" ? "LOCAL" as const : "REMOTE" as const,
    githubToken: typeof gitInput.githubToken === "string" ? gitInput.githubToken : (externalHints?.resolved.githubToken || ""),
    gitlabToken: typeof gitInput.gitlabToken === "string" ? gitInput.gitlabToken : (externalHints?.resolved.gitlabToken || ""),
    defaultBranch: typeof gitInput.defaultBranch === "string" && gitInput.defaultBranch.trim().length > 0
      ? gitInput.defaultBranch.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.defaultBranch,
    autoCreatePr: typeof gitInput.autoCreatePr === "boolean" ? gitInput.autoCreatePr : DEFAULT_DASHBOARD_SETTINGS.git.autoCreatePr,
    autoCloseLinkedIssues: typeof gitInput.autoCloseLinkedIssues === "boolean"
      ? gitInput.autoCloseLinkedIssues
      : DEFAULT_DASHBOARD_SETTINGS.git.autoCloseLinkedIssues,
    featureBranchPrefix: typeof gitInput.featureBranchPrefix === "string" && gitInput.featureBranchPrefix.trim().length > 0
      ? gitInput.featureBranchPrefix.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.featureBranchPrefix,
    sprintBranchScheme: typeof gitInput.sprintBranchScheme === "string" && gitInput.sprintBranchScheme.trim().length > 0
      ? gitInput.sprintBranchScheme.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.sprintBranchScheme,
  };
};
