import type {
  CustomMcpServer,
  DashboardSettings,
  EffectiveSettingsResponse,
  ExternalSettingsHints,
  McpToolToggle,
  ProviderConfigId,
  ProviderId,
  ProjectProviderSettings,
  ProjectSettings,
  SettingsValueSource,
  SkillToggle,
  SystemProviderCredentialSettings,
  SystemSettings,
  ThinkingMode,
} from "../../types.js";
import { cloneGuardrails } from "../../lib/settings.js";
import { sanitizeSystemProviderConfig } from "./provider-runtime-preview.js";
import {
  BRANCH_NAME_TOKENS,
  BRANCH_NAME_TOKEN_ALIASES,
  type BranchNameToken,
} from "../../../../src/domain/settings/branch-name-tokens.js";
import { DEFAULT_PROVIDER_WEIGHT } from "../../../../src/repositories/settings-defaults.js";

const cloneSkills = (skills: SkillToggle[]): SkillToggle[] => skills.map((skill) => ({ ...skill }));
const cloneMcpTools = (tools: McpToolToggle[]): McpToolToggle[] => tools.map((tool) => ({ ...tool }));
const cloneCustomMcpServers = (servers: CustomMcpServer[] = []): CustomMcpServer[] => servers.map((server) => ({
  ...server,
  headers: server.headers ? { ...server.headers } : undefined,
  providers: server.providers ? [...server.providers] : undefined,
}));
const cloneProjectProviders = (
  providers: ProjectSettings["aiProvider"]["providers"],
): ProjectSettings["aiProvider"]["providers"] => (
  Object.fromEntries(
    Object.entries(providers).map(([providerConfigId, provider]) => [providerConfigId, { ...provider }]),
  )
);
const cloneIntegrationProviders = (
  providers: SystemSettings["integrations"]["providers"],
): SystemSettings["integrations"]["providers"] => (
  Object.fromEntries(
    Object.entries(providers).map(([providerConfigId, provider]) => [providerConfigId, { ...provider }]),
  )
);

const defaultJiraSettings = (): SystemSettings["integrations"]["jira"] => ({
  host: "",
  email: "",
  apiToken: "",
  autoCloseLinkedIssues: false,
  defaultProject: "",
  closeTransitionName: "Done",
});
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

const cloneAgentRouting = (
  routing: ProjectSettings["agents"]["routing"],
): ProjectSettings["agents"]["routing"] => ({
  planning: { ...routing.planning },
  taskCoding: {
    ...routing.taskCoding,
    orchestratorAgentPresetIds: [...routing.taskCoding.orchestratorAgentPresetIds],
  },
  ciFix: { ...routing.ciFix },
  mergeConflict: { ...routing.mergeConflict },
  dashboardReply: { ...routing.dashboardReply },
  clarificationReply: { ...routing.clarificationReply },
});

