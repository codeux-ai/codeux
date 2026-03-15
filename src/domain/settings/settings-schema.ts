import type {
  DashboardSettings,
  AutomationLevel,
  ProviderId,
  ThinkingMode,
  ProviderStrategy,
  CliExecutionMode,
  FeaturePrAutoMergeMode,
  ProviderSettings,
  SkillToggle,
  McpToolToggle,
  VirtualWorkerProvider,
  WorkerExecutionMode,
} from "../../contracts/app-types.js";
import {
  PROVIDER_IDS,
  THINKING_MODES,
  PROVIDER_STRATEGIES,
  CLI_EXECUTION_MODES,
  FEATURE_PR_AUTOMERGE_MODES,
  VIRTUAL_WORKER_PROVIDERS,
  WORKER_EXECUTION_MODES,
} from "../../repositories/settings-defaults.js";
import { INSTRUCTION_TEMPLATE_IDS } from "../../instructions/instruction-template-catalog.js";

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult<T> {
  success: boolean;
  issues: ValidationIssue[];
  data?: T;
}

export class SettingsValidationError extends Error {
  public issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super(`Validation failed with ${issues.length} issues.`);
    this.name = "SettingsValidationError";
    this.issues = issues;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const validateProviderSettings = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.enabled !== "boolean") {
    issues.push({ path: `${path}.enabled`, message: "Expected a boolean" });
  }
  if (typeof value.model !== "string") {
    issues.push({ path: `${path}.model`, message: "Expected a string" });
  }
  if (typeof value.weight !== "number") {
    issues.push({ path: `${path}.weight`, message: "Expected a number" });
  }
  if (typeof value.thinkingMode !== "string" || !THINKING_MODES.includes(value.thinkingMode as ThinkingMode)) {
    issues.push({ path: `${path}.thinkingMode`, message: `Expected one of: ${THINKING_MODES.join(", ")}` });
  }
  if (typeof value.apiKey !== "string") {
    issues.push({ path: `${path}.apiKey`, message: "Expected a string" });
  }
};

const validateAiProvider = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.provider !== "string" || !PROVIDER_IDS.includes(value.provider as ProviderId)) {
    issues.push({ path: `${path}.provider`, message: `Expected one of: ${PROVIDER_IDS.join(", ")}` });
  }
  if (typeof value.strategy !== "string" || !PROVIDER_STRATEGIES.includes(value.strategy as ProviderStrategy)) {
    issues.push({ path: `${path}.strategy`, message: `Expected one of: ${PROVIDER_STRATEGIES.join(", ")}` });
  }
  if (typeof value.julesApiKey !== "string") {
    issues.push({ path: `${path}.julesApiKey`, message: "Expected a string" });
  }

  const providers = value.providers;
  if (!isRecord(providers)) {
    issues.push({ path: `${path}.providers`, message: "Expected an object" });
  } else {
    for (const id of PROVIDER_IDS) {
      if (id in providers) {
        validateProviderSettings(providers[id], `${path}.providers.${id}`, issues);
      } else {
        issues.push({ path: `${path}.providers.${id}`, message: "Missing provider settings" });
      }
    }
  }
};

const validateGitSettings = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (value.githubMode !== "REMOTE" && value.githubMode !== "LOCAL") {
    issues.push({ path: `${path}.githubMode`, message: "Expected 'REMOTE' or 'LOCAL'" });
  }
  if (typeof value.githubToken !== "string") {
    issues.push({ path: `${path}.githubToken`, message: "Expected a string" });
  }
  if (typeof value.defaultBranch !== "string") {
    issues.push({ path: `${path}.defaultBranch`, message: "Expected a string" });
  }
  if (typeof value.autoCreatePr !== "boolean") {
    issues.push({ path: `${path}.autoCreatePr`, message: "Expected a boolean" });
  }
  if (typeof value.featureBranchPrefix !== "string") {
    issues.push({ path: `${path}.featureBranchPrefix`, message: "Expected a string" });
  }
  if (typeof value.sprintBranchScheme !== "string") {
    issues.push({ path: `${path}.sprintBranchScheme`, message: "Expected a string" });
  }
};

