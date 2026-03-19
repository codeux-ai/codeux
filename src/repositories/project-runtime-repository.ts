import { randomUUID } from "crypto";
import * as path from "path";
import type { DatabaseSync } from "node:sqlite";
import type { DashboardStatus, Subtask, SubtaskMergeIndicator, SubtaskStatus } from "../contracts/app-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";

const RUNTIME_CONTEXT_PREFIX = "runtime_context:";

type PlanningTaskStatus = "pending" | "in_progress" | "coding_completed" | "completed";
type ProjectStatus = "running" | "failed" | "intervention" | "idle";
type TaskRunState = Exclude<SubtaskStatus, undefined>;

interface ProjectRow {
  id: string;
  base_dir: string;
  source_ref: string | null;
}

interface SprintRow {
  id: string;
  number: number | string | null;
}

interface TaskRow {
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

interface DependencyRow {
  task_id: string;
  depends_on_task_id: string;
}

interface TaskRunRow {
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

interface RuntimeContextPayload {
  projectId: string;
  sprintId: string | null;
  sprintNumber: number | null;
  sourceId: string | null;
  repoPath: string | null;
  featureBranch: string | null;
  reportText: string;
  statusTable: string;
  instructions: string;
  timestamp: string | null;
}

interface MappedTask {
  row: TaskRow;
  dependsOnTaskIds: string[];
}

const TERMINAL_TASK_STATES = new Set<TaskRunState>(["CODING_COMPLETED", "COMPLETED", "FAILED", "BLOCKED"]);

function toBoolean(value: number | string | null | undefined): boolean {
  return value === 1 || value === "1";
}

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function runtimeContextKey(projectId: string): string {
  return `${RUNTIME_CONTEXT_PREFIX}${projectId}`;
}

function mapPlanningStatusToRuntimeStatus(status: PlanningTaskStatus): TaskRunState {
  switch (status) {
    case "coding_completed":
      return "CODING_COMPLETED";
    case "completed":
      return "COMPLETED";
    case "in_progress":
      return "RUNNING";
    case "pending":
    default:
      return "PENDING";
  }
}

function mapRuntimeStatusToPlanningStatus(status: TaskRunState): PlanningTaskStatus | null {
  switch (status) {
    case "CODING_COMPLETED":
      return "coding_completed";
    case "RUNNING":
      return "in_progress";
    case "COMPLETED":
      return "completed";
    case "PENDING":
      return "pending";
    default:
      return null;
  }
}

function normalizePath(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }
  return path.resolve(trimmed);
}

function subtaskSignature(subtask: Subtask): string {
  return JSON.stringify({
    status: subtask.status || "PENDING",
    provider: subtask.provider || null,
    sessionId: subtask.session_id || null,
    sessionName: subtask.session_name || null,
    workerBranch: subtask.worker_branch || null,
    prUrl: subtask.pr_url || null,
    isMerged: Boolean(subtask.is_merged),
    mergeIndicator: subtask.merge_indicator || null,
  });
}

function toPersistedTaskRunState(status: TaskRunState): Exclude<TaskRunState, "CODING_COMPLETED"> {
  return status === "CODING_COMPLETED" ? "COMPLETED" : status;
}

function toMergeIndicator(value: string | null | undefined): SubtaskMergeIndicator | undefined {
  switch (value) {
    case "CI":
    case "AUTOMERGE":
    case "MERGED":
    case "MERGE_BLOCKED":
    case "MERGE_CONFLICT":
      return value;
    default:
      return undefined;
  }
}

export class ProjectRuntimeRepository {
  private readonly db: DatabaseSync;

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
  }

