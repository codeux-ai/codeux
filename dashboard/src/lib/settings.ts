import type { DashboardSettings, ExternalSettingsHints } from "../types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

export { DEFAULT_DASHBOARD_SETTINGS };

export const cloneDefaultSettings = (): DashboardSettings => ({
  dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
  enableDebugLogFile: DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile,
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
  agents: {
    saveToProjectDirectory: DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
    instructionTemplates: { ...DEFAULT_DASHBOARD_SETTINGS.agents.instructionTemplates },
  },
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
