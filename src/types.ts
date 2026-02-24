export interface JulesSource {
  name: string;
  id: string;
}

export interface JulesSession {
  name: string;
  id: string;
  title?: string;
  state?: string;
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

export interface Subtask {
  id: string;
  title: string;
  prompt: string;
  depends_on: string[];
  status?: SubtaskStatus;
  session_id?: string;
  session_name?: string;
  session_state?: string;
  activities?: JulesActivity[];
  is_independent: boolean;
  is_merged?: boolean;
}

export interface Settings {
  maxFailures?: number;
  [key: string]: any;
}

export type AutomationLevel = "FULL" | "SEMI_AUTO" | "ALWAYS_ASK";

export interface AiProviderSettings {
  provider: "jules";
  julesApiKey: string;
}

export interface GitSettings {
  githubMode: "REMOTE" | "LOCAL";
  defaultBranch: string;
  autoCreatePr: boolean;
  featureBranchPrefix: string;
  sprintBranchScheme: string;
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