  syncDashboardStatus(status: Partial<DashboardStatus> | null): DashboardStatus | null {
    if (!status) {
      return null;
    }

    const project = this.resolveProjectForStatus(status);
    if (!project) {
      return null;
    }

    const sprint = this.resolveSprintForStatus(project.id, status);
    const tasks = this.getMappedTasks(project.id, sprint?.id ?? null);
    const tasksByRecordId = new Map(tasks.map((task) => [task.row.id, task]));
    const tasksByKey = new Map(tasks.map((task) => [task.row.task_key, task]));
    const subtasks = Array.isArray(status.subtasks) ? status.subtasks : [];
    const now = new Date().toISOString();

    this.runInTransaction(() => {
      this.saveRuntimeContext({
        projectId: project.id,
        sprintId: sprint?.id ?? null,
        sprintNumber: sprint?.number === null || sprint?.number === undefined
          ? (typeof status.sprint_number === "number" ? status.sprint_number : null)
          : toNumber(sprint.number),
        sourceId: typeof status.source_id === "string" ? status.source_id : null,
        repoPath: typeof status.repo_path === "string" ? status.repo_path : null,
        featureBranch: typeof status.feature_branch === "string" ? status.feature_branch : null,
        reportText: typeof status.reportText === "string" ? status.reportText : "",
        statusTable: typeof status.statusTable === "string" ? status.statusTable : "",
        instructions: typeof status.instructions === "string" ? status.instructions : "",
        timestamp: typeof status.timestamp === "string" ? status.timestamp : now,
      });

      let hasRunning = false;
      let hasFailure = false;
      let hasIntervention = false;

      for (const subtask of subtasks) {
        const mappedTask = this.resolveMappedTask(subtask, tasksByRecordId, tasksByKey);
        if (!mappedTask) {
          continue;
        }

        const runtimeState = subtask.status || "PENDING";
        if (runtimeState === "RUNNING") {
          hasRunning = true;
        } else if (runtimeState === "FAILED") {
          hasFailure = true;
        } else if (runtimeState === "BLOCKED") {
          hasIntervention = true;
        }

        const planningStatus = mapRuntimeStatusToPlanningStatus(runtimeState);
        this.db.prepare(`
          UPDATE tasks
          SET status = COALESCE(?, status),
              is_merged = ?,
              merge_indicator = ?,
              updated_at = ?
          WHERE id = ?
        `).run(
          planningStatus,
          Number(Boolean(subtask.is_merged)),
          subtask.merge_indicator || null,
          now,
          mappedTask.row.id
        );

        this.syncTaskRun(mappedTask.row, subtask, now);
      }

      const projectStatus: ProjectStatus = hasRunning
        ? "running"
        : hasFailure
          ? "failed"
          : hasIntervention
            ? "intervention"
            : "idle";

      this.db.prepare(`
        UPDATE projects
        SET status = ?, updated_at = ?
        WHERE id = ?
      `).run(projectStatus, now, project.id);

      if (sprint?.id) {
        const sprintStatus = hasRunning ? "running" : subtasks.some((task) => task.status === "FAILED") ? "failed" : "idle";
        this.db.prepare(`
          UPDATE sprints
          SET status = ?, updated_at = ?
          WHERE id = ?
        `).run(sprintStatus, now, sprint.id);
      }
    });

    this.realtimeNotifier?.scheduleProjectRuntimeStatusRefresh(project.id);

    return this.getProjectStatus(project.id);
  }

  getSelectedProjectStatus(): DashboardStatus {
    const projectId = this.getSelectedProjectId();
    if (!projectId) {
      return { subtasks: [], timestamp: null };
    }
    return this.getProjectStatus(projectId);
  }

