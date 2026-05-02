import type { ConversationMessageRecord, ConversationThreadRecord } from "../../contracts/connection-chat-types.js";
import { toNumber } from "../repository-utils.js";

export interface ThreadRow {
  id: string;
  project_id: string;
  connection_id: string | null;
  scope: string;
  title: string;
  runtime_state_json?: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  message_count: number | string | null;
  pending_message_count: number | string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
}

export interface MessageRow {
  id: string;
  thread_id: string;
  direction: string;
  author_type: string;
  author_connection_id: string | null;
  body_markdown: string;
  delivery_status: string;
  metadata_json?: string | null;
  created_at: string;
}

export const HIDDEN_INTERNAL_VISIBILITY = "hidden";

export function visibleConversationMessageFilter(alias: string): string {
  return `(COALESCE(json_extract(${alias}.metadata_json, '$.internalVisibility'), '') != '${HIDDEN_INTERNAL_VISIBILITY}')`;
}

export function mapThreadRow(row: ThreadRow): ConversationThreadRecord {
  return {
    id: row.id,
    projectId: row.project_id,
    connectionId: row.connection_id,
    scope: row.scope as ConversationThreadRecord["scope"],
    title: row.title,
    status: row.status as ConversationThreadRecord["status"],
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    messageCount: toNumber(row.message_count),
    pendingMessageCount: toNumber(row.pending_message_count),
    lastMessageAt: row.last_message_at,
    lastMessagePreview: row.last_message_preview,
    runtimeState: row.runtime_state_json ? JSON.parse(row.runtime_state_json) : null,
  };
}

export function mapMessageRow(row: MessageRow): ConversationMessageRecord {
  return {
    id: row.id,
    threadId: row.thread_id,
    direction: row.direction as ConversationMessageRecord["direction"],
    authorType: row.author_type as ConversationMessageRecord["authorType"],
    authorConnectionId: row.author_connection_id,
    bodyMarkdown: row.body_markdown,
    deliveryStatus: row.delivery_status as ConversationMessageRecord["deliveryStatus"],
    metadata: row.metadata_json ? JSON.parse(row.metadata_json) : null,
    createdAt: row.created_at,
  };
}
