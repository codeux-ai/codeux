import type {
  BackgroundPattern,
  ConsoleLogMode,
  CustomMcpServer,
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  RuntimeLogLevel,
  SkillToggle,
} from "../contracts/app-types.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  ProjectSettingsOverride,
  SprintSettingsOverride,
  SystemSettings,
  SettingsValueSource,
} from "../contracts/settings-scope-types.js";
import { sanitizeAiProvider } from "../domain/settings/settings-sanitizers/ai-provider-sanitizer.js";
import { sanitizeCiIntelligence } from "../domain/settings/settings-sanitizers/ci-sanitizer.js";
import { sanitizeGuardrails } from "../domain/settings/settings-sanitizers/guardrails-sanitizer.js";
import { sanitizeCliWorkflow } from "../domain/settings/settings-sanitizers/cli-workflow-sanitizer.js";
import { sanitizeGit } from "../domain/settings/settings-sanitizers/git-sanitizer.js";
import { sanitizeJira } from "../domain/settings/settings-sanitizers/jira-sanitizer.js";
import { sanitizeSprintLoopSteps } from "../domain/settings/settings-sanitizers/sprint-loop-sanitizer.js";
import { sanitizeMemory } from "../domain/settings/settings-sanitizers/memory-sanitizer.js";
import { sanitizeWorkers } from "../domain/settings/settings-sanitizers/worker-sanitizer.js";
import {
  buildDashboardProviderSettings,
  buildDefaultIntegrationProviders,
  normalizeSystemIntegrationProviders,
} from "../domain/settings/provider-config-utils.js";
import { sanitizeCustomMcpServers, sanitizeMcpToolToggles } from "../mcp/mcp-tool-availability.js";
import { DEFAULT_INSTRUCTION_TEMPLATES, INSTRUCTION_TEMPLATE_IDS, type InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import { DEFAULT_DASHBOARD_SETTINGS, DEFAULT_SKILLS, INTERNAL_SKILL_NAMES, INTERNAL_SKILL_SET } from "../repositories/settings-defaults.js";

function cloneSkills(skills: SkillToggle[]): SkillToggle[] {
  return skills.map((skill) => ({ ...skill }));
}

const BACKGROUND_PATTERNS = new Set<BackgroundPattern>([
  "NONE",
  "DIAGONAL_LINES",
  "HORIZONTAL_LINES",
  "VERTICAL_LINES",
  "CROSSHATCH",
  "DOTS",
  "DIAMONDS",
  "HEXAGONS",
  "TRIANGLES",
  "WAVES",
  "NOISE",
]);

const RUNTIME_LOG_LEVEL_SET = new Set<RuntimeLogLevel>(["off", "debug", "info", "warn", "error"]);

const readRuntimeLogLevel = (value: unknown, fallback: RuntimeLogLevel): RuntimeLogLevel => (
  typeof value === "string" && RUNTIME_LOG_LEVEL_SET.has(value as RuntimeLogLevel)
    ? value as RuntimeLogLevel
    : fallback
);

const readConsoleLogMode = (value: unknown, fallback: ConsoleLogMode): ConsoleLogMode => (
  value === "full" ? "full" : fallback
);

const sanitizeBackgroundImage = (value: unknown): string | null => {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.startsWith("data:image/") || trimmed.startsWith("http://") || trimmed.startsWith("https://")
    ? trimmed
    : null;
};

const sanitizeBackgroundPattern = (value: unknown): BackgroundPattern => {
  return typeof value === "string" && BACKGROUND_PATTERNS.has(value as BackgroundPattern)
    ? value as BackgroundPattern
    : "NONE";
};

function cloneMcpTools(tools: McpToolToggle[]): McpToolToggle[] {
  return tools.map((tool) => ({ ...tool }));
}

function resolveEffectiveMcpTools(
  systemTools: McpToolToggle[],
  override?: McpToolToggle[],
): McpToolToggle[] {
  const base = sanitizeMcpToolToggles(systemTools);
  if (!Array.isArray(override) || override.length === 0) {
    return base;
  }
  const overrideByName = new Map<string, boolean>();
  for (const tool of override) {
    if (tool && typeof tool.name === "string" && typeof tool.enabled === "boolean") {
      overrideByName.set(tool.name.trim(), tool.enabled);
    }
  }
  return base.map((tool) => (
    overrideByName.has(tool.name) ? { ...tool, enabled: overrideByName.get(tool.name)! } : { ...tool }
  ));
}

function resolveEffectiveCustomMcpServers(
  systemServers: CustomMcpServer[],
  override?: CustomMcpServer[],
): CustomMcpServer[] {
  const byId = new Map<string, CustomMcpServer>();
  for (const server of sanitizeCustomMcpServers(systemServers)) {
    byId.set(server.id, server);
  }
  if (Array.isArray(override)) {
    for (const server of sanitizeCustomMcpServers(override)) {
      byId.set(server.id, server);
    }
  }
  return Array.from(byId.values());
}

function cloneInstructionTemplates(
  templates: Record<InstructionTemplateId, string>,
): Record<InstructionTemplateId, string> {
  return { ...templates };
}

function cloneQualityAssuranceSettings(
  settings: ProjectSettings["agents"]["qualityAssurance"],
): ProjectSettings["agents"]["qualityAssurance"] {
  return {
    enabled: settings.enabled,
    maxTaskReviewRuns: settings.maxTaskReviewRuns,
    taskCompletion: { ...settings.taskCompletion },
    sprintCompletion: { ...settings.sprintCompletion },
    completedTaskWithoutPr: { ...settings.completedTaskWithoutPr },
  };
}

function cloneAgentRoutingSettings(
  settings: ProjectSettings["agents"]["routing"],
): ProjectSettings["agents"]["routing"] {
  return {
    planning: { ...settings.planning },
    taskCoding: {
      ...settings.taskCoding,
      orchestratorAgentPresetIds: [...settings.taskCoding.orchestratorAgentPresetIds],
    },
    ciFix: { ...settings.ciFix },
    mergeConflict: { ...settings.mergeConflict },
    dashboardReply: { ...settings.dashboardReply },
    clarificationReply: { ...settings.clarificationReply },
  };
}

function cloneInvocationRouting(
  routing: ProjectSettings["aiProvider"]["invocationRouting"],
): ProjectSettings["aiProvider"]["invocationRouting"] {
  return Object.fromEntries(
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
  ) as ProjectSettings["aiProvider"]["invocationRouting"];
}

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function deepMerge<T>(base: T, patch: unknown): T {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    return (patch === undefined ? base : patch) as T;
  }

  const baseRecord = toRecord(base);
  const patchRecord = toRecord(patch);
  const result: Record<string, unknown> = { ...baseRecord };

  for (const [key, value] of Object.entries(patchRecord)) {
    const current = result[key];
    if (Array.isArray(value)) {
      result[key] = value.map((entry) => (
        entry && typeof entry === "object" ? JSON.parse(JSON.stringify(entry)) : entry
      ));
      continue;
    }
    if (value && typeof value === "object") {
      result[key] = deepMerge(current ?? {}, value);
      continue;
    }
    result[key] = value;
  }

  return result as T;
}

