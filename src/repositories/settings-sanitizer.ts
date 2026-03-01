import type {
  CliExecutionMode,
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  ProviderId,
  ProviderSettings,
  ProviderStrategy,
  SkillToggle,
  ThinkingMode,
} from "../contracts/app-types.js";
import { sanitizeMcpToolToggles } from "../mcp/mcp-tool-availability.js";
import {
  CLI_EXECUTION_MODES,
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_PROVIDER_SETTINGS,
  DEFAULT_SKILLS,
  INTERNAL_SKILL_NAMES,
  INTERNAL_SKILL_SET,
  MAX_JULES_CI_AUTOFIX_RETRIES,
  MAX_WATCH_LOOP_INTERVAL_SECONDS,
  MAX_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
  MIN_JULES_CI_AUTOFIX_RETRIES,
  MIN_WATCH_LOOP_INTERVAL_SECONDS,
  MIN_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
  PROVIDER_IDS,
  PROVIDER_STRATEGIES,
  THINKING_MODES,
} from "./settings-defaults.js";

const readBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);
const readString = (value: unknown, fallback: string): string => (typeof value === "string" ? value : fallback);
const readInteger = (value: unknown, fallback: number): number =>
  (typeof value === "number" && Number.isFinite(value) ? Math.round(value) : fallback);

const enforceGitManagerSkillset = (skills: SkillToggle[], githubMode: "REMOTE" | "LOCAL"): SkillToggle[] => {
  return skills.map((skill) => {
    if (skill.name === "git_manager_remote") {
      return { ...skill, enabled: githubMode === "REMOTE" };
    }
    if (skill.name === "git_manager_local") {
      return { ...skill, enabled: githubMode === "LOCAL" };
    }
    if (skill.name === "git_manager") {
      return { ...skill, enabled: true };
    }
    return skill;
  });
};

const sanitizeSkills = (value: unknown): SkillToggle[] => {
  if (!Array.isArray(value)) return DEFAULT_SKILLS.map((skill) => ({ ...skill }));
  const validSkills = value
    .filter((item): item is SkillToggle => {
      if (!item || typeof item !== "object") return false;
      const skill = item as Partial<SkillToggle>;
      return typeof skill.name === "string" && typeof skill.enabled === "boolean";
    })
    .map((skill) => ({ name: skill.name.trim(), enabled: skill.enabled }))
    .filter((skill) => skill.name.length > 0);
  const enabledByName = new Map(validSkills.map((skill) => [skill.name, skill.enabled]));

  const internalSkills: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
    name,
    enabled: enabledByName.get(name) ?? true,
    isInternal: true,
  }));

  const customSkills: SkillToggle[] = validSkills
    .filter((skill) => !INTERNAL_SKILL_SET.has(skill.name))
    .map((skill) => ({
      name: skill.name,
      enabled: skill.enabled,
      isInternal: false,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...internalSkills, ...customSkills];
};

const sanitizeMcpTools = (value: unknown): McpToolToggle[] => {
  return sanitizeMcpToolToggles(value).map((tool) => ({ ...tool }));
};

export const cloneDefaults = (externalHints?: ExternalSettingsHints): DashboardSettings => ({
  automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
  automationInterventions: {
    ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
  },
  aiProvider: {
    ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
    providers: {
      jules: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules,
        apiKey: externalHints?.resolved.julesApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules.apiKey,
      },
      gemini: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini,
        apiKey: externalHints?.resolved.geminiApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini.apiKey,
      },
      codex: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex,
        apiKey: externalHints?.resolved.codexApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex.apiKey,
      },
      "claude-code": {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"],
        apiKey: externalHints?.resolved.claudeCodeApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"].apiKey,
      },
    },
    julesApiKey: externalHints?.resolved.julesApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.julesApiKey,
  },
  git: {
    ...DEFAULT_DASHBOARD_SETTINGS.git,
    githubToken: externalHints?.resolved.githubToken || DEFAULT_DASHBOARD_SETTINGS.git.githubToken,
  },
  ciIntelligence: {
    ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
  },
  sprintLoopSteps: {
    ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
  },
  cliWorkflow: {
    ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
});