export const dashboardSettingsToProjectSettings = (settings: DashboardSettings): ProjectSettings => ({
  appearance: { ...settings.appearance },
  automationLevel: settings.automationLevel,
  automationInterventions: {
    ...settings.automationInterventions,
  },
  aiProvider: {
    provider: settings.aiProvider.provider,
    strategy: settings.aiProvider.strategy,
    providers: Object.fromEntries(
      Object.entries(settings.aiProvider.providers).map(([providerConfigId, provider]) => [
        providerConfigId,
        {
          provider: provider.provider,
          name: provider.name,
          enabled: provider.enabled,
          model: provider.model,
          weight: provider.weight,
          thinkingMode: provider.thinkingMode,
          maxConcurrentTasks: provider.maxConcurrentTasks,
        },
      ]),
    ),
    invocationRouting: cloneInvocationRouting(settings.aiProvider.invocationRouting),
  },
  git: {
    githubMode: settings.git.githubMode,
    githubToken: settings.git.githubToken,
    gitlabToken: settings.git.gitlabToken ?? "",
    defaultBranch: settings.git.defaultBranch,
    autoCreatePr: settings.git.autoCreatePr,
    autoCloseLinkedIssues: settings.git.autoCloseLinkedIssues,
    featureBranchPrefix: settings.git.featureBranchPrefix,
    sprintBranchScheme: settings.git.sprintBranchScheme,
    sprintKeyPrefix: settings.git.sprintKeyPrefix,
  },
  jira: { ...settings.jira },
  ciIntelligence: {
    ...settings.ciIntelligence,
  },
  guardrails: cloneGuardrails(settings.guardrails),
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
    routing: cloneAgentRouting(settings.agents.routing),
    instructionTemplates: { ...settings.agents.instructionTemplates },
    qualityAssurance: {
      enabled: settings.agents.qualityAssurance.enabled,
      maxTaskReviewRuns: settings.agents.qualityAssurance.maxTaskReviewRuns,
      maxSprintReviewRuns: settings.agents.qualityAssurance.maxSprintReviewRuns,
      exhaustionPolicy: settings.agents.qualityAssurance.exhaustionPolicy,
      taskCompletion: { ...settings.agents.qualityAssurance.taskCompletion },
      sprintCompletion: { ...settings.agents.qualityAssurance.sprintCompletion },
      completedTaskWithoutPr: { ...settings.agents.qualityAssurance.completedTaskWithoutPr },
    },
  },
  skills: cloneSkills(settings.skills),
  mcpTools: cloneMcpTools(settings.mcpTools),
  customMcpServers: cloneCustomMcpServers(settings.customMcpServers),
  memory: { ...settings.memory },
});

export const cloneProjectSettings = (settings: ProjectSettings): ProjectSettings => ({
  appearance: { ...settings.appearance },
  automationLevel: settings.automationLevel,
  automationInterventions: {
    ...settings.automationInterventions,
  },
  aiProvider: {
    provider: settings.aiProvider.provider,
    strategy: settings.aiProvider.strategy,
    providers: cloneProjectProviders(settings.aiProvider.providers),
    invocationRouting: cloneInvocationRouting(settings.aiProvider.invocationRouting),
  },
  git: {
    ...settings.git,
  },
  jira: { ...settings.jira },
  ciIntelligence: {
    ...settings.ciIntelligence,
  },
  guardrails: cloneGuardrails(settings.guardrails),
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
    routing: cloneAgentRouting(settings.agents.routing),
    instructionTemplates: { ...settings.agents.instructionTemplates },
    qualityAssurance: {
      enabled: settings.agents.qualityAssurance.enabled,
      maxTaskReviewRuns: settings.agents.qualityAssurance.maxTaskReviewRuns,
      maxSprintReviewRuns: settings.agents.qualityAssurance.maxSprintReviewRuns,
      exhaustionPolicy: settings.agents.qualityAssurance.exhaustionPolicy,
      taskCompletion: { ...settings.agents.qualityAssurance.taskCompletion },
      sprintCompletion: { ...settings.agents.qualityAssurance.sprintCompletion },
      completedTaskWithoutPr: { ...settings.agents.qualityAssurance.completedTaskWithoutPr },
    },
  },
  skills: cloneSkills(settings.skills),
  mcpTools: settings.mcpTools ? cloneMcpTools(settings.mcpTools) : undefined,
  customMcpServers: settings.customMcpServers ? cloneCustomMcpServers(settings.customMcpServers) : undefined,
  memory: { ...settings.memory },
});

