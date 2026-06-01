export const projectSummaryQuery = {
  select: `
      SELECT
        p.id,
        p.slug,
        p.name,
        p.base_dir,
        p.repo_url,
        p.default_branch,
        p.feature_branch_prefix,
        p.status,
        p.default_agent_presets_provisioned,
        p.created_at,
        p.updated_at,
        ps.source_type,
        ps.source_ref,
        (SELECT COUNT(*) FROM sprints s WHERE s.project_id = p.id) AS sprints_count,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status = 'completed') AS completed_tasks,
        (SELECT COUNT(*) FROM tasks t WHERE t.project_id = p.id AND t.status != 'completed') AS open_tasks,
        (SELECT MAX(CASE WHEN sr.status IN ('running', 'queued') THEN 1 ELSE 0 END) FROM sprint_runs sr WHERE sr.project_id = p.id) AS has_active_runs
  `,
  from: `
      FROM projects p
      LEFT JOIN project_sources ps ON ps.project_id = p.id
  `,
};
