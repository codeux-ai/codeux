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

export type TaskStatus = "PENDING" | "RUNNING" | "COMPLETED" | "FAILED" | "BLOCKED";

export interface Subtask {
  id: string;
  title: string;
  prompt: string;
  depends_on: string[];
  status?: TaskStatus;
  session_id?: string;
  session_name?: string;
  session_state?: string;
  activities?: JulesActivity[];
  is_independent: boolean;
  is_merged?: boolean;
}

export interface DashboardStatus {
  sprint_number?: number;
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
}

export type AutomationLevel = "FULL" | "SEMI_AUTO" | "ALWAYS_ASK";

export interface SkillToggle {
  name: string;
  enabled: boolean;
  isInternal: boolean;
}

export interface DashboardSettings {
  automationLevel: AutomationLevel;
  aiProvider: {
    provider: "jules";
    julesApiKey: string;
  };
  git: {
    githubMode: "REMOTE" | "LOCAL";
    githubToken: string;
    defaultBranch: string;
    autoCreatePr: boolean;
    featureBranchPrefix: string;
    sprintBranchScheme: string;
  };
  ciIntelligence: {
    enabled: boolean;
    waitForCiBeforeMainMerge: boolean;
    resolveAllCommentsBeforeMainMerge: boolean;
    waitForCiBeforeFeatureMerge: boolean;
    resolveAllCommentsBeforeFeatureMerge: boolean;
  };
  sprintLoopSteps: {
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
  };
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
  mergedAt: string | null;
  mergedBy: string | null;
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
  warnings: string[];
  lastUpdated: string;
}

export interface ExternalSettingsHints {
  env: {
    julesApiKey: string;
    githubToken: string;
  };
  settingsJson: {
    julesApiKey: string;
    githubToken: string;
  };
  resolved: {
    julesApiKey: string;
    githubToken: string;
  };
}
