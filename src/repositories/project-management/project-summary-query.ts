import type { AppDbStorage } from "../app-db-storage.js";
import { toBoolean, toNumber } from "../repository-utils.js";

export interface ProjectSummaryAggregation {
  sprintsCount: number;
  openTasks: number;
  completedTasks: number;
  hasActiveRuns: boolean;
  lastRunAt: string | null;
  lastRunStatus: string | null;
}

interface ProjectSprintCountRow {
  project_id: string;
  sprints_count: number | string | null;
}

interface ProjectTaskCountRow {
  project_id: string;
  completed_tasks: number | string | null;
  open_tasks: number | string | null;
}

interface ProjectActiveRunRow {
  project_id: string;
  has_active_runs: number | string | null;
}

interface ProjectLastRunRow {
  project_id: string;
  last_run_at: string | null;
  last_run_status: string | null;
}

export const projectSummaryQuery = {
  select: `
      SELECT
        p.id,
        p.slug,
        p.name,
        p.base_dir,
        p.repo_url,
        p.initialization_mode,
        p.default_branch,
        p.feature_branch_prefix,
        p.status,
        p.created_at,
        p.updated_at,
        ps.source_type,
        ps.source_ref
  `,
  from: `
      FROM projects p
      LEFT JOIN project_sources ps ON ps.project_id = p.id
  `,
};

export function loadProjectSummaryAggregationMap(
  storage: AppDbStorage,
  projectIds: string[]
): Map<string, ProjectSummaryAggregation> {
  const uniqueProjectIds = [...new Set(projectIds)];
  const map = new Map<string, ProjectSummaryAggregation>();
  for (const projectId of uniqueProjectIds) {
    map.set(projectId, {
      sprintsCount: 0,
      openTasks: 0,
      completedTasks: 0,
      hasActiveRuns: false,
      lastRunAt: null,
      lastRunStatus: null,
    });
  }

  if (uniqueProjectIds.length === 0) {
    return map;
  }

  for (const row of storage.executeChunkedInQuery<ProjectSprintCountRow>({
    sqlPrefix: `
      SELECT project_id, COUNT(*) AS sprints_count
      FROM sprints
      WHERE project_id`,
    sqlSuffix: `
      GROUP BY project_id
    `,
    items: uniqueProjectIds,
  })) {
    const aggregate = map.get(row.project_id);
    if (aggregate) {
      aggregate.sprintsCount = toNumber(row.sprints_count);
    }
  }

  for (const row of storage.executeChunkedInQuery<ProjectTaskCountRow>({
    sqlPrefix: `
      SELECT
        project_id,
        COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_tasks,
        COALESCE(SUM(CASE WHEN status != 'completed' THEN 1 ELSE 0 END), 0) AS open_tasks
      FROM tasks
      WHERE project_id`,
    sqlSuffix: `
      GROUP BY project_id
    `,
    items: uniqueProjectIds,
  })) {
    const aggregate = map.get(row.project_id);
    if (aggregate) {
      aggregate.completedTasks = toNumber(row.completed_tasks);
      aggregate.openTasks = toNumber(row.open_tasks);
    }
  }

  for (const row of storage.executeChunkedInQuery<ProjectActiveRunRow>({
    sqlPrefix: `
      WITH scoped_sprints AS (
        SELECT id, project_id, status
        FROM sprints
        WHERE project_id`,
    sqlSuffix: `
      ),
      latest_sprint_runs AS (
        SELECT sprint_id, status
        FROM (
          SELECT
            sr.sprint_id,
            sr.status,
            ROW_NUMBER() OVER (
              PARTITION BY sr.sprint_id
              ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
            ) AS row_number
          FROM sprint_runs sr
          INNER JOIN scoped_sprints ss ON ss.id = sr.sprint_id
        )
        WHERE row_number = 1
      )
      SELECT ss.project_id, 1 AS has_active_runs
      FROM scoped_sprints ss
      LEFT JOIN latest_sprint_runs lsr ON lsr.sprint_id = ss.id
      WHERE COALESCE(lsr.status, ss.status) IN ('running', 'queued', 'cancel_requested')
      GROUP BY ss.project_id
    `,
    items: uniqueProjectIds,
  })) {
    const aggregate = map.get(row.project_id);
    if (aggregate) {
      aggregate.hasActiveRuns = toBoolean(row.has_active_runs);
    }
  }

  for (const row of storage.executeChunkedInQuery<ProjectLastRunRow>({
    sqlPrefix: `
      SELECT project_id, activity_at AS last_run_at, run_status AS last_run_status
      FROM (
        SELECT
          project_run_activity.*,
          ROW_NUMBER() OVER (
            PARTITION BY project_id
            ORDER BY activity_at DESC, source_priority DESC, source_rowid DESC
          ) AS row_number
        FROM (
          SELECT
            sr.project_id,
            COALESCE(sr.finished_at, sr.started_at, sr.created_at) AS activity_at,
            sr.status AS run_status,
            1 AS source_priority,
            sr.rowid AS source_rowid
          FROM sprint_runs sr
          UNION ALL
          SELECT
            tr.project_id,
            tr.started_at AS activity_at,
            tr.state AS run_status,
            0 AS source_priority,
            tr.rowid AS source_rowid
          FROM task_runs tr
          WHERE tr.started_at IS NOT NULL
        ) project_run_activity
        WHERE project_id`,
    sqlSuffix: `
      )
      WHERE row_number = 1
    `,
    items: uniqueProjectIds,
  })) {
    const aggregate = map.get(row.project_id);
    if (aggregate) {
      aggregate.lastRunAt = row.last_run_at;
      aggregate.lastRunStatus = row.last_run_status;
    }
  }

  return map;
}