function deepDiff(base: unknown, value: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(value)) {
    return JSON.stringify(base) === JSON.stringify(value) ? undefined : value;
  }

  if (!base || typeof base !== "object" || !value || typeof value !== "object") {
    return JSON.stringify(base) === JSON.stringify(value) ? undefined : value;
  }

  const baseRecord = toRecord(base);
  const valueRecord = toRecord(value);
  const result: Record<string, unknown> = {};

  for (const key of Object.keys(valueRecord)) {
    const nextDiff = deepDiff(baseRecord[key], valueRecord[key]);
    if (nextDiff !== undefined) {
      result[key] = nextDiff;
    }
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

function flattenSources(
  value: unknown,
  source: SettingsValueSource,
  prefix = "",
  result: Record<string, SettingsValueSource> = {},
): Record<string, SettingsValueSource> {
  if (Array.isArray(value)) {
    result[prefix] = source;
    return result;
  }
  if (!value || typeof value !== "object") {
    if (prefix) {
      result[prefix] = source;
    }
    return result;
  }

  for (const [key, nested] of Object.entries(toRecord(value))) {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    if (Array.isArray(nested)) {
      result[nextPrefix] = source;
      continue;
    }
    if (nested && typeof nested === "object") {
      flattenSources(nested, source, nextPrefix, result);
      continue;
    }
    result[nextPrefix] = source;
  }

  return result;
}

function sanitizeSkills(value: unknown, githubMode: DashboardSettings["git"]["githubMode"]): SkillToggle[] {
  const input = Array.isArray(value) ? value : DEFAULT_SKILLS;
  const validSkills = input
    .filter((item): item is SkillToggle => {
      if (!item || typeof item !== "object") {
        return false;
      }
      const skill = item as Partial<SkillToggle>;
      return typeof skill.name === "string" && typeof skill.enabled === "boolean";
    })
    .map((skill) => ({
      name: skill.name.trim(),
      enabled: skill.enabled,
      isInternal: Boolean(skill.isInternal),
    }))
    .filter((skill) => skill.name.length > 0);

  const enabledByName = new Map(validSkills.map((skill) => [skill.name, skill.enabled]));
  const internalSkills: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
    name,
    enabled: enabledByName.get(name) ?? true,
    isInternal: true,
  })).map((skill) => {
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

  const customSkills = validSkills
    .filter((skill) => !INTERNAL_SKILL_SET.has(skill.name))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...internalSkills, ...customSkills];
}

function sanitizeInstructionTemplates(value: unknown): Record<InstructionTemplateId, string> {
  const input = toRecord(value);
  const nextTemplates = { ...DEFAULT_INSTRUCTION_TEMPLATES };

  for (const templateId of INSTRUCTION_TEMPLATE_IDS) {
    const candidate = input[templateId];
    if (typeof candidate === "string") {
      nextTemplates[templateId] = candidate;
    }
  }

  return nextTemplates;
}

