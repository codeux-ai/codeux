import type { Subtask } from "../contracts/app-types.js";
import type { StartSprintDispatchResult } from "./sprint-task-dispatch-service.js";
import type { Logger } from "../shared/logging/logger.js";

export interface TaskRerunContext {
  project_id?: string;
  sprint_id?: string;
  sprint_number?: number;
  source_id?: string;
  repo_path?: string;
  feature_branch?: string;
  subtasks?: Subtask[];
  reportText?: string;
  statusTable?: string;
  instructions?: string;
  timestamp?: string | null;
}

export interface TaskRerunServiceDependencies {
  getStatus: () => TaskRerunContext;
  updateStatus: (status: TaskRerunContext) => void;
  resolveSprintRunId: (args: {
    projectId: string;
    sprintId: string;
    sprintNumber: number;
    featureBranch: string;
  }) => Promise<string>;
  startTask: (args: {
    task: Subtask;
    projectId: string;
    sprintId: string;
    sprintRunId: string;
    sourceId?: string;
    featureBranch: string;
    repoPath: string;
    sprintNumber: number;
  }) => Promise<StartSprintDispatchResult>;
  resolveSessionName: (session: { id?: string; name?: string }) => string | undefined;
  extractSessionId: (session: { id?: string; name?: string }) => string | undefined;
  persistMergedFlag: (args: { taskId: string; merged: boolean }) => Promise<void>;
  logger?: Logger;
}

const resetTaskState = (task: Subtask): Subtask => ({
  ...task,
  status: "PENDING",
  session_id: undefined,
  session_name: undefined,
  session_state: undefined,
  worker_branch: undefined,
  pr_url: undefined,
  activities: [],
  is_merged: false,
  merge_indicator: undefined,
  intervention_owner: undefined,
  intervention_hint: undefined,
});

export class TaskRerunService {
  constructor(private readonly deps: TaskRerunServiceDependencies) {}

  async rerunTask(taskId: string): Promise<Subtask> {
    const status = this.deps.getStatus();
    const projectId = typeof status.project_id === "string" && status.project_id.trim().length > 0 ? status.project_id.trim() : null;
    const sprintId = typeof status.sprint_id === "string" && status.sprint_id.trim().length > 0 ? status.sprint_id.trim() : null;
    const sprintNumber = typeof status.sprint_number === "number" ? status.sprint_number : null;
    const sourceId = typeof status.source_id === "string" && status.source_id.trim().length > 0 ? status.source_id.trim() : undefined;
    const repoPath = typeof status.repo_path === "string" && status.repo_path.trim().length > 0 ? status.repo_path.trim() : null;
    const featureBranch =
      typeof status.feature_branch === "string" && status.feature_branch.trim().length > 0 ? status.feature_branch.trim() : null;
    const subtasks = Array.isArray(status.subtasks) ? status.subtasks : [];

    if (projectId === null || sprintId === null || sprintNumber === null || repoPath === null || featureBranch === null) {
      throw new Error("Cannot rerun task: sprint context is incomplete. Run orchestration/status first.");
    }

    const taskIndex = subtasks.findIndex((task) => task.record_id === taskId || task.id === taskId);
    if (taskIndex < 0) {
      throw new Error(`Cannot rerun task: task '${taskId}' was not found in current sprint status.`);
    }

    const resetTask = resetTaskState(subtasks[taskIndex]);
    const resetSubtasks = subtasks.map((task, index) => (index === taskIndex ? resetTask : task));
    this.deps.updateStatus({
      ...status,
      subtasks: resetSubtasks,
      timestamp: new Date().toLocaleTimeString(),
    });

    try {
      await this.deps.persistMergedFlag({
        taskId: resetTask.record_id || resetTask.id,
        merged: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.deps.logger?.warn("Failed to persist merged=false while rerunning task", {
        taskId,
        message,
      });
    }

    try {
      const sprintRunId = await this.deps.resolveSprintRunId({
        projectId,
        sprintId,
        sprintNumber,
        featureBranch,
      });
      const session = await this.deps.startTask({
        task: resetTask,
        projectId,
        sprintId,
        sprintRunId,
        sourceId,
        featureBranch,
        repoPath,
        sprintNumber,
      });
      const restartedTask: Subtask = {
        ...resetTask,
        status: "RUNNING",
        session_name: this.deps.resolveSessionName(session),
        session_id: this.deps.extractSessionId(session),
        provider:
          session.provider === "jules" || session.provider === "gemini" || session.provider === "codex" || session.provider === "claude-code"
            ? session.provider
            : undefined,
      };
      const restartedSubtasks = resetSubtasks.map((task, index) => (index === taskIndex ? restartedTask : task));
      this.deps.updateStatus({
        ...status,
        subtasks: restartedSubtasks,
        timestamp: new Date().toLocaleTimeString(),
      });
      return restartedTask;
    } catch (error) {
      const failedTask: Subtask = {
        ...resetTask,
        status: "FAILED",
      };
      const failedSubtasks = resetSubtasks.map((task, index) => (index === taskIndex ? failedTask : task));
      this.deps.updateStatus({
        ...status,
        subtasks: failedSubtasks,
        timestamp: new Date().toLocaleTimeString(),
      });
      throw error;
    }
  }
}
