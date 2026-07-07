import type {
  BackgroundPattern,
  ConsoleLogMode,
  CustomMcpServer,
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  RestartInvocationPolicy,
  RestartSprintPolicy,
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
import { sanitizeModelPricing } from "../domain/settings/settings-sanitizers/model-pricing-sanitizer.js";
import { sanitizeWorkers } from "../domain/settings/settings-sanitizers/worker-sanitizer.js";
import { sanitizeExternalImporterSettings } from "../repositories/settings-sanitizer.js";
import {
  buildDashboardProviderSettings,
  buildDefaultIntegrationProviders,
  normalizeSystemIntegrationProviders,
} from "../domain/settings/provider-config-utils.js";
import { sanitizeCustomMcpServersWithDefaults, sanitizeMcpToolToggles } from "../mcp/mcp-tool-availability.js";
import { DEFAULT_INSTRUCTION_TEMPLATES, INSTRUCTION_TEMPLATE_IDS, type InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import { DEFAULT_AGENT_SELF_REFLECTION, DEFAULT_DASHBOARD_SETTINGS, DEFAULT_SKILLS, INTERNAL_SKILL_NAMES, INTERNAL_SKILL_SET } from "../repositories/settings-defaults.js";

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
const RESTART_SPRINT_POLICY_SET = new Set<RestartSprintPolicy>(["continue", "pause", "cancel"]);
const RESTART_INVOCATION_POLICY_SET = new Set<RestartInvocationPolicy>(["continue", "cancel", "restart"]);

const readRuntimeLogLevel = (value: unknown, fallback: RuntimeLogLevel): RuntimeLogLevel => (
  typeof value === "string" && RUNTIME_LOG_LEVEL_SET.has(value as RuntimeLogLevel)
    ? value as RuntimeLogLevel
    : fallback
);

const readConsoleLogMode = (value: unknown, fallback: ConsoleLogMode): ConsoleLogMode => (
  value === "full" ? "full" : fallback
);

const readRestartSprintPolicy = (value: unknown, fallback: RestartSprintPolicy): RestartSprintPolicy => (
  typeof value === "string" && RESTART_SPRINT_POLICY_SET.has(value as RestartSprintPolicy)
    ? value as RestartSprintPolicy
    : fallback
);

const readRestartInvocationPolicy = (value: unknown, fallback: RestartInvocationPolicy): RestartInvocationPolicy => (
  typeof value === "string" && RESTART_INVOCATION_POLICY_SET.has(value as RestartInvocationPolicy)
    ? value as RestartInvocationPolicy
    : fallback
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
  return sanitizeCustomMcpServersWithDefaults(override, systemServers);
}

function cloneInstructionTemplates(
  templates: Record<InstructionTemplateId, string>,
): Record<InstructionTemplateId, string> {
  return { ...templates };
}

function cloneQualityAssuranceTrigger(
  trigger: ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"],
): ProjectSettings["agents"]["qualityAssurance"]["taskCompletion"] {
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
}

function cloneQualityAssuranceSettings(
  settings: ProjectSettings["agents"]["qualityAssurance"],
): ProjectSettings["agents"]["qualityAssurance"] {
  return {
    enabled: settings.enabled,
    maxTaskReviewRuns: settings.maxTaskReviewRuns,
    maxSprintReviewRuns: settings.maxSprintReviewRuns,
    exhaustionPolicy: settings.exhaustionPolicy,
    taskCompletion: cloneQualityAssuranceTrigger(settings.taskCompletion),
    sprintCompletion: cloneQualityAssuranceTrigger(settings.sprintCompletion),
    completedTaskWithoutPr: cloneQualityAssuranceTrigger(settings.completedTaskWithoutPr),
  };
}

function cloneSelfReflectionSettings(
  settings: ProjectSettings["agents"]["selfReflection"],
): ProjectSettings["agents"]["selfReflection"] {
  return {
    planning: {
      enabled: settings.planning.enabled,
      criteria: settings.planning.criteria.map((criterion) => ({ ...criterion })),
      maxImprovementAttempts: settings.planning.maxImprovementAttempts,
    },
    qualityAssurance: {
      enabled: settings.qualityAssurance.enabled,
      criteria: settings.qualityAssurance.criteria.map((criterion) => ({ ...criterion })),
      maxImprovementAttempts: settings.qualityAssurance.maxImprovementAttempts,
    },
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
  const sourceIds = Array.isArray(input.agentPresetIds)
    ? input.agentPresetIds
    : typeof input.agentPresetId === "string" && input.agentPresetId.trim().length > 0
      ? [input.agentPresetId]
      : defaults.agentPresetIds;
  const agentPresetIds = [...new Set(
    sourceIds
      .filter((id): id is string => typeof id === "string")
      .map((id) => id.trim())
      .filter(Boolean)
  )];

  return {
    enabled: typeof input.enabled === "boolean"
      ? input.enabled
      : defaults.enabled,
    agentPresetIds,
    agentPresetId: agentPresetIds[0] ?? null,
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
      ? Math.max(1, Math.min(20, Math.round(input.maxTaskReviewRuns)))
      : defaults.maxTaskReviewRuns,
    maxSprintReviewRuns: typeof input.maxSprintReviewRuns === "number" && Number.isFinite(input.maxSprintReviewRuns)
      ? Math.max(1, Math.min(20, Math.round(input.maxSprintReviewRuns)))
      : defaults.maxSprintReviewRuns,
    exhaustionPolicy: input.exhaustionPolicy === "ESCALATE_TO_HUMAN"
      || input.exhaustionPolicy === "FAIL_TASK"
      || input.exhaustionPolicy === "FINISH_TASK"
      ? input.exhaustionPolicy
      : defaults.exhaustionPolicy,
    taskCompletion: sanitizeQualityAssuranceTriggerSettings(input.taskCompletion, defaults.taskCompletion),
    sprintCompletion: sanitizeQualityAssuranceTriggerSettings(input.sprintCompletion, defaults.sprintCompletion),
    completedTaskWithoutPr: sanitizeQualityAssuranceTriggerSettings(input.completedTaskWithoutPr, defaults.completedTaskWithoutPr),
  };
}

const SELF_REFLECTION_MAX_ATTEMPTS_CEILING = 10;

function sanitizeSelfReflectionCriteria(
  value: unknown,
  defaults: ProjectSettings["agents"]["selfReflection"]["planning"]["criteria"],
): ProjectSettings["agents"]["selfReflection"]["planning"]["criteria"] {
  if (!Array.isArray(value)) {
    return defaults.map((criterion) => ({ ...criterion }));
  }

  const criteria: ProjectSettings["agents"]["selfReflection"]["planning"]["criteria"] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const input = toRecord(entry);
    const id = typeof input.id === "string" ? input.id.trim() : "";
    const label = typeof input.label === "string" ? input.label.trim() : "";
    const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
    if (!id || !label || !prompt || seen.has(id)) {
      continue;
    }
    const rawThreshold = typeof input.threshold === "number" && Number.isFinite(input.threshold)
      ? input.threshold
      : defaults.find((criterion) => criterion.id === id)?.threshold ?? 0.8;
    criteria.push({
      id,
      label,
      prompt,
      threshold: Math.max(0, Math.min(1, rawThreshold)),
    });
    seen.add(id);
  }

  return criteria.length > 0 ? criteria : defaults.map((criterion) => ({ ...criterion }));
}

function sanitizeSelfReflectionLoop(
  value: unknown,
  defaults: ProjectSettings["agents"]["selfReflection"]["planning"],
): ProjectSettings["agents"]["selfReflection"]["planning"] {
  const input = toRecord(value);
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : defaults.enabled,
    criteria: sanitizeSelfReflectionCriteria(input.criteria, defaults.criteria),
    maxImprovementAttempts: typeof input.maxImprovementAttempts === "number" && Number.isFinite(input.maxImprovementAttempts)
      ? Math.max(0, Math.min(SELF_REFLECTION_MAX_ATTEMPTS_CEILING, Math.round(input.maxImprovementAttempts)))
      : defaults.maxImprovementAttempts,
  };
}

function sanitizeSelfReflectionSettings(
  value: unknown,
): ProjectSettings["agents"]["selfReflection"] {
  const input = toRecord(value);
  return {
    planning: sanitizeSelfReflectionLoop(input.planning, DEFAULT_AGENT_SELF_REFLECTION.planning),
    qualityAssurance: sanitizeSelfReflectionLoop(input.qualityAssurance, DEFAULT_AGENT_SELF_REFLECTION.qualityAssurance),
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
  const containerAppPort = typeof input.containerAppPort === "number" && Number.isFinite(input.containerAppPort)
    ? Math.max(1, Math.min(65535, Math.round(input.containerAppPort)))
    : defaults.containerAppPort;
  const containerAppPorts = [
    containerAppPort,
    ...(Array.isArray(input.containerAppPorts)
      ? input.containerAppPorts
        .filter((port): port is number => typeof port === "number" && Number.isFinite(port))
        .map((port) => Math.round(port))
        .filter((port) => port >= 1 && port <= 65535)
      : []),
  ];

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
    containerAppPort,
    containerAppPorts: [...new Set(containerAppPorts)],
    startupScriptPath: (() => {
      const raw = typeof input.startupScriptPath === "string" && input.startupScriptPath.trim().length > 0
        ? input.startupScriptPath.trim()
        : defaults.startupScriptPath;
      if (raw.includes("..") || raw.startsWith("/") || /^[a-zA-Z]:\\/.test(raw) || raw.includes("~") || raw.includes("$") || raw.includes("%")) {
        return defaults.startupScriptPath;
      }
      return raw;
    })(),
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
      deleteMergedBranches: git.deleteMergedBranches,
      featureBranchPrefix: git.featureBranchPrefix,
      sprintBranchScheme: git.sprintBranchScheme,
      sprintKeyPrefix: git.sprintKeyPrefix,
      prDescription: git.prDescription,
    },
    jira: sanitizeJira(undefined, {
      ...DEFAULT_DASHBOARD_SETTINGS.jira,
      apiToken: externalHints?.resolved.jiraToken || DEFAULT_DASHBOARD_SETTINGS.jira.apiToken,
    }),
    notion: { ...DEFAULT_DASHBOARD_SETTINGS.notion },
    asana: { ...DEFAULT_DASHBOARD_SETTINGS.asana },
    linear: { ...DEFAULT_DASHBOARD_SETTINGS.linear },
    miro: { ...DEFAULT_DASHBOARD_SETTINGS.miro },
    lucid: { ...DEFAULT_DASHBOARD_SETTINGS.lucid },
    figma: { ...DEFAULT_DASHBOARD_SETTINGS.figma },
    mural: { ...DEFAULT_DASHBOARD_SETTINGS.mural },
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
      selfReflection: cloneSelfReflectionSettings(DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
    },
    skills: cloneSkills(DEFAULT_SKILLS),
    memory: {
      ...DEFAULT_DASHBOARD_SETTINGS.memory,
      externalEmbedding: { ...DEFAULT_DASHBOARD_SETTINGS.memory.externalEmbedding },
    },
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
      restartSprintPolicy: DEFAULT_DASHBOARD_SETTINGS.restartSprintPolicy,
      restartInvocationPolicy: DEFAULT_DASHBOARD_SETTINGS.restartInvocationPolicy,
    },
    integrations: {
      providers: buildDefaultIntegrationProviders(externalHints),
      githubToken: externalHints?.resolved.githubToken || "",
      gitlabToken: externalHints?.resolved.gitlabToken || "",
      jira: {
        ...DEFAULT_DASHBOARD_SETTINGS.jira,
        apiToken: externalHints?.resolved.jiraToken || "",
      },
      notion: { ...DEFAULT_DASHBOARD_SETTINGS.notion },
      asana: { ...DEFAULT_DASHBOARD_SETTINGS.asana },
      linear: { ...DEFAULT_DASHBOARD_SETTINGS.linear },
      miro: { ...DEFAULT_DASHBOARD_SETTINGS.miro },
      lucid: { ...DEFAULT_DASHBOARD_SETTINGS.lucid },
      figma: { ...DEFAULT_DASHBOARD_SETTINGS.figma },
      mural: { ...DEFAULT_DASHBOARD_SETTINGS.mural },
    },
    defaults: buildDefaultProjectSettings(externalHints),
    mcpTools: cloneMcpTools(DEFAULT_DASHBOARD_SETTINGS.mcpTools),
    customMcpServers: sanitizeCustomMcpServersWithDefaults(
      DEFAULT_DASHBOARD_SETTINGS.customMcpServers,
      DEFAULT_DASHBOARD_SETTINGS.customMcpServers,
    ),
    modelPricing: { overrides: { ...DEFAULT_DASHBOARD_SETTINGS.modelPricing.overrides } },
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
  const notion = sanitizeExternalImporterSettings(input.notion ?? integrationsInput.notion, DEFAULT_DASHBOARD_SETTINGS.notion);
  const asana = sanitizeExternalImporterSettings(input.asana ?? integrationsInput.asana, DEFAULT_DASHBOARD_SETTINGS.asana);
  const linear = sanitizeExternalImporterSettings(input.linear ?? integrationsInput.linear, DEFAULT_DASHBOARD_SETTINGS.linear);
  const miro = sanitizeExternalImporterSettings(input.miro ?? integrationsInput.miro, DEFAULT_DASHBOARD_SETTINGS.miro);
  const lucid = sanitizeExternalImporterSettings(input.lucid ?? integrationsInput.lucid, DEFAULT_DASHBOARD_SETTINGS.lucid);
  const figma = sanitizeExternalImporterSettings(input.figma ?? integrationsInput.figma, DEFAULT_DASHBOARD_SETTINGS.figma);
  const mural = sanitizeExternalImporterSettings(input.mural ?? integrationsInput.mural, DEFAULT_DASHBOARD_SETTINGS.mural);
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
      navigationMode: appearanceInput.navigationMode === "DOCK" ? "DOCK" : "SIDEBAR",
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
      deleteMergedBranches: git.deleteMergedBranches,
      featureBranchPrefix: git.featureBranchPrefix,
      sprintBranchScheme: git.sprintBranchScheme,
      sprintKeyPrefix: git.sprintKeyPrefix,
      prDescription: git.prDescription,
    },
    jira,
    notion,
    asana,
    linear,
    miro,
    lucid,
    figma,
    mural,
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
      selfReflection: sanitizeSelfReflectionSettings(toRecord(input.agents).selfReflection),
    },
    skills: sanitizeSkills(input.skills, git.githubMode),
    ...(Array.isArray(input.mcpTools) ? { mcpTools: sanitizeMcpToolToggles(input.mcpTools) } : {}),
    ...(Array.isArray(input.customMcpServers) ? {
      customMcpServers: sanitizeCustomMcpServersWithDefaults(
        input.customMcpServers,
        DEFAULT_DASHBOARD_SETTINGS.customMcpServers,
      ),
    } : {}),
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
  const notionSettings = sanitizeExternalImporterSettings(integrationInput.notion, DEFAULT_DASHBOARD_SETTINGS.notion);
  const asanaSettings = sanitizeExternalImporterSettings(integrationInput.asana, DEFAULT_DASHBOARD_SETTINGS.asana);
  const linearSettings = sanitizeExternalImporterSettings(integrationInput.linear, DEFAULT_DASHBOARD_SETTINGS.linear);
  const miroSettings = sanitizeExternalImporterSettings(integrationInput.miro, DEFAULT_DASHBOARD_SETTINGS.miro);
  const lucidSettings = sanitizeExternalImporterSettings(integrationInput.lucid, DEFAULT_DASHBOARD_SETTINGS.lucid);
  const figmaSettings = sanitizeExternalImporterSettings(integrationInput.figma, DEFAULT_DASHBOARD_SETTINGS.figma);
  const muralSettings = sanitizeExternalImporterSettings(integrationInput.mural, DEFAULT_DASHBOARD_SETTINGS.mural);

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
  const restartSprintPolicy = readRestartSprintPolicy(
    runtime.restartSprintPolicy,
    defaults.runtime.restartSprintPolicy,
  );
  const restartInvocationPolicy = readRestartInvocationPolicy(
    runtime.restartInvocationPolicy,
    defaults.runtime.restartInvocationPolicy,
  );

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
      notion: notionSettings,
      asana: asanaSettings,
      linear: linearSettings,
      miro: miroSettings,
      lucid: lucidSettings,
      figma: figmaSettings,
      mural: muralSettings,
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
      restartSprintPolicy,
      restartInvocationPolicy,
    },
    integrations: {
      providers: integrations,
      githubToken: systemGithubToken,
      gitlabToken: systemGitlabToken,
      jira: jiraSettings,
      notion: notionSettings,
      asana: asanaSettings,
      linear: linearSettings,
      miro: miroSettings,
      lucid: lucidSettings,
      figma: figmaSettings,
      mural: muralSettings,
    },
    defaults: defaultsInput,
    mcpTools: sanitizeMcpToolToggles(input.mcpTools ?? defaults.mcpTools).map((tool) => ({ ...tool })),
    customMcpServers: sanitizeCustomMcpServersWithDefaults(
      input.customMcpServers,
      defaults.customMcpServers,
    ),
    modelPricing: sanitizeModelPricing(input.modelPricing ?? defaults.modelPricing),
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

