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