export const cloneSystemSettings = (settings: SystemSettings): SystemSettings => ({
  runtime: {
    ...settings.runtime,
  },
  integrations: {
    ...settings.integrations,
    jira: settings.integrations.jira ? { ...settings.integrations.jira } : defaultJiraSettings(),
    providers: cloneIntegrationProviders(settings.integrations.providers),
  },
  defaults: cloneProjectSettings(settings.defaults),
  mcpTools: cloneMcpTools(settings.mcpTools),
  customMcpServers: cloneCustomMcpServers(settings.customMcpServers),
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
): SystemSettings => {
  const nextProviders = cloneIntegrationProviders(settings.integrations.providers);
  for (const [providerConfigId, provider] of Object.entries(nextProviders)) {
    if (!provider.apiKey.trim()) {
      nextProviders[providerConfigId] = {
        ...provider,
        apiKey: getHintApiKey(provider.provider, hints),
      };
    }
  }

  const currentJira = settings.integrations.jira || defaultJiraSettings();

  return {
    ...cloneSystemSettings(settings),
    integrations: {
      providers: nextProviders,
      githubToken: settings.integrations.githubToken || hints.resolved.githubToken || "",
      gitlabToken: settings.integrations.gitlabToken || hints.resolved.gitlabToken || "",
      jira: {
        ...currentJira,
        apiToken: currentJira.apiToken || hints.resolved.jiraToken || "",
      },
    },
  };
};

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

export const sourceLabel = (source: SettingsValueSource | "mixed"): string => {
  switch (source) {
    case "project":
      return "Project override";
    case "sprint":
      return "Sprint override";
    case "mixed":
      return "Mixed sources";
    case "system":
    default:
      return "Inherited";
  }
};

export const thinkingModeOptions: Array<{ value: ThinkingMode; label: string }> = [
  { value: "SMALL", label: "Small" },
  { value: "MEDIUM", label: "Medium" },
  { value: "HIGH", label: "High" },
];

export const providerLabels: Record<ProviderId, string> = {
  jules: "Jules",
  gemini: "Gemini",
  codex: "Codex",
  "claude-code": "Claude Code",
  "qwen-code": "Qwen Code",
  opencode: "OpenCode",
  antigravity: "Antigravity",
};

export const getProviderTypeLabel = (providerId: ProviderId): string => providerLabels[providerId];

export const createProjectProviderDraft = (
  providerId: ProviderId,
  name: string,
): ProjectProviderSettings => ({
  provider: providerId,
  name,
  enabled: providerId !== "claude-code" && providerId !== "qwen-code" && providerId !== "opencode",
  model: providerId === "codex"
    ? "gpt-5.5"
    : providerId === "qwen-code"
      ? "qwen3-coder-plus"
      : providerId === "opencode"
        ? "anthropic/claude-sonnet-4-5"
        : "default",
  weight: DEFAULT_PROVIDER_WEIGHT,
  thinkingMode: providerId === "codex" || providerId === "claude-code" || providerId === "qwen-code" || providerId === "opencode" ? "HIGH" : "MEDIUM",
  maxConcurrentTasks: providerId === "jules" ? 15 : 0,
});
export const getProviderDefaultAuthPath = (providerId: ProviderId): string => {
  switch (providerId) {
    case "gemini":
      return "~/.gemini";
    case "codex":
      return "~/.codex";
    case "claude-code":
      return "~/.claude";
    case "qwen-code":
      return "~/.qwen";
    case "opencode":
      return "~/.local/share/opencode";
    case "antigravity":
      return "~/.antigravity";
    default:
      return "";
  }
};

export const createSystemProviderDraft = (
  providerId: ProviderId,
  name: string,
): SystemProviderCredentialSettings => {
  const base: SystemProviderCredentialSettings = {
    provider: providerId,
    name,
    apiKey: "",
    authType: "apiKey",
    mountAuth: false,
    authPath: getProviderDefaultAuthPath(providerId),
  };

  if (providerId === "qwen-code") {
    return {
      ...base,
      qwenAuthMode: "MODEL_PROVIDER",
      qwenRegion: "international",
      qwenBaseUrl: "http://127.0.0.1:11434/v1",
      qwenEnvKey: "OLLAMA_API_KEY",
      qwenModelId: "glm-4.7-flash",
      qwenProtocol: "openai",
      qwenAdditionalModelProviders: [],
    };
  }

  if (providerId === "opencode") {
    return {
      ...base,
      openCodeAuthMode: "ENV_KEY",
      openCodeProviderId: "ollama",
      openCodeModelId: "glm-4.7-flash",
      openCodeBaseUrl: "http://127.0.0.1:11434/v1",
      openCodeEnvKey: "OLLAMA_API_KEY",
      openCodePackage: "@ai-sdk/openai-compatible",
    };
  }

  return base;
};

/**
 * Derives a stable ordering key for a provider instance. Instances must keep a
 * fixed position so that adding a second/third credential — or renaming one —
 * never reshuffles the list. Ordering by the (user-editable) display name caused
 * exactly that: "Gemini 2" sorted ahead of "Gemini Primary" and positions swapped
 * mid-edit. Instead we lead with the seeded primary (whose config id is the bare
 * provider id) and then fall back to the base36 creation timestamp embedded in
 * added config ids (`${type}-${base36ts}-${rand}`).
 */
const getProviderInstanceSortKey = (
  providerConfigId: ProviderConfigId,
  providerType: ProviderId,
): { isPrimary: number; createdAt: number } => {
  if (providerConfigId === providerType) {
    return { isPrimary: 0, createdAt: 0 };
  }
  const suffix = providerConfigId.startsWith(`${providerType}-`)
    ? providerConfigId.slice(providerType.length + 1)
    : providerConfigId;
  const createdAt = Number.parseInt(suffix.split("-")[0], 36);
  return { isPrimary: 1, createdAt: Number.isFinite(createdAt) ? createdAt : Number.MAX_SAFE_INTEGER };
};

export const sortProviderConfigEntries = <T extends { provider: ProviderId; name: string }>(
  entries: Array<[ProviderConfigId, T]>,
): Array<[ProviderConfigId, T]> => (
  [...entries].sort((left, right) => {
    const providerCompare = getProviderTypeLabel(left[1].provider).localeCompare(getProviderTypeLabel(right[1].provider));
    if (providerCompare !== 0) {
      return providerCompare;
    }
    const leftKey = getProviderInstanceSortKey(left[0], left[1].provider);
    const rightKey = getProviderInstanceSortKey(right[0], right[1].provider);
    if (leftKey.isPrimary !== rightKey.isPrimary) {
      return leftKey.isPrimary - rightKey.isPrimary;
    }
    if (leftKey.createdAt !== rightKey.createdAt) {
      return leftKey.createdAt - rightKey.createdAt;
    }
    // Final tiebreak on the immutable config id so order never depends on the name.
    return left[0].localeCompare(right[0]);
  })
);

export const getProviderInstanceLabel = (provider: { provider: ProviderId; name: string }): string => (
  `${provider.name} · ${getProviderTypeLabel(provider.provider)}`
);

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
    "gemini-3.1-pro-preview",
    "gemini-3.1-pro-preview-customtools",
    "gemini-3.1-flash-lite-preview",
    "gemini-2.5-pro",
    "gemini-2.5-flash",
    "gemini-2.5-flash-lite",
    "gemini-3.1-flash-lite",
    "gemma-4-31b-it",
    "gemma-4-26b-a4b-it",
    "gemini-2.5-flash-base",
    "gemini-3-flash-base",
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
    "claude-fable-5",
  ],
  codex: [
    "gpt-5.5",
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
  "qwen-code": [
    "qwen3-coder-plus",
    "qwen3.5-plus",
    "qwen3-coder-next",
    "qwen3-max",
    "qwen3-max-2026-01-23",
    "qwen-plus",
    "qwen-max",
  ],
  opencode: [
    "anthropic/claude-sonnet-4-5",
    "anthropic/claude-opus-4-1",
    "anthropic/claude-haiku-4-5",
    "openai/gpt-5",
    "openai/gpt-5-mini",
    "github-copilot/gpt-5",
    "openrouter/anthropic/claude-sonnet-4.5",
  ],
  antigravity: [
    "default",
    "gemini-3.5-flash",
    "gemini-3.1-pro-high",
    "gemini-3.1-pro-low",
    "gemini-3-flash",
    "claude-sonnet-4.6-thinking",
    "claude-opus-4.6-thinking",
    "gpt-oss-120b",
  ],
};

