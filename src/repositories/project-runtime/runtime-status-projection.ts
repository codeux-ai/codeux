import { DatabaseAdapter } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import type { DashboardStatus, JulesActivity, Subtask, SubtaskStatus } from "../../contracts/app-types.js";
import { mapPlanningStatusToRuntimeStatus, toMergeIndicator } from "../../services/subtask-state-mapper.js";
import { RuntimeContextPayload } from "./runtime-context-store.js";
import { toNumber, toBoolean, parsePayloadJson } from "../repository-utils.js";

export type PlanningTaskStatus = "pending" | "in_progress" | "coding_completed" | "completed" | "QA_REVIEW_FAILED";
export type ProjectStatus = "running" | "failed" | "intervention" | "idle";
export type TaskRunState = Exclude<SubtaskStatus, undefined>;
export type JulesPlan = { steps?: Array<{ title?: string }> };

export interface ProjectRow {
  id: string;
  base_dir: string;
  source_ref: string | null;
}

export interface SprintRow {
  id: string;
  number: number | string | null;
}

export interface TaskRow {
  id: string;
  project_id: string;
  sprint_id: string;
  task_key: string;
  title: string;
  prompt_markdown: string;
  description: string | null;
  status: PlanningTaskStatus;
  is_independent: number | string;
  is_merged: number | string;
  merge_indicator: string | null;
  updated_at: string;
}

export interface DependencyRow {
  task_id: string;
  depends_on_task_id: string;
}

export interface TaskRunRow {
  id: string;
  task_id: string;
  connection_id: string | null;
  provider: string | null;
  mode: string | null;
  session_id: string | null;
  session_name: string | null;
  state: TaskRunState;
  worker_branch: string | null;
  pr_url: string | null;
  started_at: string | null;
  finished_at: string | null;
  duration_ms: number | string | null;
}

export interface TaskActivityRow {
  task_id: string;
  session_id: string | null;
  session_name: string | null;
  provider: string | null;
  activity_id: string | null;
  activity_name: string | null;
  created_at: string;
  originator: string | null;
  payload_json: string | null;
}

export interface MappedTask {
  row: TaskRow;
  dependsOnTaskIds: string[];
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

export class RuntimeStatusProjection {
  constructor(
    private readonly storage: AppDbStorage,
    private readonly db: DatabaseAdapter
  ) {}

  buildProjectStatus(
    projectId: string,
    sprintIdToLoad: string | null,
    context: RuntimeContextPayload | null
  ): DashboardStatus {
    const tasks = this.getMappedTasks(projectId, sprintIdToLoad);
    const latestRuns = this.getLatestRuns(tasks.map((task) => task.row.id));
    const recentActivitiesByTaskId = this.getRecentActivitiesByTask(tasks.map((task) => task.row.id));
    const taskKeyByRecordId = new Map(tasks.map((task) => [task.row.id, task.row.task_key]));

    const subtasks: Subtask[] = tasks.map((task) => {
      const run = latestRuns.get(task.row.id);
      return {
        record_id: task.row.id,
        project_id: task.row.project_id,
        sprint_id: task.row.sprint_id,
        id: task.row.task_key,
        title: task.row.title,
        prompt: task.row.prompt_markdown || task.row.description || "",
        depends_on: task.dependsOnTaskIds.map((dependencyId) => taskKeyByRecordId.get(dependencyId) || dependencyId),
        status: run?.state && run.state !== "COMPLETED"
          ? run.state
          : mapPlanningStatusToRuntimeStatus(task.row.status),
        session_id: run?.session_id || undefined,
        session_name: run?.session_name || undefined,
        provider: run?.provider ? run.provider as Subtask["provider"] : undefined,
        worker_branch: run?.worker_branch || undefined,
        pr_url: run?.pr_url || undefined,
        activities: recentActivitiesByTaskId.get(task.row.id),
        is_independent: toBoolean(task.row.is_independent),
        is_merged: task.row.merge_indicator === "MERGED"
          || task.row.merge_indicator === "AUTOMERGE"
          || toBoolean(task.row.is_merged),
        merge_indicator: toMergeIndicator(task.row.merge_indicator),
      };
    });

    return {
      project_id: projectId,
      sprint_id: sprintIdToLoad ?? undefined,
      sprint_number: context?.sprintNumber ?? undefined,
      source_id: context?.sourceId ?? undefined,
      repo_path: context?.repoPath ?? undefined,
      feature_branch: context?.featureBranch ?? undefined,
      subtasks,
      reportText: context?.reportText || undefined,
      statusTable: context?.statusTable || undefined,
      instructions: context?.instructions || undefined,
      timestamp: context?.timestamp ?? null,
    };
  }

  getMappedTasks(projectId: string, sprintId: string | null): MappedTask[] {
    const rows = sprintId
      ? this.db.prepare(`
        SELECT *
        FROM tasks
        WHERE project_id = ? AND sprint_id = ?
        ORDER BY sort_order ASC, created_at ASC, task_key ASC
      `).all(projectId, sprintId)
      : this.db.prepare(`
        SELECT *
        FROM tasks
        WHERE project_id = ?
        ORDER BY sort_order ASC, created_at ASC, task_key ASC
      `).all(projectId);

    const taskRows = rows as unknown as TaskRow[];
    if (taskRows.length === 0) {
      return [];
    }

    const dependencyRows = this.storage.executeChunkedInQuery<DependencyRow>({
      sqlPrefix: "SELECT task_id, depends_on_task_id FROM task_dependencies WHERE task_id",
      sqlSuffix: "ORDER BY depends_on_task_id ASC",
      items: taskRows.map((row) => row.id),
    });

    const dependencyMap = new Map<string, string[]>();
    for (const row of dependencyRows) {
      const current = dependencyMap.get(row.task_id) || [];
      current.push(row.depends_on_task_id);
      dependencyMap.set(row.task_id, current);
    }

    return taskRows.map((row) => ({
      row,
      dependsOnTaskIds: dependencyMap.get(row.id) || [],
    }));
  }

