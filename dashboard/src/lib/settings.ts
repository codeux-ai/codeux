import type { DashboardSettings, ExternalSettingsHints, GuardrailSettings, TechstackCatalogSettings } from "../types.js";
import { DEFAULT_DASHBOARD_SETTINGS } from "../../../src/repositories/settings-defaults.js";

export { DEFAULT_DASHBOARD_SETTINGS };

/** Deep-clones the guardrails block (including the per-job-type record) so edits never alias defaults. */
export const cloneGuardrails = (guardrails: GuardrailSettings): GuardrailSettings => ({
  ...guardrails,
  jobs: {
    task_coding: { ...guardrails.jobs.task_coding },
    ci_fix: { ...guardrails.jobs.ci_fix },
    merge_conflict: { ...guardrails.jobs.merge_conflict },
    clarification_reply: { ...guardrails.jobs.clarification_reply },
    planning: { ...guardrails.jobs.planning },
    remediation: { ...guardrails.jobs.remediation },
  },
});

export const cloneTechstackCatalog = (catalog: TechstackCatalogSettings): TechstackCatalogSettings => ({
  defaultTechstackId: catalog.defaultTechstackId,
  entries: catalog.entries.map((entry) => ({
    ...entry,
    items: entry.items.map((item) => ({ ...item })),
  })),
});

export const cloneDefaultSettings = (): DashboardSettings => ({
  dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
  consoleLogLevel: DEFAULT_DASHBOARD_SETTINGS.consoleLogLevel,
  debugLogFileLevel: DEFAULT_DASHBOARD_SETTINGS.debugLogFileLevel,
  consoleLogMode: DEFAULT_DASHBOARD_SETTINGS.consoleLogMode,
  dbAutoVacuumOnStartup: DEFAULT_DASHBOARD_SETTINGS.dbAutoVacuumOnStartup,
  dbPruningEnabled: DEFAULT_DASHBOARD_SETTINGS.dbPruningEnabled,
  dbRetentionDays: DEFAULT_DASHBOARD_SETTINGS.dbRetentionDays,
  restartSprintPolicy: DEFAULT_DASHBOARD_SETTINGS.restartSprintPolicy,
  restartInvocationPolicy: DEFAULT_DASHBOARD_SETTINGS.restartInvocationPolicy,
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
      "qwen-code": { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["qwen-code"] },
      opencode: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.opencode },
      antigravity: { ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.antigravity },
    },
    invocationRouting: Object.fromEntries(
      Object.entries(DEFAULT_DASHBOARD_SETTINGS.aiProvider.invocationRouting).map(([routeId, route]) => [
        routeId,
        { ...route, allowedProviders: [...route.allowedProviders], providers: { ...route.providers } },
      ]),
    ) as DashboardSettings["aiProvider"]["invocationRouting"],
  },
  techstackCatalog: cloneTechstackCatalog(DEFAULT_DASHBOARD_SETTINGS.techstackCatalog),
  techstack: { ...DEFAULT_DASHBOARD_SETTINGS.techstack },
  git: { ...DEFAULT_DASHBOARD_SETTINGS.git },
  jira: { ...DEFAULT_DASHBOARD_SETTINGS.jira },
  notion: { ...DEFAULT_DASHBOARD_SETTINGS.notion },
  asana: { ...DEFAULT_DASHBOARD_SETTINGS.asana },
  linear: { ...DEFAULT_DASHBOARD_SETTINGS.linear },
  miro: { ...DEFAULT_DASHBOARD_SETTINGS.miro },
  lucid: { ...DEFAULT_DASHBOARD_SETTINGS.lucid },
  figma: { ...DEFAULT_DASHBOARD_SETTINGS.figma },
  mural: { ...DEFAULT_DASHBOARD_SETTINGS.mural },
  ciIntelligence: { ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence },
  guardrails: cloneGuardrails(DEFAULT_DASHBOARD_SETTINGS.guardrails),
  sprintLoopSteps: { ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps },
  cliWorkflow: { ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow },
  sprintPreview: { ...DEFAULT_DASHBOARD_SETTINGS.sprintPreview },
  workers: { ...DEFAULT_DASHBOARD_SETTINGS.workers },
  agents: {
    saveToProjectDirectory: DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
    routing: {
      planning: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.planning },
      taskCoding: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.taskCoding,
        orchestratorAgentPresetIds: [...DEFAULT_DASHBOARD_SETTINGS.agents.routing.taskCoding.orchestratorAgentPresetIds],
      },
      ciFix: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.ciFix },
      mergeConflict: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.mergeConflict },
      dashboardReply: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.dashboardReply },
      clarificationReply: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.clarificationReply },
    },
    instructionTemplates: { ...DEFAULT_DASHBOARD_SETTINGS.agents.instructionTemplates },
    qualityAssurance: {
      enabled: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.enabled,
      maxTaskReviewRuns: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.maxTaskReviewRuns,
      maxSprintReviewRuns: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.maxSprintReviewRuns,
      exhaustionPolicy: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.exhaustionPolicy,
      taskCompletion: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.taskCompletion,
        agentPresetIds: [...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.taskCompletion.agentPresetIds],
      },
      sprintCompletion: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.sprintCompletion,
        agentPresetIds: [...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.sprintCompletion.agentPresetIds],
      },
      completedTaskWithoutPr: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.completedTaskWithoutPr,
        agentPresetIds: [...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.completedTaskWithoutPr.agentPresetIds],
      },
    },
    selfReflection: {
      planning: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.planning,
        criteria: DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.planning.criteria.map((criterion) => ({ ...criterion })),
      },
      qualityAssurance: {
        ...DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance,
        criteria: DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection.qualityAssurance.criteria.map((criterion) => ({ ...criterion })),
      },
    },
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
  customMcpServers: DEFAULT_DASHBOARD_SETTINGS.customMcpServers.map((server) => ({ ...server })),
  memory: {
    ...DEFAULT_DASHBOARD_SETTINGS.memory,
    externalEmbedding: { ...DEFAULT_DASHBOARD_SETTINGS.memory.externalEmbedding },
  },
  modelPricing: { overrides: { ...DEFAULT_DASHBOARD_SETTINGS.modelPricing.overrides } },
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
          apiKey: (provider.apiKey || "").trim().length > 0
            ? provider.apiKey
            : provider.provider === "jules"
              ? hints.resolved.julesApiKey
              : provider.provider === "gemini"
                ? hints.resolved.geminiApiKey
                : provider.provider === "codex"
                  ? hints.resolved.codexApiKey
                  : provider.provider === "claude-code"
                    ? hints.resolved.claudeCodeApiKey
                    : provider.provider === "qwen-code"
                      ? hints.resolved.qwenCodeApiKey
                      : hints.resolved.openCodeApiKey,
        },
      ]),
    ),
  },
  git: {
    ...settings.git,
    githubToken: settings.git.githubToken.trim().length > 0 ? settings.git.githubToken : hints.resolved.githubToken,
    gitlabToken: settings.git.gitlabToken?.trim().length ? settings.git.gitlabToken : hints.resolved.gitlabToken || "",
  },
  jira: {
    ...settings.jira,
    apiToken: settings.jira.apiToken.trim().length > 0 ? settings.jira.apiToken : hints.resolved.jiraToken || "",
  },
});