const PROVIDER_MODEL_LABEL_OVERRIDES: Partial<Record<ProviderId, Record<string, string>>> = {
  gemini: {
    pro: "pro (recent)",
    flash: "flash (recent)",
    "flash-lite": "flash-lite (recent)",
  },
};

const getHintApiKey = (
  providerId: ProviderId,
  hints: ExternalSettingsHints | null,
): string => {
  if (providerId === "jules") {
    return hints?.resolved.julesApiKey || "";
  }
  if (providerId === "gemini") {
    return hints?.resolved.geminiApiKey || "";
  }
  if (providerId === "codex") {
    return hints?.resolved.codexApiKey || "";
  }
  if (providerId === "claude-code") {
    return hints?.resolved.claudeCodeApiKey || "";
  }
  if (providerId === "qwen-code") {
    return hints?.resolved.qwenCodeApiKey || "";
  }
  if (providerId === "antigravity") {
    return hints?.resolved.antigravityApiKey || "";
  }
  return hints?.resolved.openCodeApiKey || "";
};

const getLegacyIntegrationApiKey = (
  systemSettings: SystemSettings | null,
  providerId: ProviderId,
): string => {
  const integrations = (systemSettings?.integrations || {}) as Record<string, unknown>;
  if (providerId === "jules") {
    return typeof integrations.julesApiKey === "string" ? integrations.julesApiKey : "";
  }
  if (providerId === "gemini") {
    return typeof integrations.geminiApiKey === "string" ? integrations.geminiApiKey : "";
  }
  if (providerId === "codex") {
    return typeof integrations.codexApiKey === "string" ? integrations.codexApiKey : "";
  }
  if (providerId === "claude-code") {
    return typeof integrations.claudeCodeApiKey === "string" ? integrations.claudeCodeApiKey : "";
  }
  if (providerId === "qwen-code") {
    return typeof integrations.qwenCodeApiKey === "string" ? integrations.qwenCodeApiKey : "";
  }
  if (providerId === "antigravity") {
    return typeof integrations.antigravityApiKey === "string" ? integrations.antigravityApiKey : "";
  }
  return typeof integrations.openCodeApiKey === "string" ? integrations.openCodeApiKey : "";
};

