import { randomUUID } from "crypto";
import * as path from "path";
import { DatabaseAdapter } from "./db/database-adapter.js";
import type { DashboardStatus, Subtask, SubtaskStatus } from "../contracts/app-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import { mapRuntimeStatusToPlanningStatus } from "../services/subtask-state-mapper.js";
import { RuntimeContextStore } from "./project-runtime/runtime-context-store.js";
import {
  RuntimeStatusProjection,
  ProjectStatus,
  TaskRunState,
  TaskRow,
  TaskRunRow,
  ProjectRow,
  SprintRow
} from "./project-runtime/runtime-status-projection.js";
import { toNumber } from "./repository-utils.js";

const TERMINAL_TASK_STATES = new Set<TaskRunState>(["CODING_COMPLETED", "COMPLETED", "FAILED", "BLOCKED"]);

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

export class ProjectRuntimeRepository {
  private readonly db: DatabaseAdapter;
  private readonly runtimeContextStore: RuntimeContextStore;
  private readonly runtimeStatusProjection: RuntimeStatusProjection;

  constructor(
    private readonly storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
    this.runtimeContextStore = new RuntimeContextStore(this.db);
    this.runtimeStatusProjection = new RuntimeStatusProjection(this.storage, this.db);
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
    const tasks = this.runtimeStatusProjection.getMappedTasks(project.id, sprint?.id ?? null);
    const tasksByRecordId = new Map(tasks.map((task) => [task.row.id, task]));
    const tasksByKey = new Map(tasks.map((task) => [task.row.task_key, task]));
    const subtasks = Array.isArray(status.subtasks) ? status.subtasks : [];
    const now = new Date().toISOString();

    this.runInTransaction(() => {
      if (sprint?.id) {
        this.runtimeContextStore.saveRuntimeContext({
          projectId: project.id,
          sprintId: sprint.id,
          sprintNumber: sprint.number === null || sprint.number === undefined
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
        this.runtimeContextStore.clearLegacyProjectRuntimeContext(project.id);
      }

      let hasRunning = false;
      let hasFailure = false;
      let hasIntervention = false;

      for (const subtask of subtasks) {
        const mappedTask = this.runtimeStatusProjection.resolveMappedTask(subtask, tasksByRecordId, tasksByKey);
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
        // Protect merge_indicator from stale sprint-cycle writes during a task rerun:
        // After a rerun, the management API sets the DB task to status='pending' and
        // merge_indicator=null. A concurrent sprint cycle that loaded the task before
        // the rerun may still attempt to write the old merge_indicator (e.g. 'CI').
        // The CASE expression below uses the pre-UPDATE DB status column value: when it
        // is 'pending' (i.e. the task was just reset), always write NULL so that stale
        // in-memory cycle data cannot restore a cleared indicator.
        this.db.prepare(`
          UPDATE tasks
          SET status = COALESCE(?, status),
              is_merged = ?,
              merge_indicator = CASE
                WHEN status = 'pending' THEN NULL
                WHEN ? IS NOT NULL THEN ?
                ELSE merge_indicator
              END,
              updated_at = ?
          WHERE id = ?
        `).run(
          planningStatus,
          Number(Boolean(subtask.is_merged)),
          subtask.merge_indicator || null,
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

    return this.getProjectStatus(project.id, sprint?.id ?? null);
  }

  getSelectedProjectStatus(): DashboardStatus {
    const projectId = this.getSelectedProjectId();
    if (!projectId) {
      return { subtasks: [], timestamp: null };
    }
    const sprintId = this.getSelectedSprintId(projectId);
    return this.getProjectStatus(projectId, sprintId);
  }

  getProjectLiveStatus(projectId: string, preferredSprintId?: string | null): DashboardStatus {
    const sprintId = this.resolveLiveSprintId(projectId, preferredSprintId);
    return this.getProjectStatus(projectId, sprintId);
  }

  getSelectedProjectLiveStatus(): DashboardStatus {
    const projectId = this.getSelectedProjectId();
    if (!projectId) {
      return { subtasks: [], timestamp: null };
    }
    return this.getProjectLiveStatus(projectId);
  }

  getProjectStatus(projectId: string, explicitSprintId?: string | null): DashboardStatus {
    const sprintIdToLoad = explicitSprintId ?? this.getSelectedSprintId(projectId) ?? null;
    const context = sprintIdToLoad ? this.runtimeContextStore.getRuntimeContext(projectId, sprintIdToLoad) : null;
    return this.runtimeStatusProjection.buildProjectStatus(projectId, sprintIdToLoad, context);
  }

  getSelectedProjectRepoPath(fallbackPath: string): string {
    const status = this.getSelectedProjectLiveStatus();
    const repoPath = typeof status.repo_path === "string" ? status.repo_path.trim() : "";
    return repoPath.length > 0 ? repoPath : fallbackPath;
  }

  getSelectedSprintId(projectId: string): string | null {
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(`selected_sprint_id_${projectId}`) as { payload: string } | undefined;

    if (!row) {
      return null;
    }

    try {
      const parsed = JSON.parse(row.payload) as { sprintId?: string | null };
      return parsed.sprintId ?? null;
    } catch {
      return null;
    }
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

    return null;
  }

  private resolveLiveSprintId(projectId: string, preferredSprintId?: string | null): string | null {
    if (preferredSprintId) {
      const preferredActiveRow = this.db.prepare(`
        SELECT sr.sprint_id
        FROM sprint_runs sr
        WHERE sr.project_id = ?
          AND sr.sprint_id = ?
          AND sr.status IN ('queued', 'running', 'paused', 'cancel_requested')
        ORDER BY COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.created_at) DESC, sr.rowid DESC
        LIMIT 1
      `).get(projectId, preferredSprintId) as { sprint_id: string } | undefined;
      if (preferredActiveRow) {
        return preferredActiveRow.sprint_id;
      }
    }

    const activeRow = this.db.prepare(`
      SELECT sr.sprint_id
      FROM sprint_runs sr
      WHERE sr.project_id = ?
        AND sr.status IN ('queued', 'running', 'paused', 'cancel_requested')
      ORDER BY COALESCE(sr.last_heartbeat_at, sr.updated_at, sr.created_at) DESC, sr.rowid DESC
      LIMIT 1
    `).get(projectId) as { sprint_id: string } | undefined;
    if (activeRow) {
      return activeRow.sprint_id;
    }

    if (preferredSprintId) {
      return preferredSprintId;
    }

    const selectedSprintId = this.getSelectedSprintId(projectId);
    if (selectedSprintId) {
      return selectedSprintId;
    }

    return null;
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
