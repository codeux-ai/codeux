import type {
  BackgroundPattern,
  DashboardSettings,
  DashboardExperienceMode,
  DesignGuidanceSettings,
  ExternalSettingsHints,
  McpToolToggle,
  RuntimeLogLevel,
  ConsoleLogMode,
  ExternalImporterSettings,
  RestartInvocationPolicy,
  RestartSprintPolicy,
  SkillToggle,
  TechstackCatalogEntrySettings,
  TechstackCatalogSettings,
  TechstackItemSettings,
  TechstackSelectionSettings,
} from "../contracts/app-types.js";
import { readBoolean, readPort, readString } from "../shared/config/value-readers.js";
import { sanitizeCustomMcpServersWithDefaults, sanitizeMcpToolToggles } from "../mcp/mcp-tool-availability.js";
import { sanitizeAiProvider } from "../domain/settings/settings-sanitizers/ai-provider-sanitizer.js";
import { sanitizeGit } from "../domain/settings/settings-sanitizers/git-sanitizer.js";
import { sanitizeJira } from "../domain/settings/settings-sanitizers/jira-sanitizer.js";
import { sanitizeCiIntelligence } from "../domain/settings/settings-sanitizers/ci-sanitizer.js";
import { sanitizeGuardrails } from "../domain/settings/settings-sanitizers/guardrails-sanitizer.js";
import { sanitizeSprintLoopSteps } from "../domain/settings/settings-sanitizers/sprint-loop-sanitizer.js";
import { sanitizeCliWorkflow } from "../domain/settings/settings-sanitizers/cli-workflow-sanitizer.js";
import { sanitizeWorkers } from "../domain/settings/settings-sanitizers/worker-sanitizer.js";
import { sanitizeMemory } from "../domain/settings/settings-sanitizers/memory-sanitizer.js";
import { sanitizeSpeech } from "../domain/settings/settings-sanitizers/speech-sanitizer.js";
import { sanitizeModelPricing } from "../domain/settings/settings-sanitizers/model-pricing-sanitizer.js";
import { sanitizePreviewEnvironmentVariables } from "../shared/preview-environment.js";
import {
  buildDashboardProviderSettings,
  buildDefaultIntegrationProviders,
} from "../domain/settings/provider-config-utils.js";
import {
  BUILTIN_CODE_UX_TECHSTACK,
  BUILTIN_CODE_UX_TECHSTACK_ID,
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_DASHBOARD_EXPERIENCE_MODE,
  DEFAULT_AGENT_SELF_REFLECTION,
  DEFAULT_IMPORTER_SEARCH_LIMIT,
  DEFAULT_PROJECT_TECHSTACK,
  DEFAULT_SKILLS,
  DASHBOARD_EXPERIENCE_MODES,
  INTERNAL_SKILL_NAMES,
  INTERNAL_SKILL_SET,
  QA_EXHAUSTION_POLICIES,
} from "./settings-defaults.js";
import {
  cloneDesignGuidanceSettings,
  sanitizeDesignGuidanceSettings,
} from "../domain/settings/design-guidance-catalog.js";

