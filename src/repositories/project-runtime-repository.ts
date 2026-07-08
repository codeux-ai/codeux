import * as path from "path";
import { DatabaseAdapter } from "./db/database-adapter.js";
import type { DashboardStatus, Subtask } from "../contracts/app-types.js";
import type { SprintStatus } from "../contracts/project-management-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import type { DashboardRealtimeMutationNotifier } from "../services/dashboard-realtime-service.js";
import { mapRuntimeStatusToPlanningStatus } from "../services/subtask-state-mapper.js";
import { RuntimeContextStore } from "./project-runtime/runtime-context-store.js";
import {
  RunEventWrites,
  buildSessionIdentityCandidates,
  nonEmptyString,
  shouldPreserveCompletedSessionState,
  toPersistedTaskRunState,
} from "./project-runtime/run-event-writes.js";
import {
  RuntimeStatusProjection,
  ProjectStatus,
  MappedTask,
  TaskRow,
  TaskRunRow,
  TaskRunState,
  ProjectRow,
  SprintRow
} from "./project-runtime/runtime-status-projection.js";
import { toNumber } from "./repository-utils.js";

const RUNTIME_TERMINAL_STATES = new Set<TaskRunState>([
  "CODING_COMPLETED",
  "COMPLETED",
  "FAILED",
  "BLOCKED",
  "QA_REVIEW_FAILED",
]);

interface RuntimeStatusSubtask {
  index: number;
  mappedTask: MappedTask;
  subtask: Subtask;
}

interface RuntimeArtifactTaskRunRow {
  project_id: string;
  sprint_id: string;
  task_id: string;
  session_id: string | null;
  session_name: string | null;
  pr_url: string | null;
}

interface RuntimeArtifactProviderInvocationRow {
  project_id: string;
  sprint_id: string | null;
  task_id: string | null;
  session_id: string | null;
}

interface RuntimeCandidateTaskRunRow extends TaskRunRow {
  dispatch_status: string | null;
  dispatch_finished_at: string | null;
  latest_provider_invocation_status: string | null;
  latest_provider_invocation_finished_at: string | null;
}

function addStringMapValue<V>(map: Map<string, V[]>, key: string | null | undefined, value: V): void {
  const normalizedKey = nonEmptyString(key);
  if (!normalizedKey) {
    return;
  }
  const values = map.get(normalizedKey) || [];
  values.push(value);
  map.set(normalizedKey, values);
}

function isSameTaskRunOwner(task: TaskRow, row: RuntimeArtifactTaskRunRow): boolean {
  return row.project_id === task.project_id
    && row.sprint_id === task.sprint_id
    && row.task_id === task.id;
}

function isSameProviderInvocationOwner(task: TaskRow, row: RuntimeArtifactProviderInvocationRow): boolean {
  return row.project_id === task.project_id
    && (row.sprint_id === task.sprint_id || row.sprint_id === null)
    && (row.task_id === task.id || row.task_id === null);
}

