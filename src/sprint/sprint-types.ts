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
  listAllActivities?: (sessionId: string) => Promise<JulesActivity[]>;
  getSession?: (sessionId: string) => Promise<JulesSession>;
  isActionRequiredState: (state?: string) => boolean;
  projectManagementRepository?: ProjectManagementRepository;
  executionRepository?: ExecutionRepository;
  sprintRunId?: string;
  logger: Logger;
  julesUsage?: {
    calculateAndSaveUsageForTask: (
      projectId: string,
      taskId: string,
      sessionId: string,
      sessionPrompt?: string,
      gitMetrics?: { insertions?: number; deletions?: number; filesChanged?: number } | null
    ) => Promise<void>;
    syncLiveInvocation: (
      projectId: string,
      taskId: string,
      sessionId: string,
      sessionPrompt?: string,
      gitMetrics?: { insertions?: number; deletions?: number; filesChanged?: number } | null
    ) => Promise<void>;
  };
}
