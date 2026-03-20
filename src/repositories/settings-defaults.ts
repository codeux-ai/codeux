import type {
  CliExecutionMode,
  DashboardSettings,
  FeaturePrAutoMergeMode,
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

export const PROVIDER_IDS: ProviderId[] = ["jules", "gemini", "codex", "claude-code"];
export const THINKING_MODES: ThinkingMode[] = ["SMALL", "MEDIUM", "HIGH"];
export const PROVIDER_STRATEGIES: ProviderStrategy[] = ["MANUAL", "WEIGHTED", "ORCHESTRATOR"];
export const CLI_EXECUTION_MODES: CliExecutionMode[] = ["HOST", "DOCKER"];
export const FEATURE_PR_AUTOMERGE_MODES: FeaturePrAutoMergeMode[] = ["OFF", "WHEN_GREEN", "ALWAYS"];
export const WORKER_EXECUTION_MODES: WorkerExecutionMode[] = ["CONNECTED_MCP", "VIRTUAL"];
export const VIRTUAL_WORKER_PROVIDERS: VirtualWorkerProvider[] = ["gemini", "codex", "claude-code"];

export const JULES_MODEL_OPTIONS: string[] = ["default"];

export const GEMINI_MODEL_OPTIONS: string[] = [
  "default",
  "gemini-1.5-pro",
  "gemini-1.5-flash",
  "gemini-2.0-flash",
];

export const CLAUDE_CODE_MODEL_OPTIONS: string[] = [
  "default",
  "claude-3-5-sonnet-20241022",
  "claude-3-opus-20240229",
  "claude-3-haiku-20240307",
  "claude-sonnet-4-6",
  "claude-opus-4-6",
  "claude-haiku-4-5-20251001",
];

export const CODEX_MODEL_OPTIONS: string[] = [
  "default",
  "gpt-4o",
  "gpt-4-turbo",
];

export const PROVIDER_MODEL_OPTIONS: Record<ProviderId, string[]> = {
  jules: JULES_MODEL_OPTIONS,
  gemini: GEMINI_MODEL_OPTIONS,
  codex: CODEX_MODEL_OPTIONS,
  "claude-code": CLAUDE_CODE_MODEL_OPTIONS,
};

export const VIRTUAL_WORKER_MODEL_OPTIONS: string[] = [
  "default",
  ...GEMINI_MODEL_OPTIONS.filter((m) => m !== "default"),
  ...CODEX_MODEL_OPTIONS.filter((m) => m !== "default"),
  ...CLAUDE_CODE_MODEL_OPTIONS.filter((m) => m !== "default"),
];

export const MIN_WATCH_LOOP_INTERVAL_SECONDS = 1;
export const MAX_WATCH_LOOP_INTERVAL_SECONDS = 3600;
export const MIN_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS = 60;
export const MAX_WATCH_LOOP_OUTPUT_INTERVAL_SECONDS = 3600;
export const MIN_JULES_CI_AUTOFIX_RETRIES = 0;
export const MAX_JULES_CI_AUTOFIX_RETRIES = 20;

export const DEFAULT_PROVIDER_SETTINGS: Record<ProviderId, ProviderSettings> = {
  jules: {
    enabled: true,
    model: "default",
    weight: 60,
    thinkingMode: "MEDIUM",
    apiKey: "",
  },
  gemini: {
    enabled: true,
    model: "default",
    weight: 20,
    thinkingMode: "MEDIUM",
    apiKey: "",
  },
  codex: {
    enabled: true,
    model: "gpt-4o",
    weight: 20,
    thinkingMode: "HIGH",
    apiKey: "",
  },
  "claude-code": {
    enabled: false,
    model: "default",
    weight: 0,
    thinkingMode: "HIGH",
    apiKey: "",
  },
};

export const DEFAULT_DASHBOARD_SETTINGS: DashboardSettings = {
  dashboardPort: 4444,
  enableDebugLogFile: false,
  automationLevel: "SEMI_AUTO",
  automationInterventions: {
    autoApprovePlan: true,
    autoAnswerClarification: false,
    autoResumePaused: false,
    clarificationAnswerTemplate: "Proceed with the safest implementation path using repository conventions. If multiple valid options exist, choose the smallest-scope option and continue without waiting for clarification.",
  },
  aiProvider: {
    provider: "jules",
    strategy: "MANUAL",
    providers: {
      jules: { ...DEFAULT_PROVIDER_SETTINGS.jules },
      gemini: { ...DEFAULT_PROVIDER_SETTINGS.gemini },
      codex: { ...DEFAULT_PROVIDER_SETTINGS.codex },
      "claude-code": { ...DEFAULT_PROVIDER_SETTINGS["claude-code"] },
    },
    julesApiKey: "",
  },
  git: {
    githubMode: "REMOTE",
    githubToken: "",
    defaultBranch: "main",
    autoCreatePr: true,
    featureBranchPrefix: "feature/",
    sprintBranchScheme: DEFAULT_SPRINT_BRANCH_SCHEME,
  },
  ciIntelligence: {
    enabled: true,
    enableLivePrMonitoring: true,
    waitForCiBeforeMainMerge: true,
    resolveAllCommentsBeforeMainMerge: true,
    resolveMainMergeConflicts: false,
    waitForCiBeforeFeatureMerge: true,
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
    resumeFailedTaskInSameWorkspace: true,
    executionMode: "HOST",
    containerImage: "node:24-bookworm",
    containerSetupScriptPath: "",
    containerCacheSetupScriptImage: false,
    containerMountGitConfig: true,
    containerMountGithubAuth: true,
    containerMountGeminiAuth: true,
    containerMountCodexAuth: true,
    containerMountClaudeCodeAuth: true,
    containerGithubAuthPath: "~/.config/gh",
    containerGeminiAuthPath: "~/.gemini",
    containerCodexAuthPath: "~/.codex",
    containerClaudeCodeAuthPath: "~/.claude",
  },
  workers: {
    executionMode: "CONNECTED_MCP",
    virtualWorkerProvider: "codex",
    virtualWorkerModel: "default",
  },
  agents: {
    saveToProjectDirectory: true,
    instructionTemplates: { ...DEFAULT_INSTRUCTION_TEMPLATES },
  },
  skills: DEFAULT_SKILLS,
  mcpTools: DEFAULT_MCP_TOOL_TOGGLES.map((tool) => ({ ...tool })),
};
