import type { JulesSession, Subtask } from "../contracts/app-types.js";

export interface TaskRerunContext {
  sprint_number?: number;
  source_id?: string;
  repo_path?: string;
  feature_branch?: string;
  subtasks?: Subtask[];
  reportText?: string;
  statusTable?: string;
  instructions?: string;
  timestamp?: string | null;
  [key: string]: unknown;
}

export interface TaskRerunServiceDependencies {
  getStatus: () => TaskRerunContext;
  updateStatus: (status: TaskRerunContext) => void;
  startTask: (args: {
    task: Subtask;
    sourceId?: string;
    featureBranch: string;
    repoPath: string;
    sprintNumber: number;
  }) => Promise<JulesSession>;
  resolveSessionName: (session: Partial<JulesSession>) => string | undefined;
  extractSessionId: (session: Partial<JulesSession>) => string | undefined;
  persistMergedFlag: (args: { repoPath: string; sprintNumber: number; taskId: string; merged: boolean }) => Promise<void>;
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
    const sprintNumber = typeof status.sprint_number === "number" ? status.sprint_number : null;
    const sourceId = typeof status.source_id === "string" && status.source_id.trim().length > 0 ? status.source_id.trim() : undefined;
    const repoPath = typeof status.repo_path === "string" && status.repo_path.trim().length > 0 ? status.repo_path.trim() : null;
    const featureBranch =
      typeof status.feature_branch === "string" && status.feature_branch.trim().length > 0 ? status.feature_branch.trim() : null;
    const subtasks = Array.isArray(status.subtasks) ? status.subtasks : [];

    if (sprintNumber === null || repoPath === null || featureBranch === null) {
      throw new Error("Cannot rerun task: sprint context is incomplete. Run orchestration/status first.");
    }

    const taskIndex = subtasks.findIndex((task) => task.id === taskId);
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
        repoPath,
        sprintNumber,
        taskId,
        merged: false,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[TaskRerunService] Warning: failed to persist merged=false for task '${taskId}': ${message}`);
    }

    try {
      const session = await this.deps.startTask({
        task: resetTask,
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
        provider: session.provider,
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