  getProjectStatus(projectId: string): DashboardStatus {
    const context = this.getRuntimeContext(projectId);
    const tasks = this.getMappedTasks(projectId, context?.sprintId ?? null);
    const latestRuns = this.getLatestRuns(tasks.map((task) => task.row.id));
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
        is_independent: toBoolean(task.row.is_independent),
        is_merged: task.row.merge_indicator === "MERGED"
          || task.row.merge_indicator === "AUTOMERGE"
          || toBoolean(task.row.is_merged),
        merge_indicator: toMergeIndicator(task.row.merge_indicator),
      };
    });

    return {
      project_id: projectId,
      sprint_id: context?.sprintId ?? undefined,
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

  getSelectedProjectRepoPath(fallbackPath: string): string {
    const status = this.getSelectedProjectStatus();
    const repoPath = typeof status.repo_path === "string" ? status.repo_path.trim() : "";
    return repoPath.length > 0 ? repoPath : fallbackPath;
  }

  getSelectedProjectId(): string | null {
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = 'selected_project_id'
    `).get() as { payload: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.payload) as { projectId?: string | null };
      return parsed.projectId ?? null;
    } catch {
      return null;
    }
  }

  private resolveProjectForStatus(status: Partial<DashboardStatus>): ProjectRow | null {
    if (typeof status.project_id === "string" && status.project_id.trim().length > 0) {
      const direct = this.db.prepare(`
        SELECT p.id, p.base_dir, ps.source_ref
        FROM projects p
        LEFT JOIN project_sources ps ON ps.project_id = p.id
        WHERE p.id = ?
        LIMIT 1
      `).get(status.project_id.trim()) as ProjectRow | undefined;
      if (direct) {
        return direct;
      }
    }

    const repoPath = normalizePath(typeof status.repo_path === "string" ? status.repo_path : null);
    const selectedProjectId = this.getSelectedProjectId();
    const rows = this.db.prepare(`
      SELECT p.id, p.base_dir, ps.source_ref
      FROM projects p
      LEFT JOIN project_sources ps ON ps.project_id = p.id
      ORDER BY p.updated_at DESC
    `).all() as unknown as ProjectRow[];

    if (repoPath) {
      const match = rows.find((row) => {
        const baseDir = normalizePath(row.base_dir);
        const sourceRef = normalizePath(row.source_ref);
        return baseDir === repoPath || sourceRef === repoPath;
      });
      if (match) {
        return match;
      }
    }

    if (selectedProjectId) {
      return rows.find((row) => row.id === selectedProjectId) || null;
    }

    return rows[0] || null;
  }

  private resolveSprintForStatus(projectId: string, status: Partial<DashboardStatus>): SprintRow | null {
    if (typeof status.sprint_id === "string" && status.sprint_id.trim().length > 0) {
      const direct = this.db.prepare(`
        SELECT id, number
        FROM sprints
        WHERE id = ? AND project_id = ?
        LIMIT 1
      `).get(status.sprint_id.trim(), projectId) as SprintRow | undefined;
      if (direct) {
        return direct;
      }
    }

    if (typeof status.sprint_number === "number") {
      const row = this.db.prepare(`
        SELECT id, number
        FROM sprints
        WHERE project_id = ? AND number = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(projectId, status.sprint_number) as SprintRow | undefined;
      if (row) {
        return row;
      }
    }

    if (typeof status.feature_branch === "string" && status.feature_branch.trim().length > 0) {
      const row = this.db.prepare(`
        SELECT id, number
        FROM sprints
        WHERE project_id = ? AND feature_branch = ?
        ORDER BY updated_at DESC
        LIMIT 1
      `).get(projectId, status.feature_branch.trim()) as SprintRow | undefined;
      if (row) {
        return row;
      }
    }

    const existing = this.getRuntimeContext(projectId);
    if (existing?.sprintId) {
      return this.db.prepare(`
        SELECT id, number
        FROM sprints
        WHERE id = ?
      `).get(existing.sprintId) as SprintRow | undefined || null;
    }

    return null;
  }

  private getRuntimeContext(projectId: string): RuntimeContextPayload | null {
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(runtimeContextKey(projectId)) as { payload: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      return JSON.parse(row.payload) as RuntimeContextPayload;
    } catch {
      return null;
    }
  }

  private saveRuntimeContext(context: RuntimeContextPayload): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO app_settings (key, payload, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at
    `).run(
      runtimeContextKey(context.projectId),
      JSON.stringify(context),
      now
    );
  }

  private getMappedTasks(projectId: string, sprintId: string | null): MappedTask[] {
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

    const dependencyRows = this.db.prepare(`
      SELECT task_id, depends_on_task_id
      FROM task_dependencies
      WHERE task_id IN (${taskRows.map(() => "?").join(", ")})
      ORDER BY depends_on_task_id ASC
    `).all(...taskRows.map((row) => row.id)) as unknown as DependencyRow[];

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

  private getLatestRuns(taskIds: string[]): Map<string, TaskRunRow> {
    if (taskIds.length === 0) {
      return new Map();
    }

    const rows = this.db.prepare(`
      SELECT tr.*
      FROM task_runs tr
      INNER JOIN (
        SELECT task_id, MAX(COALESCE(started_at, '')) AS latest_started_at
        FROM task_runs
        WHERE task_id IN (${taskIds.map(() => "?").join(", ")})
        GROUP BY task_id
      ) latest
        ON latest.task_id = tr.task_id
       AND COALESCE(tr.started_at, '') = latest.latest_started_at
      ORDER BY tr.rowid DESC
    `).all(...taskIds) as unknown as TaskRunRow[];

    const map = new Map<string, TaskRunRow>();
    for (const row of rows) {
      if (!map.has(row.task_id)) {
        map.set(row.task_id, row);
      }
    }
    return map;
  }

  private resolveMappedTask(
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

  private syncTaskRun(task: TaskRow, subtask: Subtask, now: string): void {
    const runtimeState = subtask.status || "PENDING";
    const persistedRunState = toPersistedTaskRunState(runtimeState);
    const existing = this.findCandidateRun(task.id, subtask);
    const signature = subtaskSignature(subtask);

    if (!existing) {
      if (!this.shouldCreateTaskRun(subtask)) {
        return;
      }

      const runId = randomUUID();
      this.db.prepare(`
        INSERT INTO task_runs (
          id, project_id, sprint_id, task_id, connection_id, provider, mode, session_id, session_name,
          state, worker_branch, pr_url, started_at, finished_at, duration_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        runId,
        task.project_id,
        task.sprint_id,
        task.id,
        null,
        subtask.provider || null,
        "legacy-orchestrator",
        subtask.session_id || null,
        subtask.session_name || null,
        persistedRunState,
        subtask.worker_branch || null,
        subtask.pr_url || null,
        persistedRunState === "PENDING" ? null : now,
        TERMINAL_TASK_STATES.has(runtimeState) ? now : null,
        null
      );
      this.insertRunEvent(runId, "status_sync", {
        signature,
      }, now);
      return;
    }

    const previousSignature = JSON.stringify({
      status: existing.state,
      provider: existing.provider,
      sessionId: existing.session_id,
      sessionName: existing.session_name,
      workerBranch: existing.worker_branch,
      prUrl: existing.pr_url,
      isMerged: Boolean(subtask.is_merged),
      mergeIndicator: subtask.merge_indicator || null,
    });

    const startedAt = existing.started_at || (runtimeState === "PENDING" ? null : now);
    const finishedAt = TERMINAL_TASK_STATES.has(runtimeState)
      ? (existing.finished_at || now)
      : null;

    this.db.prepare(`
      UPDATE task_runs
      SET provider = ?, mode = ?, session_id = ?, session_name = ?, state = ?, worker_branch = ?, pr_url = ?,
          started_at = ?, finished_at = ?, duration_ms = ?
      WHERE id = ?
    `).run(
      subtask.provider || existing.provider || null,
      existing.mode || "legacy-orchestrator",
      subtask.session_id || existing.session_id || null,
      subtask.session_name || existing.session_name || null,
      persistedRunState,
      subtask.worker_branch || null,
      subtask.pr_url || null,
      startedAt,
      finishedAt,
      startedAt && finishedAt ? Math.max(0, new Date(finishedAt).getTime() - new Date(startedAt).getTime()) : null,
      existing.id
    );

    if (previousSignature !== signature) {
      this.insertRunEvent(existing.id, "status_sync", {
        previousSignature,
        signature,
      }, now);
    }
  }

  private findCandidateRun(taskId: string, subtask: Subtask): TaskRunRow | null {
    if (typeof subtask.session_id === "string" && subtask.session_id.trim().length > 0) {
      const row = this.db.prepare(`
        SELECT *
        FROM task_runs
        WHERE task_id = ? AND session_id = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(taskId, subtask.session_id.trim()) as TaskRunRow | undefined;
      if (row) {
        return row;
      }
    }

    if (typeof subtask.session_name === "string" && subtask.session_name.trim().length > 0) {
      const row = this.db.prepare(`
        SELECT *
        FROM task_runs
        WHERE task_id = ? AND session_name = ?
        ORDER BY rowid DESC
        LIMIT 1
      `).get(taskId, subtask.session_name.trim()) as TaskRunRow | undefined;
      if (row) {
        return row;
      }
    }

    const row = this.db.prepare(`
      SELECT *
      FROM task_runs
      WHERE task_id = ? AND finished_at IS NULL
      ORDER BY rowid DESC
      LIMIT 1
    `).get(taskId) as TaskRunRow | undefined;

    return row || null;
  }

  private shouldCreateTaskRun(subtask: Subtask): boolean {
    return Boolean(
      (subtask.session_id && subtask.session_id.trim().length > 0)
      || (subtask.session_name && subtask.session_name.trim().length > 0)
      || (subtask.provider && subtask.provider.trim().length > 0)
      || (subtask.worker_branch && subtask.worker_branch.trim().length > 0)
      || (subtask.pr_url && subtask.pr_url.trim().length > 0)
      || (subtask.status && subtask.status !== "PENDING")
    );
  }

  private insertRunEvent(taskRunId: string, eventType: string, payload: Record<string, unknown>, createdAt: string): void {
    this.db.prepare(`
      INSERT INTO task_run_events (id, task_run_id, event_type, originator, payload_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      randomUUID(),
      taskRunId,
      eventType,
      "system",
      JSON.stringify(payload),
      createdAt
    );
  }

  private runInTransaction(operation: () => void): void {
    this.db.exec("BEGIN");
    try {
      operation();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
