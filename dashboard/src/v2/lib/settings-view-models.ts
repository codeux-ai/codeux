import type {
  DashboardSettings,
  EffectiveSettingsResponse,
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
const cloneInvocationRouting = (
  routing: ProjectSettings["aiProvider"]["invocationRouting"],
): ProjectSettings["aiProvider"]["invocationRouting"] => (
  Object.fromEntries(
    Object.entries(routing).map(([routeId, route]) => [
      routeId,
      {
        ...route,
        allowedProviders: [...route.allowedProviders],
        providers: Object.fromEntries(
          Object.entries(route.providers).map(([providerId, overrides]) => [providerId, { ...overrides }]),
        ),
      },
    ]),
  ) as ProjectSettings["aiProvider"]["invocationRouting"]
);

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
        maxConcurrentTasks: settings.aiProvider.providers.jules.maxConcurrentTasks,
      },
      gemini: {
        enabled: settings.aiProvider.providers.gemini.enabled,
        model: settings.aiProvider.providers.gemini.model,
        weight: settings.aiProvider.providers.gemini.weight,
        thinkingMode: settings.aiProvider.providers.gemini.thinkingMode,
        maxConcurrentTasks: settings.aiProvider.providers.gemini.maxConcurrentTasks,
      },
      codex: {
        enabled: settings.aiProvider.providers.codex.enabled,
        model: settings.aiProvider.providers.codex.model,
        weight: settings.aiProvider.providers.codex.weight,
        thinkingMode: settings.aiProvider.providers.codex.thinkingMode,
        maxConcurrentTasks: settings.aiProvider.providers.codex.maxConcurrentTasks,
      },
      "claude-code": {
        enabled: settings.aiProvider.providers["claude-code"].enabled,
        model: settings.aiProvider.providers["claude-code"].model,
        weight: settings.aiProvider.providers["claude-code"].weight,
        thinkingMode: settings.aiProvider.providers["claude-code"].thinkingMode,
        maxConcurrentTasks: settings.aiProvider.providers["claude-code"].maxConcurrentTasks,
      },
    },
    invocationRouting: cloneInvocationRouting(settings.aiProvider.invocationRouting),
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
  sprintPreview: {
    ...settings.sprintPreview,
  },
  workers: {
    ...settings.workers,
  },
  agents: {
    saveToProjectDirectory: settings.agents.saveToProjectDirectory,
    instructionTemplates: { ...settings.agents.instructionTemplates },
    qualityAssurance: {
      enabled: settings.agents.qualityAssurance.enabled,
      maxTaskReviewRuns: settings.agents.qualityAssurance.maxTaskReviewRuns,
      taskCompletion: { ...settings.agents.qualityAssurance.taskCompletion },
      sprintCompletion: { ...settings.agents.qualityAssurance.sprintCompletion },
      completedTaskWithoutPr: { ...settings.agents.qualityAssurance.completedTaskWithoutPr },
    },
  },
  skills: cloneSkills(settings.skills),
  memory: { ...settings.memory },
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
    invocationRouting: cloneInvocationRouting(settings.aiProvider.invocationRouting),
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
  sprintPreview: {
    ...settings.sprintPreview,
  },
  workers: {
    ...settings.workers,
  },
  agents: {
    saveToProjectDirectory: settings.agents.saveToProjectDirectory,
    instructionTemplates: { ...settings.agents.instructionTemplates },
    qualityAssurance: {
      enabled: settings.agents.qualityAssurance.enabled,
      maxTaskReviewRuns: settings.agents.qualityAssurance.maxTaskReviewRuns,
      taskCompletion: { ...settings.agents.qualityAssurance.taskCompletion },
      sprintCompletion: { ...settings.agents.qualityAssurance.sprintCompletion },
      completedTaskWithoutPr: { ...settings.agents.qualityAssurance.completedTaskWithoutPr },
    },
  },
  skills: cloneSkills(settings.skills),
  memory: { ...settings.memory },
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

