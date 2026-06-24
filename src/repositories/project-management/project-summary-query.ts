const projectRunActivityCte = `
      WITH project_run_activity AS (
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
      )
`;

export const projectSummaryQuery = {
  select: `
      ${projectRunActivityCte}
      SELECT
        p.id,
        p.slug,
        p.name,
        p.base_dir,
        p.repo_url,
        p.default_branch,
        p.feature_branch_prefix,
        p.status,
        p.created_at,
        p.updated_at,
        ps.source_type,
        ps.source_ref,
        (SELECT COUNT(*) FROM sprints s WHERE s.project_id = p.id) AS sprints_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'completed') AS open_tasks,
        (
          SELECT CASE WHEN COUNT(*) > 0 THEN 1 ELSE 0 END
          FROM sprints s
          WHERE s.project_id = p.id
            AND COALESCE(
              (
                SELECT sr.status
                FROM sprint_runs sr
                WHERE sr.sprint_id = s.id
                ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
                LIMIT 1
              ),
              s.status
            ) IN ('running', 'queued')
        ) AS has_active_runs,
        (
          SELECT pra.activity_at
          FROM project_run_activity pra
          WHERE pra.project_id = p.id
          ORDER BY pra.activity_at DESC, pra.source_priority DESC, pra.source_rowid DESC
          LIMIT 1
        ) AS last_run_at,
        (
          SELECT pra.run_status
          FROM project_run_activity pra
          WHERE pra.project_id = p.id
          ORDER BY pra.activity_at DESC, pra.source_priority DESC, pra.source_rowid DESC
          LIMIT 1
        ) AS last_run_status
  `,
  from: `
      FROM projects p
      LEFT JOIN project_sources ps ON ps.project_id = p.id
  `,
};
