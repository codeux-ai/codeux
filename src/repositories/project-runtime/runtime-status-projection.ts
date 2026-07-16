import { DatabaseAdapter } from "../db/database-adapter.js";
import { AppDbStorage } from "../app-db-storage.js";
import type { DashboardStatus, JulesActivity, Subtask, SubtaskStatus } from "../../contracts/app-types.js";
import type { SprintReviewSummary } from "../../contracts/qa-review-summary.js";
import type { TaskSelfReflectionRating } from "../../contracts/task-self-reflection-types.js";
import { mapPlanningStatusToRuntimeStatus, toMergeIndicator } from "../../services/subtask-state-mapper.js";
import { RuntimeContextPayload } from "./runtime-context-store.js";
import { toNumber, toBoolean, parsePayloadJson } from "../repository-utils.js";
import { TaskSelfReflectionRatingRepository } from "../task-self-reflection-rating-repository.js";
import { resolveTaskCardCiStatus } from "../../domain/sprint/card-ci-status.js";
import { loadCardCiStatusEvidence } from "../project-management/card-ci-status-query.js";
import { loadLatestTaskReviewSummaryMap } from "../project-management/qa-review-summary-query.js";

export type PlanningTaskStatus = "pending" | "in_progress" | "coding_completed" | "completed" | "QA_REVIEW_FAILED";
export type ProjectStatus = "running" | "failed" | "intervention" | "idle";
export type TaskRunState = Exclude<SubtaskStatus, undefined>;
export type JulesPlan = { steps?: Array<{ title?: string }> };

const MAX_PROJECTED_ACTIVITY_TEXT_CHARS = 8 * 1024;
const MAX_PROJECTED_ACTIVITY_ID_CHARS = 2 * 1024;
const MAX_PROJECTED_PLAN_STEPS = 32;
const MAX_PROJECTED_PLAN_TITLE_CHARS = 512;
const MAX_PROJECTED_COMPLETION_JSON_CHARS = 8 * 1024;
const MAX_RECENT_ACTIVITY_CACHE_ENTRIES = 32;
const MAX_RECENT_ACTIVITY_CACHE_CHARS = 32 * 1024 * 1024;

function asBoundedString(value: unknown, maxChars = MAX_PROJECTED_ACTIVITY_TEXT_CHARS): string | undefined {
  const normalized = asString(value);
  if (!normalized || normalized.length <= maxChars) {
    return normalized;
  }
  const marker = "\n… [activity preview truncated] …\n";
  const retainedChars = Math.max(maxChars - marker.length, 0);
  const headChars = Math.ceil(retainedChars / 2);
  const tailChars = retainedChars - headChars;
  return `${normalized.slice(0, headChars)}${marker}${normalized.slice(-tailChars)}`.slice(0, maxChars);
}

function boundProjectedPlan(value: unknown): JulesPlan | undefined {
  const plan = asRecord(value);
  if (!plan) return undefined;
  const steps = Array.isArray(plan.steps)
    ? plan.steps.slice(0, MAX_PROJECTED_PLAN_STEPS).map((step) => ({
        title: asBoundedString(asRecord(step)?.title, MAX_PROJECTED_PLAN_TITLE_CHARS),
      }))
    : undefined;
  return steps ? { steps } : {};
}

function boundProjectedCompletion(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    const serialized = JSON.stringify(value);
    if (serialized.length <= MAX_PROJECTED_COMPLETION_JSON_CHARS) {
      return value;
    }
    return { truncated: true, originalChars: serialized.length };
  } catch {
    return { truncated: true, serializationFailed: true };
  }
}

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
  agent_preset_id: string | null;
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

export interface ProviderActivityVersionRow {
  id: string;
  created_at: string;
}

export interface MappedTask {
  row: TaskRow;
  dependsOnTaskIds: string[];
  latestReview?: SprintReviewSummary;
  selfReflectionRating?: TaskSelfReflectionRating;
}

interface RecentActivitiesCacheEntry {
  version: string;
  activitiesByTaskId: Map<string, JulesActivity[]>;
  estimatedChars: number;
}

export function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function isMergeSettled(row: TaskRow): boolean {
  return row.merge_indicator === "MERGED"
    || row.merge_indicator === "AUTOMERGE"
    || toBoolean(row.is_merged);
}

function resolveProjectedTaskStatus(row: TaskRow, run?: TaskRunRow): Subtask["status"] {
  if (row.status === "completed" || isMergeSettled(row)) {
    return "COMPLETED";
  }

  if (row.status === "coding_completed") {
    return "CODING_COMPLETED";
  }

  if (row.status === "QA_REVIEW_FAILED") {
    return "QA_REVIEW_FAILED";
  }

  if (run?.state && run.state !== "COMPLETED") {
    return run.state;
  }

  return mapPlanningStatusToRuntimeStatus(row.status);
}