export const getSystemIntegrationProviders = (
  systemSettings: SystemSettings | null,
): Record<ProviderConfigId, SystemProviderCredentialSettings> => {
  const providers = systemSettings?.integrations?.providers;
  if (providers && Object.keys(providers).length > 0) {
    return Object.fromEntries(
      Object.entries(providers).map(([id, config]) => [id, sanitizeSystemProviderConfig(config)])
    );
  }

  const fallback: Record<ProviderConfigId, SystemProviderCredentialSettings> = {};
  for (const providerId of ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"] as ProviderId[]) {
    const apiKey = getLegacyIntegrationApiKey(systemSettings, providerId);
    const base: SystemProviderCredentialSettings = {
      provider: providerId,
      name: getProviderTypeLabel(providerId),
      apiKey,
      authType: "apiKey",
      mountAuth: false,
      authPath: getProviderDefaultAuthPath(providerId),
    };

    let item: SystemProviderCredentialSettings;
    if (providerId === "qwen-code") {
      item = {
        ...base,
        qwenAuthMode: "MODEL_PROVIDER",
        qwenRegion: "international",
        qwenBaseUrl: "http://127.0.0.1:11434/v1",
        qwenEnvKey: "OLLAMA_API_KEY",
        qwenModelId: "glm-4.7-flash",
        qwenProtocol: "openai",
        qwenAdditionalModelProviders: [],
      };
    } else if (providerId === "opencode") {
      item = {
        ...base,
        openCodeAuthMode: "ENV_KEY",
        openCodeProviderId: "ollama",
        openCodeModelId: "glm-4.7-flash",
        openCodeBaseUrl: "http://127.0.0.1:11434/v1",
        openCodeEnvKey: "OLLAMA_API_KEY",
        openCodePackage: "@ai-sdk/openai-compatible",
      };
    } else {
      item = base;
    }
    fallback[providerId] = sanitizeSystemProviderConfig(item);
  }
  return fallback;
};