const enforceGitManagerSkillset = (skills: SkillToggle[], githubMode: "REMOTE" | "LOCAL"): SkillToggle[] => {
  return skills.map((skill) => {
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
};

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

const sanitizePreviewPortList = (value: unknown, primaryPort: number): number[] => {
  const ports = [primaryPort];
  if (Array.isArray(value)) {
    for (const item of value) {
      const port = readPort(item, -1);
      if (port > 0) {
        ports.push(port);
      }
    }
  }
  return [...new Set(ports)];
};

const sanitizeSkills = (value: unknown): SkillToggle[] => {
  if (!Array.isArray(value)) return DEFAULT_SKILLS.map((skill) => ({ ...skill }));
  const validSkills = value
    .filter((item): item is SkillToggle => {
      if (!item || typeof item !== "object") return false;
      const skill = item as Partial<SkillToggle>;
      return typeof skill.name === "string" && typeof skill.enabled === "boolean";
    })
    .map((skill) => ({ name: skill.name.trim(), enabled: skill.enabled }))
    .filter((skill) => skill.name.length > 0);
  const enabledByName = new Map(validSkills.map((skill) => [skill.name, skill.enabled]));

  const internalSkills: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
    name,
    enabled: enabledByName.get(name) ?? true,
    isInternal: true,
  }));

  const customSkills: SkillToggle[] = validSkills
    .filter((skill) => !INTERNAL_SKILL_SET.has(skill.name))
    .map((skill) => ({
      name: skill.name,
      enabled: skill.enabled,
      isInternal: false,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

  return [...internalSkills, ...customSkills];
};

const sanitizeMcpTools = (value: unknown): McpToolToggle[] => {
  return sanitizeMcpToolToggles(value).map((tool) => ({ ...tool }));
};

export const sanitizeExternalImporterSettings = (
  value: unknown,
  defaults: ExternalImporterSettings,
): ExternalImporterSettings => {
  const input = value && typeof value === "object" ? value as Partial<ExternalImporterSettings> : {};
  const rawLimit = typeof input.defaultSearchLimit === "number" && Number.isFinite(input.defaultSearchLimit)
    ? Math.round(input.defaultSearchLimit)
    : defaults.defaultSearchLimit;

  return {
    enabled: readBoolean(input.enabled, defaults.enabled),
    apiToken: readString(input.apiToken, defaults.apiToken).trim(),
    apiSecret: readString(input.apiSecret, defaults.apiSecret).trim(),
    baseUrl: readString(input.baseUrl, defaults.baseUrl).trim().replace(/\/+$/, ""),
    workspaceId: readString(input.workspaceId, defaults.workspaceId).trim(),
    teamId: readString(input.teamId, defaults.teamId).trim(),
    teamKey: readString(input.teamKey, defaults.teamKey).trim(),
    projectId: readString(input.projectId, defaults.projectId).trim(),
    databaseId: readString(input.databaseId, defaults.databaseId).trim(),
    boardId: readString(input.boardId, defaults.boardId).trim(),
    documentId: readString(input.documentId, defaults.documentId).trim(),
    fileKey: readString(input.fileKey, defaults.fileKey).trim(),
    defaultSearchLimit: Math.max(1, Math.min(250, rawLimit || DEFAULT_IMPORTER_SEARCH_LIMIT)),
  };
};

const cloneTechstackEntry = (entry: TechstackCatalogEntrySettings): TechstackCatalogEntrySettings => ({
  ...entry,
  items: entry.items.map((item) => ({ ...item })),
});

const cloneTechstackCatalog = (catalog: TechstackCatalogSettings): TechstackCatalogSettings => ({
  defaultTechstackId: catalog.defaultTechstackId,
  entries: catalog.entries.map((entry) => cloneTechstackEntry(entry)),
});

const TECHSTACK_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

const isValidTechstackId = (id: string): boolean => TECHSTACK_ID_PATTERN.test(id);

const sanitizeTechstackItem = (value: unknown): TechstackItemSettings | null => {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = readString(input.id, "").trim();
  const label = readString(input.label, "").trim();
  return id && label && isValidTechstackId(id) ? { id, label } : null;
};

const sanitizeTechstackEntry = (value: unknown): TechstackCatalogEntrySettings | null => {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const id = readString(input.id, "").trim();
  const label = readString(input.label, "").trim();
  if (!id || !label || !isValidTechstackId(id)) {
    return null;
  }

  const items: TechstackItemSettings[] = [];
  const seenItems = new Set<string>();
  if (Array.isArray(input.items)) {
    for (const itemInput of input.items) {
      const item = sanitizeTechstackItem(itemInput);
      if (!item || seenItems.has(item.id)) {
        continue;
      }
      items.push(item);
      seenItems.add(item.id);
    }
  }

  return { id, label, items };
};

const sanitizeTechstackCatalog = (value: unknown): TechstackCatalogSettings => {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const entries: TechstackCatalogEntrySettings[] = [cloneTechstackEntry(BUILTIN_CODE_UX_TECHSTACK)];
  const seenEntries = new Set<string>([BUILTIN_CODE_UX_TECHSTACK_ID]);

  if (Array.isArray(input.entries)) {
    for (const entryInput of input.entries) {
      const entry = sanitizeTechstackEntry(entryInput);
      if (!entry || seenEntries.has(entry.id)) {
        continue;
      }
      entries.push(entry);
      seenEntries.add(entry.id);
    }
  }

  const defaultTechstackId = readString(input.defaultTechstackId, "").trim();
  return {
    defaultTechstackId: seenEntries.has(defaultTechstackId) ? defaultTechstackId : BUILTIN_CODE_UX_TECHSTACK_ID,
    entries,
  };
};

const sanitizeTechstackSelection = (value: unknown): TechstackSelectionSettings => {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const selectedTechstackId = readString(input.selectedTechstackId, "").trim();
  return {
    selectedTechstackId: selectedTechstackId && isValidTechstackId(selectedTechstackId) ? selectedTechstackId : null,
    applicationKind: input.applicationKind === "web" || input.applicationKind === "desktop"
      ? input.applicationKind
      : DEFAULT_PROJECT_TECHSTACK.applicationKind,
  };
};

const cloneDesignGuidance = (settings: DesignGuidanceSettings): DesignGuidanceSettings => (
  cloneDesignGuidanceSettings(settings)
);

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
const DASHBOARD_EXPERIENCE_MODE_SET = new Set<DashboardExperienceMode>(DASHBOARD_EXPERIENCE_MODES);

const sanitizeDashboardExperienceMode = (value: unknown): DashboardExperienceMode => (
  typeof value === "string" && DASHBOARD_EXPERIENCE_MODE_SET.has(value as DashboardExperienceMode)
    ? value as DashboardExperienceMode
    : DEFAULT_DASHBOARD_EXPERIENCE_MODE
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

const sanitizeAgentPresetIds = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  const ids: string[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string") {
      continue;
    }
    const id = entry.trim();
    if (id && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
  }
  return ids;
};

const sanitizeQualityAssuranceTrigger = (
  value: unknown,
  defaults: DashboardSettings["agents"]["qualityAssurance"]["taskCompletion"],
): DashboardSettings["agents"]["qualityAssurance"]["taskCompletion"] => {
  const input = value && typeof value === "object" ? value as Partial<DashboardSettings["agents"]["qualityAssurance"]["taskCompletion"]> : {};
  const legacyAgentPresetId = readString(input.agentPresetId, "").trim();
  const agentPresetIds = Array.isArray(input.agentPresetIds)
    ? sanitizeAgentPresetIds(input.agentPresetIds)
    : sanitizeAgentPresetIds(legacyAgentPresetId ? [legacyAgentPresetId] : defaults.agentPresetIds);

  return {
    enabled: readBoolean(input.enabled, defaults.enabled),
    agentPresetIds,
    agentPresetId: agentPresetIds[0] ?? null,
  };
};

const QA_MAX_REVIEW_RUNS_CEILING = 20;

const readReviewRunCount = (value: unknown, fallback: number): number => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(1, Math.min(QA_MAX_REVIEW_RUNS_CEILING, Math.round(value)));
  }
  return fallback;
};

