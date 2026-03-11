import type { JulesActivity, JulesSession, Subtask } from "../contracts/app-types.js";
import type { ExecutionRepository } from "../repositories/execution-repository.js";
import type { ProjectManagementRepository } from "../repositories/project-management-repository.js";
import type { Logger } from "../shared/logging/logger.js";

export interface SprintAgentArgs {
  sprint_number?: number;
  sprint_id?: string;
  project_id?: string;
  repo_path?: string;
  source_id?: string;
  feature_branch?: string;
  action: "status" | "orchestrate" | "plan";
  wait?: boolean;
  retry_failed?: boolean;
  existing_sprint_run_id?: string;
  skip_branch_preflight?: boolean;
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
  projectManagementRepository?: ProjectManagementRepository;
  executionRepository?: ExecutionRepository;
  sprintRunId?: string;
  logger: Logger;
}
