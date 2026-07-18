import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { ConversationThreadRecord } from "../../contracts/connection-chat-types.js";
import {
  DEFAULT_CONVERSATION_THREAD_LIST_LIMIT,
  MAX_CONVERSATION_THREAD_LIST_LIMIT,
  visibleConversationMessageFilter,
  mapThreadRow,
  normalizeQueryLimit,
  normalizeQueryOffset,
  type ConversationQueryPaginationOptions,
  type ThreadRow,
} from "./conversation-query-utils.js";

export function listConversationThreadsQuery(
  db: DatabaseAdapter,
  projectId: string,
  options?: ConversationQueryPaginationOptions,
): ConversationThreadRecord[] {
  const limit = normalizeQueryLimit(
    options?.limit,
    DEFAULT_CONVERSATION_THREAD_LIST_LIMIT,
    MAX_CONVERSATION_THREAD_LIST_LIMIT,
  );
  const offset = normalizeQueryOffset(options?.offset);
  const rows = db.prepare(`
    WITH
    message_stats AS (
      SELECT
        cm.thread_id,
        COUNT(*) AS message_count,
        SUM(CASE WHEN cm.direction = 'dashboard_to_connection' AND cm.delivery_status IN ('pending', 'delivered') THEN 1 ELSE 0 END) AS pending_message_count
      FROM conversation_messages cm
      INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
      WHERE ct.project_id = ? AND ${visibleConversationMessageFilter("cm")}
      GROUP BY cm.thread_id
    ),
    last_messages AS (
      SELECT thread_id, created_at, body_markdown
      FROM (
        SELECT
          cm.thread_id,
          cm.created_at,
          cm.body_markdown,
          ROW_NUMBER() OVER (PARTITION BY cm.thread_id ORDER BY cm.created_at DESC, cm.rowid DESC) as rn
        FROM conversation_messages cm
        INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
        WHERE ct.project_id = ? AND ${visibleConversationMessageFilter("cm")}
      )
      WHERE rn = 1
    )
    SELECT
      ct.*,
      COALESCE(ms.message_count, 0) AS message_count,
      COALESCE(ms.pending_message_count, 0) AS pending_message_count,
      lm.created_at AS last_message_at,
      lm.body_markdown AS last_message_preview
    FROM conversation_threads ct
    LEFT JOIN message_stats ms ON ms.thread_id = ct.id
    LEFT JOIN last_messages lm ON lm.thread_id = ct.id
    WHERE ct.project_id = ?
    ORDER BY COALESCE(lm.created_at, ct.updated_at) DESC, ct.created_at DESC, ct.id DESC
    LIMIT ?
    OFFSET ?
  `).all(projectId, projectId, projectId, limit, offset) as unknown as ThreadRow[];

  return rows.map((row) => mapThreadRow(row));
}

export function requireConversationThreadQuery(db: DatabaseAdapter, threadId: string): ConversationThreadRecord {
  const row = db.prepare(`
    WITH
    message_stats AS (
      SELECT
        thread_id,
        COUNT(*) AS message_count,
        SUM(CASE WHEN direction = 'dashboard_to_connection' AND delivery_status IN ('pending', 'delivered') THEN 1 ELSE 0 END) AS pending_message_count
      FROM conversation_messages cm
      WHERE cm.thread_id = ?
        AND ${visibleConversationMessageFilter("cm")}
      GROUP BY thread_id
    ),
    last_messages AS (
      SELECT thread_id, created_at, body_markdown
      FROM (
        SELECT
          thread_id,
          created_at,
          body_markdown,
          ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at DESC, cm.rowid DESC) as rn
        FROM conversation_messages cm
        WHERE cm.thread_id = ?
          AND ${visibleConversationMessageFilter("cm")}
      )
      WHERE rn = 1
    )
    SELECT
      ct.*,
      COALESCE(ms.message_count, 0) AS message_count,
      COALESCE(ms.pending_message_count, 0) AS pending_message_count,
      lm.created_at AS last_message_at,
      lm.body_markdown AS last_message_preview
    FROM conversation_threads ct
    LEFT JOIN message_stats ms ON ms.thread_id = ct.id
    LEFT JOIN last_messages lm ON lm.thread_id = ct.id
    WHERE ct.id = ?
  `).get(threadId, threadId, threadId) as ThreadRow | undefined;

  if (!row) {
    throw new Error(`Conversation thread not found: ${threadId}`);
  }

  return mapThreadRow(row);
}