const sanitizeQualityAssurance = (
  value: Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined,
): DashboardSettings["agents"]["qualityAssurance"] => {
  const input = value && typeof value === "object" ? value : {};
  const defaults = DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance;
  const policy = typeof input.exhaustionPolicy === "string"
    && QA_EXHAUSTION_POLICIES.includes(input.exhaustionPolicy as never)
    ? input.exhaustionPolicy
    : defaults.exhaustionPolicy;

  return {
    enabled: readBoolean(input.enabled, defaults.enabled),
    maxTaskReviewRuns: readReviewRunCount(input.maxTaskReviewRuns, defaults.maxTaskReviewRuns),
    maxSprintReviewRuns: readReviewRunCount(input.maxSprintReviewRuns, defaults.maxSprintReviewRuns),
    exhaustionPolicy: policy,
    taskCompletion: sanitizeQualityAssuranceTrigger(input.taskCompletion, defaults.taskCompletion),
    sprintCompletion: sanitizeQualityAssuranceTrigger(input.sprintCompletion, defaults.sprintCompletion),
    completedTaskWithoutPr: sanitizeQualityAssuranceTrigger(input.completedTaskWithoutPr, defaults.completedTaskWithoutPr),
  };
};

const SELF_REFLECTION_MAX_ATTEMPTS_CEILING = 10;

const sanitizeSelfReflectionCriteria = (
  value: unknown,
  defaults: DashboardSettings["agents"]["selfReflection"]["planning"]["criteria"],
): DashboardSettings["agents"]["selfReflection"]["planning"]["criteria"] => {
  if (!Array.isArray(value)) {
    return defaults.map((criterion) => ({ ...criterion }));
  }

  const criteria: DashboardSettings["agents"]["selfReflection"]["planning"]["criteria"] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const input = entry as Record<string, unknown>;
    const id = readString(input.id, "").trim();
    const label = readString(input.label, "").trim();
    const prompt = readString(input.prompt, "").trim();
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
};

