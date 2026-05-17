import type {
  CliExecutionMode,
  DashboardSettings,
  FeaturePrAutoMergeMode,
  InvocationRoutingId,
  InvocationRoutingProfile,
  InvocationRoutingSettings,
  ProviderConfigId,
  ProviderId,
  ProviderSettings,
  ProviderStrategy,
  SkillToggle,
  VirtualWorkerProvider,
  WorkerExecutionMode,
  ThinkingMode,
} from "../contracts/app-types.js";
import { DEFAULT_SPRINT_BRANCH_SCHEME } from "../git/sprint-branch-scheme.js";
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

export const PROVIDER_IDS: ProviderId[] = ["jules", "gemini", "codex", "claude-code", "qwen-code", "opencode"];
export const THINKING_MODES: ThinkingMode[] = ["SMALL", "MEDIUM", "HIGH"];
export const PROVIDER_STRATEGIES: ProviderStrategy[] = ["MANUAL", "WEIGHTED", "ORCHESTRATOR"];
export const INVOCATION_ROUTING_PROFILES: InvocationRoutingProfile[] = ["GLOBAL", "WORKER"];
export const INVOCATION_ROUTING_IDS: InvocationRoutingId[] = [
  "task_coding",
  "planning",
  "dashboard_reply",
  "clarification_reply",
  "qa_review",
  "ci_fix",
  "merge_conflict",
];
export const CLI_EXECUTION_MODES: CliExecutionMode[] = ["DOCKER", "HOST"];
export const FEATURE_PR_AUTOMERGE_MODES: FeaturePrAutoMergeMode[] = ["OFF", "CREATE_PR", "WHEN_GREEN", "ALWAYS"];
export const WORKER_EXECUTION_MODES: WorkerExecutionMode[] = ["VIRTUAL"];
export const VIRTUAL_WORKER_PROVIDERS: VirtualWorkerProvider[] = ["gemini", "codex", "claude-code", "qwen-code", "opencode"];
export const CONSOLE_LOG_LEVELS = ["standard", "full"] as const;
export const DEFAULT_PROVIDER_CONFIG_IDS: Record<ProviderId, ProviderConfigId> = {
  jules: "jules",
  gemini: "gemini",
  codex: "codex",
  "claude-code": "claude-code",
  "qwen-code": "qwen-code",
  opencode: "opencode",
};
export const DEFAULT_PROVIDER_CONFIG_NAMES: Record<ProviderId, string> = {
  jules: "Jules Primary",
  gemini: "Gemini Primary",
  codex: "Codex Primary",
  "claude-code": "Claude Primary",
  "qwen-code": "Qwen Primary",
  opencode: "OpenCode Primary",
};
export const DEFAULT_PROVIDER_AUTH_PATHS: Record<ProviderId, string> = {
  jules: "",
  gemini: "~/.gemini",
  codex: "~/.codex",
  "claude-code": "~/.claude",
  "qwen-code": "~/.qwen",
  opencode: "~/.local/share/opencode",
};

// AI Models catalog — available model identifiers per virtual worker provider
export const GEMINI_MODELS: string[] = [
  "auto",
  "pro",
  "flash",
  "flash-lite",
  "gemini-3-pro-preview",
  "gemini-3-flash-preview",
  "gemini-2.5-pro",
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
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
  "claude-sonnet-4-6",
  "claude-haiku-4-5-20251001",
];

export const CODEX_MODELS: string[] = [
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
  "local-model",
];

export const OPENCODE_MODELS: string[] = [
  "anthropic/claude-sonnet-4-5",
  "anthropic/claude-opus-4-1",
  "anthropic/claude-haiku-4-5",
  "openai/gpt-5",
  "openai/gpt-5-mini",
  "github-copilot/gpt-5",
  "openrouter/anthropic/claude-sonnet-4.5",
  "custom/model",
];

export const AI_MODEL_CATALOG: Record<string, string[]> = {
  gemini: GEMINI_MODELS,
  "claude-code": CLAUDE_MODELS,
  codex: CODEX_MODELS,
  "qwen-code": QWEN_MODELS,
  opencode: OPENCODE_MODELS,
};

export const DEFAULT_VIRTUAL_WORKER_MODELS: Record<string, string> = {
  gemini: "auto",
  "claude-code": "default",
  codex: "gpt-5.3-codex",
  "qwen-code": "qwen3-coder-plus",
  opencode: "anthropic/claude-sonnet-4-5",
};

export const MIN_WATCH_LOOP_INTERVAL_SECONDS = 1;
export const MAX_WATCH_LOOP_INTERVAL_SECONDS = 3600;
export const MIN_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS = 60;
export const MAX_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS = 3600;
export const MIN_JULES_CI_AUTOFIX_RETRIES = 0;
export const MAX_JULES_CI_AUTOFIX_RETRIES = 20;