const validateCiIntelligence = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.enabled !== "boolean") issues.push({ path: `${path}.enabled`, message: "Expected a boolean" });
  if (typeof value.enableLivePrMonitoring !== "boolean") issues.push({ path: `${path}.enableLivePrMonitoring`, message: "Expected a boolean" });
  if (typeof value.waitForCiBeforeMainMerge !== "boolean") issues.push({ path: `${path}.waitForCiBeforeMainMerge`, message: "Expected a boolean" });
  if (typeof value.resolveAllCommentsBeforeMainMerge !== "boolean") issues.push({ path: `${path}.resolveAllCommentsBeforeMainMerge`, message: "Expected a boolean" });
  if (typeof value.resolveMainMergeConflicts !== "boolean") issues.push({ path: `${path}.resolveMainMergeConflicts`, message: "Expected a boolean" });
  if (typeof value.waitForCiBeforeFeatureMerge !== "boolean") issues.push({ path: `${path}.waitForCiBeforeFeatureMerge`, message: "Expected a boolean" });
  if (typeof value.resolveAllCommentsBeforeFeatureMerge !== "boolean") issues.push({ path: `${path}.resolveAllCommentsBeforeFeatureMerge`, message: "Expected a boolean" });
  if (typeof value.resolveMergeConflicts !== "boolean") issues.push({ path: `${path}.resolveMergeConflicts`, message: "Expected a boolean" });
  if (typeof value.waitForJulesCiAutofix !== "boolean") issues.push({ path: `${path}.waitForJulesCiAutofix`, message: "Expected a boolean" });
  if (typeof value.julesCiAutofixMaxRetries !== "number") issues.push({ path: `${path}.julesCiAutofixMaxRetries`, message: "Expected a number" });
  if (typeof value.featurePrAutoMergeMode !== "string" || !FEATURE_PR_AUTOMERGE_MODES.includes(value.featurePrAutoMergeMode as FeaturePrAutoMergeMode)) {
    issues.push({ path: `${path}.featurePrAutoMergeMode`, message: `Expected one of: ${FEATURE_PR_AUTOMERGE_MODES.join(", ")}` });
  }
};

const validateSprintLoopSteps = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.branchPreflight !== "boolean") issues.push({ path: `${path}.branchPreflight`, message: "Expected a boolean" });
  if (typeof value.planningPreflight !== "boolean") issues.push({ path: `${path}.planningPreflight`, message: "Expected a boolean" });
  if (typeof value.loadSubtasks !== "boolean") issues.push({ path: `${path}.loadSubtasks`, message: "Expected a boolean" });
  if (typeof value.sessionSync !== "boolean") issues.push({ path: `${path}.sessionSync`, message: "Expected a boolean" });
  if (typeof value.statusDerivation !== "boolean") issues.push({ path: `${path}.statusDerivation`, message: "Expected a boolean" });
  if (typeof value.startReadyTasks !== "boolean") issues.push({ path: `${path}.startReadyTasks`, message: "Expected a boolean" });
  if (typeof value.mergeProtocol !== "boolean") issues.push({ path: `${path}.mergeProtocol`, message: "Expected a boolean" });
  if (typeof value.actionRequiredProtocol !== "boolean") issues.push({ path: `${path}.actionRequiredProtocol`, message: "Expected a boolean" });
  if (typeof value.statusTable !== "boolean") issues.push({ path: `${path}.statusTable`, message: "Expected a boolean" });
  if (typeof value.watchLoop !== "boolean") issues.push({ path: `${path}.watchLoop`, message: "Expected a boolean" });
  if (typeof value.watchLoopIntervalSeconds !== "number") issues.push({ path: `${path}.watchLoopIntervalSeconds`, message: "Expected a number" });
  if (typeof value.watchLoopOutputIntervalSeconds !== "number") issues.push({ path: `${path}.watchLoopOutputIntervalSeconds`, message: "Expected a number" });
};