const sanitizeSelfReflectionLoop = (
  value: unknown,
  defaults: DashboardSettings["agents"]["selfReflection"]["planning"],
): DashboardSettings["agents"]["selfReflection"]["planning"] => {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const maxImprovementAttempts = typeof input.maxImprovementAttempts === "number" && Number.isFinite(input.maxImprovementAttempts)
    ? Math.max(0, Math.min(SELF_REFLECTION_MAX_ATTEMPTS_CEILING, Math.round(input.maxImprovementAttempts)))
    : defaults.maxImprovementAttempts;

  return {
    enabled: readBoolean(input.enabled, defaults.enabled),
    criteria: sanitizeSelfReflectionCriteria(input.criteria, defaults.criteria),
    maxImprovementAttempts,
  };
};

const sanitizeSelfReflection = (
  value: unknown,
): DashboardSettings["agents"]["selfReflection"] => {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    planning: sanitizeSelfReflectionLoop(input.planning, DEFAULT_AGENT_SELF_REFLECTION.planning),
    qualityAssurance: sanitizeSelfReflectionLoop(
      input.qualityAssurance,
      DEFAULT_AGENT_SELF_REFLECTION.qualityAssurance,
    ),
  };
};

const cloneAgentRouting = (): DashboardSettings["agents"]["routing"] => ({
  planning: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.planning },
  taskCoding: {
    ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.taskCoding,
    orchestratorAgentPresetIds: [...DEFAULT_DASHBOARD_SETTINGS.agents.routing.taskCoding.orchestratorAgentPresetIds],
  },
  ciFix: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.ciFix },
  mergeConflict: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.mergeConflict },
  dashboardReply: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.dashboardReply },
  clarificationReply: { ...DEFAULT_DASHBOARD_SETTINGS.agents.routing.clarificationReply },
});

const sanitizeManualAgentRouting = (value: unknown): DashboardSettings["agents"]["routing"]["ciFix"] => {
  const input = value && typeof value === "object" ? value as { agentPresetId?: unknown } : {};
  return {
    agentPresetId: readString(input.agentPresetId, "").trim() || null,
  };
};

const sanitizeAgentRouting = (value: unknown): DashboardSettings["agents"]["routing"] => {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const taskCoding = input.taskCoding && typeof input.taskCoding === "object"
    ? input.taskCoding as Record<string, unknown>
    : {};
  return {
    planning: sanitizeManualAgentRouting(input.planning),
    taskCoding: {
      mode: taskCoding.mode === "ORCHESTRATOR" ? "ORCHESTRATOR" : "MANUAL",
      agentPresetId: readString(taskCoding.agentPresetId, "").trim() || null,
      orchestratorAgentPresetIds: Array.isArray(taskCoding.orchestratorAgentPresetIds)
        ? taskCoding.orchestratorAgentPresetIds.map((entry) => String(entry || "").trim()).filter(Boolean)
        : [],
    },
    ciFix: sanitizeManualAgentRouting(input.ciFix),
    mergeConflict: sanitizeManualAgentRouting(input.mergeConflict),
    dashboardReply: sanitizeManualAgentRouting(input.dashboardReply),
    clarificationReply: sanitizeManualAgentRouting(input.clarificationReply),
  };
};

