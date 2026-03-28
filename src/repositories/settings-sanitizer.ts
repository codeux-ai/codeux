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

export const cloneDefaults = (externalHints?: ExternalSettingsHints): DashboardSettings => ({
  dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
  enableDebugLogFile: DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile,
  automationLevel: DEFAULT_DASHBOARD_SETTINGS.automationLevel,
  automationInterventions: {
    ...DEFAULT_DASHBOARD_SETTINGS.automationInterventions,
  },
  aiProvider: {
    ...DEFAULT_DASHBOARD_SETTINGS.aiProvider,
    providers: {
      jules: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules,
        apiKey: externalHints?.resolved.julesApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.jules.apiKey,
      },
      gemini: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini,
        apiKey: externalHints?.resolved.geminiApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.gemini.apiKey,
      },
      codex: {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex,
        apiKey: externalHints?.resolved.codexApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers.codex.apiKey,
      },
      "claude-code": {
        ...DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"],
        apiKey: externalHints?.resolved.claudeCodeApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.providers["claude-code"].apiKey,
      },
    },
    julesApiKey: externalHints?.resolved.julesApiKey || DEFAULT_DASHBOARD_SETTINGS.aiProvider.julesApiKey,
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
  },
  skills: DEFAULT_DASHBOARD_SETTINGS.skills.map((skill) => ({ ...skill })),
  mcpTools: DEFAULT_DASHBOARD_SETTINGS.mcpTools.map((tool) => ({ ...tool })),
  memory: { ...DEFAULT_DASHBOARD_SETTINGS.memory },
});

export const sanitizeSettings = (value: unknown, externalHints?: ExternalSettingsHints): DashboardSettings => {
  const input = (value && typeof value === "object" ? value : {}) as Partial<DashboardSettings>;
  const dashboardPort = readPort(input.dashboardPort, DEFAULT_DASHBOARD_SETTINGS.dashboardPort);
  const enableDebugLogFile = readBoolean(input.enableDebugLogFile, DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile);
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

  const aiProvider = sanitizeAiProvider(input, externalHints);
  const git = sanitizeGit(input, externalHints);
  const ciIntelligence = sanitizeCiIntelligence(input, git.githubMode);
  const sprintLoopSteps = sanitizeSprintLoopSteps(input);
  const cliWorkflow = sanitizeCliWorkflow(input);
  const sprintPreviewInput = (input.sprintPreview && typeof input.sprintPreview === "object"
    ? input.sprintPreview
    : {}) as Partial<DashboardSettings["sprintPreview"]>;
  const sprintPreview = {
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
  const workers = sanitizeWorkers(input);
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
  };

  const normalizedSkills = enforceGitManagerSkillset(sanitizeSkills(input.skills), git.githubMode);
  const mcpTools = sanitizeMcpTools(input.mcpTools);
  const memory = sanitizeMemory(input);

  return {
    dashboardPort,
    enableDebugLogFile,
    automationLevel: validAutomationLevel,
    automationInterventions,
    aiProvider,
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
