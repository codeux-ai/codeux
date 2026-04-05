import type { DatabaseAdapter } from "../db/database-adapter.js";
import type { ConversationMessageRecord } from "../../contracts/connection-chat-types.js";
import { visibleConversationMessageFilter, mapMessageRow, type MessageRow } from "./conversation-query-utils.js";

export function listConversationMessagesQuery(
  db: DatabaseAdapter,
  threadId: string,
  options?: { includeHidden?: boolean }
): ConversationMessageRecord[] {
  const includeHidden = options?.includeHidden === true;
  const rows = db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE thread_id = ?
      ${includeHidden ? "" : `AND ${visibleConversationMessageFilter("conversation_messages")}`}
    ORDER BY created_at ASC, id ASC
  `).all(threadId) as unknown as MessageRow[];

  return rows.map((row) => mapMessageRow(row));
}

export function requireConversationMessageQuery(db: DatabaseAdapter, messageId: string): ConversationMessageRecord {
  const row = db.prepare(`
    SELECT *
    FROM conversation_messages
    WHERE id = ?
  `).get(messageId) as MessageRow | undefined;

  if (!row) {
    throw new Error(`Conversation message not found: ${messageId}`);
  }

  return mapMessageRow(row);
}

export function getFirstReplyAfterMessageQuery(
  db: DatabaseAdapter,
  threadId: string,
  messageId: string,
  options?: { includeHidden?: boolean }
): ConversationMessageRecord | null {
  const includeHidden = options?.includeHidden === true;
  const row = db.prepare(`
    SELECT cm.*
    FROM conversation_messages cm
    INNER JOIN conversation_messages origin ON origin.id = ? AND origin.thread_id = ?
    WHERE cm.thread_id = ?
      AND cm.created_at > origin.created_at
      ${includeHidden ? "" : `AND ${visibleConversationMessageFilter("cm")}`}
    ORDER BY cm.created_at ASC, cm.id ASC
    LIMIT 1
  `).get(messageId, threadId, threadId) as MessageRow | undefined;

  if (!row) {
    return null;
  }

  return mapMessageRow(row);
}