export const cloneDefaults = (externalHints?: ExternalSettingsHints): DashboardSettings => ({
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
  automationInterventions: {
    ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
  },
  aiProvider: {
    ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
    providers: buildDashboardProviderSettings(
      DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers,
      buildDefaultIntegrationProviders(externalHints),
    ),
  },
  techstackCatalog: cloneTechstackCatalog(DEFAULT_DASHBOARD_SETTINGS.techstackCatalog),
  techstack: { ...DEFAULT_DASHBOARD_SETTINGS.techstack },
  designGuidance: cloneDesignGuidance(DEFAULT_DASHBOARD_SETTINGS.designGuidance),
  git: {
    ...DEFAULT_DASHBOARD_SETTINGS.git,
    githubToken: externalHints?.resolved.githubToken || DEFAULT_DASHBOARD_SETTINGS.git.githubToken,
    gitlabToken: externalHints?.resolved.gitlabToken || DEFAULT_DASHBOARD_SETTINGS.git.gitlabToken,
  },
  jira: {
    ...DEFAULT_DASHBOARD_SETTINGS.jira,
    apiToken: externalHints?.resolved?.jiraToken || DEFAULT_DASHBOARD_SETTINGS.jira.apiToken,
  },
  notion: { ...DEFAULT_DASHBOARD_SETTINGS.notion },
  asana: { ...DEFAULT_DASHBOARD_SETTINGS.asana },
  linear: { ...DEFAULT_DASHBOARD_SETTINGS.linear },
  miro: { ...DEFAULT_DASHBOARD_SETTINGS.miro },
  lucid: { ...DEFAULT_DASHBOARD_SETTINGS.lucid },
  figma: { ...DEFAULT_DASHBOARD_SETTINGS.figma },
  mural: { ...DEFAULT_DASHBOARD_SETTINGS.mural },
  ciIntelligence: {
    ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
  },
  guardrails: {
    ...DEFAULT_DASHBOARD_SETTINGS.guardrails,
    jobs: {
      task_coding: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs.task_coding },
      ci_fix: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs.ci_fix },
      merge_conflict: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs.merge_conflict },
      clarification_reply: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs.clarification_reply },
      planning: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs.planning },
      remediation: { ...DEFAULT_DASHBOARD_SETTINGS.guardrails.jobs.remediation },
    },
  },
  sprintLoopSteps: {
    ...DEFAULT_DASHBOARD_SETTINGS.sprintLoopSteps,
  },
  cliWorkflow: {
    ...DEFAULT_DASHBOARD_SETTINGS.cliWorkflow,
  },
  sprintPreview: {
    ...DEFAULT_DASHBOARD_SETTINGS.sprintPreview,
  },
  workers: {
    ...DEFAULT_DASHBOARD_SETTINGS.workers,
  },
  agents: {
    saveToProjectDirectory: DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
    routing: cloneAgentRouting(),
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
    selfReflection: sanitizeSelfReflection(DEFAULT_DASHBOARD_SETTINGS.agents.selfReflection),
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
  customMcpServers: DEFAULT_DASHBOARD_SETTINGS.customMcpServers.map((server) => ({ ...server })),
  memory: {
    ...DEFAULT_DASHBOARD_SETTINGS.memory,
    customEmbeddingModels: DEFAULT_DASHBOARD_SETTINGS.memory.customEmbeddingModels.map((model) => ({
      ...model,
      tokenizerFiles: [...model.tokenizerFiles],
    })),
    externalEmbedding: { ...DEFAULT_DASHBOARD_SETTINGS.memory.externalEmbedding },
  },
  speech: {
    ...DEFAULT_DASHBOARD_SETTINGS.speech,
    externalTranscription: { ...DEFAULT_DASHBOARD_SETTINGS.speech.externalTranscription },
  },
  modelPricing: { overrides: { ...DEFAULT_DASHBOARD_SETTINGS.modelPricing.overrides } },
});