  getLatestRuns(taskIds: string[]): Map<string, TaskRunRow> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const rows = this.storage.executeChunkedInQuery<TaskRunRow>({
      sqlPrefix: `SELECT tr.*
      FROM task_runs tr
      INNER JOIN (
        SELECT task_id, MAX(COALESCE(started_at, '')) AS latest_started_at
        FROM task_runs
        WHERE task_id`,
      sqlSuffix: `GROUP BY task_id
      ) latest
        ON latest.task_id = tr.task_id
       AND COALESCE(tr.started_at, '') = latest.latest_started_at
      ORDER BY tr.rowid DESC`,
      items: taskIds,
    });

    const map = new Map<string, TaskRunRow>();
    for (const row of rows) {
      if (!map.has(row.task_id)) {
        map.set(row.task_id, row);
      }
    }
    return map;
  }

  getRecentActivitiesByTask(taskIds: string[], limitPerTask: number = 5): Map<string, JulesActivity[]> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const rows = this.storage.executeChunkedInQuery<TaskActivityRow>({
      sqlPrefix: `SELECT
        task_id,
        session_id,
        session_name,
        provider,
        activity_id,
        activity_name,
        created_at,
        originator,
        payload_json
      FROM (
        SELECT
          tr.task_id,
          tr.session_id,
          tr.session_name,
          tr.provider,
          ${this.db.dialect.jsonExtract("tre.payload_json", "$.activityId")} AS activity_id,
          ${this.db.dialect.jsonExtract("tre.payload_json", "$.activityName")} AS activity_name,
          tre.created_at,
          tre.originator,
          tre.payload_json,
          ROW_NUMBER() OVER (
            PARTITION BY tr.task_id
            ORDER BY tre.created_at DESC, tre.id DESC
          ) AS activity_rank
        FROM task_run_events tre
        INNER JOIN task_runs tr ON tr.id = tre.task_run_id
        WHERE tr.task_id`,
      sqlSuffix: `AND tre.event_type = 'provider_activity'
      )
      WHERE activity_rank <= ?
      ORDER BY task_id ASC, created_at ASC`,
      items: taskIds,
      bindParamsAfter: [limitPerTask],
    });

    const activitiesByTaskId = new Map<string, JulesActivity[]>();
    for (const row of rows) {
      const activity = this.mapTaskActivityRow(row);
      if (!activity) {
        continue;
      }
      const existing = activitiesByTaskId.get(row.task_id) || [];
      existing.push(activity);
      activitiesByTaskId.set(row.task_id, existing);
    }

    return activitiesByTaskId;
  }

  mapTaskActivityRow(row: TaskActivityRow): JulesActivity | null {
    const payload = parsePayloadJson(row.payload_json);
    const agentMessaged = asRecord(payload?.agentMessaged);
    const userMessaged = asRecord(payload?.userMessaged);
    const progressUpdated = asRecord(payload?.progressUpdated);
    const planGenerated = asRecord(payload?.planGenerated);
    const planApproved = asRecord(payload?.planApproved);
    const sessionFailed = asRecord(payload?.sessionFailed);
    const activityId = asString(row.activity_id) || asString(payload?.activityId);
    const sessionName = asString(row.session_name) || asString(payload?.sessionName);

    if (!activityId) {
      return null;
    }

    return {
      id: activityId,
      name: asString(row.activity_name) || asString(payload?.activityName) || (sessionName ? `${sessionName}/activities/${activityId}` : `activities/${activityId}`),
      createTime: row.created_at,
      originator: asString(row.originator) || asString(payload?.originator) || "provider",
      description: asString(payload?.description),
      agentMessaged: agentMessaged ? { agentMessage: asString(agentMessaged.agentMessage) } : undefined,
      userMessaged: userMessaged ? { userMessage: asString(userMessaged.userMessage) } : undefined,
      progressUpdated: progressUpdated ? {
        title: asString(progressUpdated.title),
        description: asString(progressUpdated.description),
      } : undefined,
      planGenerated: planGenerated ? { plan: asRecord(planGenerated.plan) as JulesPlan | undefined } : undefined,
      planApproved: planApproved ? { planId: asString(planApproved.planId) } : undefined,
      sessionFailed: sessionFailed ? { reason: asString(sessionFailed.reason) } : undefined,
      sessionCompleted: payload?.sessionCompleted ?? undefined,
    };
  }

  resolveMappedTask(
    subtask: Subtask,
    tasksByRecordId: Map<string, MappedTask>,
    tasksByKey: Map<string, MappedTask>
  ): MappedTask | null {
    if (typeof subtask.record_id === "string" && tasksByRecordId.has(subtask.record_id)) {
      return tasksByRecordId.get(subtask.record_id) || null;
    }

    const taskKey = typeof subtask.id === "string" ? subtask.id.trim() : "";
    if (taskKey.length === 0) {
      return null;
    }

    return tasksByKey.get(taskKey) || null;
  }
}
