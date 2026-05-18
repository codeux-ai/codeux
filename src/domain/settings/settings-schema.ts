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
  InvocationRoutingId,
  InvocationRoutingProfile,
  ConsoleLogLevel,
} from "../../contracts/app-types.js";
import { EMBEDDING_MODEL_IDS } from "../../contracts/memory-types.js";
import type { EmbeddingModelId } from "../../contracts/memory-types.js";
import {
  PROVIDER_IDS,
  THINKING_MODES,
  PROVIDER_STRATEGIES,
  CLI_EXECUTION_MODES,
  FEATURE_PR_AUTOMERGE_MODES,
  VIRTUAL_WORKER_PROVIDERS,
  WORKER_EXECUTION_MODES,
  INVOCATION_ROUTING_IDS,
  INVOCATION_ROUTING_PROFILES,
  CONSOLE_LOG_LEVELS,
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
  if (typeof value.provider !== "string" || !PROVIDER_IDS.includes(value.provider as ProviderId)) {
    issues.push({ path: `${path}.provider`, message: `Expected one of: ${PROVIDER_IDS.join(", ")}` });
  }
  if (typeof value.name !== "string") {
    issues.push({ path: `${path}.name`, message: "Expected a string" });
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
  if (typeof value.mountAuth !== "boolean") {
    issues.push({ path: `${path}.mountAuth`, message: "Expected a boolean" });
  }
  if (typeof value.authPath !== "string") {
    issues.push({ path: `${path}.authPath`, message: "Expected a string" });
  }
  if (typeof value.maxConcurrentTasks !== "number") {
    issues.push({ path: `${path}.maxConcurrentTasks`, message: "Expected a number" });
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
  if (value.provider !== null && typeof value.provider !== "string") {
    issues.push({ path: `${path}.provider`, message: "Expected null or a provider config id string" });
  }
  if (typeof value.strategy !== "string" || !PROVIDER_STRATEGIES.includes(value.strategy as ProviderStrategy)) {
    issues.push({ path: `${path}.strategy`, message: `Expected one of: ${PROVIDER_STRATEGIES.join(", ")}` });
  }

  const providers = value.providers;
  const providerConfigIds = isRecord(providers) ? new Set(Object.keys(providers)) : new Set<string>();
  if (value.provider !== null && typeof value.provider === "string" && providerConfigIds.size > 0 && !providerConfigIds.has(value.provider)) {
    issues.push({ path: `${path}.provider`, message: "Expected an existing provider config id" });
  }
  if (!isRecord(providers)) {
    issues.push({ path: `${path}.providers`, message: "Expected an object" });
  } else {
    if (Object.keys(providers).length === 0) {
      issues.push({ path: `${path}.providers`, message: "Expected at least one provider config" });
    }
    for (const [providerConfigId, providerSettings] of Object.entries(providers)) {
      validateProviderSettings(providerSettings, `${path}.providers.${providerConfigId}`, issues);
    }
  }

  const invocationRouting = value.invocationRouting;
  if (!isRecord(invocationRouting)) {
    issues.push({ path: `${path}.invocationRouting`, message: "Expected an object" });
  } else {
    for (const routeId of INVOCATION_ROUTING_IDS) {
      const route = invocationRouting[routeId];
      const routePath = `${path}.invocationRouting.${routeId}`;
      if (!isRecord(route)) {
        issues.push({ path: routePath, message: "Expected an object" });
        continue;
      }
      if (typeof route.profile !== "string" || !INVOCATION_ROUTING_PROFILES.includes(route.profile as InvocationRoutingProfile)) {
        issues.push({ path: `${routePath}.profile`, message: `Expected one of: ${INVOCATION_ROUTING_PROFILES.join(", ")}` });
      }
      if (typeof route.strategy !== "string" || !PROVIDER_STRATEGIES.includes(route.strategy as ProviderStrategy)) {
        issues.push({ path: `${routePath}.strategy`, message: `Expected one of: ${PROVIDER_STRATEGIES.join(", ")}` });
      }
      if (route.provider !== null && typeof route.provider !== "string") {
        issues.push({ path: `${routePath}.provider`, message: "Expected null or a provider config id string" });
      } else if (typeof route.provider === "string" && providerConfigIds.size > 0 && !providerConfigIds.has(route.provider)) {
        issues.push({ path: `${routePath}.provider`, message: "Expected an existing provider config id" });
      }
      if (!Array.isArray(route.allowedProviders)) {
        issues.push({ path: `${routePath}.allowedProviders`, message: "Expected an array" });
      } else {
        route.allowedProviders.forEach((provider, index) => {
          if (typeof provider !== "string") {
            issues.push({ path: `${routePath}.allowedProviders[${index}]`, message: "Expected a provider config id string" });
          } else if (providerConfigIds.size > 0 && !providerConfigIds.has(provider)) {
            issues.push({ path: `${routePath}.allowedProviders[${index}]`, message: "Expected an existing provider config id" });
          }
        });
      }
      if (!isRecord(route.providers)) {
        issues.push({ path: `${routePath}.providers`, message: "Expected an object" });
        continue;
      }
      for (const [providerId, override] of Object.entries(route.providers)) {
        if (!isRecord(override)) {
          issues.push({ path: `${routePath}.providers.${providerId}`, message: "Expected an object" });
          continue;
        }
        if ("enabled" in override && typeof override.enabled !== "boolean") {
          issues.push({ path: `${routePath}.providers.${providerId}.enabled`, message: "Expected a boolean" });
        }
        if ("model" in override && typeof override.model !== "string") {
          issues.push({ path: `${routePath}.providers.${providerId}.model`, message: "Expected a string" });
        }
        if ("weight" in override && typeof override.weight !== "number") {
          issues.push({ path: `${routePath}.providers.${providerId}.weight`, message: "Expected a number" });
        }
        if ("thinkingMode" in override && (typeof override.thinkingMode !== "string" || !THINKING_MODES.includes(override.thinkingMode as ThinkingMode))) {
          issues.push({ path: `${routePath}.providers.${providerId}.thinkingMode`, message: `Expected one of: ${THINKING_MODES.join(", ")}` });
        }
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
  if (value.gitlabToken !== undefined && typeof value.gitlabToken !== "string") {
    issues.push({ path: `${path}.gitlabToken`, message: "Expected a string" });
  }
  if (typeof value.defaultBranch !== "string") {
    issues.push({ path: `${path}.defaultBranch`, message: "Expected a string" });
  }
  if (typeof value.autoCreatePr !== "boolean") {
    issues.push({ path: `${path}.autoCreatePr`, message: "Expected a boolean" });
  }
  if (typeof value.autoCloseLinkedIssues !== "boolean") {
    issues.push({ path: `${path}.autoCloseLinkedIssues`, message: "Expected a boolean" });
  }
  if (typeof value.featureBranchPrefix !== "string") {
    issues.push({ path: `${path}.featureBranchPrefix`, message: "Expected a string" });
  }
  if (typeof value.sprintBranchScheme !== "string") {
    issues.push({ path: `${path}.sprintBranchScheme`, message: "Expected a string" });
  }
  if (typeof value.sprintKeyPrefix !== "string") {
    issues.push({ path: `${path}.sprintKeyPrefix`, message: "Expected a string" });
  } else if (value.sprintKeyPrefix.length < 2 || value.sprintKeyPrefix.length > 10) {
    issues.push({ path: `${path}.sprintKeyPrefix`, message: "Expected length between 2 and 10 characters" });
  } else if (value.sprintKeyPrefix !== value.sprintKeyPrefix.toUpperCase()) {
    issues.push({ path: `${path}.sprintKeyPrefix`, message: "Expected an uppercase string" });
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
  if (typeof value.resolveAllCommentsBeforeMainMerge !== "boolean") issues.push({ path: `${path}.resolveAllCommentsBeforeMainMerge`, message: "Expected a boolean" });
  if (typeof value.resolveMainMergeConflicts !== "boolean") issues.push({ path: `${path}.resolveMainMergeConflicts`, message: "Expected a boolean" });
  if (typeof value.resolveAllCommentsBeforeFeatureMerge !== "boolean") issues.push({ path: `${path}.resolveAllCommentsBeforeFeatureMerge`, message: "Expected a boolean" });
  if (typeof value.resolveMergeConflicts !== "boolean") issues.push({ path: `${path}.resolveMergeConflicts`, message: "Expected a boolean" });
  if (typeof value.waitForJulesCiAutofix !== "boolean") issues.push({ path: `${path}.waitForJulesCiAutofix`, message: "Expected a boolean" });
  if (typeof value.julesCiAutofixMaxRetries !== "number") issues.push({ path: `${path}.julesCiAutofixMaxRetries`, message: "Expected a number" });
  if (typeof value.featurePrAutoMergeMode !== "string" || !FEATURE_PR_AUTOMERGE_MODES.includes(value.featurePrAutoMergeMode as FeaturePrAutoMergeMode)) {
    issues.push({ path: `${path}.featurePrAutoMergeMode`, message: `Expected one of: ${FEATURE_PR_AUTOMERGE_MODES.join(", ")}` });
  }
  if (typeof value.mainBranchAutoMergeMode !== "string" || !FEATURE_PR_AUTOMERGE_MODES.includes(value.mainBranchAutoMergeMode as FeaturePrAutoMergeMode)) {
    issues.push({ path: `${path}.mainBranchAutoMergeMode`, message: `Expected one of: ${FEATURE_PR_AUTOMERGE_MODES.join(", ")}` });
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
  if (typeof value.retryOnQuotaReset !== "boolean") issues.push({ path: `${path}.retryOnQuotaReset`, message: "Expected a boolean" });
  if (typeof value.retryOnRateLimit !== "boolean") issues.push({ path: `${path}.retryOnRateLimit`, message: "Expected a boolean" });
  if (typeof value.rateLimitRetryDelaySeconds !== "number" || !Number.isFinite(value.rateLimitRetryDelaySeconds) || value.rateLimitRetryDelaySeconds < 1) issues.push({ path: `${path}.rateLimitRetryDelaySeconds`, message: "Expected a positive integer" });
  if (typeof value.maxRateLimitRetries !== "number" || !Number.isFinite(value.maxRateLimitRetries) || value.maxRateLimitRetries < 1) issues.push({ path: `${path}.maxRateLimitRetries`, message: "Expected a positive integer" });
  if (value.maxParsingRetries !== undefined && (typeof value.maxParsingRetries !== "number" || !Number.isInteger(value.maxParsingRetries) || value.maxParsingRetries < 0 || value.maxParsingRetries > 10)) issues.push({ path: `${path}.maxParsingRetries`, message: "Expected an integer between 0 and 10" });
  if (typeof value.maxPlanningJsonRetries !== "number" || !Number.isFinite(value.maxPlanningJsonRetries) || value.maxPlanningJsonRetries < 0) issues.push({ path: `${path}.maxPlanningJsonRetries`, message: "Expected a non-negative integer" });
  if (typeof value.maxQuotaRetriesWithoutTimer !== "number" || !Number.isFinite(value.maxQuotaRetriesWithoutTimer) || value.maxQuotaRetriesWithoutTimer < 1) issues.push({ path: `${path}.maxQuotaRetriesWithoutTimer`, message: "Expected a positive integer" });
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
  if (typeof value.containerMountQwenCodeAuth !== "boolean") issues.push({ path: `${path}.containerMountQwenCodeAuth`, message: "Expected a boolean" });
  if (typeof value.containerMountOpenCodeAuth !== "boolean") issues.push({ path: `${path}.containerMountOpenCodeAuth`, message: "Expected a boolean" });
  if (typeof value.containerGithubAuthPath !== "string") issues.push({ path: `${path}.containerGithubAuthPath`, message: "Expected a string" });
  if (typeof value.containerGeminiAuthPath !== "string") issues.push({ path: `${path}.containerGeminiAuthPath`, message: "Expected a string" });
  if (typeof value.containerCodexAuthPath !== "string") issues.push({ path: `${path}.containerCodexAuthPath`, message: "Expected a string" });
  if (typeof value.containerClaudeCodeAuthPath !== "string") issues.push({ path: `${path}.containerClaudeCodeAuthPath`, message: "Expected a string" });
  if (typeof value.containerQwenCodeAuthPath !== "string") issues.push({ path: `${path}.containerQwenCodeAuthPath`, message: "Expected a string" });
  if (typeof value.containerOpenCodeAuthPath !== "string") issues.push({ path: `${path}.containerOpenCodeAuthPath`, message: "Expected a string" });
};

const validateSprintPreview = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.enabled !== "boolean") issues.push({ path: `${path}.enabled`, message: "Expected a boolean" });
  if (typeof value.showInAppBrowser !== "boolean") issues.push({ path: `${path}.showInAppBrowser`, message: "Expected a boolean" });
  if (typeof value.autoStartOnRunningSprint !== "boolean") issues.push({ path: `${path}.autoStartOnRunningSprint`, message: "Expected a boolean" });
  if (typeof value.rebuildOnTaskCompletion !== "boolean") issues.push({ path: `${path}.rebuildOnTaskCompletion`, message: "Expected a boolean" });
  if (typeof value.rebuildOnSprintCompletion !== "boolean") issues.push({ path: `${path}.rebuildOnSprintCompletion`, message: "Expected a boolean" });
  if (typeof value.autoStopOnTerminalSprint !== "boolean") issues.push({ path: `${path}.autoStopOnTerminalSprint`, message: "Expected a boolean" });
  if (typeof value.maxConcurrentContainers !== "number") issues.push({ path: `${path}.maxConcurrentContainers`, message: "Expected a number" });
  if (typeof value.hostPortRangeStart !== "number") issues.push({ path: `${path}.hostPortRangeStart`, message: "Expected a number" });
  if (typeof value.hostPortRangeEnd !== "number") issues.push({ path: `${path}.hostPortRangeEnd`, message: "Expected a number" });
  if (typeof value.containerAppPort !== "number") issues.push({ path: `${path}.containerAppPort`, message: "Expected a number" });
  if (typeof value.startupScriptPath !== "string") issues.push({ path: `${path}.startupScriptPath`, message: "Expected a string" });
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
  if (typeof value.model !== "string") {
    issues.push({ path: `${path}.model`, message: "Expected a string" });
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
  const qa = value.qualityAssurance;
  if (!isRecord(qa)) {
    issues.push({ path: `${path}.qualityAssurance`, message: "Expected an object" });
    return;
  }
  if (typeof qa.enabled !== "boolean") {
    issues.push({ path: `${path}.qualityAssurance.enabled`, message: "Expected a boolean" });
  }
  if (typeof qa.maxTaskReviewRuns !== "number" || qa.maxTaskReviewRuns < 1) {
    issues.push({ path: `${path}.qualityAssurance.maxTaskReviewRuns`, message: "Expected a positive number" });
  }
  const triggerIds = ["taskCompletion", "sprintCompletion", "completedTaskWithoutPr"] as const;
  for (const triggerId of triggerIds) {
    const trigger = qa[triggerId];
    if (!isRecord(trigger)) {
      issues.push({ path: `${path}.qualityAssurance.${triggerId}`, message: "Expected an object" });
      continue;
    }
    if (typeof trigger.enabled !== "boolean") {
      issues.push({ path: `${path}.qualityAssurance.${triggerId}.enabled`, message: "Expected a boolean" });
    }
    if (trigger.agentPresetId !== null && trigger.agentPresetId !== undefined && typeof trigger.agentPresetId !== "string") {
      issues.push({ path: `${path}.qualityAssurance.${triggerId}.agentPresetId`, message: "Expected null or a string" });
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
  if (value.autoAnswerClarificationMode !== "TEMPLATE" && value.autoAnswerClarificationMode !== "WORKER") {
    issues.push({ path: `${path}.autoAnswerClarificationMode`, message: "Expected 'TEMPLATE' or 'WORKER'" });
  }
  if (typeof value.autoResumePaused !== "boolean") issues.push({ path: `${path}.autoResumePaused`, message: "Expected a boolean" });
  if (typeof value.clarificationAnswerTemplate !== "string") issues.push({ path: `${path}.clarificationAnswerTemplate`, message: "Expected a string" });
  if (value.clarificationCooldownSeconds !== undefined) {
    if (typeof value.clarificationCooldownSeconds !== "number" || value.clarificationCooldownSeconds < 0) {
      issues.push({ path: `${path}.clarificationCooldownSeconds`, message: "Expected a non-negative number (seconds)" });
    }
  }
};

const validateMemory = (
  value: unknown,
  path: string,
  issues: ValidationIssue[]
) => {
  if (!isRecord(value)) {
    issues.push({ path, message: "Expected an object" });
    return;
  }
  if (typeof value.enabled !== "boolean") issues.push({ path: `${path}.enabled`, message: "Expected a boolean" });
  if (value.embeddingModel !== null && (typeof value.embeddingModel !== "string" || !EMBEDDING_MODEL_IDS.includes(value.embeddingModel as EmbeddingModelId))) {
    issues.push({ path: `${path}.embeddingModel`, message: `Expected null or one of: ${EMBEDDING_MODEL_IDS.join(", ")}` });
  }
  if (typeof value.autoCaptureSprint !== "boolean") issues.push({ path: `${path}.autoCaptureSprint`, message: "Expected a boolean" });
  if (typeof value.autoCaptureAgent !== "boolean") issues.push({ path: `${path}.autoCaptureAgent`, message: "Expected a boolean" });
  if (typeof value.autoPromote !== "boolean") issues.push({ path: `${path}.autoPromote`, message: "Expected a boolean" });
  if (typeof value.promotionThreshold !== "number") issues.push({ path: `${path}.promotionThreshold`, message: "Expected a number" });
  if (typeof value.maxSprintMemories !== "number") issues.push({ path: `${path}.maxSprintMemories`, message: "Expected a number" });
  if (typeof value.maxProjectMemories !== "number") issues.push({ path: `${path}.maxProjectMemories`, message: "Expected a number" });
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

  if (typeof payload.consoleLogLevel !== "string" || !CONSOLE_LOG_LEVELS.includes(payload.consoleLogLevel as ConsoleLogLevel)) {
    issues.push({ path: "consoleLogLevel", message: `Expected one of: ${CONSOLE_LOG_LEVELS.join(", ")}` });
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
  validateSprintPreview(payload.sprintPreview, "sprintPreview", issues);
  validateWorkers(payload.workers, "workers", issues);
  validateAgents(payload.agents, "agents", issues);
  validateSkills(payload.skills, "skills", issues);
  validateMcpTools(payload.mcpTools, "mcpTools", issues);
  validateMemory(payload.memory, "memory", issues);

  if (issues.length > 0) {
    return { success: false, issues };
  }

  return { success: true, issues: [], data: payload as unknown as DashboardSettings };
};
