import type {
  AgentSettings,
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  CliWorkflowSettings,
  DashboardSettings,
  McpToolToggle,
  ProviderId,
  SkillToggle,
  ThinkingMode,
  WorkerSettings,
} from "./app-types.js";
import type { WorkerRuntimeSettings } from "./worker-types.js";

export type { WorkerRuntimeSettings };

export interface ProjectProviderSettings {
  enabled: boolean;
  model: string;
  weight: number;
  thinkingMode: ThinkingMode;
}

export interface ProjectAiProviderSettings {
  provider: ProviderId;
  strategy: DashboardSettings["aiProvider"]["strategy"];
  providers: Record<ProviderId, ProjectProviderSettings>;
}

export interface ProjectGitSettings {
  githubMode: DashboardSettings["git"]["githubMode"];
  defaultBranch: string;
  autoCreatePr: boolean;
  featureBranchPrefix: string;
  sprintBranchScheme: string;
}

export interface ProjectSettings {
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  aiProvider: ProjectAiProviderSettings;
  git: ProjectGitSettings;
  ciIntelligence: CiIntelligenceSettings;
  sprintLoopSteps: DashboardSettings["sprintLoopSteps"];
  cliWorkflow: CliWorkflowSettings;
  workers: WorkerSettings;
  agents: AgentSettings;
  skills: SkillToggle[];
}

export interface SystemRuntimeSettings {
  dashboardPort: number;
  enableDebugLogFile: boolean;
}

export interface SystemIntegrationSettings {
  julesApiKey: string;
  geminiApiKey: string;
  codexApiKey: string;
  claudeCodeApiKey: string;
  githubToken: string;
}

export interface SystemSettings {
  runtime: SystemRuntimeSettings;
  integrations: SystemIntegrationSettings;
  defaults: ProjectSettings;
  mcpTools: McpToolToggle[];
}

export type SettingsOverride<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends Record<string, unknown>
      ? SettingsOverride<T[K]>
      : T[K];
};

export type ProjectSettingsOverride = SettingsOverride<ProjectSettings>;
export type SprintSettingsOverride = SettingsOverride<ProjectSettings>;

export type SettingsValueSource = "system" | "project" | "sprint";

export interface EffectiveSettingsResponse {
  settings: DashboardSettings;
  sources: Record<string, SettingsValueSource>;
}