const normalizeProviderSettings = (
  input: Partial<Record<ProviderId, Partial<ProviderSettings>>> | undefined,
  externalHints?: ExternalSettingsHints,
  julesApiKeyFallback?: string
): Record<ProviderId, ProviderSettings> => {
  const result: Record<ProviderId, ProviderSettings> = {
    jules: { ...DEFAULT_PROVIDER_SETTINGS.jules },
    gemini: { ...DEFAULT_PROVIDER_SETTINGS.gemini },
    codex: { ...DEFAULT_PROVIDER_SETTINGS.codex },
    "claude-code": { ...DEFAULT_PROVIDER_SETTINGS["claude-code"] },
  };

  for (const providerId of PROVIDER_IDS) {
    const source = input?.[providerId];
    const fallbackApiKey = providerId === "jules"
      ? (julesApiKeyFallback || externalHints?.resolved.julesApiKey || "")
      : providerId === "gemini"
        ? (externalHints?.resolved.geminiApiKey || "")
        : providerId === "claude-code"
          ? (externalHints?.resolved.claudeCodeApiKey || "")
          : (externalHints?.resolved.codexApiKey || "");

    const normalizedThinkingMode = THINKING_MODES.includes(source?.thinkingMode as ThinkingMode)
      ? (source?.thinkingMode as ThinkingMode)
      : DEFAULT_PROVIDER_SETTINGS[providerId].thinkingMode;

    const weightCandidate = typeof source?.weight === "number" ? source.weight : DEFAULT_PROVIDER_SETTINGS[providerId].weight;
    const normalizedWeight = Number.isFinite(weightCandidate) ? Math.max(0, Math.round(weightCandidate)) : DEFAULT_PROVIDER_SETTINGS[providerId].weight;

    result[providerId] = {
      enabled: typeof source?.enabled === "boolean" ? source.enabled : DEFAULT_PROVIDER_SETTINGS[providerId].enabled,
      model: typeof source?.model === "string" && source.model.trim().length > 0
        ? source.model.trim()
        : DEFAULT_PROVIDER_SETTINGS[providerId].model,
      weight: normalizedWeight,
      thinkingMode: normalizedThinkingMode,
      apiKey: typeof source?.apiKey === "string" ? source.apiKey : fallbackApiKey,
    };
  }

  return result;
};

