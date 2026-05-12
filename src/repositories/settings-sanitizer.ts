import type {
  DashboardSettings,
  ExternalSettingsHints,
  McpToolToggle,
  SkillToggle,
} from "../contracts/app-types.js";
import { readBoolean, readPort, readString } from "../shared/config/value-readers.js";
import { sanitizeMcpToolToggles } from "../mcp/mcp-tool-availability.js";
import { sanitizeAiProvider } from "../domain/settings/settings-sanitizers/ai-provider-sanitizer.js";
import { sanitizeGit } from "../domain/settings/settings-sanitizers/git-sanitizer.js";
import { sanitizeCiIntelligence } from "../domain/settings/settings-sanitizers/ci-sanitizer.js";
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

export const cloneDefaults = (externalHints?: ExternalSettingsHints): DashboardSettings => ({
  dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
  enableDebugLogFile: DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile,
  consoleLogLevel: DEFAULT_DASHBOARD_SETTINGS.consoleLogLevel,
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
  },
  ciIntelligence: {
    ...DEFAULT_DASHBOARD_SETTINGS.ciIntelligence,
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
    instructionTemplates: { ...DEFAULT_DASHBOARD_SETTINGS.agents.instructionTemplates },
    qualityAssurance: {
      enabled: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.enabled,
      maxTaskReviewRuns: DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.maxTaskReviewRuns,
      taskCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.taskCompletion },
      sprintCompletion: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.sprintCompletion },
      completedTaskWithoutPr: { ...DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.completedTaskWithoutPr },
    },
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
  memory: { ...DEFAULT_DASHBOARD_SETTINGS.memory },
});

export const sanitizeSettings = (value: unknown, externalHints?: ExternalSettingsHints): DashboardSettings => {
  const input = (value && typeof value === "object" ? value : {}) as Partial<DashboardSettings>;
  const dashboardPort = readPort(input.dashboardPort, DEFAULT_DASHBOARD_SETTINGS.dashboardPort);
  const enableDebugLogFile = readBoolean(input.enableDebugLogFile, DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile);
  const consoleLogLevel = input.consoleLogLevel === "full" ? "full" : DEFAULT_DASHBOARD_SETTINGS.consoleLogLevel;

  const appearanceInput = (input.appearance && typeof input.appearance === "object"
    ? input.appearance
    : {}) as Partial<DashboardSettings["appearance"]>;

  const appearance = {
    navigationMode: appearanceInput.navigationMode === "SIDEBAR" ? "SIDEBAR" : "DOCK" as "DOCK" | "SIDEBAR",
    theme: appearanceInput.theme === "LIGHT" || appearanceInput.theme === "DARK" ? appearanceInput.theme : "SYSTEM" as "LIGHT" | "DARK" | "SYSTEM",
    reducedMotion: appearanceInput.reducedMotion === "REDUCE" || appearanceInput.reducedMotion === "NONE" ? appearanceInput.reducedMotion : "AUTO" as "AUTO" | "REDUCE" | "NONE",
    backgroundMode: appearanceInput.backgroundMode === "STATIC" ? "STATIC" : "ANIMATED" as "ANIMATED" | "STATIC",
    animatedBackground: typeof appearanceInput.animatedBackground === "string" ? appearanceInput.animatedBackground : "deep-ocean",
    staticBackgroundColor: typeof appearanceInput.staticBackgroundColor === "string" ? appearanceInput.staticBackgroundColor : "#0d0f12",
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
  const ciIntelligence = sanitizeCiIntelligence(input, git.githubMode);
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
    instructionTemplates: {
      ...DEFAULT_DASHBOARD_SETTINGS.agents.instructionTemplates,
      ...(agentsInput.instructionTemplates && typeof agentsInput.instructionTemplates === "object"
        ? Object.fromEntries(
            Object.entries(agentsInput.instructionTemplates).filter(([, value]) => typeof value === "string"),
          )
        : {}),
    },
    qualityAssurance: {
      enabled: readBoolean(
        (agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined)?.enabled,
        DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.enabled,
      ),
      maxTaskReviewRuns: Math.max(1, Math.min(10,
        typeof (agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined)?.maxTaskReviewRuns === "number"
          && Number.isFinite((agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined)?.maxTaskReviewRuns)
            ? Math.round((agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined)!.maxTaskReviewRuns!)
            : DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.maxTaskReviewRuns
      )),
      taskCompletion: sanitizeQualityAssuranceTrigger(
        (agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined)?.taskCompletion,
        DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.taskCompletion,
      ),
      sprintCompletion: sanitizeQualityAssuranceTrigger(
        (agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined)?.sprintCompletion,
        DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.sprintCompletion,
      ),
      completedTaskWithoutPr: sanitizeQualityAssuranceTrigger(
        (agentsInput.qualityAssurance as Partial<DashboardSettings["agents"]["qualityAssurance"]> | undefined)?.completedTaskWithoutPr,
        DEFAULT_DASHBOARD_SETTINGS.agents.qualityAssurance.completedTaskWithoutPr,
      ),
    },
  };

  const normalizedSkills = enforceGitManagerSkillset(sanitizeSkills(input.skills), git.githubMode);
  const mcpTools = sanitizeMcpTools(input.mcpTools);
  const memory = sanitizeMemory(input);

  return {
    dashboardPort,
    enableDebugLogFile,
    consoleLogLevel,
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
    ciIntelligence,
    sprintLoopSteps,
    cliWorkflow,
    sprintPreview,
    workers,
    agents,
    skills: normalizedSkills,
    mcpTools,
    memory,
  };
};
