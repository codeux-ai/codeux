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
import { sanitizeSkills } from "../domain/settings/settings-sanitizers/skills-sanitizer.js";
import { sanitizeSprintPreviewSettings } from "../domain/settings/settings-sanitizers/sprint-preview-sanitizer.js";
import { sanitizeInstructionTemplates, sanitizeQualityAssuranceSettings } from "../domain/settings/settings-sanitizers/agents-sanitizer.js";
import {
  DEFAULT_DASHBOARD_SETTINGS,
} from "./settings-defaults.js";

const sanitizeMcpTools = (value: unknown): McpToolToggle[] => {
  return sanitizeMcpToolToggles(value).map((tool) => ({ ...tool }));
};

export const cloneDefaults = (externalHints?: ExternalSettingsHints): DashboardSettings => ({
  dashboardPort: DEFAULT_DASHBOARD_SETTINGS.dashboardPort,
  enableDebugLogFile: DEFAULT_DASHBOARD_SETTINGS.enableDebugLogFile,
  appearance: { ...DEFAULT_DASHBOARD_SETTINGS.appearance },
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

  const appearanceInput = (input.appearance && typeof input.appearance === "object"
    ? input.appearance
    : {}) as Partial<DashboardSettings["appearance"]>;

  const appearance = {
    navigationMode: appearanceInput.navigationMode === "SIDEBAR" ? "SIDEBAR" : "DOCK" as "DOCK" | "SIDEBAR",
    theme: appearanceInput.theme === "LIGHT" || appearanceInput.theme === "DARK" ? appearanceInput.theme : "SYSTEM" as "LIGHT" | "DARK" | "SYSTEM",
    reducedMotion: appearanceInput.reducedMotion === "REDUCE" || appearanceInput.reducedMotion === "NONE" ? appearanceInput.reducedMotion : "AUTO" as "AUTO" | "REDUCE" | "NONE",
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

  const aiProvider = sanitizeAiProvider(input, externalHints);
  const git = sanitizeGit(input, externalHints);
  const ciIntelligence = sanitizeCiIntelligence(input, git.githubMode);
  const sprintLoopSteps = sanitizeSprintLoopSteps(input);
  const cliWorkflow = sanitizeCliWorkflow(input);
  const sprintPreview = sanitizeSprintPreviewSettings(input.sprintPreview);
  const workers = sanitizeWorkers(input);
  const agentsInput = (input.agents && typeof input.agents === "object")
    ? input.agents as Partial<DashboardSettings["agents"]>
    : {};
  const agents = {
    saveToProjectDirectory: readBoolean(
      agentsInput.saveToProjectDirectory,
      DEFAULT_DASHBOARD_SETTINGS.agents.saveToProjectDirectory,
    ),
    instructionTemplates: sanitizeInstructionTemplates(agentsInput.instructionTemplates),
    qualityAssurance: sanitizeQualityAssuranceSettings(agentsInput.qualityAssurance),
  };

  const normalizedSkills = sanitizeSkills(input.skills, git.githubMode);
  const mcpTools = sanitizeMcpTools(input.mcpTools);
  const memory = sanitizeMemory(input);

  return {
    dashboardPort,
    enableDebugLogFile,
    appearance,
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
