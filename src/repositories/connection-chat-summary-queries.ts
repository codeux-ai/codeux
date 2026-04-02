export const HIDDEN_INTERNAL_VISIBILITY = "hidden";

export function visibleConversationMessageFilter(alias: string): string {
  return `(COALESCE(json_extract(${alias}.metadata_json, '$.internalVisibility'), '') != '${HIDDEN_INTERNAL_VISIBILITY}')`;
}

export function isHiddenConversationMessage(metadata?: Record<string, unknown> | null): boolean {
  return metadata?.internalVisibility === HIDDEN_INTERNAL_VISIBILITY;
}

export function buildConnectionSummaryCte(projectId: string): { sql: string; params: unknown[] } {
  return {
    sql: `
      WITH scoped_connections AS (
        SELECT b.connection_id as id
        FROM connection_project_bindings b
        WHERE b.project_id = ?
      ),
      task_run_stats AS (
        SELECT tr.connection_id, COUNT(*) AS tasks_run_count
        FROM task_runs tr
        INNER JOIN scoped_connections sc ON tr.connection_id = sc.id
        WHERE tr.project_id = ?
        GROUP BY tr.connection_id
      ),
      thread_stats AS (
        SELECT ct.connection_id, COUNT(*) AS thread_count
        FROM conversation_threads ct
        INNER JOIN scoped_connections sc ON ct.connection_id = sc.id
        WHERE ct.project_id = ?
        GROUP BY ct.connection_id
      ),
      message_stats AS (
        SELECT ct.connection_id, COUNT(*) AS message_count
        FROM conversation_messages cm
        INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
        INNER JOIN scoped_connections sc ON ct.connection_id = sc.id
        WHERE ct.project_id = ?
          AND ${visibleConversationMessageFilter("cm")}
        GROUP BY ct.connection_id
      ),
      pending_stats AS (
        SELECT sc.id AS connection_id, COUNT(cm.id) AS pending_inbox_count
        FROM scoped_connections sc
        INNER JOIN conversation_threads ct ON ct.project_id = ? AND (ct.connection_id = sc.id OR ct.connection_id IS NULL)
        INNER JOIN conversation_messages cm ON cm.thread_id = ct.id
        WHERE cm.direction = 'dashboard_to_connection'
          AND cm.delivery_status = 'pending'
          AND ${visibleConversationMessageFilter("cm")}
        GROUP BY sc.id
      ),
      dispatch_stats AS (
        SELECT td.connection_id, COUNT(*) AS active_dispatch_count
        FROM task_dispatches td
        INNER JOIN scoped_connections sc ON td.connection_id = sc.id
        WHERE td.status IN ('claimed', 'running', 'cancel_requested')
        GROUP BY td.connection_id
      ),
      connection_stats AS (
        SELECT
          sc.id AS connection_id,
          COALESCE(trs.tasks_run_count, 0) AS tasks_run_count,
          COALESCE(ths.thread_count, 0) AS thread_count,
          COALESCE(ms.message_count, 0) AS message_count,
          COALESCE(ps.pending_inbox_count, 0) AS pending_inbox_count,
          COALESCE(ds.active_dispatch_count, 0) AS active_dispatch_count
        FROM scoped_connections sc
        LEFT JOIN task_run_stats trs ON trs.connection_id = sc.id
        LEFT JOIN thread_stats ths ON ths.connection_id = sc.id
        LEFT JOIN message_stats ms ON ms.connection_id = sc.id
        LEFT JOIN pending_stats ps ON ps.connection_id = sc.id
        LEFT JOIN dispatch_stats ds ON ds.connection_id = sc.id
      )
    `,
    params: [projectId, projectId, projectId, projectId, projectId],
  };
}

export function buildSingleConnectionSummaryCte(): { sql: string } {
  return {
    sql: `
      WITH connection_stats AS (
        SELECT
          td.connection_id,
          COUNT(*) AS active_dispatch_count
        FROM task_dispatches td
        WHERE td.status IN ('claimed', 'running', 'cancel_requested')
        GROUP BY td.connection_id
      )
    `
  };
}

export function buildThreadSummaryCte(): { sql: string } {
  return {
    sql: `
      WITH message_stats AS (
        SELECT
          thread_id,
          COUNT(*) AS message_count,
          MAX(created_at) AS max_message_at
        FROM conversation_messages cm
        WHERE ${visibleConversationMessageFilter("cm")}
        GROUP BY thread_id
      ),
      pending_stats AS (
        SELECT
          thread_id,
          COUNT(*) AS pending_message_count
        FROM conversation_messages cm
        WHERE direction = 'dashboard_to_connection'
          AND delivery_status IN ('pending', 'delivered')
          AND ${visibleConversationMessageFilter("cm")}
        GROUP BY thread_id
      ),
      preview_ranked AS (
        SELECT
          thread_id,
          body_markdown,
          ROW_NUMBER() OVER(PARTITION BY thread_id ORDER BY created_at DESC, id DESC) as rn
        FROM conversation_messages cm
        WHERE ${visibleConversationMessageFilter("cm")}
      ),
      thread_stats AS (
        SELECT
          ct.id AS thread_id,
          COALESCE(ms.message_count, 0) AS message_count,
          COALESCE(ps.pending_message_count, 0) AS pending_message_count,
          ms.max_message_at,
          pr.body_markdown AS last_message_preview
        FROM conversation_threads ct
        LEFT JOIN message_stats ms ON ms.thread_id = ct.id
        LEFT JOIN pending_stats ps ON ps.thread_id = ct.id
        LEFT JOIN preview_ranked pr ON pr.thread_id = ct.id AND pr.rn = 1
      )
    `
  };
}
