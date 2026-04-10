import type { DashboardSettings, ExternalSettingsHints } from "../types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

export { DEFAULT_DASHBOARD_SETTINGS };

export const cloneDefaultSettings = (): DashboardSettings => ({
  dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
  enableDebugLogFile: DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile,
  appearance: { ...DEFAULT_DASHBOARD_SETTINGS.appearance },
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
  sprintPreview: { ...DEFAULT_DASHBOARD_SETTINGS.sprintPreview },
  workers: { ...DEFAULT_DASHBOARD_SETTINGS.workers },
  agents: {
    saveToProjectDirectory: DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
    instructionTemplates: { ...DEFAULT_DASHBOARD_SETTINGS.agents.instructionTemplates },
    qualityAssurance: {
      enabled: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.enabled,
      maxTaskReviewRuns: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.maxTaskReviewRuns,
      taskCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.taskCompletion },
      sprintCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.sprintCompletion },
      completedTaskWithoutPr: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.completedTaskWithoutPr },
    },
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
  memory: { ...DEFAULT_DASHBOARD_SETTINGS.memory },
});

export const applyExternalSettingsHints = (
  settings: DashboardSettings,
  hints: ExternalSettingsHints
): DashboardSettings => ({
  ...settings,
  aiProvider: {
    ...settings.aiProvider,
    providers: Object.fromEntries(
      Object.entries(settings.aiProvider.providers).map(([providerConfigId, provider]) => [
        providerConfigId,
        {
          ...provider,
          apiKey: provider.apiKey.trim().length > 0
            ? provider.apiKey
            : provider.provider === "jules"
              ? hints.resolved.julesApiKey
              : provider.provider === "gemini"
                ? hints.resolved.geminiApiKey
                : provider.provider === "codex"
                  ? hints.resolved.codexApiKey
                  : hints.resolved.claudeCodeApiKey,
        },
      ]),
    ),
  },
  git: {
    ...settings.git,
    githubToken: settings.git.githubToken.trim().length > 0 ? settings.git.githubToken : hints.resolved.githubToken,
  },
});
