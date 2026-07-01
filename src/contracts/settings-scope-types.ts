import type {
  AgentSettings,
  AppearanceSettings,
  AutomationInterventionsSettings,
  AutomationLevel,
  CiIntelligenceSettings,
  CliWorkflowSettings,
  CustomMcpServer,
  GuardrailSettings,
  ProviderConfigId,
  DashboardSettings,
  InvocationProviderOverrideSettings,
  InvocationRoutingId,
  InvocationRoutingProfile,
  ProviderStrategy,
  McpToolToggle,
  ModelPricingSettings,
  ProviderId,
  SprintPreviewSettings,
  SkillToggle,
  ThinkingMode,
  WorkerSettings,
  ConsoleLogMode,
  RuntimeLogLevel,
  JiraSettings,
} from "./app-types.js";
import type { MemorySettings } from "./memory-types.js";
import type { WorkerRuntimeSettings } from "./worker-types.js";

export type { WorkerRuntimeSettings };

export interface ProjectProviderSettings {
  provider: ProviderId;
  name: string;
  enabled: boolean;
  model: string;
  weight: number;
  thinkingMode: ThinkingMode;
  maxConcurrentTasks: number;
}

export interface ProjectAiProviderSettings {
  provider: ProviderConfigId | null;
  strategy: ProviderStrategy;
  providers: Record<ProviderConfigId, ProjectProviderSettings>;
  invocationRouting: Record<InvocationRoutingId, ProjectInvocationRoutingSettings>;
}

export interface ProjectInvocationRoutingSettings {
  profile: InvocationRoutingProfile;
  strategy: ProviderStrategy;
  provider: ProviderConfigId | null;
  allowedProviders: ProviderConfigId[];
  providers: Record<ProviderConfigId, InvocationProviderOverrideSettings>;
}

export interface ProjectGitSettings {
  githubMode: DashboardSettings["git"]["githubMode"];
  githubToken: string;
  gitlabToken: string;
  defaultBranch: string;
  autoCreatePr: boolean;
  autoCloseLinkedIssues: boolean;
  deleteMergedBranches: boolean;
  featureBranchPrefix: string;
  sprintBranchScheme: string;
  sprintKeyPrefix: string;
}

export interface ProjectSettings {
  appearance: AppearanceSettings;
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  aiProvider: ProjectAiProviderSettings;
  git: ProjectGitSettings;
  jira: JiraSettings;
  ciIntelligence: CiIntelligenceSettings;
  guardrails: GuardrailSettings;
  sprintLoopSteps: DashboardSettings["sprintLoopSteps"];
  cliWorkflow: CliWorkflowSettings;
  sprintPreview: SprintPreviewSettings;
  workers: WorkerSettings;
  agents: AgentSettings;
  skills: SkillToggle[];
  mcpTools?: McpToolToggle[];
  customMcpServers?: CustomMcpServer[];
  memory: MemorySettings;
}

export interface SystemRuntimeSettings {
  dashboardPort: number;
  consoleLogLevel: RuntimeLogLevel;
  debugLogFileLevel: RuntimeLogLevel;
  consoleLogMode: ConsoleLogMode;
  lastActiveScope?: "system" | "project";
  dbAutoVacuumOnStartup: boolean;
  dbPruningEnabled: boolean;
  dbRetentionDays: number;
}

export interface SystemProviderCredentialSettings {
  provider: ProviderId;
  name: string;
  apiKey: string;
  mountAuth: boolean;
  authPath: string;
  authType?: "apiKey" | "localAuth" | "dashboardAuth";
  lastLoginAt?: number;
  /** Custom API endpoint base URL for providers that support it (claude-code, codex). */
  customBaseUrl?: string;
  /** Custom model identifier sent to the CLI when routing through a custom base URL (claude-code, codex). */
  customModel?: string;
  /** models.dev provider id selected to autofill customBaseUrl, or a free-typed provider name (claude-code, codex). */
  customProviderId?: string;
  qwenAuthMode?: "LOCAL_AUTH" | "ALIBABA_CODING_PLAN" | "MODEL_PROVIDER";
  qwenRegion?: "china" | "international";
  qwenBaseUrl?: string;
  qwenEnvKey?: string;
  qwenModelId?: string;
  qwenProtocol?: "openai" | "anthropic" | "gemini";
  qwenAdditionalModelProviders?: QwenModelProviderSettings[];
  /** models.dev provider id selected to autofill qwenBaseUrl, or a free-typed provider name. */
  qwenApiProviderId?: string;
  openCodeAuthMode?: "LOCAL_AUTH" | "ENV_KEY" | "CUSTOM_PROVIDER";
  openCodeProviderId?: string;
  openCodeModelId?: string;
  openCodeBaseUrl?: string;
  openCodeEnvKey?: string;
  openCodePackage?: string;
}

export interface SystemIntegrationSettings {
  providers: Record<ProviderConfigId, SystemProviderCredentialSettings>;
  githubToken: string;
  gitlabToken?: string;
  jira: JiraSettings;
}

export interface QwenModelProviderSettings {
  id: string;
  name: string;
  authType: "openai" | "anthropic" | "gemini";
  envKey: string;
  apiKey: string;
  baseUrl: string;
  description?: string;
}

export interface SystemSettings {
  runtime: SystemRuntimeSettings;
  integrations: SystemIntegrationSettings;
  defaults: ProjectSettings;
  mcpTools: McpToolToggle[];
  customMcpServers: CustomMcpServer[];
  modelPricing: ModelPricingSettings;
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
