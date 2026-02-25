import type { JulesActivity, JulesSession, Subtask } from "../types.js";

export interface SprintAgentArgs {
  sprint_number: number;
  repo_path: string;
  source_id: string;
  feature_branch?: string;
  action: "status" | "orchestrate" | "plan";
  wait?: boolean;
  retry_failed?: boolean;
}

export interface SprintCycleResult {
  subtasks: Subtask[];
  reportText: string;
  statusTable: string;
  instructions: string;
}

export interface SessionSyncDependencies {
  listSessions: () => Promise<{ sessions?: JulesSession[] }>;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  fetchRecentActivities: (sessionName: string, pageSize?: number) => Promise<JulesActivity[]>;
  isActionRequiredState: (state?: string) => boolean;
}