const inferProviderTypeFromConfigId = (providerConfigId: ProviderConfigId): ProviderId | null => {
  if (providerConfigId === "jules" || providerConfigId.startsWith("jules-")) {
    return "jules";
  }
  if (providerConfigId === "gemini" || providerConfigId.startsWith("gemini-")) {
    return "gemini";
  }
  if (providerConfigId === "codex" || providerConfigId.startsWith("codex-")) {
    return "codex";
  }
  if (providerConfigId === "claude-code" || providerConfigId.startsWith("claude-code-") || providerConfigId.startsWith("claude-")) {
    return "claude-code";
  }
  if (providerConfigId === "qwen-code" || providerConfigId.startsWith("qwen-code-") || providerConfigId.startsWith("qwen-")) {
    return "qwen-code";
  }
  if (providerConfigId === "opencode" || providerConfigId.startsWith("opencode-")) {
    return "opencode";
  }
  if (providerConfigId === "antigravity" || providerConfigId.startsWith("antigravity-")) {
    return "antigravity";
  }
  return null;
};

export const getSystemProvidersByType = (
  systemSettings: SystemSettings | null,
  providerId: ProviderId,
): Array<[ProviderConfigId, SystemProviderCredentialSettings]> => (
  Object.entries(getSystemIntegrationProviders(systemSettings))
    .filter(([, provider]) => provider.provider === providerId)
);

export const getProjectProvidersByType = (
  settings: ProjectSettings,
  providerId: ProviderId,
): Array<[ProviderConfigId, ProjectProviderSettings]> => (
  Object.entries(settings.aiProvider.providers)
    .filter(([providerConfigId, provider]) => (provider.provider || inferProviderTypeFromConfigId(providerConfigId)) === providerId)
);

export const hasProviderInstanceApiKey = (
  providerConfigId: ProviderConfigId,
  systemSettings: SystemSettings | null,
): boolean => Boolean(getSystemIntegrationProviders(systemSettings)[providerConfigId]?.apiKey?.trim());

const hasAnyProviderApiKey = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
): boolean => (
  getSystemProvidersByType(systemSettings, providerId).some(([, provider]) => provider.apiKey.trim().length > 0)
  || Boolean(getLegacyIntegrationApiKey(systemSettings, providerId).trim())
  || Boolean(getHintApiKey(providerId, hints).trim())
);

export const providerSupportsModelSelection = (providerId: ProviderId): boolean => providerId !== "jules";

export const providerSupportsThinkingMode = (providerId: ProviderId): boolean => providerId !== "jules";

export const isProviderAvailable = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
): boolean => (
  hasAnyProviderApiKey(providerId, systemSettings, hints)
  || (providerId !== "jules" && getSystemProvidersByType(systemSettings, providerId).some(([, provider]) => provider.mountAuth))
);

export const isProviderInstanceAvailable = (
  providerConfigId: ProviderConfigId,
  systemSettings: SystemSettings | null,
): boolean => {
  const providerConfig = getSystemIntegrationProviders(systemSettings)[providerConfigId];
  const providerType = providerConfig?.provider;
  if (!providerType) {
    return false;
  }
  return hasProviderInstanceApiKey(providerConfigId, systemSettings)
    || (providerType !== "jules" && providerConfig.mountAuth);
};

