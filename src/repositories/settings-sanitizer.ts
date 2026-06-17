import type {
  BackgroundPattern,
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  RuntimeLogLevel,
  ConsoleLogMode,
  SkillToggle,
} from "../contracts/app-types.js";
import { readBoolean, readPort, readString } from "../shared/config/value-readers.js";
import { sanitizeCustomMcpServers, sanitizeMcpToolToggles } from "../mcp/mcp-tool-availability.js";
import { sanitizeAiProvider } from "../domain/settings/settings-sanitizers/ai-provider-sanitizer.js";
import { sanitizeGit } from "../domain/settings/settings-sanitizers/git-sanitizer.js";
import { sanitizeJira } from "../domain/settings/settings-sanitizers/jira-sanitizer.js";
import { sanitizeCiIntelligence } from "../domain/settings/settings-sanitizers/ci-sanitizer.js";
import { sanitizeGuardrails } from "../domain/settings/settings-sanitizers/guardrails-sanitizer.js";
import { sanitizeSprintLoopSteps } from "../domain/settings/settings-sanitizers/sprint-loop-sanitizer.js";
import { sanitizeCliWorkflow } from "../domain/settings/settings-sanitizers/cli-workflow-sanitizer.js";
import { sanitizeWorkers } from "../domain/settings/settings-sanitizers/worker-sanitizer.js";
import { sanitizeMemory } from "../domain/settings/settings-sanitizers/memory-sanitizer.js";
import {
  buildDashboardProviderSettings,
  buildDefaultIntegrationProviders,
} from "../domain/settings/provider-config-utils.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
  DEFAULT_SKILLS,
  INTERNAL_SKILL_NAMES,
  INTERNAL_SKILL_SET,
  QA_EXHAUSTION_POLICIES,
} from "./settings-defaults.js";

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

const readRuntimeLogLevel = (value: unknown, fallback: RuntimeLogLevel): RuntimeLogLevel => (
  typeof value === "string" && RUNTIME_LOG_LEVEL_SET.has(value as RuntimeLogLevel)
    ? value as RuntimeLogLevel
    : fallback
);

const readConsoleLogMode = (value: unknown, fallback: ConsoleLogMode): ConsoleLogMode => (
  value === "full" ? "full" : fallback
);

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

const sanitizeQualityAssuranceTrigger = (
  value: unknown,
  defaults: DashboardSettings["agents"]["qualityAssurance"]["taskCompletion"],
): DashboardSettings["agents"]["qualityAssurance"]["taskCompletion"] => {
  const input = value && typeof value === "object" ? value as Partial<DashboardSettings["agents"]["qualityAssurance"]["taskCompletion"]> : {};

  return {
    enabled: readBoolean(input.enabled, defaults.enabled),
    agentPresetId: readString(input.agentPresetId, "").trim() || null,
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
  git: {
    ...DEFAULT_DASHBOARD_SETTINGS.git,
    githubToken: externalHints?.resolved.githubToken || DEFAULT_DASHBOARD_SETTINGS.git.githubToken,
    gitlabToken: externalHints?.resolved.gitlabToken || DEFAULT_DASHBOARD_SETTINGS.git.gitlabToken,
  },
  jira: {
    ...DEFAULT_DASHBOARD_SETTINGS.jira,
    apiToken: externalHints?.resolved?.jiraToken || DEFAULT_DASHBOARD_SETTINGS.jira.apiToken,
  },
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
      taskCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.taskCompletion },
      sprintCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.sprintCompletion },
      completedTaskWithoutPr: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.completedTaskWithoutPr },
    },
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
  customMcpServers: DEFAULT_DASHBOARD_SETTINGS.customMcpServers.map((server) => ({ ...server })),
  memory: { ...DEFAULT_DASHBOARD_SETTINGS.memory },
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

  const appearanceInput = (input.appearance && typeof input.appearance === "object"
    ? input.appearance
    : {}) as Partial<DashboardSettings["appearance"]>;

  const rawZoom = typeof appearanceInput.zoomLevel === "number" && Number.isFinite(appearanceInput.zoomLevel)
    ? appearanceInput.zoomLevel
    : DEFAULT_DASHBOARD_SETTINGS.appearance.zoomLevel;
  const appearance = {
    navigationMode: appearanceInput.navigationMode === "SIDEBAR" ? "SIDEBAR" : "DOCK" as "DOCK" | "SIDEBAR",
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
  const git = sanitizeGit(input, externalHints);
  const jira = sanitizeJira(input.jira, DEFAULT_DASHBOARD_SETTINGS.jira);
  if (externalHints?.resolved?.jiraToken) {
    jira.apiToken = externalHints.resolved.jiraToken;
  }
  const ciIntelligence = sanitizeCiIntelligence(input, git.githubMode);
  const guardrails = sanitizeGuardrails(input);
  const sprintLoopSteps = sanitizeSprintLoopSteps(input);
  const cliWorkflow = sanitizeCliWorkflow(input);
  const sprintPreviewInput = (input.sprintPreview && typeof input.sprintPreview === "object"
    ? input.sprintPreview
    : {}) as Partial<DashboardSettings["sprintPreview"]>;
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
    containerAppPort: Math.max(1, Math.min(65535,
      typeof sprintPreviewInput.containerAppPort === "number" && Number.isFinite(sprintPreviewInput.containerAppPort)
        ? Math.round(sprintPreviewInput.containerAppPort)
        : DEFAULT_DASHBOARD_SETTINGS.sprintPreview.containerAppPort
    )),
    startupScriptPath: readString(
      sprintPreviewInput.startupScriptPath,
      DEFAULT_DASHBOARD_SETTINGS.sprintPreview.startupScriptPath,
    ).trim() || DEFAULT_DASHBOARD_SETTINGS.sprintPreview.startupScriptPath,
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
  };

  const normalizedSkills = enforceGitManagerSkillset(sanitizeSkills(input.skills), git.githubMode);
  const mcpTools = sanitizeMcpTools(input.mcpTools);
  const customMcpServers = sanitizeCustomMcpServers(input.customMcpServers);
  const memory = sanitizeMemory(input);

  return {
    dashboardPort,
    consoleLogLevel,
    debugLogFileLevel,
    consoleLogMode,
    dbAutoVacuumOnStartup,
    dbPruningEnabled,
    dbRetentionDays,
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
    git,
    jira,
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
  };
};