const validateCliWorkflow = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.cleanupWorktreeOnSuccess !== "boolean") issues.push({ path: `${path}.cleanupWorktreeOnSuccess`, message: "Expected a boolean" });
  if (typeof value.cleanupWorktreeOnFailure !== "boolean") issues.push({ path: `${path}.cleanupWorktreeOnFailure`, message: "Expected a boolean" });
  if (typeof value.retryOnReadFileNotFound !== "boolean") issues.push({ path: `${path}.retryOnReadFileNotFound`, message: "Expected a boolean" });
  if (typeof value.resumeFailedTaskInSameWorkspace !== "boolean") issues.push({ path: `${path}.resumeFailedTaskInSameWorkspace`, message: "Expected a boolean" });
  if (typeof value.executionMode !== "string" || !CLI_EXECUTION_MODES.includes(value.executionMode as CliExecutionMode)) {
    issues.push({ path: `${path}.executionMode`, message: `Expected one of: ${CLI_EXECUTION_MODES.join(", ")}` });
  }
  if (typeof value.containerImage !== "string") issues.push({ path: `${path}.containerImage`, message: "Expected a string" });
  if (typeof value.containerSetupScriptPath !== "string") issues.push({ path: `${path}.containerSetupScriptPath`, message: "Expected a string" });
  if (typeof value.containerCacheSetupScriptImage !== "boolean") issues.push({ path: `${path}.containerCacheSetupScriptImage`, message: "Expected a boolean" });
  if (typeof value.containerMountGitConfig !== "boolean") issues.push({ path: `${path}.containerMountGitConfig`, message: "Expected a boolean" });
  if (typeof value.containerMountGithubAuth !== "boolean") issues.push({ path: `${path}.containerMountGithubAuth`, message: "Expected a boolean" });
  if (typeof value.containerMountGeminiAuth !== "boolean") issues.push({ path: `${path}.containerMountGeminiAuth`, message: "Expected a boolean" });
  if (typeof value.containerMountCodexAuth !== "boolean") issues.push({ path: `${path}.containerMountCodexAuth`, message: "Expected a boolean" });
  if (typeof value.containerMountClaudeCodeAuth !== "boolean") issues.push({ path: `${path}.containerMountClaudeCodeAuth`, message: "Expected a boolean" });
  if (typeof value.containerGithubAuthPath !== "string") issues.push({ path: `${path}.containerGithubAuthPath`, message: "Expected a string" });
  if (typeof value.containerGeminiAuthPath !== "string") issues.push({ path: `${path}.containerGeminiAuthPath`, message: "Expected a string" });
  if (typeof value.containerCodexAuthPath !== "string") issues.push({ path: `${path}.containerCodexAuthPath`, message: "Expected a string" });
  if (typeof value.containerClaudeCodeAuthPath !== "string") issues.push({ path: `${path}.containerClaudeCodeAuthPath`, message: "Expected a string" });
};

const validateWorkers = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.executionMode !== "string" || !WORKER_EXECUTION_MODES.includes(value.executionMode as WorkerExecutionMode)) {
    issues.push({ path: `${path}.executionMode`, message: `Expected one of: ${WORKER_EXECUTION_MODES.join(", ")}` });
  }
  if (
    typeof value.virtualWorkerProvider !== "string"
    || !VIRTUAL_WORKER_PROVIDERS.includes(value.virtualWorkerProvider as VirtualWorkerProvider)
  ) {
    issues.push({ path: `${path}.virtualWorkerProvider`, message: `Expected one of: ${VIRTUAL_WORKER_PROVIDERS.join(", ")}` });
  }
};

const validateAgents = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.saveToProjectDirectory !== "boolean") {
    issues.push({ path: `${path}.saveToProjectDirectory`, message: "Expected a boolean" });
  }
  if (!isRecord(value.instructionTemplates)) {
    issues.push({ path: `${path}.instructionTemplates`, message: "Expected an object" });
    return;
  }
  for (const templateId of INSTRUCTION_TEMPLATE_IDS) {
    if (typeof value.instructionTemplates[templateId] !== "string") {
      issues.push({ path: `${path}.instructionTemplates.${templateId}`, message: "Expected a string" });
    }
  }
};