export const sanitizeSettings = (value: unknown, externalHints?: ExternalSettingsHints): DashboardSettings => {
  const input = (value && typeof value === "object" ? value : {}) as Partial<DashboardSettings> & {
    enableDebugLogFile?: unknown;
    consoleLogMode?: unknown;
  };
  const dashboardPort = readPort(input.dashboardPort, DEFAULT_DASHBOARD_SETTINGS.dashboardPort);
  const rawConsoleLogLevel = input.consoleLogLevel as unknown;
  const legacyConsoleLogMode = rawConsoleLogLevel === "full" || rawConsoleLogLevel === "standard"
    ? rawConsoleLogLevel
    : undefined;
  const legacyDebugLogFileLevel = Object.hasOwn(input, "enableDebugLogFile")
    ? readBoolean(input.enableDebugLogFile, false) ? DEFAULT_DASHBOARD_SETTINGS.debugLogFileLevel : "off"
    : DEFAULT_DASHBOARD_SETTINGS.debugLogFileLevel;
  const consoleLogLevel = readRuntimeLogLevel(rawConsoleLogLevel, DEFAULT_DASHBOARD_SETTINGS.consoleLogLevel);
  const debugLogFileLevel = readRuntimeLogLevel(input.debugLogFileLevel, legacyDebugLogFileLevel);
  const consoleLogMode = readConsoleLogMode(input.consoleLogMode ?? legacyConsoleLogMode, DEFAULT_DASHBOARD_SETTINGS.consoleLogMode);
  const dbAutoVacuumOnStartup = readBoolean(input.dbAutoVacuumOnStartup, DEFAULT_DASHBOARD_SETTINGS.dbAutoVacuumOnStartup);
  const dbPruningEnabled = readBoolean(input.dbPruningEnabled, DEFAULT_DASHBOARD_SETTINGS.dbPruningEnabled);
  const dbRetentionDays = typeof input.dbRetentionDays === "number" ? input.dbRetentionDays : DEFAULT_DASHBOARD_SETTINGS.dbRetentionDays;
  const restartSprintPolicy = readRestartSprintPolicy(input.restartSprintPolicy, DEFAULT_DASHBOARD_SETTINGS.restartSprintPolicy);
  const restartInvocationPolicy = readRestartInvocationPolicy(input.restartInvocationPolicy, DEFAULT_DASHBOARD_SETTINGS.restartInvocationPolicy);

  const appearanceInput = (input.appearance && typeof input.appearance === "object"
    ? input.appearance
    : {}) as Partial<DashboardSettings["appearance"]>;

  const rawZoom = typeof appearanceInput.zoomLevel === "number" && Number.isFinite(appearanceInput.zoomLevel)
    ? appearanceInput.zoomLevel
    : DEFAULT_DASHBOARD_SETTINGS.appearance.zoomLevel;
  const appearance = {
    navigationMode: appearanceInput.navigationMode === "DOCK" ? "DOCK" : "SIDEBAR" as "DOCK" | "SIDEBAR",
    experienceMode: sanitizeDashboardExperienceMode(appearanceInput.experienceMode),
    theme: appearanceInput.theme === "LIGHT" || appearanceInput.theme === "DARK" ? appearanceInput.theme : "SYSTEM" as "LIGHT" | "DARK" | "SYSTEM",
    reducedMotion: appearanceInput.reducedMotion === "REDUCE" || appearanceInput.reducedMotion === "NONE" ? appearanceInput.reducedMotion : "AUTO" as "AUTO" | "REDUCE" | "NONE",
    backgroundMode: appearanceInput.backgroundMode === "STATIC" ? "STATIC" : "ANIMATED" as "ANIMATED" | "STATIC",
    animatedBackground: typeof appearanceInput.animatedBackground === "string" ? appearanceInput.animatedBackground : "deep-ocean",
    staticBackgroundColor: typeof appearanceInput.staticBackgroundColor === "string" ? appearanceInput.staticBackgroundColor : "#0d0f12",
    backgroundImage: sanitizeBackgroundImage(appearanceInput.backgroundImage),
    backgroundPattern: sanitizeBackgroundPattern(appearanceInput.backgroundPattern),
    zoomLevel: Math.min(2.5, Math.max(0.5, rawZoom)),
  };

  const automationLevel = input.automationLevel;
  const validAutomationLevel = automationLevel === "FULL" || automationLevel === "SEMI_AUTO" || automationLevel === "ALWAYS_ASK"
    ? automationLevel
    : DEFAULT_DASHBOARD_SETTINGS.automationLevel;
  const interventionInput = (input.automationInterventions && typeof input.automationInterventions === "object"
    ? input.automationInterventions
    : {}) as Partial<DashboardSettings["automationInterventions"]>;
  const automationInterventions = {
    autoApprovePlan: readBoolean(
      interventionInput.autoApprovePlan,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.autoApprovePlan
    ),
    autoAnswerClarification: readBoolean(
      interventionInput.autoAnswerClarification,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.autoAnswerClarification
    ),
    autoAnswerClarificationMode: (interventionInput.autoAnswerClarificationMode === "WORKER" ? "WORKER" : "TEMPLATE") as "TEMPLATE" | "WORKER",
    autoResumePaused: readBoolean(
      interventionInput.autoResumePaused,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.autoResumePaused
    ),
    clarificationAnswerTemplate: readString(
      interventionInput.clarificationAnswerTemplate,
      DEFAULT_DASHBOARD_SETTINGS.automationInterventions.clarificationAnswerTemplate
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.automationInterventions.clarificationAnswerTemplate,
    clarificationCooldownSeconds: Math.max(0,
      typeof interventionInput.clarificationCooldownSeconds === "number" && Number.isFinite(interventionInput.clarificationCooldownSeconds)
        ? interventionInput.clarificationCooldownSeconds
        : DEFAULT_DASHBOARD_SETTINGS.automationInterventions.clarificationCooldownSeconds
    ),
  };

  const aiProvider = sanitizeAiProvider(input, { externalHints });
  const techstackCatalog = sanitizeTechstackCatalog(input.techstackCatalog ?? DEFAULT_DASHBOARD_SETTINGS.techstackCatalog);
  const techstack = sanitizeTechstackSelection(input.techstack);
  const designGuidance = sanitizeDesignGuidanceSettings(input.designGuidance);
  const git = sanitizeGit(input, externalHints);
  const jira = sanitizeJira(input.jira, DEFAULT_DASHBOARD_SETTINGS.jira);
  if (externalHints?.resolved?.jiraToken) {
    jira.apiToken = externalHints.resolved.jiraToken;
  }
  const notion = sanitizeExternalImporterSettings(input.notion, DEFAULT_DASHBOARD_SETTINGS.notion);
  const asana = sanitizeExternalImporterSettings(input.asana, DEFAULT_DASHBOARD_SETTINGS.asana);
  const linear = sanitizeExternalImporterSettings(input.linear, DEFAULT_DASHBOARD_SETTINGS.linear);
  const miro = sanitizeExternalImporterSettings(input.miro, DEFAULT_DASHBOARD_SETTINGS.miro);
  const lucid = sanitizeExternalImporterSettings(input.lucid, DEFAULT_DASHBOARD_SETTINGS.lucid);
  const figma = sanitizeExternalImporterSettings(input.figma, DEFAULT_DASHBOARD_SETTINGS.figma);
  const mural = sanitizeExternalImporterSettings(input.mural, DEFAULT_DASHBOARD_SETTINGS.mural);
  const ciIntelligence = sanitizeCiIntelligence(input, git.githubMode);
  const guardrails = sanitizeGuardrails(input);
  const sprintLoopSteps = sanitizeSprintLoopSteps(input);
  const cliWorkflow = sanitizeCliWorkflow(input);
  const sprintPreviewInput = (input.sprintPreview && typeof input.sprintPreview === "object"
    ? input.sprintPreview
    : {}) as Partial<DashboardSettings["sprintPreview"]>;
  const containerAppPort = readPort(
    sprintPreviewInput.containerAppPort,
    DEFAULT_DASHBOARD_SETTINGS.sprintPreview.containerAppPort,
  );
  const sprintPreview = {
    enabled: readBoolean(
      sprintPreviewInput.enabled,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.enabled,
    ),
    showInAppBrowser: readBoolean(
      sprintPreviewInput.showInAppBrowser,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.showInAppBrowser,
    ),
    autoStartOnRunningSprint: readBoolean(
      sprintPreviewInput.autoStartOnRunningSprint,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.autoStartOnRunningSprint,
    ),
    rebuildOnTaskCompletion: readBoolean(
      sprintPreviewInput.rebuildOnTaskCompletion,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.rebuildOnTaskCompletion,
    ),
    rebuildOnSprintCompletion: readBoolean(
      sprintPreviewInput.rebuildOnSprintCompletion,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.rebuildOnSprintCompletion,
    ),
    autoStopOnTerminalSprint: readBoolean(
      sprintPreviewInput.autoStopOnTerminalSprint,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.autoStopOnTerminalSprint,
    ),
    maxConcurrentContainers: Math.max(1, Math.min(100,
      typeof sprintPreviewInput.maxConcurrentContainers === "number" && Number.isFinite(sprintPreviewInput.maxConcurrentContainers)
        ? Math.round(sprintPreviewInput.maxConcurrentContainers)
        : DEFAULT_DASHBOARD_SETTINGS.sprintPreview.maxConcurrentContainers
    )),
    hostPortRangeStart: Math.max(1, Math.min(65535,
      typeof sprintPreviewInput.hostPortRangeStart === "number" && Number.isFinite(sprintPreviewInput.hostPortRangeStart)
        ? Math.round(sprintPreviewInput.hostPortRangeStart)
        : DEFAULT_DASHBOARD_SETTINGS.sprintPreview.hostPortRangeStart
    )),
    hostPortRangeEnd: Math.max(1, Math.min(65535,
      typeof sprintPreviewInput.hostPortRangeEnd === "number" && Number.isFinite(sprintPreviewInput.hostPortRangeEnd)
        ? Math.round(sprintPreviewInput.hostPortRangeEnd)
        : DEFAULT_DASHBOARD_SETTINGS.sprintPreview.hostPortRangeEnd
    )),
    containerAppPort,
    containerAppPorts: sanitizePreviewPortList(sprintPreviewInput.containerAppPorts, containerAppPort),
    startupScriptPath: (() => {
      const raw = readString(
        sprintPreviewInput.startupScriptPath,
        DEFAULT_DASHBOARD_SETTINGS.sprintPreview.startupScriptPath,
      ).trim() || DEFAULT_DASHBOARD_SETTINGS.sprintPreview.startupScriptPath;
      if (raw.includes("..") || raw.startsWith("/") || /^[a-zA-Z]:\\/.test(raw) || raw.includes("~") || raw.includes("$") || raw.includes("%")) {
        return DEFAULT_DASHBOARD_SETTINGS.sprintPreview.startupScriptPath;
      }
      return raw;
    })(),
    startupCommand: (() => {
      const raw = readString(
        sprintPreviewInput.startupCommand,
        DEFAULT_DASHBOARD_SETTINGS.sprintPreview.startupCommand,
      ).trim();
      return raw.includes("\0") ? "" : raw.slice(0, 8_192);
    })(),
    allowDockerAccess: readBoolean(
      sprintPreviewInput.allowDockerAccess,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.allowDockerAccess,
    ),
    environmentVariables: sanitizePreviewEnvironmentVariables(sprintPreviewInput.environmentVariables),
  };
  if (sprintPreview.hostPortRangeEnd < sprintPreview.hostPortRangeStart) {
    sprintPreview.hostPortRangeEnd = sprintPreview.hostPortRangeStart;
  }
  const workers = sanitizeWorkers(input, { providers: aiProvider.providers });
  const agentsInput = (input.agents && typeof input.agents === "object")
    ? input.agents as Partial<DashboardSettings["agents"]>
    : {};
  const agents = {
    saveToProjectDirectory: readBoolean(
      agentsInput.saveToProjectDirectory,
      DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
    ),
    routing: sanitizeAgentRouting(agentsInput.routing),
    instructionTemplates: {
      ...DEFAULT_DASHBOARD_SETTINGS.agents.instructionTemplates,
      ...(agentsInput.instructionTemplates && typeof agentsInput.instructionTemplates === "object"
        ? Object.fromEntries(
            Object.entries(agentsInput.instructionTemplates).filter(([, value]) => typeof value === "string"),
          )
        : {}),
    },
    qualityAssurance: sanitizeQualityAssurance(
      agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined,
    ),
    selfReflection: sanitizeSelfReflection(agentsInput.selfReflection),
  };

  const normalizedSkills = enforceGitManagerSkillset(sanitizeSkills(input.skills), git.githubMode);
  const mcpTools = sanitizeMcpTools(input.mcpTools);
  const customMcpServers = sanitizeCustomMcpServersWithDefaults(
    input.customMcpServers,
    DEFAULT_DASHBOARD_SETTINGS.customMcpServers,
  );
  const memory = sanitizeMemory(input);
  const speech = sanitizeSpeech(input);
  const modelPricing = sanitizeModelPricing(input.modelPricing);

  return {
    dashboardPort,
    consoleLogLevel,
    debugLogFileLevel,
    consoleLogMode,
    dbAutoVacuumOnStartup,
    dbPruningEnabled,
    dbRetentionDays,
    restartSprintPolicy,
    restartInvocationPolicy,
    appearance,
    automationLevel: validAutomationLevel,
    automationInterventions,
    aiProvider: {
      provider: aiProvider.provider,
      strategy: aiProvider.strategy,
      providers: buildDashboardProviderSettings(
        aiProvider.providers,
        buildDefaultIntegrationProviders(externalHints),
      ),
      invocationRouting: aiProvider.invocationRouting,
    },
    techstackCatalog,
    techstack,
    designGuidance,
    git,
    jira,
    notion,
    asana,
    linear,
    miro,
    lucid,
    figma,
    mural,
    ciIntelligence,
    guardrails,
    sprintLoopSteps,
    cliWorkflow,
    sprintPreview,
    workers,
    agents,
    skills: normalizedSkills,
    mcpTools,
    customMcpServers,
    memory,
    speech,
    modelPricing,
  };
};