export const sanitizeSettings = (value: unknown, externalHints?: ExternalSettingsHints): DashboardSettings => {
  const input = (value && typeof value === "object" ? value : {}) as Partial<DashboardSettings>;
  const automationLevel = input.automationLevel;
  const validAutomationLevel = automationLevel === "FULL" || automationLevel === "SEMI_AUTO" || automationLevel === "ALWAYS_ASK"
    ? automationLevel
    : DEFAULT_DASHBOARD_SETTINGS.automationLevel;
  const interventionInput = (input.automationInterventions && typeof input.automationInterventions === "object"
    ? input.automationInterventions
    : {}) as Partial<DashboardSettings["automationInterventions"]>;
  const automationInterventions = {
    autoApprovePlan: readBoolean(
      interventionInput.autoApprovePlan,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.autoApprovePlan
    ),
    autoAnswerClarification: readBoolean(
      interventionInput.autoAnswerClarification,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.autoAnswerClarification
    ),
    autoResumePaused: readBoolean(
      interventionInput.autoResumePaused,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.autoResumePaused
    ),
    clarificationAnswerTemplate: readString(
      interventionInput.clarificationAnswerTemplate,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.clarificationAnswerTemplate
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.automationInterventions.clarificationAnswerTemplate,
  };

  const aiProviderInput = (input.aiProvider && typeof input.aiProvider === "object"
    ? input.aiProvider
    : {}) as Partial<DashboardSettings["aiProvider"]>;
  const normalizedProvider = PROVIDER_IDS.includes(aiProviderInput.provider as ProviderId)
    ? (aiProviderInput.provider as ProviderId)
    : DEFAULT_DASHBOARD_SETTINGS.aiProvider.provider;
  const normalizedStrategy = PROVIDER_STRATEGIES.includes(aiProviderInput.strategy as ProviderStrategy)
    ? (aiProviderInput.strategy as ProviderStrategy)
    : DEFAULT_DASHBOARD_SETTINGS.aiProvider.strategy;
  const julesApiKey = typeof aiProviderInput.julesApiKey === "string"
    ? aiProviderInput.julesApiKey
    : (externalHints?.resolved.julesApiKey || "");
  const providers = normalizeProviderSettings(aiProviderInput.providers, externalHints, julesApiKey);
  providers.jules.apiKey = julesApiKey || providers.jules.apiKey;
  const aiProvider = {
    provider: normalizedProvider,
    strategy: normalizedStrategy,
    providers,
    julesApiKey: providers.jules.apiKey,
  };

  const gitInput = (input.git && typeof input.git === "object" ? input.git : {}) as Partial<DashboardSettings["git"]>;
  const git = {
    githubMode: gitInput.githubMode === "LOCAL" ? "LOCAL" as const : "REMOTE" as const,
    githubToken: typeof gitInput.githubToken === "string" ? gitInput.githubToken : (externalHints?.resolved.githubToken || ""),
    defaultBranch: typeof gitInput.defaultBranch === "string" && gitInput.defaultBranch.trim().length > 0
      ? gitInput.defaultBranch.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.defaultBranch,
    autoCreatePr: typeof gitInput.autoCreatePr === "boolean" ? gitInput.autoCreatePr : DEFAULT_DASHBOARD_SETTINGS.git.autoCreatePr,
    featureBranchPrefix: typeof gitInput.featureBranchPrefix === "string" && gitInput.featureBranchPrefix.trim().length > 0
      ? gitInput.featureBranchPrefix.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.featureBranchPrefix,
    sprintBranchScheme: typeof gitInput.sprintBranchScheme === "string" && gitInput.sprintBranchScheme.trim().length > 0
      ? gitInput.sprintBranchScheme.trim()
      : DEFAULT_DASHBOARD_SETTINGS.git.sprintBranchScheme,
  };

  const ciInput = (input.ciIntelligence && typeof input.ciIntelligence === "object"
    ? input.ciIntelligence
    : {}) as Partial<DashboardSettings["ciIntelligence"]>;
  const ciIntelligence = {
    enabled: readBoolean(ciInput.enabled, DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.enabled),
    enableLivePrMonitoring: readBoolean(
      ciInput.enableLivePrMonitoring,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.enableLivePrMonitoring
    ),
    waitForCiBeforeMainMerge: readBoolean(
      ciInput.waitForCiBeforeMainMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForCiBeforeMainMerge
    ),
    resolveAllCommentsBeforeMainMerge: readBoolean(
      ciInput.resolveAllCommentsBeforeMainMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveAllCommentsBeforeMainMerge
    ),
    waitForCiBeforeFeatureMerge: readBoolean(
      ciInput.waitForCiBeforeFeatureMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForCiBeforeFeatureMerge
    ),
    resolveAllCommentsBeforeFeatureMerge: readBoolean(
      ciInput.resolveAllCommentsBeforeFeatureMerge,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.resolveAllCommentsBeforeFeatureMerge
    ),
    waitForJulesCiAutofix: readBoolean(
      ciInput.waitForJulesCiAutofix,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.waitForJulesCiAutofix
    ),
    julesCiAutofixMaxRetries: Math.min(
      MAX_JULES_CI_AUTOFIX_RETRIES,
      Math.max(
        MIN_JULES_CI_AUTOFIX_RETRIES,
        readInteger(
          ciInput.julesCiAutofixMaxRetries,
          DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.julesCiAutofixMaxRetries
        )
      )
    ),
    autoMergeFeaturePrWhenGreen: readBoolean(
      ciInput.autoMergeFeaturePrWhenGreen,
      DEFAULT_DASHBOARD_SETTINGS.ciIntelligence.autoMergeFeaturePrWhenGreen
    ),
  };
  if (git.githubMode === "LOCAL") {
    ciIntelligence.enableLivePrMonitoring = false;
  }

  const loopInput = (input.sprintLoopSteps && typeof input.sprintLoopSteps === "object"
    ? input.sprintLoopSteps
    : {}) as Partial<DashboardSettings["sprintLoopSteps"]>;
  const sprintLoopSteps = {
    branchPreflight: readBoolean(loopInput.branchPreflight, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.branchPreflight),
    planningPreflight: readBoolean(loopInput.planningPreflight, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.planningPreflight),
    loadSubtasks: readBoolean(loopInput.loadSubtasks, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.loadSubtasks),
    sessionSync: readBoolean(loopInput.sessionSync, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.sessionSync),
    statusDerivation: readBoolean(loopInput.statusDerivation, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.statusDerivation),
    startReadyTasks: readBoolean(loopInput.startReadyTasks, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.startReadyTasks),
    mergeProtocol: readBoolean(loopInput.mergeProtocol, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.mergeProtocol),
    actionRequiredProtocol: readBoolean(loopInput.actionRequiredProtocol, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.actionRequiredProtocol),
    statusTable: readBoolean(loopInput.statusTable, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.statusTable),
    watchLoop: readBoolean(loopInput.watchLoop, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.watchLoop),
    watchLoopIntervalSeconds: Math.min(
      MAX_WATCH_LOOP_INTERVAL_SECONDS,
      Math.max(
        MIN_WATCH_LOOP_INTERVAL_SECONDS,
        readInteger(loopInput.watchLoopIntervalSeconds, DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.watchLoopIntervalSeconds)
      )
    ),
    watchLoopOutputIntervalSeconds: Math.min(
      MAX_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
      Math.max(
        MIN_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS,
        readInteger(
          loopInput.watchLoopOutputIntervalSeconds,
          DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps.watchLoopOutputIntervalSeconds
        )
      )
    ),
  };

  const cliInput = (input.cliWorkflow && typeof input.cliWorkflow === "object"
    ? input.cliWorkflow
    : {}) as Partial<DashboardSettings["cliWorkflow"]>;
  const normalizedExecutionMode = CLI_EXECUTION_MODES.includes(cliInput.executionMode as CliExecutionMode)
    ? (cliInput.executionMode as CliExecutionMode)
    : DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.executionMode;
  const containerImage = readString(
    cliInput.containerImage,
    DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerImage
  ).trim() || DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerImage;
  const cliWorkflow = {
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
    containerMountCredentials: readBoolean(
      cliInput.containerMountCredentials,
      DEFAULT_DASHBOARD_SETTINGS.cliWorkflow.containerMountCredentials
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
  };

  const normalizedSkills = enforceGitManagerSkillset(sanitizeSkills(input.skills), git.githubMode);
  const mcpTools = sanitizeMcpTools(input.mcpTools);

  return {
    automationLevel: validAutomationLevel,
    automationInterventions,
    aiProvider,
    git,
    ciIntelligence,
    sprintLoopSteps,
    cliWorkflow,
    skills: normalizedSkills,
    mcpTools,
  };
};