type SettingsResolutionScope =
  | { scope: "system" }
  | { scope: "project"; projectId: string }
  | { scope: "sprint"; projectId: string; sprintId: string };

type SettingsResolutionRevision = number | string;

function settingsResolutionCacheKey(revision: SettingsResolutionRevision, scope: SettingsResolutionScope): string {
  if (scope.scope === "system") {
    return `${revision}:system`;
  }
  if (scope.scope === "project") {
    return `${revision}:project:${scope.projectId}`;
  }
  return `${revision}:sprint:${scope.projectId}:${scope.sprintId}`;
}

export class SettingsResolutionCache {
  private readonly effectiveDashboardSettings = new Map<string, EffectiveSettingsResponse>();
  private readonly resolvedProjectSettings = new Map<string, ProjectSettings>();

  clear(): void {
    this.effectiveDashboardSettings.clear();
    this.resolvedProjectSettings.clear();
  }

  getSystemDashboardSettings(
    revision: SettingsResolutionRevision,
    systemSettings: SystemSettings,
  ): EffectiveSettingsResponse {
    return this.getEffectiveDashboardSettings(
      revision,
      { scope: "system" },
      () => resolveDashboardSettings({ systemSettings }),
    );
  }

  getProjectDashboardSettings(
    revision: SettingsResolutionRevision,
    projectId: string,
    factory: () => {
      systemSettings: SystemSettings;
      projectOverride?: ProjectSettingsOverride | null;
    },
  ): EffectiveSettingsResponse {
    return this.getEffectiveDashboardSettings(
      revision,
      { scope: "project", projectId },
      () => resolveDashboardSettings(factory()),
    );
  }

