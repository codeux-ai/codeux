import type {
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  ProjectSettings,
  SettingsValueSource,
  SkillToggle,
  SystemSettings,
} from "../../types.js";

const cloneSkills = (skills: SkillToggle[]): SkillToggle[] => skills.map((skill) => ({ ...skill }));
const cloneMcpTools = (tools: McpToolToggle[]): McpToolToggle[] => tools.map((tool) => ({ ...tool }));

export const dashboardSettingsToProjectSettings = (settings: DashboardSettings): ProjectSettings => ({
  automationLevel: settings.automationLevel,
  automationInterventions: {
    ...settings.automationInterventions,
  },
  aiProvider: {
    provider: settings.aiProvider.provider,
    strategy: settings.aiProvider.strategy,
    providers: {
      jules: {
        enabled: settings.aiProvider.providers.jules.enabled,
        model: settings.aiProvider.providers.jules.model,
        weight: settings.aiProvider.providers.jules.weight,
        thinkingMode: settings.aiProvider.providers.jules.thinkingMode,
      },
      gemini: {
        enabled: settings.aiProvider.providers.gemini.enabled,
        model: settings.aiProvider.providers.gemini.model,
        weight: settings.aiProvider.providers.gemini.weight,
        thinkingMode: settings.aiProvider.providers.gemini.thinkingMode,
      },
      codex: {
        enabled: settings.aiProvider.providers.codex.enabled,
        model: settings.aiProvider.providers.codex.model,
        weight: settings.aiProvider.providers.codex.weight,
        thinkingMode: settings.aiProvider.providers.codex.thinkingMode,
      },
      "claude-code": {
        enabled: settings.aiProvider.providers["claude-code"].enabled,
        model: settings.aiProvider.providers["claude-code"].model,
        weight: settings.aiProvider.providers["claude-code"].weight,
        thinkingMode: settings.aiProvider.providers["claude-code"].thinkingMode,
      },
    },
  },
  git: {
    githubMode: settings.git.githubMode,
    defaultBranch: settings.git.defaultBranch,
    autoCreatePr: settings.git.autoCreatePr,
    featureBranchPrefix: settings.git.featureBranchPrefix,
    sprintBranchScheme: settings.git.sprintBranchScheme,
  },
  ciIntelligence: {
    ...settings.ciIntelligence,
  },
  sprintLoopSteps: {
    ...settings.sprintLoopSteps,
  },
  cliWorkflow: {
    ...settings.cliWorkflow,
  },
  workers: {
    ...settings.workers,
  },
  agents: {
    saveToProjectDirectory: settings.agents.saveToProjectDirectory,
    instructionTemplates: { ...settings.agents.instructionTemplates },
  },
  skills: cloneSkills(settings.skills),
});

export const cloneProjectSettings = (settings: ProjectSettings): ProjectSettings => ({
  automationLevel: settings.automationLevel,
  automationInterventions: {
    ...settings.automationInterventions,
  },
  aiProvider: {
    provider: settings.aiProvider.provider,
    strategy: settings.aiProvider.strategy,
    providers: {
      jules: { ...settings.aiProvider.providers.jules },
      gemini: { ...settings.aiProvider.providers.gemini },
      codex: { ...settings.aiProvider.providers.codex },
      "claude-code": { ...settings.aiProvider.providers["claude-code"] },
    },
  },
  git: {
    ...settings.git,
  },
  ciIntelligence: {
    ...settings.ciIntelligence,
  },
  sprintLoopSteps: {
    ...settings.sprintLoopSteps,
  },
  cliWorkflow: {
    ...settings.cliWorkflow,
  },
  workers: {
    ...settings.workers,
  },
  agents: {
    saveToProjectDirectory: settings.agents.saveToProjectDirectory,
    instructionTemplates: { ...settings.agents.instructionTemplates },
  },
  skills: cloneSkills(settings.skills),
});

export const cloneSystemSettings = (settings: SystemSettings): SystemSettings => ({
  runtime: {
    ...settings.runtime,
  },
  integrations: {
    ...settings.integrations,
  },
  defaults: cloneProjectSettings(settings.defaults),
  mcpTools: cloneMcpTools(settings.mcpTools),
});

export const applyExternalHintsToSystemSettings = (
  settings: SystemSettings,
  hints: ExternalSettingsHints,
): SystemSettings => ({
  ...cloneSystemSettings(settings),
  integrations: {
    julesApiKey: settings.integrations.julesApiKey || hints.resolved.julesApiKey || "",
    geminiApiKey: settings.integrations.geminiApiKey || hints.resolved.geminiApiKey || "",
    codexApiKey: settings.integrations.codexApiKey || hints.resolved.codexApiKey || "",
    claudeCodeApiKey: settings.integrations.claudeCodeApiKey || hints.resolved.claudeCodeApiKey || "",
    githubToken: settings.integrations.githubToken || hints.resolved.githubToken || "",
  },
});

export const getSectionSource = (
  sources: Record<string, SettingsValueSource>,
  prefix: string,
): SettingsValueSource | "mixed" => {
  const sectionSources = Object.entries(sources)
    .filter(([key]) => key === prefix || key.startsWith(`${prefix}.`))
    .map(([, source]) => source);

  if (sectionSources.length === 0) {
    return "system";
  }

  const uniqueSources = new Set(sectionSources);
  if (uniqueSources.size === 1) {
    return sectionSources[0]!;
  }
  return "mixed";
};
