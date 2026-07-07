import type {
  CliExecutionMode,
  DashboardSettings,
  DashboardExperienceMode,
  FeaturePrAutoMergeMode,
  GuardrailJobType,
  GuardrailOnLimitAction,
  ExternalImporterProvider,
  ExternalImporterSettings,
  QaExhaustionPolicy,
  InvocationRoutingId,
  InvocationRoutingProfile,
  InvocationRoutingSettings,
  PrDescriptionSettings,
  ProviderConfigId,
  ProviderId,
  ProviderSettings,
  ProviderStrategy,
  SkillToggle,
  TechstackCatalogEntrySettings,
  TechstackCatalogSettings,
  TechstackSelectionSettings,
  VirtualWorkerProvider,
  WorkerExecutionMode,
  ThinkingMode,
} from "../contracts/app-types.js";
import { DEFAULT_SPRINT_BRANCH_SCHEME } from "../domain/sprint/branch-name-generator.js";
import { DEFAULT_TASK_PR_TITLE_SCHEME } from "../domain/git/task-pr-title-template.js";
import { DEFAULT_TASK_SECTION_ORDER, DEFAULT_SPRINT_SECTION_ORDER } from "../domain/sprint/composer/pr-description-composer.js";
import { DEFAULT_INSTRUCTION_TEMPLATES } from "../instructions/instruction-template-catalog.js";
import { DEFAULT_MCP_TOOL_TOGGLES } from "../mcp/mcp-tool-availability.js";

export const INTERNAL_SKILL_NAMES = [
  "git_manager",
  "git_manager_remote",
  "git_manager_local",
] as const;

export const INTERNAL_SKILL_SET = new Set<string>(INTERNAL_SKILL_NAMES);

export const DEFAULT_SKILLS: SkillToggle[] = INTERNAL_SKILL_NAMES.map((name) => ({
  name,
  enabled: name === "git_manager_local" ? false : true,
  isInternal: true,
}));

export const BUILTIN_CODE_UX_TECHSTACK_ID = "code-ux-internal";

export const BUILTIN_CODE_UX_TECHSTACK: TechstackCatalogEntrySettings = {
  id: BUILTIN_CODE_UX_TECHSTACK_ID,
  label: "Code UX Stack",
  items: [
    { id: "preact", label: "Preact" },
    { id: "tanstack-router", label: "TanStack Router" },
    { id: "gsap", label: "GSAP" },
    { id: "three-js", label: "Three.js" },
    { id: "lucide-icons", label: "Lucide Icons" },
  ],
};

export const DEFAULT_TECHSTACK_CATALOG: TechstackCatalogSettings = {
  defaultTechstackId: BUILTIN_CODE_UX_TECHSTACK_ID,
  entries: [
    {
      ...BUILTIN_CODE_UX_TECHSTACK,
      items: BUILTIN_CODE_UX_TECHSTACK.items.map((item) => ({ ...item })),
    },
  ],
};

export const DEFAULT_PROJECT_TECHSTACK: TechstackSelectionSettings = {
  selectedTechstackId: null,
  applicationKind: null,
};

export const DEFAULT_PR_DESCRIPTION_SETTINGS: PrDescriptionSettings = {
  task: {
    summary: true,
    modelAndProvider: true,
    timing: true,
    fullPrompt: true,
    tokenUsage: true,
    qaFindings: true,
    branchInfo: true,
  },
  sprint: {
    summary: true,
    taskChecklist: true,
    providerBreakdown: true,
    planningModel: true,
    mainPrompt: true,
    timing: true,
    tokenUsage: true,
    qaFindings: true,
    branchInfo: true,
  },
  taskSectionOrder: [...DEFAULT_TASK_SECTION_ORDER],
  sprintSectionOrder: [...DEFAULT_SPRINT_SECTION_ORDER],
};

