import type {
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  ProviderId,
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

export type SettingsEditorScope = "project" | "sprint";

export const getFieldSource = (
  sources: Record<string, SettingsValueSource>,
  path: string,
): SettingsValueSource | "mixed" => {
  const directSource = sources[path];
  if (directSource) {
    return directSource;
  }
  return getSectionSource(sources, path);
};

export const getFieldSourceLabel = (
  source: SettingsValueSource | "mixed",
  scope: SettingsEditorScope,
): string | null => {
  if (scope === "project") {
    return source === "project" ? "Project override" : null;
  }

  return source === "sprint" ? "Sprint override" : null;
};

export const AI_MODEL_CATALOG: Record<string, string[]> = {
  gemini: [
    "auto",
    "pro",
    "flash",
    "flash-lite",
    "gemini-3-pro-preview",
    "gemini-3-flash-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
  ],
  "claude-code": [
    "default",
    "sonnet",
    "opus",
    "haiku",
    "sonnet[1m]",
    "opus[1m]",
    "opusplan",
    "claude-opus-4-6",
    "claude-sonnet-4-6",
    "claude-haiku-4-5-20251001",
  ],
  codex: [
    "gpt-5.4",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "gpt-5.3-codex-spark",
    "gpt-5.2-codex",
    "gpt-5.2",
    "gpt-5.1-codex-max",
    "gpt-5.1",
    "gpt-5.1-codex",
    "gpt-5-codex",
    "gpt-5-codex-mini",
    "gpt-5",
  ],
};

const PROVIDER_MODEL_LABEL_OVERRIDES: Partial<Record<ProviderId, Record<string, string>>> = {
  gemini: {
    pro: "pro (recent)",
    flash: "flash (recent)",
    "flash-lite": "flash-lite (recent)",
  },
};

export const providerSupportsModelSelection = (providerId: ProviderId): boolean => providerId !== "jules";

export const providerSupportsThinkingMode = (providerId: ProviderId): boolean => providerId !== "jules";

export const getProviderModelOptions = (
  providerId: ProviderId,
): Array<{ value: string; label: string }> => {
  const labelOverrides = PROVIDER_MODEL_LABEL_OVERRIDES[providerId] || {};
  return (AI_MODEL_CATALOG[providerId] || []).map((model) => ({
    value: model,
    label: labelOverrides[model] || model,
  }));
};

export const PROVIDER_CARD_TOKENS: Record<ProviderId, {
  watermark: string;
  logoLabel: string;
  badgeLabel: string;
  badgeClassName: string;
  glowClassName: string;
  railClassName: string;
  noteClassName: string;
}> = {
  jules: {
    watermark: "JLS",
    logoLabel: "J",
    badgeLabel: "Hosted API",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  gemini: {
    watermark: "GMN",
    logoLabel: "G",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  codex: {
    watermark: "CDX",
    logoLabel: "O",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.04] text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-700 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-200",
  },
  "claude-code": {
    watermark: "CLD",
    logoLabel: "C",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
};