export class RuntimeStatusProjection {
  private readonly recentActivitiesCache = new Map<string, RecentActivitiesCacheEntry>();
  private recentActivitiesCacheChars = 0;

  constructor(
    private readonly storage: AppDbStorage,
    private readonly db: DatabaseAdapter,
    private readonly taskSelfReflectionRatingRepository: TaskSelfReflectionRatingRepository = new TaskSelfReflectionRatingRepository(storage),
  ) {}

  buildProjectStatus(
    projectId: string,
    sprintIdToLoad: string | null,
    context: RuntimeContextPayload | null
  ): DashboardStatus {
    const tasks = this.getMappedTasks(projectId, sprintIdToLoad);
    const latestRuns = this.getLatestRuns(tasks.map((task) => task.row.id));
    const recentActivitiesByTaskId = this.getRecentActivitiesByTask(projectId, sprintIdToLoad, tasks.map((task) => task.row.id));
    const taskKeyByRecordId = new Map(tasks.map((task) => [task.row.id, task.row.task_key]));
    const ciEvidence = loadCardCiStatusEvidence(this.storage, {
      taskIds: tasks.map((task) => task.row.id),
      sprintIds: tasks.map((task) => task.row.sprint_id),
    });

    const subtasks: Subtask[] = tasks.map((task) => {
      const run = latestRuns.get(task.row.id);
      const merged = isMergeSettled(task.row);
      return {
        record_id: task.row.id,
        project_id: task.row.project_id,
        sprint_id: task.row.sprint_id,
        id: task.row.task_key,
        title: task.row.title,
        prompt: task.row.prompt_markdown || task.row.description || "",
        depends_on: task.dependsOnTaskIds.map((dependencyId) => taskKeyByRecordId.get(dependencyId) || dependencyId),
        status: resolveProjectedTaskStatus(task.row, run),
        session_id: run?.session_id || undefined,
        session_name: run?.session_name || undefined,
        provider: run?.provider ? run.provider as Subtask["provider"] : undefined,
        agentPresetId: task.row.agent_preset_id || null,
        worker_branch: merged ? undefined : run?.worker_branch || undefined,
        pr_url: run?.pr_url || undefined,
        activities: recentActivitiesByTaskId.get(task.row.id),
        is_independent: toBoolean(task.row.is_independent),
        latestReview: task.latestReview,
        selfReflectionRating: task.selfReflectionRating,
        is_merged: merged,
        merge_indicator: toMergeIndicator(task.row.merge_indicator),
        ciStatus: resolveTaskCardCiStatus({
          status: task.row.status,
          isMerged: merged,
          mergeIndicator: task.row.merge_indicator,
          latestGateEvent: ciEvidence.latestTaskGateByTaskId.get(task.row.id),
          hasActiveFailure: ciEvidence.failedTaskIds.has(task.row.id),
        }),
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

    const taskIds = taskRows.map((row) => row.id);
    const reviewMap = loadLatestTaskReviewSummaryMap(this.storage, taskIds);
    const selfReflectionRatingMap = this.taskSelfReflectionRatingRepository.getLatestByTaskIds(taskIds);

    return taskRows.map((row) => ({
      row,
      dependsOnTaskIds: dependencyMap.get(row.id) || [],
      latestReview: reviewMap.get(row.id),
      selfReflectionRating: selfReflectionRatingMap.get(row.id),
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

  getRecentActivitiesByTask(projectId: string, sprintId: string | null, taskIds: string[], limitPerTask: number = 5): Map<string, JulesActivity[]> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const cacheKey = this.getRecentActivitiesCacheKey(projectId, sprintId, taskIds, limitPerTask);
    const version = this.getProviderActivityVersion(projectId);
    const cached = this.recentActivitiesCache.get(cacheKey);
    if (cached?.version === version) {
      return this.cloneActivitiesByTaskId(cached.activitiesByTaskId);
    }

    const rows = this.storage.executeChunkedInQuery<TaskActivityRow>({
      sqlPrefix: `SELECT
        task_id,
        session_id,
        session_name,
        provider,
        ${this.db.dialect.jsonExtract("payload_json", "$.activityId")} AS activity_id,
        ${this.db.dialect.jsonExtract("payload_json", "$.activityName")} AS activity_name,
        created_at,
        originator,
        payload_json
      FROM (
        SELECT
          tr.task_id,
          tr.session_id,
          tr.session_name,
          tr.provider,
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

    this.setRecentActivitiesCache(cacheKey, {
      version,
      activitiesByTaskId: this.cloneActivitiesByTaskId(activitiesByTaskId),
      estimatedChars: this.estimateActivitiesChars(activitiesByTaskId),
    });

    return activitiesByTaskId;
  }

  private getRecentActivitiesCacheKey(projectId: string, sprintId: string | null, taskIds: string[], limitPerTask: number): string {
    return [projectId, sprintId || "", String(limitPerTask), ...taskIds].join("\u0000");
  }

  private getProviderActivityVersion(projectId: string): string {
    const row = this.db.prepare(`
      SELECT id, created_at
      FROM task_run_events
      WHERE project_id = ?
        AND event_type = 'provider_activity'
      ORDER BY created_at DESC, id DESC
      LIMIT 1
    `).get(projectId) as ProviderActivityVersionRow | undefined;

    return row ? `${row.created_at}\u0000${row.id}` : "";
  }

  private cloneActivitiesByTaskId(activitiesByTaskId: Map<string, JulesActivity[]>): Map<string, JulesActivity[]> {
    return new Map([...activitiesByTaskId.entries()].map(([taskId, activities]) => [taskId, [...activities]]));
  }

  private setRecentActivitiesCache(cacheKey: string, entry: RecentActivitiesCacheEntry): void {
    const replaced = this.recentActivitiesCache.get(cacheKey);
    if (replaced) {
      this.recentActivitiesCacheChars -= replaced.estimatedChars;
      this.recentActivitiesCache.delete(cacheKey);
    }
    this.recentActivitiesCache.set(cacheKey, entry);
    this.recentActivitiesCacheChars += entry.estimatedChars;
    while (
      this.recentActivitiesCache.size > MAX_RECENT_ACTIVITY_CACHE_ENTRIES
      || (this.recentActivitiesCacheChars > MAX_RECENT_ACTIVITY_CACHE_CHARS && this.recentActivitiesCache.size > 1)
    ) {
      const oldestKey = this.recentActivitiesCache.keys().next().value;
      if (typeof oldestKey !== "string") {
        return;
      }
      const oldest = this.recentActivitiesCache.get(oldestKey);
      this.recentActivitiesCache.delete(oldestKey);
      this.recentActivitiesCacheChars -= oldest?.estimatedChars ?? 0;
    }
  }

  private estimateActivitiesChars(activitiesByTaskId: Map<string, JulesActivity[]>): number {
    let total = 0;
    for (const [taskId, activities] of activitiesByTaskId) {
      total += taskId.length;
      for (const activity of activities) {
        try {
          total += JSON.stringify(activity).length;
        } catch {
          total += MAX_PROJECTED_ACTIVITY_TEXT_CHARS;
        }
      }
    }
    return total;
  }

  mapTaskActivityRow(row: TaskActivityRow): JulesActivity | null {
    const payload = parsePayloadJson(row.payload_json);
    const agentMessaged = asRecord(payload?.agentMessaged);
    const userMessaged = asRecord(payload?.userMessaged);
    const progressUpdated = asRecord(payload?.progressUpdated);
    const planGenerated = asRecord(payload?.planGenerated);
    const planApproved = asRecord(payload?.planApproved);
    const sessionFailed = asRecord(payload?.sessionFailed);
    const activityId = asBoundedString(row.activity_id, MAX_PROJECTED_ACTIVITY_ID_CHARS)
      || asBoundedString(payload?.activityId, MAX_PROJECTED_ACTIVITY_ID_CHARS);
    const sessionName = asBoundedString(row.session_name, MAX_PROJECTED_ACTIVITY_ID_CHARS)
      || asBoundedString(payload?.sessionName, MAX_PROJECTED_ACTIVITY_ID_CHARS);

    if (!activityId) {
      return null;
    }

    return {
      id: activityId,
      name: asBoundedString(row.activity_name, MAX_PROJECTED_ACTIVITY_ID_CHARS)
        || asBoundedString(payload?.activityName, MAX_PROJECTED_ACTIVITY_ID_CHARS)
        || (sessionName ? `${sessionName}/activities/${activityId}` : `activities/${activityId}`),
      createTime: row.created_at,
      originator: asBoundedString(row.originator, MAX_PROJECTED_ACTIVITY_ID_CHARS)
        || asBoundedString(payload?.originator, MAX_PROJECTED_ACTIVITY_ID_CHARS)
        || "provider",
      description: asBoundedString(payload?.description),
      agentMessaged: agentMessaged ? { agentMessage: asBoundedString(agentMessaged.agentMessage) } : undefined,
      userMessaged: userMessaged ? { userMessage: asBoundedString(userMessaged.userMessage) } : undefined,
      progressUpdated: progressUpdated ? {
        title: asBoundedString(progressUpdated.title),
        description: asBoundedString(progressUpdated.description),
      } : undefined,
      planGenerated: planGenerated ? { plan: boundProjectedPlan(planGenerated.plan) } : undefined,
      planApproved: planApproved ? { planId: asBoundedString(planApproved.planId, MAX_PROJECTED_ACTIVITY_ID_CHARS) } : undefined,
      sessionFailed: sessionFailed ? { reason: asBoundedString(sessionFailed.reason) } : undefined,
      sessionCompleted: boundProjectedCompletion(payload?.sessionCompleted),
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