export const PROVIDER_IDS: ProviderId[] = ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity", "mockup-cli"];
export const PUBLIC_PROVIDER_IDS: ProviderId[] = ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"];
export const THINKING_MODES: ThinkingMode[] = ["SMALL", "MEDIUM", "HIGH"];
export const PROVIDER_STRATEGIES: ProviderStrategy[] = ["MANUAL", "WEIGHTED", "AGENT"];
export const INVOCATION_ROUTING_PROFILES: InvocationRoutingProfile[] = ["GLOBAL", "WORKER"];
export const INVOCATION_ROUTING_IDS: InvocationRoutingId[] = [
  "task_coding",
  "planning",
  "dashboard_reply",
  "clarification_reply",
  "qa_review",
  "ci_fix",
  "merge_conflict",
  "remediation",
];
export const CLI_EXECUTION_MODES: CliExecutionMode[] = ["DOCKER", "HOST"];
export const FEATURE_PR_AUTOMERGE_MODES: FeaturePrAutoMergeMode[] = ["OFF", "CREATE_PR", "WHEN_GREEN", "ALWAYS"];
export const WORKER_EXECUTION_MODES: WorkerExecutionMode[] = ["VIRTUAL"];
export const VIRTUAL_WORKER_PROVIDERS: VirtualWorkerProvider[] = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity", "mockup-cli"];
export const PUBLIC_VIRTUAL_WORKER_PROVIDERS: VirtualWorkerProvider[] = ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"];
export const RUNTIME_LOG_LEVELS = ["off", "debug", "info", "warn", "error"] as const;
export const CONSOLE_LOG_MODES = ["standard", "full"] as const;
export const EXTERNAL_IMPORTER_PROVIDERS: ExternalImporterProvider[] = ["notion", "asana", "linear", "miro", "lucid", "figma", "mural"];
export const DASHBOARD_EXPERIENCE_MODES: DashboardExperienceMode[] = ["EASY", "STANDARD", "EXPERT"];
export const DEFAULT_DASHBOARD_EXPERIENCE_MODE: DashboardExperienceMode = "EXPERT";
export const DEFAULT_IMPORTER_SEARCH_LIMIT = 25;
export const DEFAULT_PROVIDER_CONFIG_IDS: Record<ProviderId, ProviderConfigId> = {
  jules: "jules",
  gemini: "gemini",
  codex: "codex",
  "claude-code": "claude-code",
  "qwen-code": "qwen-code",
  opencode: "opencode",
  antigravity: "antigravity",
  "mockup-cli": "mockup-cli",
};

export const DEFAULT_PLAYWRIGHT_MCP_SERVER_ID = "playwright";

export const DEFAULT_PLAYWRIGHT_MCP_SERVER = {
  id: DEFAULT_PLAYWRIGHT_MCP_SERVER_ID,
  name: "playwright",
  label: "Playwright",
  description: "Browser automation MCP server for coding agents.",
  enabled: true,
  transport: "stdio",
  command: "npx",
  args: ["@playwright/mcp@latest"],
  providers: ["gemini", "codex", "claude-code", "qwen-code", "opencode", "antigravity"],
} satisfies DashboardSettings["customMcpServers"][number];
export const DEFAULT_PROVIDER_CONFIG_NAMES: Record<ProviderId, string> = {
  jules: "Jules Primary",
  gemini: "Gemini Primary",
  codex: "Codex Primary",
  "claude-code": "Claude Primary",
  "qwen-code": "Qwen Primary",
  opencode: "OpenCode Primary",
  antigravity: "Antigravity Primary",
  "mockup-cli": "Mockup CLI",
};
export const DEFAULT_PROVIDER_AUTH_PATHS: Record<ProviderId, string> = {
  jules: "",
  gemini: "~/.gemini",
  codex: "~/.codex",
  "claude-code": "~/.claude",
  "qwen-code": "~/.qwen",
  opencode: "~/.local/share/opencode",
  antigravity: "~/.antigravity",
  "mockup-cli": "",
};

export const DEFAULT_PROVIDER_CONFIG_FILE_PATHS: Record<ProviderId, string> = {
  jules: "",
  gemini: "~/.gemini/settings.json",
  codex: "~/.codex/config.toml",
  "claude-code": "~/.claude.json",
  "qwen-code": "~/.qwen/settings.json",
  opencode: "~/.config/opencode/opencode.json",
  antigravity: "~/.gemini/antigravity-cli/mcp_config.json",
  "mockup-cli": "",
};

