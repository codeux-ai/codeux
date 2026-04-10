import type {
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  SkillToggle,
} from "../contracts/app-types.js";
import type { SettingsRepository } from "../repositories/settings-repository.js";
import type {
  EffectiveSettingsResponse,
  ProjectSettings,
  ProjectSettingsOverride,
  SprintSettingsOverride,
  SystemIntegrationSettings,
  SystemSettings,
  SettingsValueSource,
} from "../contracts/settings-scope-types.js";
import { sanitizeAiProvider } from "../domain/settings/settings-sanitizers/ai-provider-sanitizer.js";
import { sanitizeCiIntelligence } from "../domain/settings/settings-sanitizers/ci-sanitizer.js";
import { sanitizeCliWorkflow } from "../domain/settings/settings-sanitizers/cli-workflow-sanitizer.js";
import { sanitizeGit } from "../domain/settings/settings-sanitizers/git-sanitizer.js";
import { sanitizeSprintLoopSteps } from "../domain/settings/settings-sanitizers/sprint-loop-sanitizer.js";
import { sanitizeMemory } from "../domain/settings/settings-sanitizers/memory-sanitizer.js";
import { sanitizeWorkers } from "../domain/settings/settings-sanitizers/worker-sanitizer.js";
import { sanitizeMcpToolToggles } from "../mcp/mcp-tool-availability.js";
import { cloneMcpTools } from "../domain/settings/settings-sanitizers/mcp-tools-sanitizer.js";
import { cloneSkills, sanitizeSkills } from "../domain/settings/settings-sanitizers/skills-sanitizer.js";
import { sanitizeSprintPreviewSettings } from "../domain/settings/settings-sanitizers/sprint-preview-sanitizer.js";
import { cloneInstructionTemplates, cloneQualityAssuranceSettings, sanitizeInstructionTemplates, sanitizeQualityAssuranceSettings } from "../domain/settings/settings-sanitizers/agents-sanitizer.js";
import { DEFAULT_INSTRUCTION_TEMPLATES, INSTRUCTION_TEMPLATE_IDS, type InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import { DEFAULT_DASHBOARD_SETTINGS, DEFAULT_SKILLS, INTERNAL_SKILL_NAMES, INTERNAL_SKILL_SET } from "../repositories/settings-defaults.js";





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






export function buildDefaultProjectSettings(externalHints?: ExternalSettingsHints): ProjectSettings {
  const aiProvider = sanitizeAiProvider(DEFAULT_DASHBOARD_SETTINGS, externalHints);
  const git = sanitizeGit(DEFAULT_DASHBOARD_SETTINGS, externalHints);

  return {
    appearance: { ...DEFAULT_DASHBOARD_SETTINGS.appearance },
    automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
    automationInterventions: {
      ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
    },
    aiProvider: {
      provider: aiProvider.provider,
      strategy: aiProvider.strategy,
      providers: {
        jules: {
          enabled: aiProvider.providers.jules.enabled,
          model: aiProvider.providers.jules.model,
          weight: aiProvider.providers.jules.weight,
          thinkingMode: aiProvider.providers.jules.thinkingMode,
          maxConcurrentTasks: aiProvider.providers.jules.maxConcurrentTasks,
        },
        gemini: {
          enabled: aiProvider.providers.gemini.enabled,
          model: aiProvider.providers.gemini.model,
          weight: aiProvider.providers.gemini.weight,
          thinkingMode: aiProvider.providers.gemini.thinkingMode,
          maxConcurrentTasks: aiProvider.providers.gemini.maxConcurrentTasks,
        },
        codex: {
          enabled: aiProvider.providers.codex.enabled,
          model: aiProvider.providers.codex.model,
          weight: aiProvider.providers.codex.weight,
          thinkingMode: aiProvider.providers.codex.thinkingMode,
          maxConcurrentTasks: aiProvider.providers.codex.maxConcurrentTasks,
        },
        "claude-code": {
          enabled: aiProvider.providers["claude-code"].enabled,
          model: aiProvider.providers["claude-code"].model,
          weight: aiProvider.providers["claude-code"].weight,
          thinkingMode: aiProvider.providers["claude-code"].thinkingMode,
          maxConcurrentTasks: aiProvider.providers["claude-code"].maxConcurrentTasks,
        },
      },
      invocationRouting: cloneInvocationRouting(aiProvider.invocationRouting),
    },
    git: {
      githubMode: git.githubMode,
      defaultBranch: git.defaultBranch,
      autoCreatePr: git.autoCreatePr,
      featureBranchPrefix: git.featureBranchPrefix,
      sprintBranchScheme: git.sprintBranchScheme,
    },
    ciIntelligence: sanitizeCiIntelligence(DEFAULT_DASHBOARD_SETTINGS, git.githubMode),
    sprintLoopSteps: sanitizeSprintLoopSteps(DEFAULT_DASHBOARD_SETTINGS),
    cliWorkflow: sanitizeCliWorkflow(DEFAULT_DASHBOARD_SETTINGS),
    sprintPreview: { ...DEFAULT_DASHBOARD_SETTINGS.sprintPreview },
    workers: sanitizeWorkers(DEFAULT_DASHBOARD_SETTINGS),
    agents: {
      saveToProjectDirectory: DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
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
      enableDebugLogFile: DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile,
    },
    integrations: {
      julesApiKey: externalHints?.resolved.julesApiKey || "",
      geminiApiKey: externalHints?.resolved.geminiApiKey || "",
      codexApiKey: externalHints?.resolved.codexApiKey || "",
      claudeCodeApiKey: externalHints?.resolved.claudeCodeApiKey || "",
      githubToken: externalHints?.resolved.githubToken || "",
    },
    defaults: buildDefaultProjectSettings(externalHints),
    mcpTools: cloneMcpTools(DEFAULT_DASHBOARD_SETTINGS.mcpTools),
  };
}

export function sanitizeProjectSettings(value: unknown, externalHints?: ExternalSettingsHints): ProjectSettings {
  const input = toRecord(value);
  const aiInput = {
    ...DEFAULT_DASHBOARD_SETTINGS,
    aiProvider: deepMerge(DEFAULT_DASHBOARD_SETTINGS.aiProvider, input.aiProvider),
  };
  const gitInput = {
    ...DEFAULT_DASHBOARD_SETTINGS,
    git: deepMerge(DEFAULT_DASHBOARD_SETTINGS.git, input.git),
  };
  const git = sanitizeGit(gitInput, externalHints);
  const aiProvider = sanitizeAiProvider(aiInput, externalHints);
  const appearanceInput = toRecord(input.appearance);

  return {
    appearance: {
      navigationMode: appearanceInput.navigationMode === "SIDEBAR" ? "SIDEBAR" : "DOCK",
      theme: appearanceInput.theme === "LIGHT" || appearanceInput.theme === "DARK" ? appearanceInput.theme : "SYSTEM",
      reducedMotion: appearanceInput.reducedMotion === "REDUCE" || appearanceInput.reducedMotion === "NONE" ? appearanceInput.reducedMotion : "AUTO",
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
      providers: {
        jules: {
          enabled: aiProvider.providers.jules.enabled,
          model: aiProvider.providers.jules.model,
          weight: aiProvider.providers.jules.weight,
          thinkingMode: aiProvider.providers.jules.thinkingMode,
          maxConcurrentTasks: aiProvider.providers.jules.maxConcurrentTasks,
        },
        gemini: {
          enabled: aiProvider.providers.gemini.enabled,
          model: aiProvider.providers.gemini.model,
          weight: aiProvider.providers.gemini.weight,
          thinkingMode: aiProvider.providers.gemini.thinkingMode,
          maxConcurrentTasks: aiProvider.providers.gemini.maxConcurrentTasks,
        },
        codex: {
          enabled: aiProvider.providers.codex.enabled,
          model: aiProvider.providers.codex.model,
          weight: aiProvider.providers.codex.weight,
          thinkingMode: aiProvider.providers.codex.thinkingMode,
          maxConcurrentTasks: aiProvider.providers.codex.maxConcurrentTasks,
        },
        "claude-code": {
          enabled: aiProvider.providers["claude-code"].enabled,
          model: aiProvider.providers["claude-code"].model,
          weight: aiProvider.providers["claude-code"].weight,
          thinkingMode: aiProvider.providers["claude-code"].thinkingMode,
          maxConcurrentTasks: aiProvider.providers["claude-code"].maxConcurrentTasks,
        },
      },
      invocationRouting: cloneInvocationRouting(aiProvider.invocationRouting),
    },
    git: {
      githubMode: git.githubMode,
      defaultBranch: git.defaultBranch,
      autoCreatePr: git.autoCreatePr,
      featureBranchPrefix: git.featureBranchPrefix,
      sprintBranchScheme: git.sprintBranchScheme,
    },
    ciIntelligence: sanitizeCiIntelligence({
      ...DEFAULT_DASHBOARD_SETTINGS,
      ciIntelligence: deepMerge(DEFAULT_DASHBOARD_SETTINGS.ciIntelligence, input.ciIntelligence),
    }, git.githubMode),
    sprintLoopSteps: sanitizeSprintLoopSteps({
      ...DEFAULT_DASHBOARD_SETTINGS,
      sprintLoopSteps: deepMerge(DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps, input.sprintLoopSteps),
    }),
    cliWorkflow: sanitizeCliWorkflow({
      ...DEFAULT_DASHBOARD_SETTINGS,
      cliWorkflow: deepMerge(DEFAULT_DASHBOARD_SETTINGS.cliWorkflow, input.cliWorkflow),
    }),
    sprintPreview: sanitizeSprintPreviewSettings(deepMerge(DEFAULT_DASHBOARD_SETTINGS.sprintPreview, input.sprintPreview)),
    workers: sanitizeWorkers({
      ...DEFAULT_DASHBOARD_SETTINGS,
      workers: deepMerge(DEFAULT_DASHBOARD_SETTINGS.workers, input.workers),
    }),
    agents: {
      saveToProjectDirectory: typeof toRecord(input.agents).saveToProjectDirectory === "boolean"
        ? Boolean(toRecord(input.agents).saveToProjectDirectory)
        : DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
      instructionTemplates: sanitizeInstructionTemplates(toRecord(input.agents).instructionTemplates),
      qualityAssurance: sanitizeQualityAssuranceSettings(toRecord(input.agents).qualityAssurance),
    },
    skills: sanitizeSkills(input.skills, git.githubMode),
    memory: sanitizeMemory(input as Partial<DashboardSettings>),
  };
}

export function sanitizeSystemSettings(value: unknown, externalHints?: ExternalSettingsHints): SystemSettings {
  const defaults = buildDefaultSystemSettings(externalHints);
  const input = toRecord(value);
  const runtime = toRecord(input.runtime);
  const integrations = toRecord(input.integrations);

  const dashboardPort = typeof runtime.dashboardPort === "number" ? runtime.dashboardPort : defaults.runtime.dashboardPort;
  const enableDebugLogFile = typeof runtime.enableDebugLogFile === "boolean"
    ? runtime.enableDebugLogFile
    : defaults.runtime.enableDebugLogFile;

  return {
    runtime: {
      dashboardPort,
      enableDebugLogFile,
    },
    integrations: {
      julesApiKey: typeof integrations.julesApiKey === "string" ? integrations.julesApiKey : defaults.integrations.julesApiKey,
      geminiApiKey: typeof integrations.geminiApiKey === "string" ? integrations.geminiApiKey : defaults.integrations.geminiApiKey,
      codexApiKey: typeof integrations.codexApiKey === "string" ? integrations.codexApiKey : defaults.integrations.codexApiKey,
      claudeCodeApiKey: typeof integrations.claudeCodeApiKey === "string" ? integrations.claudeCodeApiKey : defaults.integrations.claudeCodeApiKey,
      githubToken: typeof integrations.githubToken === "string" ? integrations.githubToken : defaults.integrations.githubToken,
    },
    defaults: sanitizeProjectSettings(input.defaults, externalHints),
    mcpTools: sanitizeMcpToolToggles(input.mcpTools ?? defaults.mcpTools).map((tool) => ({ ...tool })),
  };
}

export function systemSettingsToDashboardSettings(settings: SystemSettings): DashboardSettings {
  return resolveDashboardSettings({
    systemSettings: settings,
  }).settings;
}

function applyIntegrations(settings: ProjectSettings, integrations: SystemIntegrationSettings): DashboardSettings["aiProvider"] {
  return {
    provider: settings.aiProvider.provider,
    strategy: settings.aiProvider.strategy,
    providers: {
      jules: {
        ...settings.aiProvider.providers.jules,
        apiKey: integrations.julesApiKey,
      },
      gemini: {
        ...settings.aiProvider.providers.gemini,
        apiKey: integrations.geminiApiKey,
      },
      codex: {
        ...settings.aiProvider.providers.codex,
        apiKey: integrations.codexApiKey,
      },
      "claude-code": {
        ...settings.aiProvider.providers["claude-code"],
        apiKey: integrations.claudeCodeApiKey,
      },
    },
    invocationRouting: cloneInvocationRouting(settings.aiProvider.invocationRouting),
    julesApiKey: integrations.julesApiKey,
  };
}

export function resolveProjectSettings(
  systemSettings: SystemSettings,
  projectOverride?: ProjectSettingsOverride | null,
): ProjectSettings {
  return sanitizeProjectSettings(deepMerge(systemSettings.defaults, projectOverride || {}));
}

export function resolveSprintProjectSettings(
  systemSettings: SystemSettings,
  projectOverride?: ProjectSettingsOverride | null,
  sprintOverride?: SprintSettingsOverride | null,
): ProjectSettings {
  const projectSettings = resolveProjectSettings(systemSettings, projectOverride);
  return sanitizeProjectSettings(deepMerge(projectSettings, sprintOverride || {}));
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
  const dashboardSettings: DashboardSettings = {
    dashboardPort: args.systemSettings.runtime.dashboardPort,
    enableDebugLogFile: args.systemSettings.runtime.enableDebugLogFile,
    appearance: { ...sprintSettings.appearance },
    automationLevel: sprintSettings.automationLevel,
    automationInterventions: { ...sprintSettings.automationInterventions },
    aiProvider: applyIntegrations(sprintSettings, args.systemSettings.integrations),
    git: {
      ...sprintSettings.git,
      githubToken: args.systemSettings.integrations.githubToken,
    },
    ciIntelligence: { ...sprintSettings.ciIntelligence },
    sprintLoopSteps: { ...sprintSettings.sprintLoopSteps },
    cliWorkflow: { ...sprintSettings.cliWorkflow },
    sprintPreview: { ...sprintSettings.sprintPreview },
    workers: { ...sprintSettings.workers },
    agents: {
      saveToProjectDirectory: sprintSettings.agents.saveToProjectDirectory,
      instructionTemplates: cloneInstructionTemplates(sprintSettings.agents.instructionTemplates),
      qualityAssurance: cloneQualityAssuranceSettings(sprintSettings.agents.qualityAssurance),
    },
    skills: cloneSkills(sprintSettings.skills),
    mcpTools: cloneMcpTools(args.systemSettings.mcpTools),
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
  externalHints?: ExternalSettingsHints,
): ProjectSettingsOverride {
  const merged = sanitizeProjectSettings(deepMerge(base, patch), externalHints);
  return (deepDiff(base, merged) || {}) as ProjectSettingsOverride;
}

export function toSprintSettingsOverride(
  base: ProjectSettings,
  patch: unknown,
  externalHints?: ExternalSettingsHints,
): SprintSettingsOverride {
  const merged = sanitizeProjectSettings(deepMerge(base, patch), externalHints);
  return (deepDiff(base, merged) || {}) as SprintSettingsOverride;
}