function sanitizeQualityAssuranceTriggerSettings(
  value: unknown,
  defaults: ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"],
): ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"] {
  const input = toRecord(value);

  return {
    enabled: typeof input.enabled === "boolean"
      ? input.enabled
      : defaults.enabled,
    agentPresetId: typeof input.agentPresetId === "string" && input.agentPresetId.trim().length > 0
      ? input.agentPresetId.trim()
      : null,
  };
}

function sanitizeManualAgentRoutingSettings(value: unknown): ProjectSettings["agents"]["routing"]["ciFix"] {
  const input = toRecord(value);
  return {
    agentPresetId: typeof input.agentPresetId === "string" && input.agentPresetId.trim().length > 0
      ? input.agentPresetId.trim()
      : null,
  };
}

function sanitizeAgentRoutingSettings(value: unknown): ProjectSettings["agents"]["routing"] {
  const input = toRecord(value);
  const taskCoding = toRecord(input.taskCoding);

  return {
    planning: sanitizeManualAgentRoutingSettings(input.planning),
    taskCoding: {
      mode: taskCoding.mode === "ORCHESTRATOR" ? "ORCHESTRATOR" : "MANUAL",
      agentPresetId: typeof taskCoding.agentPresetId === "string" && taskCoding.agentPresetId.trim().length > 0
        ? taskCoding.agentPresetId.trim()
        : null,
      orchestratorAgentPresetIds: Array.isArray(taskCoding.orchestratorAgentPresetIds)
        ? taskCoding.orchestratorAgentPresetIds.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [],
    },
    ciFix: sanitizeManualAgentRoutingSettings(input.ciFix),
    mergeConflict: sanitizeManualAgentRoutingSettings(input.mergeConflict),
    dashboardReply: sanitizeManualAgentRoutingSettings(input.dashboardReply),
    clarificationReply: sanitizeManualAgentRoutingSettings(input.clarificationReply),
  };
}

function sanitizeQualityAssuranceSettings(
  value: unknown,
): ProjectSettings["agents"]["qualityAssurance"] {
  const input = toRecord(value);
  const defaults = DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance;

  return {
    enabled: typeof input.enabled === "boolean"
      ? input.enabled
      : defaults.enabled,
    maxTaskReviewRuns: typeof input.maxTaskReviewRuns === "number" && Number.isFinite(input.maxTaskReviewRuns)
      ? Math.max(1, Math.min(10, Math.round(input.maxTaskReviewRuns)))
      : defaults.maxTaskReviewRuns,
    taskCompletion: sanitizeQualityAssuranceTriggerSettings(input.taskCompletion, defaults.taskCompletion),
    sprintCompletion: sanitizeQualityAssuranceTriggerSettings(input.sprintCompletion, defaults.sprintCompletion),
    completedTaskWithoutPr: sanitizeQualityAssuranceTriggerSettings(input.completedTaskWithoutPr, defaults.completedTaskWithoutPr),
  };
}

function sanitizeSprintPreviewSettings(value: unknown): ProjectSettings["sprintPreview"] {
  const input = toRecord(value);
  const defaults = DEFAULT_DASHBOARD_SETTINGS.sprintPreview;
  const hostPortRangeStart = typeof input.hostPortRangeStart === "number" && Number.isFinite(input.hostPortRangeStart)
    ? Math.max(1, Math.min(65535, Math.round(input.hostPortRangeStart)))
    : defaults.hostPortRangeStart;
  const hostPortRangeEndCandidate = typeof input.hostPortRangeEnd === "number" && Number.isFinite(input.hostPortRangeEnd)
    ? Math.max(1, Math.min(65535, Math.round(input.hostPortRangeEnd)))
    : defaults.hostPortRangeEnd;

  return {
    enabled: typeof input.enabled === "boolean"
      ? input.enabled
      : defaults.enabled,
    showInAppBrowser: typeof input.showInAppBrowser === "boolean"
      ? input.showInAppBrowser
      : defaults.showInAppBrowser,
    autoStartOnRunningSprint: typeof input.autoStartOnRunningSprint === "boolean"
      ? input.autoStartOnRunningSprint
      : defaults.autoStartOnRunningSprint,
    rebuildOnTaskCompletion: typeof input.rebuildOnTaskCompletion === "boolean"
      ? input.rebuildOnTaskCompletion
      : defaults.rebuildOnTaskCompletion,
    rebuildOnSprintCompletion: typeof input.rebuildOnSprintCompletion === "boolean"
      ? input.rebuildOnSprintCompletion
      : defaults.rebuildOnSprintCompletion,
    autoStopOnTerminalSprint: typeof input.autoStopOnTerminalSprint === "boolean"
      ? input.autoStopOnTerminalSprint
      : defaults.autoStopOnTerminalSprint,
    maxConcurrentContainers: typeof input.maxConcurrentContainers === "number" && Number.isFinite(input.maxConcurrentContainers)
      ? Math.max(1, Math.min(100, Math.round(input.maxConcurrentContainers)))
      : defaults.maxConcurrentContainers,
    hostPortRangeStart,
    hostPortRangeEnd: Math.max(hostPortRangeStart, hostPortRangeEndCandidate),
    containerAppPort: typeof input.containerAppPort === "number" && Number.isFinite(input.containerAppPort)
      ? Math.max(1, Math.min(65535, Math.round(input.containerAppPort)))
      : defaults.containerAppPort,
    startupScriptPath: typeof input.startupScriptPath === "string" && input.startupScriptPath.trim().length > 0
      ? input.startupScriptPath.trim()
      : defaults.startupScriptPath,
  };
}