// AI Models catalog — available model identifiers per virtual worker provider
export const GEMINI_MODELS: string[] = [
  "auto",
  "pro",
  "flash",
  "flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-3.1-pro-preview",
  "gemini-3.1-pro-preview-customtools",
  "gemini-3.1-flash-lite-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemma-4-31b-it",
  "gemma-4-26b-a4b-it",
  "gemini-2.5-flash-base",
  "gemini-3-flash-base",
];

export const CLAUDE_MODELS: string[] = [
  "default",
  "sonnet",
  "opus",
  "haiku",
  "sonnet[1m]",
  "opus[1m]",
  "opusplan",
  "claude-opus-4-6",
  "claude-opus-4-7",
  "claude-opus-4-8",
  "claude-sonnet-4-6",
  "claude-sonnet-5",
  "claude-haiku-4-5-20251001",
  "claude-fable-5",
  "claude-mythos-5",
];

export const CODEX_MODELS: string[] = [
  "gpt-5.5",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-5.6-luna",
  "gpt-5.4",
  "gpt-5.4-mini",
  "gpt-5.3-codex",
  "gpt-5.3-codex-spark",
  "gpt-5.2-codex",
  "gpt-5.2",
  "gpt-5.1-codex-max",
  "gpt-5.1",
  "gpt-5.1-codex",
  "gpt-5-codex",
  "gpt-5-codex-mini",
  "gpt-5",
];

export const QWEN_MODELS: string[] = [
  "qwen3-coder-plus",
  "qwen3.5-plus",
  "qwen3-coder-next",
  "qwen3-max",
  "qwen3-max-2026-01-23",
  "qwen-plus",
  "qwen-max",
];

export const OPENCODE_MODELS: string[] = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-opus-4-1",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "github-copilot/gpt-5",
  "openrouter/anthropic/claude-sonnet-4.5",
];

export const ANTIGRAVITY_MODELS: string[] = [
  "default",
  "gemini-3.5-flash",
  "gemini-3.1-pro-high",
  "gemini-3.1-pro-low",
  "gemini-3-flash",
  "claude-sonnet-4.6-thinking",
  "claude-opus-4.6-thinking",
  "gpt-oss-120b",
];

export const AI_MODEL_CATALOG: Record<string, string[]> = {
  gemini: GEMINI_MODELS,
  "claude-code": CLAUDE_MODELS,
  codex: CODEX_MODELS,
  "qwen-code": QWEN_MODELS,
  opencode: OPENCODE_MODELS,
  antigravity: ANTIGRAVITY_MODELS,
  "mockup-cli": ["default"],
};

export const DEFAULT_VIRTUAL_WORKER_MODELS: Record<string, string> = {
  gemini: "auto",
  "claude-code": "default",
  codex: "gpt-5.5",
  "qwen-code": "qwen3-coder-plus",
  opencode: "anthropic/claude-sonnet-4-5",
  antigravity: "default",
  "mockup-cli": "default",
};

export const MIN_WATCH_LOOP_INTERVAL_SECONDS = 1;
export const MAX_WATCH_LOOP_INTERVAL_SECONDS = 3600;
export const MIN_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS = 60;
export const MAX_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS = 3600;
export const MIN_JULES_CI_AUTOFIX_RETRIES = 0;
export const MAX_JULES_CI_AUTOFIX_RETRIES = 20;

export const MIN_GUARDRAIL_CAP = 0;
export const MAX_GUARDRAIL_CAP = 100;
export const MIN_GUARDRAIL_TOTAL_CEILING = 0;
export const MAX_GUARDRAIL_TOTAL_CEILING = 500;
export const GUARDRAIL_JOB_TYPES: GuardrailJobType[] = [
  "task_coding",
  "ci_fix",
  "merge_conflict",
  "clarification_reply",
  "planning",
  "remediation",
];
export const GUARDRAIL_ON_LIMIT_ACTIONS: GuardrailOnLimitAction[] = [
  "BLOCK_AND_ESCALATE",
  "STOP_AND_WAIT",
  "WARN_ONLY",
];
export const QA_EXHAUSTION_POLICIES: QaExhaustionPolicy[] = [
  "ESCALATE_TO_HUMAN",
  "FAIL_TASK",
  "FINISH_TASK",
];

