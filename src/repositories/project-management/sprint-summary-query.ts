export const sprintSummaryQuery = {
  select: `
      SELECT
        s.id,
        s.project_id,
        s.number,
        s.slug,
        s.name,
        s.original_prompt,
        s.goal,
        s.status,
        s.showcase_pinned,
        s.start_date,
        s.end_date,
        s.feature_branch,
        s.created_at,
        s.updated_at,
        COUNT(t.id) AS tasks_count,
        COALESCE(SUM(CASE WHEN t.status = 'completed' THEN 1 ELSE 0 END), 0) AS completed_tasks,
        (
          SELECT sr.status
          FROM sprint_runs sr
          WHERE sr.sprint_id = s.id
          ORDER BY COALESCE(sr.started_at, sr.created_at) DESC, sr.created_at DESC, sr.rowid DESC
          LIMIT 1
        ) AS latest_run_status,
        (
          SELECT json_object(
            'status', q.status,
            'outcome', q.outcome,
            'summary', q.summary_markdown,
            'reviewer', q.agent_name,
            'finishedAt', q.finished_at
          )
          FROM qa_review_runs q
          WHERE q.sprint_id = s.id
            AND q.trigger_type = 'sprint_completion'
          ORDER BY q.started_at DESC, q.rowid DESC
          LIMIT 1
        ) AS latest_sprint_review_json
  `,
  from: `
      FROM sprints s
      LEFT JOIN tasks t ON t.sprint_id = s.id
  `,
  groupBy: `
      GROUP BY s.id
  `,
};
