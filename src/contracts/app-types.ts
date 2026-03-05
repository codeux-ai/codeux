export interface JulesSource {
  name: string;
  id: string;
  [key: string]: unknown;
}

export interface PullRequestOutput {
  url?: string;
  workerBranch?: string;
  [key: string]: unknown;
}

export interface SessionOutput {
  pullRequest?: PullRequestOutput;
  [key: string]: unknown;
}

export interface JulesSession {
  name: string;
  id: string;
  title?: string;
  state?: string;
  provider?: ProviderId;
  prompt: string;
  createTime?: string;
  outputs?: SessionOutput[];
}

export interface JulesActivity {
  name: string;
  id: string;
  createTime: string;
  originator?: "agent" | "user" | "system" | string;
  agentMessaged?: { agentMessage?: string };
  userMessaged?: { userMessage?: string };
  progressUpdated?: { title?: string; description?: string };
  planGenerated?: { plan?: { steps?: Array<{ title?: string }> } };
  planApproved?: { planId?: string };
  sessionFailed?: { reason?: string };
  sessionCompleted?: unknown;
  description?: string;
  [key: string]: unknown;
}

export type SubtaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";
export type SubtaskMergeIndicator = "CI" | "AUTOMERGE" | "MERGED" | "MERGE_BLOCKED";
export type ProviderId = "jules" | "gemini" | "codex" | "claude-code";
export type ProviderStrategy = "MANUAL" | "WEIGHTED" | "ORCHESTRATOR";
export type ThinkingMode = "SMALL" | "MEDIUM" | "HIGH";
export type CliExecutionMode = "HOST" | "DOCKER";
export type FeaturePrAutoMergeMode = "OFF" | "WHEN_GREEN" | "ALWAYS";

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
  merge_indicator?: SubtaskMergeIndicator;
  intervention_owner?: InterventionOwner;
  intervention_hint?: string;
}

export interface DashboardStatus {
  sprint_number?: number;
  source_id?: string;
  repo_path?: string;
  feature_branch?: string;
  subtasks: Subtask[];
  reportText?: string;
  statusTable?: string;
  instructions?: string;
  timestamp: string | null;
}

export interface LiveActivitiesResponse {
  activitiesBySession: Record<string, JulesActivity[]>;
  polledAt: string;
  cacheTtlMs: number;
}

export interface DashboardStats {
  total: number;
  running: number;
  completed: number;
  failed: number;
  ci: number;
  automerge: number;
  merged: number;
  mergeBlocked: number;
}

export interface Settings {
  maxFailures?: number;
  [key: string]: unknown;
}

export type AutomationLevel = "FULL" | "SEMI_AUTO" | "ALWAYS_ASK";
export type InterventionOwner = "HUMAN" | "AGENT";

export interface AutomationInterventionsSettings {
  autoApprovePlan: boolean;
  autoAnswerClarification: boolean;
  autoResumePaused: boolean;
  clarificationAnswerTemplate: string;
}

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
  enableLivePrMonitoring: boolean;
  waitForCiBeforeMainMerge: boolean;
  resolveAllCommentsBeforeMainMerge: boolean;
  waitForCiBeforeFeatureMerge: boolean;
  resolveAllCommentsBeforeFeatureMerge: boolean;
  waitForJulesCiAutofix: boolean;
  julesCiAutofixMaxRetries: number;
  featurePrAutoMergeMode: FeaturePrAutoMergeMode;
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
  watchLoopIntervalSeconds: number;
  watchLoopOutputIntervalSeconds: number;
}

export interface CliWorkflowSettings {
  cleanupWorktreeOnSuccess: boolean;
  cleanupWorktreeOnFailure: boolean;
  retryOnReadFileNotFound: boolean;
  resumeFailedTaskInSameWorkspace: boolean;
  executionMode: CliExecutionMode;
  containerImage: string;
  containerSetupScriptPath: string;
  containerMountCredentials: boolean;
  containerMountGitConfig: boolean;
  containerMountGithubAuth: boolean;
  containerMountGeminiAuth: boolean;
  containerMountCodexAuth: boolean;
  containerMountClaudeCodeAuth: boolean;
  containerGithubAuthPath: string;
  containerGeminiAuthPath: string;
  containerCodexAuthPath: string;
  containerClaudeCodeAuthPath: string;
}

export interface SkillToggle {
  name: string;
  enabled: boolean;
  isInternal: boolean;
}

export interface McpToolToggle {
  name: string;
  enabled: boolean;
  isInternal: boolean;
}

export interface DashboardSettings {
  dashboardPort: number;
  enableDebugLogFile: boolean;
  automationLevel: AutomationLevel;
  automationInterventions: AutomationInterventionsSettings;
  aiProvider: AiProviderSettings;
  git: GitSettings;
  ciIntelligence: CiIntelligenceSettings;
  sprintLoopSteps: SprintLoopStepSettings;
  cliWorkflow: CliWorkflowSettings;
  skills: SkillToggle[];
  mcpTools: McpToolToggle[];
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
  failedJobs?: GitCiFailedJob[];
}

export interface GitCiFailedJob {
  id: number | null;
  name: string;
  conclusion: string | null;
  failedSteps: string[];
  logExcerpt: string | null;
  logCommand: string | null;
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
    claudeCodeApiKey: string;
    githubToken: string;
  };
  settingsJson: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    claudeCodeApiKey: string;
    githubToken: string;
  };
  resolved: {
    julesApiKey: string;
    geminiApiKey: string;
    codexApiKey: string;
    claudeCodeApiKey: string;
    githubToken: string;
  };
}

export interface GetCiStatusForScopeArgs {
  repoPath: string;
  scope: "FEATURE_PR_CI" | "MAIN_MERGE_PR_CI";
  featureBranch: string;
  defaultBranch: string;
  featureBranchPrefix: string;
}

export interface AutoMergeFeaturePrArgs {
  repoPath: string;
  prNumber: number;
}

export interface PersistTaskMergedFlagArgs {
  repoPath: string;
  sprintNumber: number;
  taskId: string;
  merged: boolean;
}

export interface ReadinessProbeStatus {
  status: "UP" | "READY" | "NOT_READY" | "DOWN";
  components?: {
    settingsDb: "UP" | "DOWN";
    dashboardBind: "UP" | "DOWN";
    mcpService: "UP" | "DOWN";
  };
}