const DEFAULT_SELF_REFLECTION_CRITERIA: DashboardSettings["agents"]["selfReflection"]["planning"]["criteria"] = [
  {
    id: "correctness",
    label: "Correctness",
    prompt: "The plan or review accurately addresses the requested behavior and repository facts.",
    threshold: 0.85,
  },
  {
    id: "completeness",
    label: "Completeness",
    prompt: "The response covers all required deliverables, edge cases, and verification expectations.",
    threshold: 0.85,
  },
  {
    id: "decomposition_quality",
    label: "Decomposition quality",
    prompt: "Work is broken into coherent, dependency-aware steps with clear ownership boundaries.",
    threshold: 0.8,
  },
  {
    id: "risk_handling",
    label: "Risk handling",
    prompt: "Important technical, operational, and rollback risks are identified and handled.",
    threshold: 0.8,
  },
  {
    id: "testability",
    label: "Testability",
    prompt: "The proposed work can be validated with focused deterministic checks.",
    threshold: 0.8,
  },
  {
    id: "maintainability",
    label: "Maintainability",
    prompt: "The approach preserves local architecture and avoids unnecessary complexity.",
    threshold: 0.8,
  },
  {
    id: "security",
    label: "Security",
    prompt: "The approach avoids weakening validation, secrets handling, permissions, and auditability.",
    threshold: 0.85,
  },
  {
    id: "scope_control",
    label: "Scope control",
    prompt: "The work stays within the task contract and avoids unrelated behavior changes.",
    threshold: 0.85,
  },
];

export const DEFAULT_AGENT_SELF_REFLECTION: DashboardSettings["agents"]["selfReflection"] = {
  planning: {
    enabled: false,
    criteria: DEFAULT_SELF_REFLECTION_CRITERIA.map((criterion) => ({ ...criterion })),
    maxImprovementAttempts: 1,
  },
  qualityAssurance: {
    enabled: false,
    criteria: DEFAULT_SELF_REFLECTION_CRITERIA.map((criterion) => ({ ...criterion })),
    maxImprovementAttempts: 1,
  },
};
/** Fallback cap used when migrating the legacy hardcoded clarification auto-answer limit. */
export const LEGACY_CLARIFICATION_RETRY_CAP = 3;

export const DEFAULT_PROVIDER_WEIGHT = 50;

export const createDefaultExternalImporterSettings = (): ExternalImporterSettings => ({
  enabled: false,
  apiToken: "",
  apiSecret: "",
  baseUrl: "",
  workspaceId: "",
  teamId: "",
  teamKey: "",
  projectId: "",
  databaseId: "",
  boardId: "",
  documentId: "",
  fileKey: "",
  defaultSearchLimit: DEFAULT_IMPORTER_SEARCH_LIMIT,
});

