import type {
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  SkillToggle,
} from "../contracts/app-types.js";
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
import { DEFAULT_INSTRUCTION_TEMPLATES, INSTRUCTION_TEMPLATE_IDS, type InstructionTemplateId } from "../instructions/instruction-template-catalog.js";
import { DEFAULT_DASHBOARD_SETTINGS, DEFAULT_SKILLS, INTERNAL_SKILL_NAMES, INTERNAL_SKILL_SET } from "../repositories/settings-defaults.js";

function cloneSkills(skills: SkillToggle[]): SkillToggle[] {
  return skills.map((skill) => ({ ...skill }));
}

function cloneMcpTools(tools: McpToolToggle[]): McpToolToggle[] {
  return tools.map((tool) => ({ ...tool }));
}

function cloneInstructionTemplates(
  templates: Record<InstructionTemplateId, string>,
): Record<InstructionTemplateId, string> {
  return { ...templates };
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
  const aiProvider = sanitizeAiProvider(DEFAULT_DASHBOARD_SETTINGS, externalHints);
  const git = sanitizeGit(DEFAULT_DASHBOARD_SETTINGS, externalHints);

  return {
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
        },
        gemini: {
          enabled: aiProvider.providers.gemini.enabled,
          model: aiProvider.providers.gemini.model,
          weight: aiProvider.providers.gemini.weight,
          thinkingMode: aiProvider.providers.gemini.thinkingMode,
        },
        codex: {
          enabled: aiProvider.providers.codex.enabled,
          model: aiProvider.providers.codex.model,
          weight: aiProvider.providers.codex.weight,
          thinkingMode: aiProvider.providers.codex.thinkingMode,
        },
        "claude-code": {
          enabled: aiProvider.providers["claude-code"].enabled,
          model: aiProvider.providers["claude-code"].model,
          weight: aiProvider.providers["claude-code"].weight,
          thinkingMode: aiProvider.providers["claude-code"].thinkingMode,
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

  return {
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
        },
        gemini: {
          enabled: aiProvider.providers.gemini.enabled,
          model: aiProvider.providers.gemini.model,
          weight: aiProvider.providers.gemini.weight,
          thinkingMode: aiProvider.providers.gemini.thinkingMode,
        },
        codex: {
          enabled: aiProvider.providers.codex.enabled,
          model: aiProvider.providers.codex.model,
          weight: aiProvider.providers.codex.weight,
          thinkingMode: aiProvider.providers.codex.thinkingMode,
        },
        "claude-code": {
          enabled: aiProvider.providers["claude-code"].enabled,
          model: aiProvider.providers["claude-code"].model,
          weight: aiProvider.providers["claude-code"].weight,
          thinkingMode: aiProvider.providers["claude-code"].thinkingMode,
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
    agents: { ...sprintSettings.agents },
    skills: cloneSkills(sprintSettings.skills),
    mcpTools: cloneMcpTools(args.systemSettings.mcpTools),
    memory: { ...sprintSettings.memory },
  };

  const sources = flattenSources(args.systemSettings.runtime, "system");
  flattenSources(args.systemSettings.mcpTools, "system", "mcpTools", sources);
  flattenSources(baseProject, "system", "", sources);
  if (args.projectOverride) {
    Object.assign(sources, flattenSources(args.projectOverride, "project"));
  }
  if (args.sprintOverride) {
    Object.assign(sources, flattenSources(args.sprintOverride, "sprint"));
  }

  return {
    settings: dashboardSettings,
    sources,
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