function resolveTerminalEvidenceState(candidateRun: RuntimeCandidateTaskRunRow | null, reportedState: TaskRunState): TaskRunState {
  if (
    reportedState !== "RUNNING"
    || !candidateRun
    || candidateRun.state !== "RUNNING"
    || candidateRun.finished_at !== null
  ) {
    return reportedState;
  }

  switch (candidateRun.latest_provider_invocation_status) {
    case "failed":
    case "cancelled":
      return "FAILED";
    case "completed":
      return "CODING_COMPLETED";
  }

  switch (candidateRun.dispatch_status) {
    case "completed":
      return "CODING_COMPLETED";
    case "failed":
    case "cancelled":
      return "FAILED";
    case "blocked":
      return "BLOCKED";
    case "quota":
      return "QUOTA";
    default:
      return reportedState;
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

export class ProjectRuntimeRepository {
  private readonly db: DatabaseAdapter;
  private readonly runtimeContextStore: RuntimeContextStore;
  private readonly runtimeStatusProjection: RuntimeStatusProjection;
  private readonly runEventWrites: RunEventWrites;

  constructor(
    private readonly storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeNotifier?: DashboardRealtimeMutationNotifier,
  ) {
    this.db = storage.getDatabase();
    this.runtimeContextStore = new RuntimeContextStore(this.db);
    this.runtimeStatusProjection = new RuntimeStatusProjection(this.storage, this.db);
    this.runEventWrites = new RunEventWrites(this.db);
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
    const mappedSubtasks = subtasks
      .map((subtask, index): RuntimeStatusSubtask | null => {
        const mappedTask = this.runtimeStatusProjection.resolveMappedTask(subtask, tasksByRecordId, tasksByKey);
        return mappedTask ? { index, mappedTask, subtask } : null;
      })
      .filter((entry): entry is RuntimeStatusSubtask => entry !== null);
    const artifactScopes = this.resolveRuntimeArtifactScopes(mappedSubtasks);
    const candidateRuns = this.resolveCandidateTaskRuns(mappedSubtasks, artifactScopes);
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
      const updateTaskFromRuntimeStatus = this.db.prepare(`
        UPDATE tasks
        SET status = CASE
              WHEN (status = 'completed' OR is_merged = 1 OR merge_indicator IN ('MERGED', 'AUTOMERGE'))
                AND ? != 'completed'
              THEN 'completed'
              WHEN status = 'coding_completed' AND ? IN ('pending', 'in_progress')
              THEN status
              ELSE COALESCE(?, status)
            END,
            is_merged = CASE
              WHEN is_merged = 1 AND ? = 0 THEN is_merged
              WHEN merge_indicator IN ('MERGED', 'AUTOMERGE') AND ? = 0 THEN is_merged
              ELSE ?
            END,
            merge_indicator = CASE
              WHEN status = 'pending' THEN NULL
              WHEN ? = 'MERGE_CONFLICT'
                AND EXISTS (
                  SELECT 1
                  FROM project_attention_items
                  WHERE task_id = tasks.id
                    AND attention_type = 'merge_conflict'
                    AND owner_type = 'worker'
                    AND status = 'resolved'
                    AND json_extract(payload_json, '$.resolutionReason') IN (
                      'virtual_worker_merge_conflict_resolved',
                      'virtual_worker_merge_conflict_already_resolved'
                    )
                    AND (? IS NULL OR json_extract(payload_json, '$.conflictingBranches.source') = ?)
                    AND (? IS NULL OR json_extract(payload_json, '$.conflictingBranches.target') = ?)
                )
              THEN NULL
              WHEN merge_indicator IN ('MERGED', 'AUTOMERGE')
                AND (? IS NULL OR ? NOT IN ('MERGED', 'AUTOMERGE'))
              THEN merge_indicator
              WHEN ? IS NOT NULL THEN ?
              ELSE merge_indicator
            END,
            updated_at = ?
        WHERE id = ?
      `);

      for (const { index, mappedTask, subtask } of mappedSubtasks) {
        const artifactScope = artifactScopes.get(index) || "local";
        const scopedSubtask = artifactScope === "foreign"
          ? this.stripRuntimeArtifacts(subtask)
          : subtask;
        const candidateRun = artifactScope === "foreign"
          ? null
          : candidateRuns.get(index) ?? null;
        const reportedRuntimeState = shouldPreserveCompletedSessionState(candidateRun, scopedSubtask)
          ? "CODING_COMPLETED"
          : (scopedSubtask.status || "PENDING");
        const runtimeState = resolveTerminalEvidenceState(candidateRun, reportedRuntimeState);
        if (artifactScope !== "foreign") {
          if (runtimeState === "RUNNING") {
            hasRunning = true;
          } else if (runtimeState === "FAILED") {
            hasFailure = true;
          } else if (runtimeState === "BLOCKED") {
            hasIntervention = true;
          }
        }

        const planningStatus = artifactScope === "foreign"
          ? mappedTask.row.status
          : mapRuntimeStatusToPlanningStatus(runtimeState);
        // Protect merge_indicator from stale sprint-cycle writes during a task rerun:
        // After a rerun, the management API sets the DB task to status='pending' and
        // merge_indicator=null. A concurrent sprint cycle that loaded the task before
        // the rerun may still attempt to write the old merge_indicator (e.g. 'CI').
        // The CASE expression below uses pre-UPDATE DB column values. It also blocks
        // stale MERGE_CONFLICT snapshots from resurrecting a marker that a virtual
        // worker just cleared after resolving the matching attention item.
        const incomingMerged = Number(Boolean(scopedSubtask.is_merged));
        const incomingMergeIndicator = scopedSubtask.merge_indicator || null;
        const incomingWorkerBranch = scopedSubtask.worker_branch || null;
        const incomingFeatureBranch = status.feature_branch || null;
        updateTaskFromRuntimeStatus.run(
          planningStatus,
          planningStatus,
          planningStatus,
          incomingMerged,
          incomingMerged,
          incomingMerged,
          incomingMergeIndicator,
          incomingWorkerBranch,
          incomingWorkerBranch,
          incomingFeatureBranch,
          incomingFeatureBranch,
          incomingMergeIndicator,
          incomingMergeIndicator,
          incomingMergeIndicator,
          incomingMergeIndicator,
          now,
          mappedTask.row.id
        );

        if (artifactScope !== "foreign") {
          this.runEventWrites.syncTaskRun(mappedTask.row, scopedSubtask, now, candidateRun, runtimeState);
        }
      }

      const activeProjectRunStatus = this.findActiveProjectRunStatus(project.id);
      const projectStatus: ProjectStatus = activeProjectRunStatus === "queued"
        || activeProjectRunStatus === "running"
        || activeProjectRunStatus === "cancel_requested"
        ? "running"
        : hasRunning
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
        const sprintStatus = this.resolveSprintSummaryStatus(sprint.id, {
          hasRunning,
          hasFailure: subtasks.some((task) => task.status === "FAILED"),
        });
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

  private findActiveProjectRunStatus(projectId: string): string | null {
    const row = this.db.prepare(`
      SELECT status
      FROM sprint_runs
      WHERE project_id = ?
        AND status IN ('queued', 'running', 'paused', 'cancel_requested')
      ORDER BY COALESCE(last_heartbeat_at, updated_at, created_at) DESC, rowid DESC
      LIMIT 1
    `).get(projectId) as { status: string } | undefined;

    return row?.status ?? null;
  }

  private findActiveSprintRunStatus(sprintId: string): string | null {
    const row = this.db.prepare(`
      SELECT status
      FROM sprint_runs
      WHERE sprint_id = ?
        AND status IN ('queued', 'running', 'paused', 'cancel_requested')
      ORDER BY COALESCE(last_heartbeat_at, updated_at, created_at) DESC, rowid DESC
      LIMIT 1
    `).get(sprintId) as { status: string } | undefined;

    return row?.status ?? null;
  }

  private resolveSprintSummaryStatus(sprintId: string, fallback: { hasRunning: boolean; hasFailure: boolean }): SprintStatus {
    const activeRunStatus = this.findActiveSprintRunStatus(sprintId);
    if (activeRunStatus === "queued" || activeRunStatus === "running" || activeRunStatus === "cancel_requested") {
      return "running";
    }
    if (activeRunStatus === "paused") {
      return "paused";
    }
    if (fallback.hasRunning) {
      return "running";
    }
    if (fallback.hasFailure) {
      return "failed";
    }
    return "idle";
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

  private resolveCandidateTaskRuns(
    entries: RuntimeStatusSubtask[],
    artifactScopes: Map<number, "local" | "foreign">,
  ): Map<number, RuntimeCandidateTaskRunRow | null> {
    const localEntries = entries.filter((entry) => (artifactScopes.get(entry.index) || "local") === "local");
    const rows = this.storage.executeChunkedInQuery<RuntimeCandidateTaskRunRow>({
      sqlPrefix: `SELECT task_runs.*,
        td.status AS dispatch_status,
        td.finished_at AS dispatch_finished_at,
        (
          SELECT pi.status
          FROM provider_invocations pi
          WHERE pi.task_run_id = task_runs.id
          ORDER BY COALESCE(pi.finished_at, pi.started_at, pi.created_at) DESC, pi.rowid DESC
          LIMIT 1
        ) AS latest_provider_invocation_status,
        (
          SELECT pi.finished_at
          FROM provider_invocations pi
          WHERE pi.task_run_id = task_runs.id
          ORDER BY COALESCE(pi.finished_at, pi.started_at, pi.created_at) DESC, pi.rowid DESC
          LIMIT 1
        ) AS latest_provider_invocation_finished_at
        FROM task_runs
        LEFT JOIN task_dispatches td ON td.id = task_runs.dispatch_id
        WHERE task_runs.task_id`,
      sqlSuffix: "ORDER BY task_runs.task_id ASC, task_runs.rowid DESC",
      items: localEntries.map((entry) => entry.mappedTask.row.id),
    });
    const rowsByTaskId = new Map<string, RuntimeCandidateTaskRunRow[]>();
    for (const row of rows) {
      const taskRows = rowsByTaskId.get(row.task_id) || [];
      taskRows.push(row);
      rowsByTaskId.set(row.task_id, taskRows);
    }

    const candidateRuns = new Map<number, RuntimeCandidateTaskRunRow | null>();
    for (const { index, mappedTask, subtask } of localEntries) {
      const taskRows = rowsByTaskId.get(mappedTask.row.id) || [];
      const sessionId = nonEmptyString(subtask.session_id);
      if (sessionId) {
        const row = taskRows.find((candidate) => nonEmptyString(candidate.session_id) === sessionId);
        if (row) {
          candidateRuns.set(index, row);
          continue;
        }
      }

      const sessionName = nonEmptyString(subtask.session_name);
      if (sessionName) {
        const row = taskRows.find((candidate) => nonEmptyString(candidate.session_name) === sessionName);
        if (row) {
          candidateRuns.set(index, row);
          continue;
        }
      }

      const activeRun = taskRows.find((candidate) => candidate.finished_at === null);
      if (activeRun) {
        candidateRuns.set(index, activeRun);
        continue;
      }

      const persistedState = toPersistedTaskRunState(subtask.status || "PENDING");
      if (RUNTIME_TERMINAL_STATES.has(persistedState)) {
        const terminalRun = taskRows.find((candidate) => candidate.state === persistedState);
        if (terminalRun) {
          candidateRuns.set(index, terminalRun);
          continue;
        }
      }

      candidateRuns.set(index, null);
    }

    return candidateRuns;
  }

  private resolveRuntimeArtifactScopes(entries: RuntimeStatusSubtask[]): Map<number, "local" | "foreign"> {
    const sessionIdentities: string[] = [];
    const prUrls: string[] = [];
    for (const { subtask } of entries) {
      sessionIdentities.push(...buildSessionIdentityCandidates(subtask.session_id, subtask.session_name));
      const prUrl = nonEmptyString(subtask.pr_url);
      if (prUrl) {
        prUrls.push(prUrl);
      }
    }

    const taskRunsBySession = new Map<string, RuntimeArtifactTaskRunRow[]>();
    const taskRunSessionRows = [
      ...this.storage.executeChunkedInQuery<RuntimeArtifactTaskRunRow>({
        sqlPrefix: "SELECT project_id, sprint_id, task_id, session_id, session_name, pr_url FROM task_runs WHERE session_id",
        items: sessionIdentities,
      }),
      ...this.storage.executeChunkedInQuery<RuntimeArtifactTaskRunRow>({
        sqlPrefix: "SELECT project_id, sprint_id, task_id, session_id, session_name, pr_url FROM task_runs WHERE session_name",
        items: sessionIdentities,
      }),
    ];
    for (const row of taskRunSessionRows) {
      addStringMapValue(taskRunsBySession, row.session_id, row);
      addStringMapValue(taskRunsBySession, row.session_name, row);
    }

    const providerInvocationsBySession = new Map<string, RuntimeArtifactProviderInvocationRow[]>();
    const providerInvocationRows = this.storage.executeChunkedInQuery<RuntimeArtifactProviderInvocationRow>({
      sqlPrefix: "SELECT project_id, sprint_id, task_id, session_id FROM provider_invocations WHERE session_id",
      items: sessionIdentities,
    });
    for (const row of providerInvocationRows) {
      addStringMapValue(providerInvocationsBySession, row.session_id, row);
    }

    const taskRunsByPrUrl = new Map<string, RuntimeArtifactTaskRunRow[]>();
    const taskRunPrRows = this.storage.executeChunkedInQuery<RuntimeArtifactTaskRunRow>({
      sqlPrefix: "SELECT project_id, sprint_id, task_id, session_id, session_name, pr_url FROM task_runs WHERE pr_url",
      items: prUrls,
    });
    for (const row of taskRunPrRows) {
      addStringMapValue(taskRunsByPrUrl, row.pr_url, row);
    }

    const scopes = new Map<number, "local" | "foreign">();
    for (const { index, mappedTask, subtask } of entries) {
      const task = mappedTask.row;
      const sessionCandidates = buildSessionIdentityCandidates(subtask.session_id, subtask.session_name);
      const hasForeignSessionRun = sessionCandidates.some((candidate) =>
        (taskRunsBySession.get(candidate) || []).some((row) => !isSameTaskRunOwner(task, row))
      );
      if (hasForeignSessionRun) {
        scopes.set(index, "foreign");
        continue;
      }

      const hasForeignProviderInvocation = sessionCandidates.some((candidate) =>
        (providerInvocationsBySession.get(candidate) || []).some((row) => !isSameProviderInvocationOwner(task, row))
      );
      if (hasForeignProviderInvocation) {
        scopes.set(index, "foreign");
        continue;
      }

      const prUrl = nonEmptyString(subtask.pr_url);
      const hasForeignPrUrl = prUrl
        ? (taskRunsByPrUrl.get(prUrl) || []).some((row) => !isSameTaskRunOwner(task, row))
        : false;
      scopes.set(index, hasForeignPrUrl ? "foreign" : "local");
    }

    return scopes;
  }

  private stripRuntimeArtifacts(subtask: Subtask): Subtask {
    return {
      ...subtask,
      session_id: undefined,
      session_name: undefined,
      provider: undefined,
      worker_branch: undefined,
      pr_url: undefined,
      activities: undefined,
    };
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