export const DEFAULT_PROVIDER_SETTINGS: Record<ProviderId, ProviderSettings> = {
  jules: {
    provider: "jules",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.jules,
    enabled: true,
    model: "default",
    weight: DEFAULT_PROVIDER_WEIGHT,
    thinkingMode: "MEDIUM",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.jules,
    providerConfigMode: "none",
    providerConfigPath: "",
    maxConcurrentTasks: 15,
  },
  gemini: {
    provider: "gemini",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.gemini,
    enabled: true,
    model: "default",
    weight: DEFAULT_PROVIDER_WEIGHT,
    thinkingMode: "MEDIUM",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.gemini,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.gemini,
    maxConcurrentTasks: 0,
  },
  codex: {
    provider: "codex",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.codex,
    enabled: true,
    model: "gpt-5.5",
    weight: DEFAULT_PROVIDER_WEIGHT,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.codex,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.codex,
    maxConcurrentTasks: 0,
  },
  "claude-code": {
    provider: "claude-code",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["claude-code"],
    enabled: false,
    model: "default",
    weight: DEFAULT_PROVIDER_WEIGHT,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["claude-code"],
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS["claude-code"],
    maxConcurrentTasks: 0,
  },
  "qwen-code": {
    provider: "qwen-code",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["qwen-code"],
    enabled: false,
    model: "qwen3-coder-plus",
    weight: DEFAULT_PROVIDER_WEIGHT,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["qwen-code"],
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS["qwen-code"],
    maxConcurrentTasks: 0,
  },
  opencode: {
    provider: "opencode",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.opencode,
    enabled: false,
    model: "anthropic/claude-sonnet-4-5",
    weight: DEFAULT_PROVIDER_WEIGHT,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.opencode,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.opencode,
    maxConcurrentTasks: 0,
  },
  antigravity: {
    provider: "antigravity",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.antigravity,
    enabled: false,
    model: "default",
    weight: DEFAULT_PROVIDER_WEIGHT,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.antigravity,
    providerConfigMode: "copyHost",
    providerConfigPath: DEFAULT_PROVIDER_CONFIG_FILE_PATHS.antigravity,
    maxConcurrentTasks: 0,
  },
  "mockup-cli": {
    provider: "mockup-cli",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["mockup-cli"],
    enabled: false,
    model: "default",
    weight: 0,
    thinkingMode: "MEDIUM",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["mockup-cli"],
    providerConfigMode: "none",
    providerConfigPath: "",
    maxConcurrentTasks: 0,
  },
};

export const createDefaultProviderSettings = (
  providerId: ProviderId,
  name = DEFAULT_PROVIDER_CONFIG_NAMES[providerId],
): ProviderSettings => ({
  ...DEFAULT_PROVIDER_SETTINGS[providerId],
  provider: providerId,
  name,
});

export const buildDefaultProviderSettingsMap = (): Record<ProviderConfigId, ProviderSettings> => ({
  [DEFAULT_PROVIDER_CONFIG_IDS.jules]: createDefaultProviderSettings("jules"),
  [DEFAULT_PROVIDER_CONFIG_IDS.gemini]: createDefaultProviderSettings("gemini"),
  [DEFAULT_PROVIDER_CONFIG_IDS.codex]: createDefaultProviderSettings("codex"),
  [DEFAULT_PROVIDER_CONFIG_IDS["claude-code"]]: createDefaultProviderSettings("claude-code"),
  [DEFAULT_PROVIDER_CONFIG_IDS["qwen-code"]]: createDefaultProviderSettings("qwen-code"),
  [DEFAULT_PROVIDER_CONFIG_IDS.opencode]: createDefaultProviderSettings("opencode"),
  [DEFAULT_PROVIDER_CONFIG_IDS.antigravity]: createDefaultProviderSettings("antigravity"),
  [DEFAULT_PROVIDER_CONFIG_IDS["mockup-cli"]]: createDefaultProviderSettings("mockup-cli"),
});

