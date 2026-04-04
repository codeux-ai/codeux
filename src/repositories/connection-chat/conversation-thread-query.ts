import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { ConversationThreadRecord } from "../../contracts/connection-chat-types.js";
import { visibleConversationMessageFilter, mapThreadRow, type ThreadRow } from "./conversation-query-utils.js";

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
          ROW_NUMBER() OVER (PARTITION BY thread_id ORDER BY created_at DESC, id DESC) as rn
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
