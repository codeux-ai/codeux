import type { DashboardSettings, ExternalSettingsHints } from "../types.js";

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  automationLevel: "SEMI_AUTO",
  automationInterventions: {
    autoApprovePlan: true,
    autoAnswerClarification: false,
    autoResumePaused: false,
    clarificationAnswerTemplate: "Proceed with the safest implementation path using repository conventions. If multiple valid options exist, choose the smallest-scope option and continue without waiting for clarification.",
  },
  aiProvider: {
    provider: "jules",
    strategy: "MANUAL",
    providers: {
      jules: {
        enabled: true,
        model: "default",
        weight: 60,
        thinkingMode: "MEDIUM",
        apiKey: "",
      },
      gemini: {
        enabled: true,
        model: "default",
        weight: 20,
        thinkingMode: "MEDIUM",
        apiKey: "",
      },
      codex: {
        enabled: true,
        model: "gpt-5.3-codex",
        weight: 20,
        thinkingMode: "HIGH",
        apiKey: "",
      },
      "claude-code": {
        enabled: false,
        model: "default",
        weight: 0,
        thinkingMode: "HIGH",
        apiKey: "",
      },
    },
    julesApiKey: "",
  },
  git: {
    githubMode: "REMOTE",
    githubToken: "",
    defaultBranch: "main",
    autoCreatePr: true,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: "feature/sprint{sprint}-implementation",
  },
  ciIntelligence: {
    enabled: true,
    enableLivePrMonitoring: true,
    waitForCiBeforeMainMerge: true,
    resolveAllCommentsBeforeMainMerge: true,
    waitForCiBeforeFeatureMerge: true,
    resolveAllCommentsBeforeFeatureMerge: true,
    waitForJulesCiAutofix: false,
    julesCiAutofixMaxRetries: 3,
    featurePrAutoMergeMode: "OFF",
  },
  sprintLoopSteps: {
    branchPreflight: true,
    planningPreflight: true,
    loadSubtasks: true,
    sessionSync: true,
    statusDerivation: true,
    startReadyTasks: true,
    mergeProtocol: true,
    actionRequiredProtocol: true,
    statusTable: true,
    watchLoop: true,
    watchLoopIntervalSeconds: 120,
    watchLoopOutputIntervalSeconds: 300,
  },
  cliWorkflow: {
    cleanupWorktreeOnSuccess: true,
    cleanupWorktreeOnFailure: false,
    retryOnReadFileNotFound: true,
    resumeFailedTaskInSameWorkspace: true,
    executionMode: "HOST",
    containerImage: "node:22-bookworm-slim",
    containerSetupScriptPath: "",
    containerMountCredentials: false,
    containerMountGitConfig: true,
    containerMountGithubAuth: true,
    containerMountGeminiAuth: true,
    containerMountCodexAuth: true,
    containerMountClaudeCodeAuth: true,
    containerGithubAuthPath: "~/.config/gh",
    containerGeminiAuthPath: "~/.gemini",
    containerCodexAuthPath: "~/.codex",
    containerClaudeCodeAuthPath: "~/.claude",
  },
  skills: [
    { name: "orchestrator", enabled: true, isInternal: true },
    { name: "worker", enabled: true, isInternal: true },
    { name: "watch", enabled: true, isInternal: true },
    { name: "watch-skill", enabled: true, isInternal: true },
    { name: "sprint_agent_guide", enabled: true, isInternal: true },
    { name: "git_manager", enabled: true, isInternal: true },
    { name: "git_manager_remote", enabled: true, isInternal: true },
    { name: "git_manager_local", enabled: false, isInternal: true },
  ],
  mcpTools: [
    { name: "get_source", enabled: true, isInternal: true },
    { name: "list_sources", enabled: true, isInternal: true },
    { name: "list_all_sources", enabled: true, isInternal: true },
    { name: "create_session", enabled: true, isInternal: true },
    { name: "get_session", enabled: true, isInternal: true },
    { name: "list_sessions", enabled: true, isInternal: true },
    { name: "approve_session_plan", enabled: true, isInternal: true },
    { name: "send_session_message", enabled: true, isInternal: true },
    { name: "wait_for_session_completion", enabled: true, isInternal: true },
    { name: "get_activity", enabled: true, isInternal: true },
    { name: "list_activities", enabled: true, isInternal: true },
    { name: "list_all_activities", enabled: true, isInternal: true },
    { name: "sprint_agent", enabled: true, isInternal: true },
    { name: "task_agent", enabled: true, isInternal: true },
  ],
};

export const cloneDefaultSettings = (): DashboardSettings => ({
  automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
  automationInterventions: { ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions },
  aiProvider: {
    ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
    providers: {
      jules: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules },
      gemini: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini },
      codex: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex },
      "claude-code": { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"] },
    },
  },
  git: { ...DEFAULT_DASHBOARD_SETTINGS.git },
  ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence },
  sprintLoopSteps: { ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps },
  cliWorkflow: { ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
});

export const applyExternalSettingsHints = (
  settings: DashboardSettings,
  hints: ExternalSettingsHints
): DashboardSettings => ({
  ...settings,
  aiProvider: {
    ...settings.aiProvider,
    julesApiKey: settings.aiProvider.julesApiKey.trim().length > 0 ? settings.aiProvider.julesApiKey : hints.resolved.julesApiKey,
    providers: {
      ...settings.aiProvider.providers,
      jules: {
        ...settings.aiProvider.providers.jules,
        apiKey: settings.aiProvider.providers.jules.apiKey.trim().length > 0
          ? settings.aiProvider.providers.jules.apiKey
          : hints.resolved.julesApiKey,
      },
      gemini: {
        ...settings.aiProvider.providers.gemini,
        apiKey: settings.aiProvider.providers.gemini.apiKey.trim().length > 0
          ? settings.aiProvider.providers.gemini.apiKey
          : hints.resolved.geminiApiKey,
      },
      codex: {
        ...settings.aiProvider.providers.codex,
        apiKey: settings.aiProvider.providers.codex.apiKey.trim().length > 0
          ? settings.aiProvider.providers.codex.apiKey
          : hints.resolved.codexApiKey,
      },
      "claude-code": {
        ...settings.aiProvider.providers["claude-code"],
        apiKey: settings.aiProvider.providers["claude-code"].apiKey.trim().length > 0
          ? settings.aiProvider.providers["claude-code"].apiKey
          : hints.resolved.claudeCodeApiKey,
      },
    },
  },
  git: {
    ...settings.git,
    githubToken: settings.git.githubToken.trim().length > 0 ? settings.git.githubToken : hints.resolved.githubToken,
  },
});