  getSprintDashboardSettings(
    revision: SettingsResolutionRevision,
    projectId: string,
    sprintId: string,
    factory: () => {
      systemSettings: SystemSettings;
      projectOverride?: ProjectSettingsOverride | null;
      sprintOverride?: SprintSettingsOverride | null;
    },
  ): EffectiveSettingsResponse {
    return this.getEffectiveDashboardSettings(
      revision,
      { scope: "sprint", projectId, sprintId },
      () => resolveDashboardSettings(factory()),
    );
  }

  getProjectSettings(
    revision: SettingsResolutionRevision,
    projectId: string,
    factory: () => {
      systemSettings: SystemSettings;
      projectOverride?: ProjectSettingsOverride | null;
    },
  ): ProjectSettings {
    const key = settingsResolutionCacheKey(revision, { scope: "project", projectId });
    const cached = this.resolvedProjectSettings.get(key);
    if (cached) {
      return cached;
    }

    const { systemSettings, projectOverride } = factory();
    const resolved = resolveProjectSettings(systemSettings, projectOverride);
    this.resolvedProjectSettings.set(key, resolved);
    return resolved;
  }

  private getEffectiveDashboardSettings(
    revision: SettingsResolutionRevision,
    scope: SettingsResolutionScope,
    factory: () => EffectiveSettingsResponse,
  ): EffectiveSettingsResponse {
    const key = settingsResolutionCacheKey(revision, scope);
    const cached = this.effectiveDashboardSettings.get(key);
    if (cached) {
      return cached;
    }

    const resolved = factory();
    this.effectiveDashboardSettings.set(key, resolved);
    return resolved;
  }
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
    restartSprintPolicy: args.systemSettings.runtime.restartSprintPolicy,
    restartInvocationPolicy: args.systemSettings.runtime.restartInvocationPolicy,
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
      autoTransitionLinkedIssuesOnImport: sprintSettings.jira.autoTransitionLinkedIssuesOnImport,
      importTransitionName: sprintSettings.jira.importTransitionName || systemJira.importTransitionName,
      defaultProject: sprintSettings.jira.defaultProject || systemJira.defaultProject,
      closeTransitionName: sprintSettings.jira.closeTransitionName || systemJira.closeTransitionName,
      autoCloseLinkedIssues: sprintSettings.jira.autoCloseLinkedIssues,
    },
    notion: { ...sprintSettings.notion },
    asana: { ...sprintSettings.asana },
    linear: { ...sprintSettings.linear },
    miro: { ...sprintSettings.miro },
    lucid: { ...sprintSettings.lucid },
    figma: { ...sprintSettings.figma },
    mural: { ...sprintSettings.mural },
    ciIntelligence: { ...sprintSettings.ciIntelligence },
    guardrails: {
      ...sprintSettings.guardrails,
      jobs: {
        task_coding: { ...sprintSettings.guardrails.jobs.task_coding },
        ci_fix: { ...sprintSettings.guardrails.jobs.ci_fix },
        merge_conflict: { ...sprintSettings.guardrails.jobs.merge_conflict },
        clarification_reply: { ...sprintSettings.guardrails.jobs.clarification_reply },
        planning: { ...sprintSettings.guardrails.jobs.planning },
        remediation: { ...sprintSettings.guardrails.jobs.remediation },
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
      selfReflection: cloneSelfReflectionSettings(sprintSettings.agents.selfReflection),
    },
    skills: cloneSkills(sprintSettings.skills),
    mcpTools: resolveEffectiveMcpTools(args.systemSettings.mcpTools, sprintSettings.mcpTools),
    customMcpServers: resolveEffectiveCustomMcpServers(args.systemSettings.customMcpServers, sprintSettings.customMcpServers),
    memory: { ...sprintSettings.memory, externalEmbedding: { ...sprintSettings.memory.externalEmbedding } },
    modelPricing: { overrides: { ...args.systemSettings.modelPricing?.overrides } },
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