const validateSkills = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected an array" });
    return;
  }
  value.forEach((skill, index) => {
    if (!isRecord(skill)) {
      issues.push({ path: `${path}[${index}]`, message: "Expected an object" });
      return;
    }
    if (typeof skill.name !== "string") issues.push({ path: `${path}[${index}].name`, message: "Expected a string" });
    if (typeof skill.enabled !== "boolean") issues.push({ path: `${path}[${index}].enabled`, message: "Expected a boolean" });
    if (skill.isInternal !== undefined && typeof skill.isInternal !== "boolean") issues.push({ path: `${path}[${index}].isInternal`, message: "Expected a boolean" });
  });
};

const validateMcpTools = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!Array.isArray(value)) {
    issues.push({ path, message: "Expected an array" });
    return;
  }
  value.forEach((tool, index) => {
    if (!isRecord(tool)) {
      issues.push({ path: `${path}[${index}]`, message: "Expected an object" });
      return;
    }
    if (typeof tool.name !== "string") issues.push({ path: `${path}[${index}].name`, message: "Expected a string" });
    if (typeof tool.enabled !== "boolean") issues.push({ path: `${path}[${index}].enabled`, message: "Expected a boolean" });
    if (tool.isInternal !== undefined && typeof tool.isInternal !== "boolean") issues.push({ path: `${path}[${index}].isInternal`, message: "Expected a boolean" });
  });
};

const validateAutomationInterventions = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.autoApprovePlan !== "boolean") issues.push({ path: `${path}.autoApprovePlan`, message: "Expected a boolean" });
  if (typeof value.autoAnswerClarification !== "boolean") issues.push({ path: `${path}.autoAnswerClarification`, message: "Expected a boolean" });
  if (typeof value.autoResumePaused !== "boolean") issues.push({ path: `${path}.autoResumePaused`, message: "Expected a boolean" });
  if (typeof value.clarificationAnswerTemplate !== "string") issues.push({ path: `${path}.clarificationAnswerTemplate`, message: "Expected a string" });
};

export const validateSettingsPayload = (payload: unknown): ValidationResult<DashboardSettings> => {
  const issues: ValidationIssue[] = [];

  if (!isRecord(payload)) {
    issues.push({ path: "root", message: "Payload must be an object" });
    return { success: false, issues };
  }

  if (typeof payload.dashboardPort !== "number") {
    issues.push({ path: "dashboardPort", message: "Expected a number" });
  }

  if (typeof payload.enableDebugLogFile !== "boolean") {
    issues.push({ path: "enableDebugLogFile", message: "Expected a boolean" });
  }

  const validAutomationLevels: AutomationLevel[] = ["FULL", "SEMI_AUTO", "ALWAYS_ASK"];
  if (typeof payload.automationLevel !== "string" || !validAutomationLevels.includes(payload.automationLevel as AutomationLevel)) {
    issues.push({ path: "automationLevel", message: `Expected one of: ${validAutomationLevels.join(", ")}` });
  }

  validateAutomationInterventions(payload.automationInterventions, "automationInterventions", issues);
  validateAiProvider(payload.aiProvider, "aiProvider", issues);
  validateGitSettings(payload.git, "git", issues);
  validateCiIntelligence(payload.ciIntelligence, "ciIntelligence", issues);
  validateSprintLoopSteps(payload.sprintLoopSteps, "sprintLoopSteps", issues);
  validateCliWorkflow(payload.cliWorkflow, "cliWorkflow", issues);
  validateWorkers(payload.workers, "workers", issues);
  validateAgents(payload.agents, "agents", issues);
  validateSkills(payload.skills, "skills", issues);
  validateMcpTools(payload.mcpTools, "mcpTools", issues);

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return { success: true, issues: [], data: payload as unknown as DashboardSettings };
};