export const DEFAULT_PROVIDER_SETTINGS: Record<ProviderId, ProviderSettings> = {
  jules: {
    provider: "jules",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.jules,
    enabled: true,
    model: "default",
    weight: 60,
    thinkingMode: "MEDIUM",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.jules,
    maxConcurrentTasks: 15,
  },
  gemini: {
    provider: "gemini",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.gemini,
    enabled: true,
    model: "default",
    weight: 20,
    thinkingMode: "MEDIUM",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.gemini,
    maxConcurrentTasks: 0,
  },
  codex: {
    provider: "codex",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.codex,
    enabled: true,
    model: "gpt-5.3-codex",
    weight: 20,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.codex,
    maxConcurrentTasks: 0,
  },
  "claude-code": {
    provider: "claude-code",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["claude-code"],
    enabled: false,
    model: "default",
    weight: 0,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["claude-code"],
    maxConcurrentTasks: 0,
  },
  "qwen-code": {
    provider: "qwen-code",
    name: DEFAULT_PROVIDER_CONFIG_NAMES["qwen-code"],
    enabled: false,
    model: "qwen3-coder-plus",
    weight: 0,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS["qwen-code"],
    maxConcurrentTasks: 0,
  },
  opencode: {
    provider: "opencode",
    name: DEFAULT_PROVIDER_CONFIG_NAMES.opencode,
    enabled: false,
    model: "anthropic/claude-sonnet-4-5",
    weight: 0,
    thinkingMode: "HIGH",
    apiKey: "",
    mountAuth: false,
    authPath: DEFAULT_PROVIDER_AUTH_PATHS.opencode,
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
};

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  dashboardPort: 4444,
  enableDebugLogFile: false,
  consoleLogLevel: "standard",
  appearance: {
    navigationMode: "DOCK",
    theme: "SYSTEM",
    reducedMotion: "AUTO",
    backgroundMode: "ANIMATED",
    animatedBackground: "deep-ocean",
    staticBackgroundColor: "#0d0f12",
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
    },
  },
  git: {
    githubMode: "REMOTE",
    githubToken: "",
    gitlabToken: "",
    defaultBranch: "main",
    autoCreatePr: true,
    autoCloseLinkedIssues: false,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: DEFAULT_SPRINT_BRANCH_SCHEME,
  },
  ciIntelligence: {
    enabled: true,
    enableLivePrMonitoring: true,
    resolveAllCommentsBeforeMainMerge: true,
    resolveMainMergeConflicts: false,
    resolveAllCommentsBeforeFeatureMerge: true,
    resolveMergeConflicts: false,
    waitForJulesCiAutofix: false,
    julesCiAutofixMaxRetries: 3,
    featurePrAutoMergeMode: "OFF",
    mainBranchAutoMergeMode: "OFF",
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
    watchLoopIntervalSeconds: 120,
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
    executionMode: "DOCKER",
    containerImage: "node:24-bookworm",
    containerSetupScriptPath: "",
    containerCacheSetupScriptImage: false,
    containerMountGitConfig: true,
    containerMountGithubAuth: false,
    containerMountGeminiAuth: false,
    containerMountCodexAuth: false,
    containerMountClaudeCodeAuth: false,
    containerMountQwenCodeAuth: false,
    containerMountOpenCodeAuth: false,
    containerGithubAuthPath: "~/.config/gh",
    containerGeminiAuthPath: "~/.gemini",
    containerCodexAuthPath: "~/.codex",
    containerClaudeCodeAuthPath: "~/.claude",
    containerQwenCodeAuthPath: "~/.qwen",
    containerOpenCodeAuthPath: "~/.local/share/opencode",
    maxPlanningJsonRetries: 3,
    maxQuotaRetriesWithoutTimer: 5,
  },
  sprintPreview: {
    enabled: true,
    showInAppBrowser: true,
    autoStartOnRunningSprint: true,
    rebuildOnTaskCompletion: true,
    rebuildOnSprintCompletion: true,
    autoStopOnTerminalSprint: false,
    maxConcurrentContainers: 5,
    hostPortRangeStart: 5555,
    hostPortRangeEnd: 6666,
    containerAppPort: 3000,
    startupScriptPath: ".code-ux/browser/start-preview.sh",
  },
  workers: {
    executionMode: "VIRTUAL",
    virtualWorkerProvider: DEFAULT_PROVIDER_CONFIG_IDS.codex,
    model: "gpt-5.3-codex",
    maxConcurrency: 1,
    timeoutSeconds: 300,
  },
  agents: {
    saveToProjectDirectory: true,
    instructionTemplates: { ...DEFAULT_INSTRUCTION_TEMPLATES },
    qualityAssurance: {
      enabled: false,
      maxTaskReviewRuns: 1,
      taskCompletion: {
        enabled: true,
        agentPresetId: null,
      },
      sprintCompletion: {
        enabled: true,
        agentPresetId: null,
      },
      completedTaskWithoutPr: {
        enabled: true,
        agentPresetId: null,
      },
    },
  },
  skills: DEFAULT_SKILLS,
  mcpTools: DEFAULT_MCP_TOOL_TOGGLES.map((tool) => ({ ...tool })),
  memory: {
    enabled: false,
    embeddingModel: null,
    autoCaptureSprint: true,
    autoCaptureAgent: true,
    autoPromote: false,
    promotionThreshold: 0.7,
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
};