export const DEFAULT_INVOCATION_ROUTING: Record<InvocationRoutingId, InvocationRoutingSettings> = {
  task_coding: {
    profile: "GLOBAL",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
  planning: {
    profile: "WORKER",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
  dashboard_reply: {
    profile: "WORKER",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
  clarification_reply: {
    profile: "WORKER",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
  qa_review: {
    profile: "WORKER",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
  ci_fix: {
    profile: "WORKER",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
  merge_conflict: {
    profile: "WORKER",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
  remediation: {
    profile: "WORKER",
    strategy: "MANUAL",
    provider: null,
    allowedProviders: [],
    providers: {},
  },
};

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  dashboardPort: 4444,
  consoleLogLevel: "info",
  debugLogFileLevel: "error",
  consoleLogMode: "standard",
  dbAutoVacuumOnStartup: true,
  dbPruningEnabled: true,
  dbRetentionDays: 14,
  restartSprintPolicy: "continue",
  restartInvocationPolicy: "continue",
  appearance: {
    navigationMode: "SIDEBAR",
    experienceMode: DEFAULT_DASHBOARD_EXPERIENCE_MODE,
    theme: "SYSTEM",
    reducedMotion: "AUTO",
    backgroundMode: "ANIMATED",
    animatedBackground: "deep-ocean",
    staticBackgroundColor: "#0d0f12",
    backgroundPattern: "NONE",
    zoomLevel: 1,
  },
  automationLevel: "SEMI_AUTO",
  automationInterventions: {
    autoApprovePlan: true,
    autoAnswerClarification: false,
    autoAnswerClarificationMode: "TEMPLATE",
    autoResumePaused: false,
    clarificationAnswerTemplate: "Proceed with the safest implementation path using repository conventions. If multiple valid options exist, choose the smallest-scope option and continue without waiting for clarification.",
    clarificationCooldownSeconds: 300,
  },
  aiProvider: {
    provider: DEFAULT_PROVIDER_CONFIG_IDS.jules,
    strategy: "MANUAL",
    providers: buildDefaultProviderSettingsMap(),
    invocationRouting: {
      task_coding: { ...DEFAULT_INVOCATION_ROUTING.task_coding, allowedProviders: [], providers: {} },
      planning: { ...DEFAULT_INVOCATION_ROUTING.planning, allowedProviders: [], providers: {} },
      dashboard_reply: { ...DEFAULT_INVOCATION_ROUTING.dashboard_reply, allowedProviders: [], providers: {} },
      clarification_reply: { ...DEFAULT_INVOCATION_ROUTING.clarification_reply, allowedProviders: [], providers: {} },
      qa_review: { ...DEFAULT_INVOCATION_ROUTING.qa_review, allowedProviders: [], providers: {} },
      ci_fix: { ...DEFAULT_INVOCATION_ROUTING.ci_fix, allowedProviders: [], providers: {} },
      merge_conflict: { ...DEFAULT_INVOCATION_ROUTING.merge_conflict, allowedProviders: [], providers: {} },
      remediation: { ...DEFAULT_INVOCATION_ROUTING.remediation, allowedProviders: [], providers: {} },
    },
  },
  techstackCatalog: {
    defaultTechstackId: DEFAULT_TECHSTACK_CATALOG.defaultTechstackId,
    entries: DEFAULT_TECHSTACK_CATALOG.entries.map((entry) => ({
      ...entry,
      items: entry.items.map((item) => ({ ...item })),
    })),
  },
  techstack: { ...DEFAULT_PROJECT_TECHSTACK },
  git: {
    githubMode: "REMOTE",
    githubToken: "",
    gitlabToken: "",
    defaultBranch: "main",
    autoCreatePr: true,
    autoCloseLinkedIssues: false,
    deleteMergedBranches: true,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: DEFAULT_SPRINT_BRANCH_SCHEME,
    sprintKeyPrefix: "SPR",
    taskPrTitleScheme: DEFAULT_TASK_PR_TITLE_SCHEME,
    prDescription: DEFAULT_PR_DESCRIPTION_SETTINGS,
  },
  jira: {
    host: "",
    email: "",
    apiToken: "",
    autoTransitionLinkedIssuesOnImport: true,
    importTransitionName: "In Work",
    autoCloseLinkedIssues: false,
    defaultProject: "",
    closeTransitionName: "Done",
  },
  notion: createDefaultExternalImporterSettings(),
  asana: createDefaultExternalImporterSettings(),
  linear: createDefaultExternalImporterSettings(),
  miro: createDefaultExternalImporterSettings(),
  lucid: createDefaultExternalImporterSettings(),
  figma: createDefaultExternalImporterSettings(),
  mural: createDefaultExternalImporterSettings(),
  ciIntelligence: {
    enabled: true,
    enableLivePrMonitoring: true,
    resolveAllCommentsBeforeMainMerge: true,
    resolveMainMergeConflicts: true,
    resolveMainMergeFailedChecks: true,
    resolveAllCommentsBeforeFeatureMerge: true,
    resolveMergeConflicts: true,
    waitForJulesCiAutofix: false,
    julesCiAutofixMaxRetries: 3,
    featurePrAutoMergeMode: "ALWAYS",
    mainBranchAutoMergeMode: "ALWAYS",
  },
  guardrails: {
    enabled: true,
    perTaskTotalCeiling: 0,
    jobs: {
      task_coding: { cap: 8, onLimit: "BLOCK_AND_ESCALATE" },
      ci_fix: { cap: 3, onLimit: "BLOCK_AND_ESCALATE" },
      merge_conflict: { cap: 3, onLimit: "BLOCK_AND_ESCALATE" },
      clarification_reply: { cap: 3, onLimit: "STOP_AND_WAIT" },
      planning: { cap: 5, onLimit: "BLOCK_AND_ESCALATE" },
      remediation: { cap: 2, onLimit: "BLOCK_AND_ESCALATE" },
    },
  },
  sprintLoopSteps: {
    branchPreflight: true,
    planningPreflight: true,
    loadSubtasks: true,
    sessionSync: true,
    statusDerivation: true,
    startReadyTasks: true,
    mergeProtocol: true,
    actionRequiredProtocol: true,
    statusTable: true,
    watchLoop: true,
    watchLoopIntervalSeconds: 10,
    watchLoopOutputIntervalSeconds: 300,
  },
  cliWorkflow: {
    cleanupWorktreeOnSuccess: true,
    cleanupWorktreeOnFailure: false,
    retryOnReadFileNotFound: true,
    retryOnQuotaReset: true,
    retryOnRateLimit: true,
    rateLimitRetryDelaySeconds: 10,
    maxRateLimitRetries: 5,
    maxParsingRetries: 3,
    resumeFailedTaskInSameWorkspace: true,
    gitMode: "remote",
    executionMode: "DOCKER",
    containerImage: "node:24-bookworm",
    containerSetupScriptPath: "",
    containerMemoryLimitMb: 6144,
    containerCacheSetupScriptImage: true,
    containerInstallPlaywrightBrowsers: true,
    containerRunAsRoot: false,
    containerMountGitConfig: false,
    containerGitUserName: "Code UX",
    containerGitUserEmail: "agents@codeux.ai",
    containerMountGithubAuth: false,
    containerMountGeminiAuth: false,
    containerMountCodexAuth: false,
    containerMountClaudeCodeAuth: false,
    containerMountQwenCodeAuth: false,
    containerMountOpenCodeAuth: false,
    containerMountAntigravityAuth: true,
    containerGithubAuthPath: "~/.config/gh",
    containerGeminiAuthPath: "~/.gemini",
    containerCodexAuthPath: "~/.codex",
    containerClaudeCodeAuthPath: "~/.claude",
    containerQwenCodeAuthPath: "~/.qwen",
    containerOpenCodeAuthPath: "~/.local/share/opencode",
    containerAntigravityAuthPath: "~/.antigravity",
    maxPlanningJsonRetries: 3,
    maxQuotaRetriesWithoutTimer: 5,
  },
  sprintPreview: {
    enabled: true,
    showInAppBrowser: true,
    autoStartOnRunningSprint: false,
    rebuildOnTaskCompletion: false,
    rebuildOnSprintCompletion: false,
    autoStopOnTerminalSprint: false,
    maxConcurrentContainers: 5,
    hostPortRangeStart: 5555,
    hostPortRangeEnd: 6666,
    containerAppPort: 3000,
    containerAppPorts: [3000],
    startupScriptPath: ".code-ux/browser/start-preview.sh",
  },
  workers: {
    executionMode: "VIRTUAL",
    virtualWorkerProvider: DEFAULT_PROVIDER_CONFIG_IDS.codex,
    model: "gpt-5.5",
    maxConcurrency: 100,
    timeoutSeconds: 300,
  },
  agents: {
    saveToProjectDirectory: true,
    routing: {
      planning: { agentPresetId: null },
      taskCoding: {
        mode: "MANUAL",
        agentPresetId: null,
        orchestratorAgentPresetIds: [],
      },
      ciFix: { agentPresetId: null },
      mergeConflict: { agentPresetId: null },
      dashboardReply: { agentPresetId: null },
      clarificationReply: { agentPresetId: null },
    },
    instructionTemplates: { ...DEFAULT_INSTRUCTION_TEMPLATES },
    qualityAssurance: {
      enabled: true,
      maxTaskReviewRuns: 3,
      maxSprintReviewRuns: 3,
      exhaustionPolicy: "FINISH_TASK",
      taskCompletion: {
        enabled: true,
        agentPresetIds: [],
        agentPresetId: null,
      },
      sprintCompletion: {
        enabled: true,
        agentPresetIds: [],
        agentPresetId: null,
      },
      completedTaskWithoutPr: {
        enabled: true,
        agentPresetIds: [],
        agentPresetId: null,
      },
    },
    selfReflection: {
      planning: {
        enabled: DEFAULT_AGENT_SELF_REFLECTION.planning.enabled,
        criteria: DEFAULT_AGENT_SELF_REFLECTION.planning.criteria.map((criterion) => ({ ...criterion })),
        maxImprovementAttempts: DEFAULT_AGENT_SELF_REFLECTION.planning.maxImprovementAttempts,
      },
      qualityAssurance: {
        enabled: DEFAULT_AGENT_SELF_REFLECTION.qualityAssurance.enabled,
        criteria: DEFAULT_AGENT_SELF_REFLECTION.qualityAssurance.criteria.map((criterion) => ({ ...criterion })),
        maxImprovementAttempts: DEFAULT_AGENT_SELF_REFLECTION.qualityAssurance.maxImprovementAttempts,
      },
    },
  },
  skills: DEFAULT_SKILLS,
  mcpTools: DEFAULT_MCP_TOOL_TOGGLES.map((tool) => ({ ...tool })),
  customMcpServers: [{ ...DEFAULT_PLAYWRIGHT_MCP_SERVER, args: [...DEFAULT_PLAYWRIGHT_MCP_SERVER.args], providers: [...DEFAULT_PLAYWRIGHT_MCP_SERVER.providers] }],
  memory: {
    enabled: true,
    embeddingProvider: "in_app",
    embeddingModel: null,
    customEmbeddingModels: [],
    externalEmbedding: {
      baseUrl: "https://api.openai.com/v1/embeddings",
      apiKey: "",
      model: "text-embedding-3-small",
      dimensions: null,
    },
    autoCaptureSprint: true,
    autoCaptureAgent: true,
    autoPromote: false,
    promotionThreshold: 0.5,
    remediationMode: "deterministic",
    remediationMaxPromotions: 12,
    maxSprintMemories: 200,
    maxProjectMemories: 1000,
    mapMaxEdgesPerNode: 3,
    workerLearningsInstruction: [
      "Before you finish, create a file called `.task-learnings.md` in the repository root.",
      "This file will NOT be committed — it is used to capture your learnings for the project memory system.",
      "",
      "Structure it with these sections (include only sections where you have something to report):",
      "",
      "## Category: architecture",
      "- [bullet point per learning about system architecture]",
      "",
      "## Category: codebase",
      "- [bullet point per learning about codebase structure, conventions, or patterns found]",
      "",
      "## Category: patterns",
      "- [bullet point per coding pattern, naming convention, or design pattern you observed or applied]",
      "",
      "## Category: decision",
      "- [bullet point per design decision you made and why]",
      "",
      "## Category: error",
      "- [bullet point per issue, error, or obstacle you encountered]",
      "",
      "## Category: learning",
      "- [bullet point per general learning, insight, or discovery]",
      "",
      "Each bullet should be a self-contained statement (1-2 sentences) that would be useful context for a future developer or AI working on this project.",
    ].join("\n"),
  },
  speech: {
    enabled: false,
    providerMode: "auto",
    localModelId: "onnx-community/whisper-base.en",
    maxAudioSeconds: 120,
    externalTranscription: {
      baseUrl: "https://api.openai.com/v1/audio/transcriptions",
      apiKey: "",
      model: "whisper-1",
      language: null,
    },
  },
  modelPricing: {
    overrides: {},
  },
};
;