export const applyEffectiveProjectSettings = (effectiveProject: EffectiveSettingsResponse): { settings: ProjectSettings, sources: Record<string, SettingsValueSource> } => {
  const nextProject = dashboardSettingsToProjectSettings(effectiveProject.settings);
  return {
    settings: cloneProjectSettings(nextProject),
    sources: effectiveProject.sources,
  };
};

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

const hasProviderApiKey = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
): boolean => {
  if (providerId === "jules") {
    return Boolean(systemSettings?.integrations.julesApiKey?.trim() || hints?.resolved.julesApiKey?.trim());
  }
  if (providerId === "gemini") {
    return Boolean(systemSettings?.integrations.geminiApiKey?.trim() || hints?.resolved.geminiApiKey?.trim());
  }
  if (providerId === "codex") {
    return Boolean(systemSettings?.integrations.codexApiKey?.trim() || hints?.resolved.codexApiKey?.trim());
  }
  if (providerId === "claude-code") {
    return Boolean(systemSettings?.integrations.claudeCodeApiKey?.trim() || hints?.resolved.claudeCodeApiKey?.trim());
  }
  return false;
};

const hasProviderLocalAuth = (
  providerId: ProviderId,
  hints: ExternalSettingsHints | null,
): boolean => {
  if (providerId === "gemini") {
    return Boolean(hints?.providerAvailability.gemini?.hasLocalAuth);
  }
  if (providerId === "codex") {
    return Boolean(hints?.providerAvailability.codex?.hasLocalAuth);
  }
  if (providerId === "claude-code") {
    return Boolean(hints?.providerAvailability.claudeCode?.hasLocalAuth);
  }
  return false;
};

export const providerSupportsModelSelection = (providerId: ProviderId): boolean => providerId !== "jules";

export const providerSupportsThinkingMode = (providerId: ProviderId): boolean => providerId !== "jules";

export const isProviderAvailable = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
  mountAuthEnabled = false,
): boolean => (
  hasProviderApiKey(providerId, systemSettings, hints)
  || hasProviderLocalAuth(providerId, hints)
  || (providerId !== "jules" && mountAuthEnabled)
);

export const getProviderAuthLabel = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
  dockerExecutionEnabled: boolean,
  mountAuthEnabled: boolean,
): string | null => {
  const hasApiKey = hasProviderApiKey(providerId, systemSettings, hints);
  const hasLocalAuth = hasProviderLocalAuth(providerId, hints);
  const hasMountedAuth = providerId !== "jules" && mountAuthEnabled && dockerExecutionEnabled;

  if (providerId === "jules") {
    return hasApiKey ? "API key" : null;
  }

  if (hasMountedAuth && hasApiKey) {
    return "Auth mount + API key";
  }
  if (hasMountedAuth && hasLocalAuth) {
    return "Auth mount + local auth";
  }
  if (hasMountedAuth) {
    return "Auth mount enabled";
  }
  if (hasLocalAuth && hasApiKey) {
    return "Local auth + API key";
  }
  if (hasLocalAuth) {
    return "Local auth";
  }
  return hasApiKey ? "API key" : null;
};

export const getEligibleProviders = (
  systemSettings: SystemSettings | null,
  editableSettings: ProjectSettings,
  hints: ExternalSettingsHints | null,
): ProviderId[] => {
  const visibleProviders = Object.entries(editableSettings.aiProvider.providers).filter(([providerId]) => {
    const mountAuthEnabled = providerId === "gemini"
      ? editableSettings.cliWorkflow.containerMountGeminiAuth
      : providerId === "codex"
        ? editableSettings.cliWorkflow.containerMountCodexAuth
        : providerId === "claude-code"
          ? editableSettings.cliWorkflow.containerMountClaudeCodeAuth
          : false;
    return isProviderAvailable(providerId as ProviderId, systemSettings, hints, mountAuthEnabled);
  });

  return visibleProviders
    .filter(([providerId, provider]) => provider.enabled)
    .map(([providerId]) => providerId as ProviderId);
};

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
