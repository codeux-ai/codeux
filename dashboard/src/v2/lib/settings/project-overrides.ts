import type {
  CustomMcpServer,
  DashboardSettings,
  EffectiveSettingsResponse,
  ExternalSettingsHints,
  McpToolToggle,
  ProjectSettings,
  SettingsValueSource,
  SkillToggle,
  SystemSettings,
} from "../../../types.js";
import { cloneGuardrails } from "../../../lib/settings.js";
import { getHintApiKey } from "./provider-instances.js";

const cloneMemorySettings = (memory: ProjectSettings["memory"]): ProjectSettings["memory"] => ({
  ...memory,
  externalEmbedding: { ...memory.externalEmbedding },
});

const cloneJiraSettings = (jira: SystemSettings["integrations"]["jira"]): SystemSettings["integrations"]["jira"] => ({ ...jira });

const cloneQualityAssuranceTrigger = (
  trigger: ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"],
): ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"] => {
  const sourceIds = Array.isArray(trigger.agentPresetIds)
    ? trigger.agentPresetIds
    : trigger.agentPresetId
      ? [trigger.agentPresetId]
      : [];
  const agentPresetIds = [...new Set(sourceIds.map((id) => id.trim()).filter(Boolean))];

  return {
    ...trigger,
    agentPresetIds,
    agentPresetId: agentPresetIds[0] ?? null,
  };
};

const cloneQualityAssuranceSettings = (qa: ProjectSettings["agents"]["qualityAssurance"]): ProjectSettings["agents"]["qualityAssurance"] => ({
  enabled: qa.enabled,
  maxTaskReviewRuns: qa.maxTaskReviewRuns,
  maxSprintReviewRuns: qa.maxSprintReviewRuns,
  exhaustionPolicy: qa.exhaustionPolicy,
  taskCompletion: cloneQualityAssuranceTrigger(qa.taskCompletion),
  sprintCompletion: cloneQualityAssuranceTrigger(qa.sprintCompletion),
  completedTaskWithoutPr: cloneQualityAssuranceTrigger(qa.completedTaskWithoutPr),
});

const cloneSkills = (skills: SkillToggle[]): SkillToggle[] => skills.map((skill) => ({ ...skill }));
const cloneMcpTools = (tools: McpToolToggle[]): McpToolToggle[] => tools.map((tool) => ({ ...tool }));
const cloneCustomMcpServers = (servers: CustomMcpServer[] = []): CustomMcpServer[] => servers.map((server) => ({
  ...server,
  headers: server.headers ? { ...server.headers } : undefined,
  env: server.env ? { ...server.env } : undefined,
  providers: server.providers ? [...server.providers] : undefined,
}));

export const cloneProjectProviders = (
  providers: ProjectSettings["aiProvider"]["providers"],
): ProjectSettings["aiProvider"]["providers"] => (
  Object.fromEntries(
    Object.entries(providers).map(([providerConfigId, provider]) => [providerConfigId, { ...provider }]),
  )
);

export const cloneIntegrationProviders = (
  providers: SystemSettings["integrations"]["providers"],
): SystemSettings["integrations"]["providers"] => (
  Object.fromEntries(
    Object.entries(providers).map(([providerConfigId, provider]) => [providerConfigId, { ...provider }]),
  )
);

const cloneClusterSettings = (cluster: SystemSettings["cluster"]): SystemSettings["cluster"] => ({
  connections: cluster.connections.map((connection) => ({
    ...connection,
    ...(connection.lastSync ? { lastSync: { ...connection.lastSync } } : {}),
    syncPolicy: { ...connection.syncPolicy },
  })),
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

const cloneProjectAiProviderSettings = (
  aiProvider: ProjectSettings["aiProvider"],
): ProjectSettings["aiProvider"] => ({
  provider: aiProvider.provider,
  strategy: aiProvider.strategy,
  providers: cloneProjectProviders(aiProvider.providers),
  invocationRouting: cloneInvocationRouting(aiProvider.invocationRouting),
});

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

const defaultJiraSettings = (): SystemSettings["integrations"]["jira"] => ({
  host: "",
  email: "",
  apiToken: "",
  autoTransitionLinkedIssuesOnImport: true,
  importTransitionName: "In Work",
  autoCloseLinkedIssues: false,
  defaultProject: "",
  closeTransitionName: "Done",
});

export const dashboardSettingsToProjectSettings = (settings: DashboardSettings): ProjectSettings => ({
  appearance: { ...settings.appearance },
  automationLevel: settings.automationLevel,
  automationInterventions: {
    ...settings.automationInterventions,
  },
  aiProvider: cloneProjectAiProviderSettings(settings.aiProvider),
  git: {
    githubMode: settings.git.githubMode,
    githubToken: settings.git.githubToken,
    gitlabToken: settings.git.gitlabToken ?? "",
    defaultBranch: settings.git.defaultBranch,
    autoCreatePr: settings.git.autoCreatePr,
    autoCloseLinkedIssues: settings.git.autoCloseLinkedIssues,
    deleteMergedBranches: settings.git.deleteMergedBranches,
    featureBranchPrefix: settings.git.featureBranchPrefix,
    sprintBranchScheme: settings.git.sprintBranchScheme,
    sprintKeyPrefix: settings.git.sprintKeyPrefix,
    prDescription: settings.git.prDescription,
  },
  jira: cloneJiraSettings(settings.jira),
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
    qualityAssurance: cloneQualityAssuranceSettings(settings.agents.qualityAssurance),
  },
  skills: cloneSkills(settings.skills),
  mcpTools: cloneMcpTools(settings.mcpTools),
  customMcpServers: cloneCustomMcpServers(settings.customMcpServers),
  memory: cloneMemorySettings(settings.memory),
});

export const cloneProjectSettings = (settings: ProjectSettings): ProjectSettings => ({
  appearance: { ...settings.appearance },
  automationLevel: settings.automationLevel,
  automationInterventions: {
    ...settings.automationInterventions,
  },
  aiProvider: cloneProjectAiProviderSettings(settings.aiProvider),
  git: {
    ...settings.git,
  },
  jira: cloneJiraSettings(settings.jira),
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
    qualityAssurance: cloneQualityAssuranceSettings(settings.agents.qualityAssurance),
  },
  skills: cloneSkills(settings.skills),
  mcpTools: settings.mcpTools ? cloneMcpTools(settings.mcpTools) : undefined,
  customMcpServers: settings.customMcpServers ? cloneCustomMcpServers(settings.customMcpServers) : undefined,
  memory: cloneMemorySettings(settings.memory),
});

export const cloneSystemSettings = (settings: SystemSettings): SystemSettings => ({
  runtime: {
    ...settings.runtime,
  },
  integrations: {
    ...settings.integrations,
    jira: settings.integrations.jira ? cloneJiraSettings(settings.integrations.jira) : defaultJiraSettings(),
    providers: cloneIntegrationProviders(settings.integrations.providers),
  },
  cluster: cloneClusterSettings(settings.cluster ?? { connections: [] }),
  defaults: cloneProjectSettings(settings.defaults),
  mcpTools: cloneMcpTools(settings.mcpTools),
  customMcpServers: cloneCustomMcpServers(settings.customMcpServers),
  modelPricing: { overrides: { ...settings.modelPricing?.overrides } },
});

export const applyEffectiveProjectSettings = (effectiveProject: EffectiveSettingsResponse): { settings: ProjectSettings; sources: Record<string, SettingsValueSource> } => {
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