export function buildDefaultProjectSettings(externalHints?: ExternalSettingsHints): ProjectSettings {
  const integrationProviders = buildDefaultIntegrationProviders(externalHints);
  const aiProvider = sanitizeAiProvider(DEFAULT_DASHBOARD_SETTINGS, {
    externalHints,
    integrationProviders,
  });
  const git = sanitizeGit(DEFAULT_DASHBOARD_SETTINGS, externalHints);
  const workers = sanitizeWorkers(DEFAULT_DASHBOARD_SETTINGS, { providers: aiProvider.providers });

  return {
    appearance: { ...DEFAULT_DASHBOARD_SETTINGS.appearance },
    automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
    automationInterventions: {
      ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
    },
    aiProvider: {
      provider: aiProvider.provider,
      strategy: aiProvider.strategy,
      providers: Object.fromEntries(
        Object.entries(aiProvider.providers).map(([providerConfigId, provider]) => [
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
      invocationRouting: cloneInvocationRouting(aiProvider.invocationRouting),
    },
    git: {
      githubMode: git.githubMode,
      githubToken: git.githubToken,
      gitlabToken: git.gitlabToken ?? "",
      defaultBranch: git.defaultBranch,
      autoCreatePr: git.autoCreatePr,
      autoCloseLinkedIssues: git.autoCloseLinkedIssues,
      featureBranchPrefix: git.featureBranchPrefix,
      sprintBranchScheme: git.sprintBranchScheme,
      sprintKeyPrefix: git.sprintKeyPrefix,
    },
    jira: sanitizeJira(undefined, {
      ...DEFAULT_DASHBOARD_SETTINGS.jira,
      apiToken: externalHints?.resolved.jiraToken || DEFAULT_DASHBOARD_SETTINGS.jira.apiToken,
    }),
    ciIntelligence: sanitizeCiIntelligence(DEFAULT_DASHBOARD_SETTINGS, git.githubMode),
    guardrails: sanitizeGuardrails(DEFAULT_DASHBOARD_SETTINGS),
    sprintLoopSteps: sanitizeSprintLoopSteps(DEFAULT_DASHBOARD_SETTINGS),
    cliWorkflow: sanitizeCliWorkflow(DEFAULT_DASHBOARD_SETTINGS),
    sprintPreview: { ...DEFAULT_DASHBOARD_SETTINGS.sprintPreview },
    workers,
    agents: {
      saveToProjectDirectory: DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
      routing: cloneAgentRoutingSettings(DEFAULT_DASHBOARD_SETTINGS.agents.routing),
      instructionTemplates: cloneInstructionTemplates(DEFAULT_DASHBOARD_SETTINGS.agents.instructionTemplates),
      qualityAssurance: cloneQualityAssuranceSettings(DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance),
    },
    skills: cloneSkills(DEFAULT_SKILLS),
    memory: { ...DEFAULT_DASHBOARD_SETTINGS.memory },
  };
}

export function buildDefaultSystemSettings(externalHints?: ExternalSettingsHints): SystemSettings {
  return {
    runtime: {
      dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
      consoleLogLevel: DEFAULT_DASHBOARD_SETTINGS.consoleLogLevel,
      debugLogFileLevel: DEFAULT_DASHBOARD_SETTINGS.debugLogFileLevel,
      consoleLogMode: DEFAULT_DASHBOARD_SETTINGS.consoleLogMode,
      lastActiveScope: "system",
      dbAutoVacuumOnStartup: DEFAULT_DASHBOARD_SETTINGS.dbAutoVacuumOnStartup,
      dbPruningEnabled: DEFAULT_DASHBOARD_SETTINGS.dbPruningEnabled,
      dbRetentionDays: DEFAULT_DASHBOARD_SETTINGS.dbRetentionDays,
    },
    integrations: {
      providers: buildDefaultIntegrationProviders(externalHints),
      githubToken: externalHints?.resolved.githubToken || "",
      gitlabToken: externalHints?.resolved.gitlabToken || "",
      jira: {
        ...DEFAULT_DASHBOARD_SETTINGS.jira,
        apiToken: externalHints?.resolved.jiraToken || "",
      },
    },
    defaults: buildDefaultProjectSettings(externalHints),
    mcpTools: cloneMcpTools(DEFAULT_DASHBOARD_SETTINGS.mcpTools),
    customMcpServers: sanitizeCustomMcpServers(DEFAULT_DASHBOARD_SETTINGS.customMcpServers),
  };
}

export function sanitizeProjectSettings(value: unknown, externalHints?: ExternalSettingsHints): ProjectSettings {
  const input = toRecord(value);
  const integrationsInput = toRecord(input.integrations);
  const integrationProviders = input.integrations && typeof input.integrations === "object"
    ? normalizeSystemIntegrationProviders(input.integrations, externalHints)
    : buildDefaultIntegrationProviders(externalHints);
  const aiInput = {
    ...DEFAULT_DASHBOARD_SETTINGS,
    aiProvider: deepMerge(DEFAULT_DASHBOARD_SETTINGS.aiProvider, input.aiProvider),
  };
  const gitInput = {
    ...DEFAULT_DASHBOARD_SETTINGS,
    git: deepMerge(DEFAULT_DASHBOARD_SETTINGS.git, input.git),
  };
  const git = sanitizeGit(gitInput, externalHints);
  // GitHub/GitLab/Jira are scoped settings: a project may override them, otherwise
  // they inherit the system integration values seeded into the base by
  // sanitizeSystemSettings. The integrations block is used as a last-resort fallback.
  const jira = sanitizeJira(input.jira ?? integrationsInput.jira, {
    ...DEFAULT_DASHBOARD_SETTINGS.jira,
    apiToken: externalHints?.resolved.jiraToken || DEFAULT_DASHBOARD_SETTINGS.jira.apiToken,
  });
  const aiProvider = sanitizeAiProvider(aiInput, {
    externalHints,
    integrationProviders,
  });
  const appearanceInput = toRecord(input.appearance);
  const workers = sanitizeWorkers({
    ...DEFAULT_DASHBOARD_SETTINGS,
    workers: deepMerge(DEFAULT_DASHBOARD_SETTINGS.workers, input.workers),
  }, { providers: aiProvider.providers });

  return {
    appearance: {
      navigationMode: appearanceInput.navigationMode === "SIDEBAR" ? "SIDEBAR" : "DOCK",
      theme: appearanceInput.theme === "LIGHT" || appearanceInput.theme === "DARK" ? appearanceInput.theme : "SYSTEM",
      reducedMotion: appearanceInput.reducedMotion === "REDUCE" || appearanceInput.reducedMotion === "NONE" ? appearanceInput.reducedMotion : "AUTO",
      backgroundMode: appearanceInput.backgroundMode === "STATIC" ? "STATIC" : "ANIMATED",
      animatedBackground: typeof appearanceInput.animatedBackground === "string" ? appearanceInput.animatedBackground : "deep-ocean",
      staticBackgroundColor: typeof appearanceInput.staticBackgroundColor === "string" ? appearanceInput.staticBackgroundColor : "#0d0f12",
      backgroundImage: sanitizeBackgroundImage(appearanceInput.backgroundImage),
      backgroundPattern: sanitizeBackgroundPattern(appearanceInput.backgroundPattern),
      zoomLevel: typeof appearanceInput.zoomLevel === "number" && Number.isFinite(appearanceInput.zoomLevel)
        ? Math.min(2.5, Math.max(0.5, appearanceInput.zoomLevel))
        : DEFAULT_DASHBOARD_SETTINGS.appearance.zoomLevel,
    },
    automationLevel: input.automationLevel === "FULL" || input.automationLevel === "SEMI_AUTO" || input.automationLevel === "ALWAYS_ASK"
      ? input.automationLevel
      : DEFAULT_DASHBOARD_SETTINGS.automationLevel,
    automationInterventions: {
      ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
      ...toRecord(input.automationInterventions),
    },
    aiProvider: {
      provider: aiProvider.provider,
      strategy: aiProvider.strategy,
      providers: Object.fromEntries(
        Object.entries(aiProvider.providers).map(([providerConfigId, provider]) => [
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
      invocationRouting: cloneInvocationRouting(aiProvider.invocationRouting),
    },
    git: {
      githubMode: git.githubMode,
      githubToken: git.githubToken,
      gitlabToken: git.gitlabToken ?? "",
      defaultBranch: git.defaultBranch,
      autoCreatePr: git.autoCreatePr,
      autoCloseLinkedIssues: git.autoCloseLinkedIssues,
      featureBranchPrefix: git.featureBranchPrefix,
      sprintBranchScheme: git.sprintBranchScheme,
      sprintKeyPrefix: git.sprintKeyPrefix,
    },
    jira,
    ciIntelligence: sanitizeCiIntelligence({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: deepMerge(DEFAULT_DASHBOARD_SETTINGS.ciIntelligence, input.ciIntelligence),
    }, git.githubMode),
    guardrails: sanitizeGuardrails({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: deepMerge(DEFAULT_DASHBOARD_SETTINGS.ciIntelligence, input.ciIntelligence),
      guardrails: deepMerge(DEFAULT_DASHBOARD_SETTINGS.guardrails, input.guardrails),
    }),
    sprintLoopSteps: sanitizeSprintLoopSteps({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: deepMerge(DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps, input.sprintLoopSteps),
    }),
    cliWorkflow: sanitizeCliWorkflow({
      ...DEFAULT_DASHBOARD_SETTINGS,
      cliWorkflow: deepMerge(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, input.cliWorkflow),
    }),
    sprintPreview: sanitizeSprintPreviewSettings(deepMerge(DEFAULT_DASHBOARD_SETTINGS.sprintPreview, input.sprintPreview)),
    workers,
    agents: {
      saveToProjectDirectory: typeof toRecord(input.agents).saveToProjectDirectory === "boolean"
        ? Boolean(toRecord(input.agents).saveToProjectDirectory)
        : DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
      routing: sanitizeAgentRoutingSettings(toRecord(input.agents).routing),
      instructionTemplates: sanitizeInstructionTemplates(toRecord(input.agents).instructionTemplates),
      qualityAssurance: sanitizeQualityAssuranceSettings(toRecord(input.agents).qualityAssurance),
    },
    skills: sanitizeSkills(input.skills, git.githubMode),
    ...(Array.isArray(input.mcpTools) ? { mcpTools: sanitizeMcpToolToggles(input.mcpTools) } : {}),
    ...(Array.isArray(input.customMcpServers) ? { customMcpServers: sanitizeCustomMcpServers(input.customMcpServers) } : {}),
    memory: sanitizeMemory(input as Partial<DashboardSettings>),
  };
}

export function sanitizeSystemSettings(value: unknown, externalHints?: ExternalSettingsHints): SystemSettings {
  const defaults = buildDefaultSystemSettings(externalHints);
  const input = toRecord(value);
  const runtime = toRecord(input.runtime);
  const integrations = normalizeSystemIntegrationProviders(input.integrations, externalHints);
  const integrationInput = toRecord(input.integrations);
  const jiraSettings = sanitizeJira(integrationInput.jira, {
    ...DEFAULT_DASHBOARD_SETTINGS.jira,
    apiToken: externalHints?.resolved.jiraToken || DEFAULT_DASHBOARD_SETTINGS.jira.apiToken,
  });

  const dashboardPort = typeof runtime.dashboardPort === "number" ? runtime.dashboardPort : defaults.runtime.dashboardPort;
  const legacyConsoleLogMode = runtime.consoleLogLevel === "full" || runtime.consoleLogLevel === "standard"
    ? runtime.consoleLogLevel
    : undefined;
  const legacyDebugLogFileLevel = Object.hasOwn(runtime, "enableDebugLogFile")
    ? runtime.enableDebugLogFile === true ? defaults.runtime.debugLogFileLevel : "off"
    : defaults.runtime.debugLogFileLevel;
  const consoleLogLevel = readRuntimeLogLevel(runtime.consoleLogLevel, defaults.runtime.consoleLogLevel);
  const debugLogFileLevel = readRuntimeLogLevel(runtime.debugLogFileLevel, legacyDebugLogFileLevel);
  const consoleLogMode = readConsoleLogMode(runtime.consoleLogMode ?? legacyConsoleLogMode, defaults.runtime.consoleLogMode);
  const lastActiveScope = runtime.lastActiveScope === "project" ? "project" : "system";
  const dbAutoVacuumOnStartup = typeof runtime.dbAutoVacuumOnStartup === "boolean"
    ? runtime.dbAutoVacuumOnStartup
    : defaults.runtime.dbAutoVacuumOnStartup;
  const dbPruningEnabled = typeof runtime.dbPruningEnabled === "boolean"
    ? runtime.dbPruningEnabled
    : defaults.runtime.dbPruningEnabled;
  const dbRetentionDays = typeof runtime.dbRetentionDays === "number"
    ? runtime.dbRetentionDays
    : defaults.runtime.dbRetentionDays;

  const systemGithubToken = typeof integrationInput.githubToken === "string"
    ? integrationInput.githubToken
    : defaults.integrations.githubToken;
  const systemGitlabToken = typeof integrationInput.gitlabToken === "string"
    ? integrationInput.gitlabToken
    : defaults.integrations.gitlabToken;

  // Seed the project-settings base (defaults) with the resolved system GitHub/GitLab
  // tokens and Jira connection so every project inherits them unless it overrides.
  const defaultsInput = sanitizeProjectSettings({
    ...toRecord(input.defaults),
    git: {
      ...toRecord(toRecord(input.defaults).git),
      githubToken: systemGithubToken,
      gitlabToken: systemGitlabToken,
    },
    jira: jiraSettings,
    integrations: {
      providers: integrations,
      githubToken: systemGithubToken,
      gitlabToken: systemGitlabToken,
      jira: jiraSettings,
    },
  }, externalHints);

  return {
    runtime: {
      dashboardPort,
      consoleLogLevel,
      debugLogFileLevel,
      consoleLogMode,
      lastActiveScope,
      dbAutoVacuumOnStartup,
      dbPruningEnabled,
      dbRetentionDays,
    },
    integrations: {
      providers: integrations,
      githubToken: systemGithubToken,
      gitlabToken: systemGitlabToken,
      jira: jiraSettings,
    },
    defaults: defaultsInput,
    mcpTools: sanitizeMcpToolToggles(input.mcpTools ?? defaults.mcpTools).map((tool) => ({ ...tool })),
    customMcpServers: sanitizeCustomMcpServers(input.customMcpServers ?? defaults.customMcpServers),
  };
}

export function systemSettingsToDashboardSettings(settings: SystemSettings): DashboardSettings {
  return resolveDashboardSettings({
    systemSettings: settings,
  }).settings;
}

function applyIntegrations(settings: ProjectSettings, integrations: SystemSettings["integrations"]): DashboardSettings["aiProvider"] {
  const integrationProviders = normalizeSystemIntegrationProviders(integrations);
  return {
    provider: settings.aiProvider.provider,
    strategy: settings.aiProvider.strategy,
    providers: buildDashboardProviderSettings(settings.aiProvider.providers, integrationProviders),
    invocationRouting: cloneInvocationRouting(settings.aiProvider.invocationRouting),
  };
}

/**
 * Resolves the effective provider concurrency cap, enforcing the system-level cap as a
 * hard ceiling. A project/sprint override may only lower the cap, never raise it above
 * the system value. `0` means "unlimited" for both layers.
 */
export function applySystemConcurrencyCeiling(scopedValue: number, systemValue: number | undefined): number {
  if (systemValue === undefined || systemValue <= 0) {
    // System imposes no ceiling — the scoped value (project/sprint) stands.
    return scopedValue;
  }
  if (scopedValue <= 0) {
    // Scoped scope requests "unlimited", but the system cap is a hard ceiling.
    return systemValue;
  }
  return Math.min(scopedValue, systemValue);
}

/**
 * Clamps every provider's `maxConcurrentTasks` in the resolved (project/sprint) aiProvider
 * settings to the corresponding system-level cap so a project can never exceed the system cap.
 */
function clampProviderConcurrencyToSystemCap(
  resolved: DashboardSettings["aiProvider"],
  systemAiProvider: DashboardSettings["aiProvider"],
): void {
  for (const [providerConfigId, provider] of Object.entries(resolved.providers)) {
    const systemCap = systemAiProvider.providers[providerConfigId]?.maxConcurrentTasks;
    provider.maxConcurrentTasks = applySystemConcurrencyCeiling(provider.maxConcurrentTasks, systemCap);
  }
}

export function resolveProjectSettings(
  systemSettings: SystemSettings,
  projectOverride?: ProjectSettingsOverride | null,
): ProjectSettings {
  return sanitizeProjectSettings(
    {
      ...deepMerge(systemSettings.defaults, projectOverride || {}),
      integrations: systemSettings.integrations,
    },
    undefined
  );
}

export function resolveSprintProjectSettings(
  systemSettings: SystemSettings,
  projectOverride?: ProjectSettingsOverride | null,
  sprintOverride?: SprintSettingsOverride | null,
): ProjectSettings {
  const projectSettings = resolveProjectSettings(systemSettings, projectOverride);
  return sanitizeProjectSettings(
    {
      ...deepMerge(projectSettings, sprintOverride || {}),
      integrations: systemSettings.integrations,
    },
    undefined
  );
}

export function resolveEffectiveDashboardSettings(
  settingsRepository: SettingsRepository,
  projectId: string,
  sprintId?: string | null,
): EffectiveSettingsResponse {
  return sprintId
    ? settingsRepository.resolveSprintDashboardSettings(projectId, sprintId)
    : settingsRepository.resolveProjectDashboardSettings(projectId);
}

export function resolveDashboardSettings(args: {
  systemSettings: SystemSettings;
  projectOverride?: ProjectSettingsOverride | null;
  sprintOverride?: SprintSettingsOverride | null;
}): EffectiveSettingsResponse {
  const baseProject = args.systemSettings.defaults;
  const projectSettings = resolveProjectSettings(args.systemSettings, args.projectOverride);
  const sprintSettings = resolveSprintProjectSettings(args.systemSettings, args.projectOverride, args.sprintOverride);
  // Provider concurrency caps: the system-level cap is a hard ceiling. Resolve the scoped
  // (project/sprint) caps, then clamp each provider to the system cap so an override can
  // only lower a cap, never raise it above the system value.
  const resolvedAiProvider = applyIntegrations(sprintSettings, args.systemSettings.integrations);
  const systemAiProvider = applyIntegrations(baseProject, args.systemSettings.integrations);
  clampProviderConcurrencyToSystemCap(resolvedAiProvider, systemAiProvider);
  const systemGithubToken = args.systemSettings.integrations.githubToken || "";
  const systemGitlabToken = args.systemSettings.integrations.gitlabToken || "";
  const systemJira = args.systemSettings.integrations.jira ?? DEFAULT_DASHBOARD_SETTINGS.jira;
  const dashboardSettings: DashboardSettings = {
    dashboardPort: args.systemSettings.runtime.dashboardPort,
    consoleLogLevel: args.systemSettings.runtime.consoleLogLevel,
    debugLogFileLevel: args.systemSettings.runtime.debugLogFileLevel,
    consoleLogMode: args.systemSettings.runtime.consoleLogMode,
    dbAutoVacuumOnStartup: args.systemSettings.runtime.dbAutoVacuumOnStartup,
    dbPruningEnabled: args.systemSettings.runtime.dbPruningEnabled,
    dbRetentionDays: args.systemSettings.runtime.dbRetentionDays,
    appearance: { ...sprintSettings.appearance },
    automationLevel: sprintSettings.automationLevel,
    automationInterventions: { ...sprintSettings.automationInterventions },
    aiProvider: resolvedAiProvider,
    // GitHub/GitLab/Jira resolve through the scoped project/sprint settings, which
    // inherit the system integration values unless a project or sprint overrides
    // them. A blank scoped value falls back to the system integration value.
    git: {
      ...sprintSettings.git,
      githubToken: sprintSettings.git.githubToken || systemGithubToken,
      gitlabToken: sprintSettings.git.gitlabToken || systemGitlabToken,
    },
    jira: {
      host: sprintSettings.jira.host || systemJira.host,
      email: sprintSettings.jira.email || systemJira.email,
      apiToken: sprintSettings.jira.apiToken || systemJira.apiToken,
      defaultProject: sprintSettings.jira.defaultProject || systemJira.defaultProject,
      closeTransitionName: sprintSettings.jira.closeTransitionName || systemJira.closeTransitionName,
      autoCloseLinkedIssues: sprintSettings.jira.autoCloseLinkedIssues,
    },
    ciIntelligence: { ...sprintSettings.ciIntelligence },
    guardrails: {
      ...sprintSettings.guardrails,
      jobs: {
        task_coding: { ...sprintSettings.guardrails.jobs.task_coding },
        ci_fix: { ...sprintSettings.guardrails.jobs.ci_fix },
        merge_conflict: { ...sprintSettings.guardrails.jobs.merge_conflict },
        clarification_reply: { ...sprintSettings.guardrails.jobs.clarification_reply },
        planning: { ...sprintSettings.guardrails.jobs.planning },
      },
    },
    sprintLoopSteps: { ...sprintSettings.sprintLoopSteps },
    cliWorkflow: { ...sprintSettings.cliWorkflow },
    sprintPreview: { ...sprintSettings.sprintPreview },
    workers: { ...sprintSettings.workers },
    agents: {
      saveToProjectDirectory: sprintSettings.agents.saveToProjectDirectory,
      routing: cloneAgentRoutingSettings(sprintSettings.agents.routing),
      instructionTemplates: cloneInstructionTemplates(sprintSettings.agents.instructionTemplates),
      qualityAssurance: cloneQualityAssuranceSettings(sprintSettings.agents.qualityAssurance),
    },
    skills: cloneSkills(sprintSettings.skills),
    mcpTools: resolveEffectiveMcpTools(args.systemSettings.mcpTools, sprintSettings.mcpTools),
    customMcpServers: resolveEffectiveCustomMcpServers(args.systemSettings.customMcpServers, sprintSettings.customMcpServers),
    memory: { ...sprintSettings.memory },
  };

  let sourcesCache: Record<string, SettingsValueSource> | undefined;

  return {
    settings: dashboardSettings,
    get sources() {
      if (!sourcesCache) {
        sourcesCache = flattenSources(args.systemSettings.runtime, "system");
        flattenSources(args.systemSettings.mcpTools, "system", "mcpTools", sourcesCache);
        flattenSources(baseProject, "system", "", sourcesCache);
        if (args.projectOverride) {
          Object.assign(sourcesCache, flattenSources(args.projectOverride, "project"));
        }
        if (args.sprintOverride) {
          Object.assign(sourcesCache, flattenSources(args.sprintOverride, "sprint"));
        }
      }
      return sourcesCache;
    },
  };
}

export function toProjectSettingsOverride(
  base: ProjectSettings,
  patch: unknown,
  integrations?: SystemSettings["integrations"],
  externalHints?: ExternalSettingsHints,
): ProjectSettingsOverride {
  const merged = sanitizeProjectSettings(
    {
      ...deepMerge(base, patch),
      integrations,
    },
    externalHints
  );
  return (deepDiff(base, merged) || {}) as ProjectSettingsOverride;
}

export function toSprintSettingsOverride(
  base: ProjectSettings,
  patch: unknown,
  integrations?: SystemSettings["integrations"],
  externalHints?: ExternalSettingsHints,
): SprintSettingsOverride {
  const merged = sanitizeProjectSettings(
    {
      ...deepMerge(base, patch),
      integrations,
    },
    externalHints
  );
  return (deepDiff(base, merged) || {}) as SprintSettingsOverride;
}
