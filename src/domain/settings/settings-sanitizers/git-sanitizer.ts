import type { DashboardSettings, ExternalSettingsHints, PrDescriptionSettings, SprintPrSectionKey, SprintPrTemplateSections, TaskPrSectionKey, TaskPrTemplateSections } from "../../../contracts/app-types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../repositories/settings-defaults.js";
import { resolveSectionOrder } from "../../sprint/composer/pr-description-composer.js";

const boolOrDefault = (value: unknown, fallback: boolean): boolean => typeof value === "boolean" ? value : fallback;

const sanitizeOrder = <K extends string>(input: unknown, defaultOrder: K[]): K[] => (
  resolveSectionOrder(Array.isArray(input) ? (input.filter((v) => typeof v === "string") as K[]) : undefined, defaultOrder)
);

/** Coerces every field to boolean, defaulting missing/non-boolean values to `true` so settings
 *  rows saved before this feature existed still load with everything enabled. */
export const sanitizePrDescriptionSections = (
  input: Partial<PrDescriptionSettings> | undefined,
): PrDescriptionSettings => {
  const taskInput = (input?.task && typeof input.task === "object" ? input.task : {}) as Partial<TaskPrTemplateSections>;
  const sprintInput = (input?.sprint && typeof input.sprint === "object" ? input.sprint : {}) as Partial<SprintPrTemplateSections>;
  const taskDefaults = DEFAULT_DASHBOARD_SETTINGS.git.prDescription.task;
  const sprintDefaults = DEFAULT_DASHBOARD_SETTINGS.git.prDescription.sprint;

  return {
    task: {
      summary: boolOrDefault(taskInput.summary, taskDefaults.summary),
      modelAndProvider: boolOrDefault(taskInput.modelAndProvider, taskDefaults.modelAndProvider),
      timing: boolOrDefault(taskInput.timing, taskDefaults.timing),
      fullPrompt: boolOrDefault(taskInput.fullPrompt, taskDefaults.fullPrompt),
      tokenUsage: boolOrDefault(taskInput.tokenUsage, taskDefaults.tokenUsage),
      qaFindings: boolOrDefault(taskInput.qaFindings, taskDefaults.qaFindings),
      branchInfo: boolOrDefault(taskInput.branchInfo, taskDefaults.branchInfo),
    },
    sprint: {
      summary: boolOrDefault(sprintInput.summary, sprintDefaults.summary),
      taskChecklist: boolOrDefault(sprintInput.taskChecklist, sprintDefaults.taskChecklist),
      providerBreakdown: boolOrDefault(sprintInput.providerBreakdown, sprintDefaults.providerBreakdown),
      planningModel: boolOrDefault(sprintInput.planningModel, sprintDefaults.planningModel),
      mainPrompt: boolOrDefault(sprintInput.mainPrompt, sprintDefaults.mainPrompt),
      timing: boolOrDefault(sprintInput.timing, sprintDefaults.timing),
      tokenUsage: boolOrDefault(sprintInput.tokenUsage, sprintDefaults.tokenUsage),
      qaFindings: boolOrDefault(sprintInput.qaFindings, sprintDefaults.qaFindings),
      branchInfo: boolOrDefault(sprintInput.branchInfo, sprintDefaults.branchInfo),
    },
    taskSectionOrder: sanitizeOrder<TaskPrSectionKey>(input?.taskSectionOrder, DEFAULT_DASHBOARD_SETTINGS.git.prDescription.taskSectionOrder),
    sprintSectionOrder: sanitizeOrder<SprintPrSectionKey>(input?.sprintSectionOrder, DEFAULT_DASHBOARD_SETTINGS.git.prDescription.sprintSectionOrder),
  };
};

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
    deleteMergedBranches: typeof gitInput.deleteMergedBranches === "boolean"
      ? gitInput.deleteMergedBranches
      : DEFAULT_DASHBOARD_SETTINGS.git.deleteMergedBranches,
    featureBranchPrefix: typeof gitInput.featureBranchPrefix === "string" && gitInput.featureBranchPrefix.trim().length > 0
      ? gitInput.featureBranchPrefix.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.featureBranchPrefix,
    sprintBranchScheme: typeof gitInput.sprintBranchScheme === "string" && gitInput.sprintBranchScheme.trim().length > 0
      ? gitInput.sprintBranchScheme.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.sprintBranchScheme,
    sprintKeyPrefix: typeof gitInput.sprintKeyPrefix === "string" && gitInput.sprintKeyPrefix.trim().length >= 2 && gitInput.sprintKeyPrefix.trim().length <= 10
      ? gitInput.sprintKeyPrefix.trim().toUpperCase()
      : DEFAULT_DASHBOARD_SETTINGS.git.sprintKeyPrefix,
    taskPrTitleScheme: typeof gitInput.taskPrTitleScheme === "string" && gitInput.taskPrTitleScheme.trim().length > 0
      ? gitInput.taskPrTitleScheme.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.taskPrTitleScheme,
    prDescription: sanitizePrDescriptionSections(gitInput.prDescription),
  };
};