export const getProviderInstanceAuthLabel = (
  providerConfigId: ProviderConfigId,
  systemSettings: SystemSettings | null,
  dockerExecutionEnabled: boolean,
): string | null => {
  const providerConfig = getSystemIntegrationProviders(systemSettings)[providerConfigId];
  const providerType = providerConfig?.provider;
  if (!providerType) {
    return null;
  }
  const hasApiKey = hasProviderInstanceApiKey(providerConfigId, systemSettings);
  const hasMountedAuth = providerType !== "jules" && providerConfig.mountAuth;

  if (providerType === "jules") {
    return hasApiKey ? "API key" : null;
  }

  if (providerConfig.authType === "dashboardAuth") {
    return "Dashboard login";
  }

  if (hasMountedAuth && hasApiKey) {
    return dockerExecutionEnabled ? "Auth mount + API key" : "Mount config + API key";
  }
  if (hasMountedAuth) {
    return dockerExecutionEnabled ? "Auth mount enabled" : "Mount config enabled";
  }
  return hasApiKey ? "API key" : null;
};

export const getProviderAuthLabel = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
  dockerExecutionEnabled: boolean,
): string | null => {
  const systemProviders = getSystemProvidersByType(systemSettings, providerId);
  if (systemProviders.length > 0) {
    const labels = systemProviders
      .map(([providerConfigId]) => getProviderInstanceAuthLabel(providerConfigId, systemSettings, dockerExecutionEnabled))
      .filter((label): label is string => Boolean(label));
    if (labels.length > 0) {
      return labels.length === 1 ? labels[0] : `${labels.length} credentials`;
    }
  }
  return hasAnyProviderApiKey(providerId, systemSettings, hints) ? "API key" : null;
};

export const getEligibleProviders = (
  systemSettings: SystemSettings | null,
  editableSettings: ProjectSettings,
  hints: ExternalSettingsHints | null,
): ProviderConfigId[] => (
  Object.entries(editableSettings.aiProvider.providers)
    .filter(([providerConfigId, provider]) => {
      const providerType = provider.provider || inferProviderTypeFromConfigId(providerConfigId);
      if (!providerType) {
        return false;
      }
      return provider.enabled && (isProviderInstanceAvailable(providerConfigId, systemSettings)
        || Boolean(getHintApiKey(providerType, hints)));
    })
    .map(([providerConfigId]) => providerConfigId)
);

