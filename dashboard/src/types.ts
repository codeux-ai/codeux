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
    defaultBranch: string;
    autoCreatePr: boolean;
    featureBranchPrefix: string;
    sprintBranchScheme: string;
  };
  skills: SkillToggle[];
}
