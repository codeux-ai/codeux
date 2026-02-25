export interface JulesSource {
  name: string;
  id: string;
}

export interface JulesSession {
  name: string;
  id: string;
  title?: string;
  state?: string;
  provider?: ProviderId;
  prompt: string;
  createTime?: string;
  outputs?: Array<{ pullRequest?: any; [key: string]: any }>;
}

export interface JulesActivity {
  name: string;
  id: string;
  createTime: string;
  originator?: "agent" | "user" | "system" | string;
  [key: string]: any;
}

export type SubtaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";
export type ProviderId = "jules" | "gemini" | "codex";
export type ProviderStrategy = "MANUAL" | "WEIGHTED" | "ORCHESTRATOR";
export type ThinkingMode = "SMALL" | "MEDIUM" | "HIGH";

export interface Subtask {
  id: string;
  title: string;
  prompt: string;
  depends_on: string[];
  status?: SubtaskStatus;
  session_id?: string;
  session_name?: string;
  session_state?: string;
  provider?: ProviderId;
  worker_branch?: string;
  pr_url?: string;
  activities?: JulesActivity[];
  is_independent: boolean;
  is_merged?: boolean;
}

export interface Settings {
  maxFailures?: number;
  [key: string]: any;
}

export type AutomationLevel = "FULL" | "SEMI_AUTO" | "ALWAYS_ASK";

export interface ProviderSettings {
  enabled: boolean;
  model: string;
  weight: number;
  thinkingMode: ThinkingMode;
  apiKey: string;
}

export interface AiProviderSettings {
  provider: ProviderId;
  strategy: ProviderStrategy;
  providers: Record<ProviderId, ProviderSettings>;
  julesApiKey: string;
}

export interface GitSettings {
  githubMode: "REMOTE" | "LOCAL";
  githubToken: string;
  defaultBranch: string;
  autoCreatePr: boolean;
  featureBranchPrefix: string;
  sprintBranchScheme: string;
}

export interface CiIntelligenceSettings {
  enabled: boolean;
  waitForCiBeforeMainMerge: boolean;
  resolveAllCommentsBeforeMainMerge: boolean;
  waitForCiBeforeFeatureMerge: boolean;
  resolveAllCommentsBeforeFeatureMerge: boolean;
}

export interface SprintLoopStepSettings {
  branchPreflight: boolean;
  planningPreflight: boolean;
  loadSubtasks: boolean;
  sessionSync: boolean;
  statusDerivation: boolean;
  startReadyTasks: boolean;
  mergeProtocol: boolean;
  actionRequiredProtocol: boolean;
  statusTable: boolean;
  watchLoop: boolean;
}

export interface CliWorkflowSettings {
  cleanupWorktreeOnSuccess: boolean;
  cleanupWorktreeOnFailure: boolean;
  retryOnReadFileNotFound: boolean;
  resumeFailedTaskInSameWorkspace: boolean;
}

export interface SkillToggle {
  name: string;
  enabled: boolean;
  isInternal: boolean;
}

export interface DashboardSettings {
  automationLevel: AutomationLevel;
  aiProvider: AiProviderSettings;
  git: GitSettings;
  ciIntelligence: CiIntelligenceSettings;
  sprintLoopSteps: SprintLoopStepSettings;
  cliWorkflow: CliWorkflowSettings;
  skills: SkillToggle[];
}

export interface GitStatusCheck {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface GitPullRequestStatus {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  headRefName: string | null;
  baseRefName: string | null;
  mergeStateStatus: string | null;
  reviewDecision: string | null;
  updatedAt: string | null;
  comments: number;
  checks: GitStatusCheck[];
}

export interface GitCiRunStatus {
  id: number | null;
  name: string;
  workflowName: string | null;
  status: string;
  conclusion: string | null;
  event: string | null;
  headBranch: string | null;
  url: string;
  updatedAt: string | null;
}

export interface GitMergeStatus {
  number: number;
  title: string;
  url: string;
  headRefName: string | null;
  baseRefName: string | null;
  mergedAt: string | null;
  mergedBy: string | null;
}

export type GitTrackingScope = "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI" | "MAIN_BRANCH_CI" | "REPOSITORY";

export interface GitTrackingTarget {
  scope: GitTrackingScope;
  label: string;
  branch: string | null;
}

export interface GitTrackingStatus {
  mode: "REMOTE" | "LOCAL";
  available: boolean;
  repositoryRoot: string | null;
  branch: string | null;
  hasRemote: boolean;
  dirty: boolean;
  openPullRequests: GitPullRequestStatus[];
  ciRuns: GitCiRunStatus[];
  mergedPullRequests: GitMergeStatus[];
  tracking: GitTrackingTarget;
  warnings: string[];
  lastUpdated: string;
}

export interface ExternalSettingsHints {
  env: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    githubToken: string;
  };
  settingsJson: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    githubToken: string;
  };
  resolved: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    githubToken: string;
  };
}