export const countConnectedProviders = (
  providerId: ProviderId,
  systemSettings: SystemSettings | null,
  hints: ExternalSettingsHints | null,
): number => {
  const stored = getSystemProvidersByType(systemSettings, providerId)
    .filter(([, provider]) => provider.apiKey.trim().length > 0 || (provider.provider !== "jules" && provider.mountAuth))
    .length;
  return Math.max(stored, hints && getHintApiKey(providerId, hints).trim() ? 1 : 0);
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

export const getOpenCodeConfiguredModel = (
  provider: Pick<SystemProviderCredentialSettings, "openCodeAuthMode" | "openCodeProviderId" | "openCodeModelId"> | null | undefined,
  fallbackModel = "anthropic/claude-sonnet-4-5",
): string | null => {
  if (provider?.openCodeAuthMode !== "CUSTOM_PROVIDER") {
    return null;
  }
  const [fallbackProviderId, ...fallbackModelParts] = fallbackModel.split("/");
  const providerId = (provider.openCodeProviderId || fallbackProviderId || "custom").trim();
  const modelId = (provider.openCodeModelId || fallbackModelParts.join("/") || "model").trim();
  return `${providerId}/${modelId}`;
};

export const getQwenConfiguredModel = (
  provider: Pick<SystemProviderCredentialSettings, "qwenAuthMode" | "qwenModelId"> | null | undefined,
  fallbackModel = "glm-4.7-flash",
): string | null => {
  if (provider?.qwenAuthMode !== "MODEL_PROVIDER") {
    return null;
  }
  const fallback = fallbackModel === "custom/model" || fallbackModel === "local-model"
    ? "glm-4.7-flash"
    : fallbackModel;
  return (provider.qwenModelId || fallback || "glm-4.7-flash").trim();
};

export const getProviderInstanceModelOptions = (
  providerConfigId: ProviderConfigId,
  provider: Pick<ProjectProviderSettings, "provider" | "model">,
  systemSettings: SystemSettings | null,
): Array<{ value: string; label: string }> => {
  const baseOptions = getProviderModelOptions(provider.provider);
  const systemProvider = getSystemIntegrationProviders(systemSettings)[providerConfigId];
  const configuredOpenCodeModel = provider.provider === "opencode"
    ? getOpenCodeConfiguredModel(systemProvider, provider.model)
    : null;
  const configuredQwenModel = provider.provider === "qwen-code"
    ? getQwenConfiguredModel(systemProvider, provider.model)
    : null;
  const selectedModels = [
    configuredOpenCodeModel,
    configuredQwenModel,
    provider.model,
  ].filter((value): value is string => Boolean(value && value.trim().length > 0));

  const optionsByValue = new Map<string, { value: string; label: string }>();
  for (const option of baseOptions) {
    optionsByValue.set(option.value, option);
  }
  for (const selectedModel of selectedModels) {
    if (!optionsByValue.has(selectedModel)) {
      optionsByValue.set(selectedModel, {
        value: selectedModel,
        label: configuredOpenCodeModel === selectedModel || configuredQwenModel === selectedModel
          ? `${selectedModel} (configured)`
          : selectedModel,
      });
    }
  }
  return [...optionsByValue.values()];
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
  "qwen-code": {
    watermark: "QWN",
    logoLabel: "Q",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  opencode: {
    watermark: "OPC",
    logoLabel: "O",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
  antigravity: {
    watermark: "AGY",
    logoLabel: "AGY",
    badgeLabel: "CLI",
    badgeClassName: "border-black/[0.08] bg-black/[0.035] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
    glowClassName: "bg-[radial-gradient(circle_at_top_right,rgba(15,23,42,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(15,23,42,0.03),transparent_34%)] dark:bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.045),transparent_42%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.025),transparent_34%)]",
    railClassName: "bg-black/[0.12] dark:bg-white/[0.14]",
    noteClassName: "border-black/[0.08] bg-black/[0.03] text-slate-600 dark:border-white/[0.08] dark:bg-white/[0.04] dark:text-slate-300",
  },
};

export interface BranchSchemeOption {
  value: string;
  label: string;
}

export const BRANCH_NAME_TOKEN_LABELS: Record<BranchNameToken, string> = {
  sprint_key_prefix: "Sprint Key Prefix",
  sprint_number: "Sprint Number",
  sprint_name: "Sprint Name",
  sprint_id: "Sprint ID",
  planning_agent: "Planning Agent",
  agent_routing: "Agent Routing",
  worker_agent: "Worker Agent",
  worker_provider: "Worker Provider",
  worker_model: "Worker Model",
};

export const getCanonicalBranchNameToken = (tokenOrScheme: string): BranchNameToken => {
  const match = tokenOrScheme.match(/\{([^}]+)\}/);
  const token = match ? match[1] : tokenOrScheme;
  return BRANCH_NAME_TOKEN_ALIASES[token] || (BRANCH_NAME_TOKENS.includes(token as any) ? (token as BranchNameToken) : "sprint_id");
};

export const getBranchSchemeOptions = (): BranchSchemeOption[] => {
  return BRANCH_NAME_TOKENS.map((token) => ({
    value: `{${token}}`,
    label: BRANCH_NAME_TOKEN_LABELS[token],
  }));
};

