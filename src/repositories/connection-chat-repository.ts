import { randomUUID } from "crypto";
import { DatabaseAdapter } from "./db/database-adapter.js";
import { AppDbStorage } from "./app-db-storage.js";
import { requireRecord, toNumber, toBoolean } from "./repository-utils.js";
import type {
  ConnectionInboxMessage,
  ConversationMessageRecord,
  ConversationThreadRecord,
  CreateConversationThreadInput,
  CreateDashboardConversationMessageInput,
  McpConnectionCapabilities,
  McpConnectionRecord,
  PostListenReplyInput,
  PullInboxInput,
  StartListenInput,
  StartListenResponse,
  UpdateConversationThreadInput,
  UpdateMcpConnectionInput,
  UpsertMcpConnectionInput,
} from "../contracts/connection-chat-types.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";
import { WorkerEndpointRepository } from "./worker-endpoint-repository.js";
import {
  HIDDEN_INTERNAL_VISIBILITY,
  visibleConversationMessageFilter,
} from "./connection-chat/conversation-query-utils.js";
import { requireConversationThreadQuery } from "./connection-chat/conversation-thread-query.js";
import { ThreadRow, mapThreadRow, MessageRow } from "./connection-chat/conversation-query-utils.js";

interface InboxRow extends MessageRow {
  title: string;
  project_id: string;
}
import {
  listConversationMessagesQuery,
  requireConversationMessageQuery,
  getFirstReplyAfterMessageQuery,
} from "./connection-chat/conversation-message-query.js";
import {
  deriveConnectionHeartbeatStatus,
} from "./connection-lifecycle.js";

const HEARTBEAT_WRITE_INTERVAL_MS = 5 * 1000;
const OFFLINE_CONNECTION_THRESHOLD_MS = 3 * 60 * 1000;
const PRUNE_CONNECTION_THRESHOLD_MS = 3 * 60 * 1000;
const STALE_CONNECTION_THRESHOLD_MS = 90 * 1000;

interface ConnectionRow {
  id: string;
  connection_key: string;
  display_name: string;
  role: string;
  transport: string;
  status: string;
  capabilities_json: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
  tasks_run_count: number | string | null;
  thread_count: number | string | null;
  message_count: number | string | null;
  pending_inbox_count: number | string | null;
  active_dispatch_count: number | string | null;
}

interface BindingRow {
  connection_id: string;
  project_id: string;
  is_active: number | string;
  last_attention_cursor: string | null;
  last_assignment_cursor: string | null;
  created_at?: string | null;
}

export interface ConnectionProjectBindingState {
  projectId: string;
  isActive: boolean;
  lastAttentionCursor: string | null;
  lastAssignmentCursor: string | null;
}

export interface CreateSystemConversationMessageInput {
  threadId?: string;
  title?: string;
  connectionId?: string | null;
  bodyMarkdown: string;
  metadata?: Record<string, unknown> | null;
}

const SELECTED_PROJECT_KEY = "selected_project_id";
function isHiddenConversationMessage(metadata?: Record<string, unknown> | null): boolean {
  return metadata?.internalVisibility === HIDDEN_INTERNAL_VISIBILITY;
}

export interface ConnectionLifecycleCleanupResult {
  staleConnectionIds: string[];
  offlineConnectionIds: string[];
  prunedConnectionIds: string[];
}


function parseCapabilities(value: string | null): McpConnectionCapabilities {
  if (!value) {
    return {};
  }
  try {
    const parsed = JSON.parse(value) as McpConnectionCapabilities;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

export class ConnectionChatRepository {
  private readonly db: DatabaseAdapter;

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeService?: DashboardRealtimeService,
    private readonly workerEndpointRepository: WorkerEndpointRepository = new WorkerEndpointRepository(storage),
  ) {
    this.db = storage.getDatabase();
  }

  listConnections(projectId: string): McpConnectionRecord[] {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const rows = this.db.prepare(`
      WITH
      task_runs_stats AS (
        SELECT connection_id, COUNT(*) AS cnt
        FROM task_runs
        WHERE project_id = ?
        GROUP BY connection_id
      ),
      threads_stats AS (
        SELECT connection_id, COUNT(*) AS cnt
        FROM conversation_threads
        WHERE project_id = ? AND connection_id IS NOT NULL
        GROUP BY connection_id
      ),
      messages_stats AS (
        SELECT ct.connection_id, COUNT(*) AS cnt
        FROM conversation_messages cm
        INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
        WHERE ct.project_id = ? AND ct.connection_id IS NOT NULL
          AND ${visibleConversationMessageFilter("cm")}
        GROUP BY ct.connection_id
      ),
      pending_messages_stats AS (
        SELECT COALESCE(ct.connection_id, 'null_conn') as conn_id, COUNT(*) AS cnt
        FROM conversation_messages cm
        INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
        WHERE ct.project_id = ?
          AND cm.direction = 'dashboard_to_connection'
          AND cm.delivery_status = 'pending'
          AND ${visibleConversationMessageFilter("cm")}
        GROUP BY COALESCE(ct.connection_id, 'null_conn')
      ),
      dispatches_stats AS (
        SELECT td.connection_id, COUNT(*) AS cnt
        FROM task_dispatches td
        WHERE td.project_id = ? AND td.status IN ('claimed', 'running', 'cancel_requested')
        GROUP BY td.connection_id
      )
      SELECT
        c.*,
        COALESCE(trs.cnt, 0) AS tasks_run_count,
        COALESCE(ts.cnt, 0) AS thread_count,
        COALESCE(ms.cnt, 0) AS message_count,
        (COALESCE(pms.cnt, 0) + COALESCE(pms_null.cnt, 0)) AS pending_inbox_count,
        COALESCE(ds.cnt, 0) AS active_dispatch_count
      FROM mcp_connections c
      LEFT JOIN task_runs_stats trs ON trs.connection_id = c.id
      LEFT JOIN threads_stats ts ON ts.connection_id = c.id
      LEFT JOIN messages_stats ms ON ms.connection_id = c.id
      LEFT JOIN pending_messages_stats pms ON pms.conn_id = c.id
      LEFT JOIN pending_messages_stats pms_null ON pms_null.conn_id = 'null_conn'
      LEFT JOIN dispatches_stats ds ON ds.connection_id = c.id
      WHERE EXISTS (
        SELECT 1
        FROM connection_project_bindings b
        WHERE b.connection_id = c.id
          AND b.project_id = ?
      )
      ORDER BY COALESCE(c.last_heartbeat_at, c.updated_at) DESC, c.display_name ASC
    `).all(projectId, projectId, projectId, projectId, projectId, projectId) as unknown as ConnectionRow[];

    return this.sortConnections(this.inflateConnections(rows));
  }

  getConnection(connectionId: string): McpConnectionRecord | null {
    const row = this.db.prepare(`
      SELECT
        c.*,
        0 AS tasks_run_count,
        0 AS thread_count,
        0 AS message_count,
        0 AS pending_inbox_count,
        (
          SELECT COUNT(*)
          FROM task_dispatches td
          WHERE td.connection_id = c.id
            AND td.status IN ('claimed', 'running', 'cancel_requested')
        ) AS active_dispatch_count
      FROM mcp_connections c
      WHERE c.id = ?
    `).get(connectionId) as ConnectionRow | undefined;

    if (!row) {
      return null;
    }

    return this.inflateConnections([row])[0] || null;
  }

  getConnectionByKey(connectionKey: string): McpConnectionRecord | null {
    const row = this.db.prepare(`
      SELECT
        c.*,
        0 AS tasks_run_count,
        0 AS thread_count,
        0 AS message_count,
        0 AS pending_inbox_count,
        (
          SELECT COUNT(*)
          FROM task_dispatches td
          WHERE td.connection_id = c.id
            AND td.status IN ('claimed', 'running', 'cancel_requested')
        ) AS active_dispatch_count
      FROM mcp_connections c
      WHERE c.connection_key = ?
    `).get(connectionKey.trim()) as ConnectionRow | undefined;

    if (!row) {
      return null;
    }

    return this.inflateConnections([row])[0] || null;
  }

  upsertConnection(input: UpsertMcpConnectionInput): McpConnectionRecord {
    const now = new Date().toISOString();
    const existing = this.db.prepare(`
      SELECT id
      FROM mcp_connections
      WHERE connection_key = ?
    `).get(input.connectionKey.trim()) as { id: string } | undefined;

    const connectionId = existing?.id || randomUUID();
    const normalizedProjectIds = this.normalizeProjectIds(input.projectIds);
    const activeProjectIds = this.normalizeActiveProjectIds(normalizedProjectIds, input.activeProjectIds);
    const existingBindings = existing
      ? this.db.prepare(`
        SELECT connection_id, project_id, is_active, last_attention_cursor, last_assignment_cursor, created_at
        FROM connection_project_bindings
        WHERE connection_id = ?
      `).all(connectionId) as unknown as BindingRow[]
      : [];
    const existingBindingsByProjectId = new Map(existingBindings.map((binding) => [binding.project_id, binding]));

    this.runInTransaction(() => {
      this.db.prepare(`DELETE FROM connection_project_bindings WHERE connection_id = ?`).run(connectionId);

      if (existing) {
        this.db.prepare(`
          UPDATE mcp_connections
          SET display_name = ?, role = ?, transport = ?, status = ?, capabilities_json = ?, last_heartbeat_at = ?, updated_at = ?
          WHERE id = ?
        `).run(
          input.displayName.trim(),
          input.role,
          input.transport.trim() || "stdio",
          input.status,
          JSON.stringify(input.capabilities || {}),
          now,
          now,
          connectionId
        );
      } else {
        this.db.prepare(`
          INSERT INTO mcp_connections (
            id, connection_key, display_name, role, transport, status, capabilities_json, last_heartbeat_at, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          connectionId,
          input.connectionKey.trim(),
          input.displayName.trim(),
          input.role,
          input.transport.trim() || "stdio",
          input.status,
          JSON.stringify(input.capabilities || {}),
          now,
          now,
          now
        );
      }

      if (normalizedProjectIds.length > 0) {
        const CHUNK_SIZE = 100;
        for (let i = 0; i < normalizedProjectIds.length; i += CHUNK_SIZE) {
          const chunk = normalizedProjectIds.slice(i, i + CHUNK_SIZE);
          const placeholders = chunk.map(() => "(?, ?, ?, ?, ?, ?)").join(", ");
          const params = chunk.flatMap((projectId) => {
            const existingBinding = existingBindingsByProjectId.get(projectId);
            return [
              connectionId,
              projectId,
              Number(activeProjectIds.includes(projectId)),
              existingBinding?.last_attention_cursor ?? null,
              existingBinding?.last_assignment_cursor ?? null,
              existingBinding?.created_at ?? now,
            ];
          });
          this.db.prepare(`
            INSERT INTO connection_project_bindings (
              connection_id,
              project_id,
              is_active,
              last_attention_cursor,
              last_assignment_cursor,
              created_at
            ) VALUES ${placeholders}
          `).run(...params);
        }
      }
    });

    const connection = this.requireConnection(connectionId);
    this.syncWorkerEndpoint(connection);
    this.notifyProjects([...connection.projectIds, ...connection.activeProjectIds]);
    return connection;
  }

  updateConnection(connectionId: string, input: UpdateMcpConnectionInput): McpConnectionRecord {
    const current = this.requireConnection(connectionId);
    const nextCapabilities = input.capabilities === undefined
      ? current.capabilities
      : input.capabilities;
    const now = new Date().toISOString();

    this.runInTransaction(() => {
      this.db.prepare(`
        UPDATE mcp_connections
        SET display_name = ?, role = ?, status = ?, capabilities_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        input.displayName?.trim() || current.displayName,
        input.role || current.role,
        input.status || current.status,
        JSON.stringify(nextCapabilities || {}),
        now,
        connectionId
      );

      if (input.activeProjectIds) {
        const normalized = this.normalizeActiveProjectIds(current.projectIds, input.activeProjectIds);
        this.db.prepare(`
          UPDATE connection_project_bindings
          SET is_active = CASE WHEN project_id IN (${normalized.map(() => "?").join(", ") || "''"}) THEN 1 ELSE 0 END
          WHERE connection_id = ?
        `).run(...normalized, connectionId);
      }
    });

    const connection = this.requireConnection(connectionId);
    this.syncWorkerEndpoint(connection);
    this.notifyProjects([...connection.projectIds, ...connection.activeProjectIds]);
    return connection;
  }

  listThreads(projectId: string): ConversationThreadRecord[] {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const rows = this.db.prepare(`
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
            ROW_NUMBER() OVER (PARTITION BY cm.thread_id ORDER BY cm.created_at DESC, cm.id DESC) as rn
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
      ORDER BY COALESCE(lm.created_at, ct.updated_at) DESC, ct.created_at DESC
    `).all(projectId, projectId, projectId) as unknown as ThreadRow[];

    return rows.map((row) => mapThreadRow(row));
  }

  createThread(projectId: string, input: CreateConversationThreadInput): ConversationThreadRecord {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const connectionId = input.connectionId ?? null;
    if (connectionId) {
      this.requireConnection(connectionId);
    }

    const now = new Date().toISOString();
    const threadId = randomUUID();
    this.db.prepare(`
      INSERT INTO conversation_threads (id, project_id, connection_id, scope, title, runtime_state_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadId,
      projectId,
      connectionId || null,
      input.scope || "project",
      input.title.trim(),
      input.runtimeState ? JSON.stringify(input.runtimeState) : null,
      "open",
      now,
      now
    );

    const thread = requireConversationThreadQuery(this.db, threadId);
    this.notifyProjects([thread.projectId]);
    this.publishThreadUpdatedEvent(thread);
    return thread;
  }

  listMessages(threadId: string, options?: { includeHidden?: boolean }): ConversationMessageRecord[] {
    requireConversationThreadQuery(this.db, threadId);
    return listConversationMessagesQuery(this.db, threadId, options);
  }



  getFirstReplyAfterMessage(threadId: string, messageId: string, options?: { includeHidden?: boolean }): ConversationMessageRecord | null {
    requireConversationThreadQuery(this.db, threadId);
    return getFirstReplyAfterMessageQuery(this.db, threadId, messageId, options);
  }

  getThread(threadId: string): ConversationThreadRecord {
    return requireConversationThreadQuery(this.db, threadId);
  }

  updateThread(threadId: string, input: UpdateConversationThreadInput): ConversationThreadRecord {
    const thread = requireConversationThreadQuery(this.db, threadId);
    const now = new Date().toISOString();
    const normalizedConnectionId = input.connectionId === undefined
      ? thread.connectionId
      : input.connectionId === null
        ? null
        : input.connectionId.trim();

    if (normalizedConnectionId) {
      const connection = this.requireConnection(normalizedConnectionId);
      const activeProjectIds = connection.activeProjectIds.length > 0 ? connection.activeProjectIds : connection.projectIds;
      if (!activeProjectIds.includes(thread.projectId)) {
        throw new Error(`Connection ${connection.connectionKey} is not bound to project ${thread.projectId}`);
      }
    }

    this.runInTransaction(() => {
      this.db.prepare(`
        UPDATE conversation_threads
        SET connection_id = ?, runtime_state_json = ?, updated_at = ?
        WHERE id = ?
      `).run(
        normalizedConnectionId || null,
        input.runtimeState !== undefined ? (input.runtimeState ? JSON.stringify(input.runtimeState) : null) : (thread.runtimeState ? JSON.stringify(thread.runtimeState) : null),
        now,
        thread.id
      );

      if (normalizedConnectionId !== thread.connectionId) {
        this.db.prepare(`
          UPDATE conversation_messages
          SET delivery_status = 'pending'
          WHERE thread_id = ?
            AND direction = 'dashboard_to_connection'
            AND delivery_status IN ('pending', 'delivered')
        `).run(thread.id);
      }
    });

    const updated = requireConversationThreadQuery(this.db, threadId);
    this.notifyProjects([updated.projectId]);
    this.publishThreadUpdatedEvent(updated);
    return updated;
  }

  deleteThread(threadId: string): void {
    const thread = requireConversationThreadQuery(this.db, threadId);

    this.db.prepare(`
      DELETE FROM conversation_threads
      WHERE id = ?
    `).run(thread.id);

    this.notifyProjects([thread.projectId]);
    this.publishThreadDeletedEvent(thread.projectId, thread.id);
  }

  postDashboardMessage(projectId: string, input: CreateDashboardConversationMessageInput): ConversationMessageRecord {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const thread = input.threadId
      ? requireConversationThreadQuery(this.db, input.threadId)
      : this.createThread(projectId, {
        title: input.title?.trim() || `Project Chat ${new Date().toISOString().slice(0, 16)}`,
        connectionId: input.connectionId ?? undefined,
      });

    if (thread.projectId !== projectId) {
      throw new Error(`Thread ${thread.id} does not belong to project ${projectId}`);
    }

    const preferredConnectionId = thread.connectionId || input.connectionId || null;
    const now = new Date().toISOString();
    const messageId = randomUUID();
    const hiddenMessage = isHiddenConversationMessage(input.metadata);

    this.runInTransaction(() => {
      if (!thread.connectionId && preferredConnectionId) {
        this.db.prepare(`
          UPDATE conversation_threads
          SET connection_id = ?, updated_at = ?
          WHERE id = ?
        `).run(preferredConnectionId, now, thread.id);
      } else {
        this.db.prepare(`
          UPDATE conversation_threads
          SET updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
      }

      this.db.prepare(`
        INSERT INTO conversation_messages (
          id, thread_id, direction, author_type, author_connection_id, body_markdown, delivery_status, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        thread.id,
        "dashboard_to_connection",
        "dashboard_user",
        null,
        input.bodyMarkdown.trim(),
        "pending",
        input.metadata ? JSON.stringify(input.metadata) : null,
        now
      );
    });

    const created = requireConversationMessageQuery(this.db, messageId);
    this.notifyProjects([projectId]);
    if (!hiddenMessage) {
      this.publishThreadUpdatedEvent(requireConversationThreadQuery(this.db, thread.id));
      this.publishMessageCreatedEvent(projectId, thread.id, created);
    }
    return created;
  }

  postSystemMessage(projectId: string, input: CreateSystemConversationMessageInput): ConversationMessageRecord {
    requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(projectId), "Project", projectId);
    const thread = input.threadId
      ? requireConversationThreadQuery(this.db, input.threadId)
      : this.createThread(projectId, {
        title: input.title?.trim() || `Worker Attention ${new Date().toISOString().slice(0, 16)}`,
        connectionId: input.connectionId ?? undefined,
      });

    if (thread.projectId !== projectId) {
      throw new Error(`Thread ${thread.id} does not belong to project ${projectId}`);
    }

    const preferredConnectionId = thread.connectionId || input.connectionId || null;
    const now = new Date().toISOString();
    const messageId = randomUUID();

    this.runInTransaction(() => {
      if (!thread.connectionId && preferredConnectionId) {
        this.db.prepare(`
          UPDATE conversation_threads
          SET connection_id = ?, updated_at = ?
          WHERE id = ?
        `).run(preferredConnectionId, now, thread.id);
      } else {
        this.db.prepare(`
          UPDATE conversation_threads
          SET updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
      }

      this.db.prepare(`
        INSERT INTO conversation_messages (
          id, thread_id, direction, author_type, author_connection_id, body_markdown, delivery_status, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        thread.id,
        "connection_to_dashboard",
        "system",
        null,
        input.bodyMarkdown.trim(),
        "processed",
        input.metadata ? JSON.stringify(input.metadata) : null,
        now
      );
    });

    const message = requireConversationMessageQuery(this.db, messageId);
    const hiddenMessage = isHiddenConversationMessage(input.metadata);
    this.notifyProjects([projectId]);
    if (!hiddenMessage) {
      this.publishThreadUpdatedEvent(requireConversationThreadQuery(this.db, thread.id));
      this.publishMessageCreatedEvent(projectId, thread.id, message);
    }
    return message;
  }

  markDashboardMessagesProcessed(threadId: string, options?: { upToMessageId?: string | null }): ConversationThreadRecord {
    const thread = requireConversationThreadQuery(this.db, threadId);
    const now = new Date().toISOString();

    this.runInTransaction(() => {
      if (options?.upToMessageId) {
        this.db.prepare(`
          UPDATE conversation_messages
          SET delivery_status = 'processed'
          WHERE thread_id = ?
            AND direction = 'dashboard_to_connection'
            AND delivery_status IN ('pending', 'delivered')
            AND created_at <= COALESCE((
              SELECT created_at
              FROM conversation_messages
              WHERE id = ?
                AND thread_id = ?
            ), created_at)
        `).run(threadId, options.upToMessageId, threadId);
      } else {
        this.db.prepare(`
          UPDATE conversation_messages
          SET delivery_status = 'processed'
          WHERE thread_id = ?
            AND direction = 'dashboard_to_connection'
            AND delivery_status IN ('pending', 'delivered')
        `).run(threadId);
      }

      this.db.prepare(`
        UPDATE conversation_threads
        SET updated_at = ?
        WHERE id = ?
      `).run(now, threadId);
    });

    const updatedThread = requireConversationThreadQuery(this.db, threadId);
    this.notifyProjects([thread.projectId]);
    this.publishThreadUpdatedEvent(updatedThread);
    return updatedThread;
  }

  startListen(input: StartListenInput): StartListenResponse {
    const normalizedProjectIds = this.normalizeListenProjectIds(input.projectIds, input.projectId);
    const fallbackProjectId = normalizedProjectIds[0] || this.getSelectedProjectId();
    const projectIds = normalizedProjectIds.length > 0
      ? normalizedProjectIds
      : fallbackProjectId
        ? [fallbackProjectId]
        : [];
    const activeProjectIds = this.normalizeActiveProjectIds(
      projectIds,
      input.activeProjectIds && input.activeProjectIds.length > 0 ? input.activeProjectIds : projectIds,
    );
    const connection = this.upsertConnection({
      connectionKey: input.connectionKey,
      displayName: input.displayName?.trim() || input.connectionKey.trim(),
      role: input.role || "listener",
      transport: input.transport?.trim() || "stdio",
      status: "listening",
      capabilities: {
        listenMode: true,
        ...((input.role || "listener") === "worker"
          ? {
            workerCanSuperviseProjects: true,
            workerCanExecuteTasks: true,
          }
          : {}),
        ...(input.capabilities || {}),
      },
      projectIds,
      activeProjectIds,
    });

    const inbox = this.pullInbox({
      connectionKey: input.connectionKey,
      projectId: fallbackProjectId || undefined,
      maxMessages: input.maxMessages,
    });

    return {
      connection: this.requireConnection(connection.id),
      inbox,
    };
  }

  pullInbox(input: PullInboxInput): ConnectionInboxMessage[] {
    const connection = this.requireConnectionByKey(input.connectionKey);
    const activeProjectIds = this.getActiveProjectIds(connection.id);
    const scopedProjectIds = input.projectId
      ? activeProjectIds.filter((projectId) => projectId === input.projectId)
      : activeProjectIds;

    this.touchConnection(connection, "listening");

    if (scopedProjectIds.length === 0) {
      return [];
    }

    const placeholders = scopedProjectIds.map(() => "?").join(", ");
    const limit = Math.max(1, Math.min(50, input.maxMessages || 10));
    const rows = this.db.prepare(`
      SELECT cm.*, ct.title, ct.project_id
      FROM conversation_messages cm
      INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
      WHERE ct.project_id IN (${placeholders})
        AND cm.direction = 'dashboard_to_connection'
        AND cm.delivery_status = 'pending'
        AND (ct.connection_id IS NULL OR ct.connection_id = ?)
      ORDER BY cm.created_at ASC, cm.id ASC
      LIMIT ?
    `).all(...scopedProjectIds, connection.id, limit) as unknown as InboxRow[];

    if (rows.length === 0) {
      return [];
    }

    this.runInTransaction(() => {
      const assignThread = this.db.prepare(`
        UPDATE conversation_threads
        SET connection_id = ?, updated_at = ?
        WHERE id = ? AND connection_id IS NULL
      `);
      const markDelivered = this.db.prepare(`
        UPDATE conversation_messages
        SET delivery_status = 'delivered'
        WHERE id = ?
      `);
      const now = new Date().toISOString();
      for (const row of rows) {
        assignThread.run(connection.id, now, row.thread_id);
        markDelivered.run(row.id);
      }
    });

    const inbox = rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      threadTitle: row.title,
      projectId: row.project_id,
      bodyMarkdown: row.body_markdown,
      metadata: row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : null,
      createdAt: row.created_at,
      deliveryStatus: "delivered" as const,
    }));
    this.notifyProjects(scopedProjectIds);
    for (const row of rows) {
      const metadata = row.metadata_json ? JSON.parse(row.metadata_json) as Record<string, unknown> : null;
      if (!isHiddenConversationMessage(metadata)) {
        this.publishThreadUpdatedEvent(requireConversationThreadQuery(this.db, row.thread_id));
      }
    }
    return inbox;
  }

  postListenReply(input: PostListenReplyInput): ConversationMessageRecord {
    const connection = this.requireConnectionByKey(input.connectionKey);
    const thread = requireConversationThreadQuery(this.db, input.threadId);
    const activeProjectIds = this.getActiveProjectIds(connection.id);
    if (activeProjectIds.length > 0 && !activeProjectIds.includes(thread.projectId)) {
      throw new Error(`Connection ${connection.connectionKey} is not bound to project ${thread.projectId}`);
    }

    const now = new Date().toISOString();
    const messageId = randomUUID();

    this.runInTransaction(() => {
      if (!thread.connectionId) {
        this.db.prepare(`
          UPDATE conversation_threads
          SET connection_id = ?, updated_at = ?
          WHERE id = ?
        `).run(connection.id, now, thread.id);
      } else {
        this.db.prepare(`
          UPDATE conversation_threads
          SET updated_at = ?
          WHERE id = ?
        `).run(now, thread.id);
      }

      this.db.prepare(`
        INSERT INTO conversation_messages (
          id, thread_id, direction, author_type, author_connection_id, body_markdown, delivery_status, metadata_json, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        thread.id,
        "connection_to_dashboard",
        "connection",
        connection.id,
        input.bodyMarkdown.trim(),
        "processed",
        input.metadata ? JSON.stringify(input.metadata) : null,
        now
      );

      if (input.replyToMessageId) {
        this.db.prepare(`
          UPDATE conversation_messages
          SET delivery_status = 'processed'
          WHERE id = ? AND thread_id = ?
        `).run(input.replyToMessageId, thread.id);
      } else {
        this.db.prepare(`
          UPDATE conversation_messages
          SET delivery_status = 'processed'
          WHERE thread_id = ?
            AND direction = 'dashboard_to_connection'
            AND delivery_status IN ('pending', 'delivered')
        `).run(thread.id);
      }
    });

    this.touchConnection(connection, "listening");
    const message = requireConversationMessageQuery(this.db, messageId);
    const hiddenMessage = isHiddenConversationMessage(input.metadata);
    this.notifyProjects([thread.projectId]);
    if (!hiddenMessage) {
      this.publishThreadUpdatedEvent(requireConversationThreadQuery(this.db, thread.id));
      this.publishMessageCreatedEvent(thread.projectId, thread.id, message);
    }
    return message;
  }

  touchConnectionHeartbeat(connectionId: string, status?: McpConnectionRecord["status"]): McpConnectionRecord {
    const current = this.requireConnection(connectionId);
    const touched = this.touchConnection(current, status);
    const connection = touched ? this.requireConnection(connectionId) : current;
    if (touched) {
      this.notifyProjects([...connection.projectIds, ...connection.activeProjectIds]);
    }
    return connection;
  }

  cleanupConnectionLifecycle(now = new Date()): ConnectionLifecycleCleanupResult {
    const nowIso = now.toISOString();
    const staleBeforeIso = new Date(now.getTime() - STALE_CONNECTION_THRESHOLD_MS).toISOString();
    const offlineBeforeIso = new Date(now.getTime() - OFFLINE_CONNECTION_THRESHOLD_MS).toISOString();
    const pruneBeforeIso = new Date(now.getTime() - PRUNE_CONNECTION_THRESHOLD_MS).toISOString();

    const staleRows = this.db.prepare(`
      SELECT id
      FROM mcp_connections
      WHERE last_heartbeat_at IS NOT NULL
        AND last_heartbeat_at <= ?
        AND last_heartbeat_at > ?
        AND status NOT IN ('offline', 'stale')
    `).all(staleBeforeIso, offlineBeforeIso) as Array<{ id: string }>;

    const offlineRows = this.db.prepare(`
      SELECT id
      FROM mcp_connections
      WHERE last_heartbeat_at IS NOT NULL
        AND last_heartbeat_at <= ?
        AND status != 'offline'
    `).all(offlineBeforeIso) as Array<{ id: string }>;

    const prunedRows = this.db.prepare(`
      SELECT c.id
      FROM mcp_connections c
      WHERE c.status = 'offline'
        AND c.last_heartbeat_at IS NOT NULL
        AND c.last_heartbeat_at <= ?
        AND NOT EXISTS (
          SELECT 1
          FROM task_dispatches td
          WHERE td.connection_id = c.id
            AND td.status IN ('claimed', 'running', 'cancel_requested')
        )
    `).all(pruneBeforeIso) as Array<{ id: string }>;
    const prunedProjectIds = this.resolveProjectIdsForConnections(prunedRows.map((row) => row.id));

    this.runInTransaction(() => {
      if (staleRows.length > 0) {
        const statement = this.db.prepare(`
          UPDATE mcp_connections
          SET status = 'stale', updated_at = ?
          WHERE id = ?
        `);
        for (const row of staleRows) {
          statement.run(nowIso, row.id);
        }
      }

      if (offlineRows.length > 0) {
        const statement = this.db.prepare(`
          UPDATE mcp_connections
          SET status = 'offline', updated_at = ?
          WHERE id = ?
        `);
        for (const row of offlineRows) {
          statement.run(nowIso, row.id);
        }
      }

      if (prunedRows.length > 0) {
        for (const row of prunedRows) {
          this.workerEndpointRepository.deleteByConnectionId(row.id);
        }
        const statement = this.db.prepare(`
          DELETE FROM mcp_connections
          WHERE id = ?
        `);
        for (const row of prunedRows) {
          statement.run(row.id);
        }
      }
    });

    const result = {
      staleConnectionIds: staleRows.map((row) => row.id),
      offlineConnectionIds: offlineRows.map((row) => row.id),
      prunedConnectionIds: prunedRows.map((row) => row.id),
    };
    for (const connectionId of [...result.staleConnectionIds, ...result.offlineConnectionIds]) {
      const connection = this.getConnection(connectionId);
      if (connection) {
        this.syncWorkerEndpoint(connection);
      }
    }
    this.notifyProjects([
      ...this.resolveProjectIdsForConnections(result.staleConnectionIds),
      ...this.resolveProjectIdsForConnections(result.offlineConnectionIds),
      ...prunedProjectIds,
    ]);
    return result;
  }

  pruneDisconnectedConnectionsOnStartup(): { prunedConnectionIds: string[] } {
    const rows = this.db.prepare(`
      SELECT c.id
      FROM mcp_connections c
      WHERE NOT EXISTS (
        SELECT 1
        FROM task_dispatches td
        WHERE td.connection_id = c.id
          AND td.status IN ('claimed', 'running', 'cancel_requested')
      )
    `).all() as Array<{ id: string }>;

    if (rows.length === 0) {
      return { prunedConnectionIds: [] };
    }

    const prunedProjectIds = this.resolveProjectIdsForConnections(rows.map((row) => row.id));
    this.runInTransaction(() => {
      for (const row of rows) {
        this.workerEndpointRepository.deleteByConnectionId(row.id);
      }
      const statement = this.db.prepare(`
        DELETE FROM mcp_connections
        WHERE id = ?
      `);
      for (const row of rows) {
        statement.run(row.id);
      }
    });

    this.notifyProjects(prunedProjectIds);
    return {
      prunedConnectionIds: rows.map((row) => row.id),
    };
  }

  listProjectBindingStates(connectionId: string): ConnectionProjectBindingState[] {
    const rows = this.db.prepare(`
      SELECT connection_id, project_id, is_active, last_attention_cursor, last_assignment_cursor
      FROM connection_project_bindings
      WHERE connection_id = ?
      ORDER BY is_active DESC, project_id ASC
    `).all(connectionId) as unknown as BindingRow[];

    return rows.map((row) => ({
      projectId: row.project_id,
      isActive: toBoolean(row.is_active),
      lastAttentionCursor: row.last_attention_cursor,
      lastAssignmentCursor: row.last_assignment_cursor,
    }));
  }

  updateProjectBindingCursor(
    connectionId: string,
    projectId: string,
    updates: { attentionCursor?: string | null; assignmentCursor?: string | null },
  ): void {
    this.db.prepare(`
      UPDATE connection_project_bindings
      SET last_attention_cursor = COALESCE(?, last_attention_cursor),
          last_assignment_cursor = COALESCE(?, last_assignment_cursor)
      WHERE connection_id = ?
        AND project_id = ?
    `).run(
      updates.attentionCursor === undefined ? null : updates.attentionCursor,
      updates.assignmentCursor === undefined ? null : updates.assignmentCursor,
      connectionId,
      projectId,
    );
  }

  private inflateConnections(rows: ConnectionRow[]): McpConnectionRecord[] {
    if (rows.length === 0) {
      return [];
    }

    const bindings = this.db.prepare(`
      SELECT connection_id, project_id, is_active
      FROM connection_project_bindings
      WHERE connection_id IN (${rows.map(() => "?").join(", ")})
    `).all(...rows.map((row) => row.id)) as unknown as BindingRow[];

    const projectIdsByConnection = new Map<string, string[]>();
    const activeProjectIdsByConnection = new Map<string, string[]>();

    for (const binding of bindings) {
      const projectIds = projectIdsByConnection.get(binding.connection_id) || [];
      projectIds.push(binding.project_id);
      projectIdsByConnection.set(binding.connection_id, projectIds);
      if (toBoolean(binding.is_active)) {
        const active = activeProjectIdsByConnection.get(binding.connection_id) || [];
        active.push(binding.project_id);
        activeProjectIdsByConnection.set(binding.connection_id, active);
      }
    }

    return rows.map((row) => ({
      id: row.id,
      connectionKey: row.connection_key,
      displayName: row.display_name,
      role: row.role as McpConnectionRecord["role"],
      transport: row.transport,
      status: this.deriveConnectionStatus(
        row.status as McpConnectionRecord["status"],
        row.last_heartbeat_at,
        toNumber(row.active_dispatch_count),
      ),
      capabilities: parseCapabilities(row.capabilities_json),
      lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      projectIds: projectIdsByConnection.get(row.id) || [],
      activeProjectIds: activeProjectIdsByConnection.get(row.id) || [],
      tasksRunCount: toNumber(row.tasks_run_count),
      threadCount: toNumber(row.thread_count),
      messageCount: toNumber(row.message_count),
      pendingInboxCount: toNumber(row.pending_inbox_count),
      activeDispatchCount: toNumber(row.active_dispatch_count),
    }));
  }

  private deriveConnectionStatus(
    storedStatus: McpConnectionRecord["status"],
    lastHeartbeatAt: string | null,
    activeDispatchCount: number,
  ): McpConnectionRecord["status"] {
    const heartbeatStatus = deriveConnectionHeartbeatStatus(storedStatus, lastHeartbeatAt);
    if (heartbeatStatus === "offline" || heartbeatStatus === "stale") {
      return heartbeatStatus;
    }

    if (activeDispatchCount > 0 && storedStatus !== "paused") {
      return "connected";
    }

    return storedStatus;
  }

  private sortConnections(connections: McpConnectionRecord[]): McpConnectionRecord[] {
    const priority: Record<McpConnectionRecord["status"], number> = {
      listening: 0,
      connected: 1,
      idle: 2,
      paused: 3,
      stale: 4,
      offline: 5,
    };

    return [...connections].sort((left, right) => {
      const byStatus = priority[left.status] - priority[right.status];
      if (byStatus !== 0) {
        return byStatus;
      }

      const leftTime = left.lastHeartbeatAt ? new Date(left.lastHeartbeatAt).getTime() : 0;
      const rightTime = right.lastHeartbeatAt ? new Date(right.lastHeartbeatAt).getTime() : 0;
      if (leftTime !== rightTime) {
        return rightTime - leftTime;
      }

      return left.displayName.localeCompare(right.displayName);
    });
  }

  private notifyProjects(projectIds: string[]): void {
    const uniqueProjectIds = [...new Set(projectIds.map((projectId) => String(projectId || "").trim()).filter(Boolean))];
    for (const projectId of uniqueProjectIds) {
      this.realtimeService?.scheduleProjectExecutionRefresh(projectId, { includeOverview: false });
    }
  }

  private publishThreadUpdatedEvent(thread: ConversationThreadRecord): void {
    if (!this.realtimeService) {
      return;
    }

    this.realtimeService.publishRawEvent({
      scopeType: "project",
      scopeId: thread.projectId,
      eventType: "conversation.thread.updated",
      entityType: "conversation_thread",
      entityId: thread.id,
      projectId: thread.projectId,
      threadId: thread.id,
      payload: thread,
    });
    this.realtimeService.publishRawEvent({
      scopeType: "thread",
      scopeId: thread.id,
      eventType: "conversation.thread.updated",
      entityType: "conversation_thread",
      entityId: thread.id,
      projectId: thread.projectId,
      threadId: thread.id,
      payload: thread,
    });
  }

  private publishThreadDeletedEvent(projectId: string, threadId: string): void {
    if (!this.realtimeService) {
      return;
    }

    const payload = {
      threadId,
      projectId,
    };

    this.realtimeService.publishRawEvent({
      scopeType: "project",
      scopeId: projectId,
      eventType: "conversation.thread.deleted",
      entityType: "conversation_thread",
      entityId: threadId,
      projectId,
      threadId,
      payload,
    });
    this.realtimeService.publishRawEvent({
      scopeType: "thread",
      scopeId: threadId,
      eventType: "conversation.thread.deleted",
      entityType: "conversation_thread",
      entityId: threadId,
      projectId,
      threadId,
      payload,
    });
  }

  private publishMessageCreatedEvent(
    projectId: string,
    threadId: string,
    message: ConversationMessageRecord,
  ): void {
    if (!this.realtimeService) {
      return;
    }

    this.realtimeService.publishRawEvent({
      scopeType: "project",
      scopeId: projectId,
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: message.id,
      projectId,
      threadId,
      payload: message,
    });
    this.realtimeService.publishRawEvent({
      scopeType: "thread",
      scopeId: threadId,
      eventType: "conversation.message.created",
      entityType: "conversation_message",
      entityId: message.id,
      projectId,
      threadId,
      payload: message,
    });
  }

  private resolveProjectIdsForConnections(connectionIds: string[]): string[] {
    const uniqueConnectionIds = [...new Set(connectionIds.map((connectionId) => String(connectionId || "").trim()).filter(Boolean))];
    if (uniqueConnectionIds.length === 0) {
      return [];
    }

    const rows = this.db.prepare(`
      SELECT DISTINCT project_id
      FROM connection_project_bindings
      WHERE connection_id IN (${uniqueConnectionIds.map(() => "?").join(", ")})
    `).all(...uniqueConnectionIds) as Array<{ project_id: string }>;

    return rows.map((row) => row.project_id);
  }

  private requireConnection(connectionId: string): McpConnectionRecord {
    const connection = this.getConnection(connectionId);
    if (!connection) {
      throw new Error(`Connection not found: ${connectionId}`);
    }
    return connection;
  }

  private requireConnectionByKey(connectionKey: string): McpConnectionRecord {
    const connection = this.getConnectionByKey(connectionKey);
    if (!connection) {
      throw new Error(`Connection not found for key: ${connectionKey}`);
    }
    return connection;
  }

  private touchConnection(connection: McpConnectionRecord, status?: string): boolean {
    const requestedStatus = status?.trim() || connection.status;
    const lastHeartbeatMs = connection.lastHeartbeatAt ? new Date(connection.lastHeartbeatAt).getTime() : null;
    const nowMs = Date.now();
    const shouldWrite = requestedStatus !== connection.status
      || lastHeartbeatMs === null
      || !Number.isFinite(lastHeartbeatMs)
      || nowMs - lastHeartbeatMs >= HEARTBEAT_WRITE_INTERVAL_MS;

    if (!shouldWrite) {
      return false;
    }

    const now = new Date(nowMs).toISOString();
    this.db.prepare(`
      UPDATE mcp_connections
      SET status = COALESCE(?, status), last_heartbeat_at = ?, updated_at = ?
      WHERE id = ?
    `).run(requestedStatus || null, now, now, connection.id);
    const refreshed = this.getConnection(connection.id);
    if (refreshed) {
      this.syncWorkerEndpoint(refreshed);
    }
    return true;
  }

  private syncWorkerEndpoint(connection: McpConnectionRecord): void {
    this.workerEndpointRepository.upsertMcpConnectionEndpoint(connection);
  }

  private normalizeProjectIds(projectIds?: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const projectId of projectIds || []) {
      const trimmed = String(projectId || "").trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      requireRecord(this.db.prepare('SELECT id FROM projects WHERE id = ?').get(trimmed), "Project", trimmed);
      seen.add(trimmed);
      normalized.push(trimmed);
    }
    return normalized;
  }

  private normalizeListenProjectIds(projectIds?: string[], projectId?: string): string[] {
    const combined = [...(projectIds || [])];
    if (projectId?.trim()) {
      combined.push(projectId.trim());
    }
    return this.normalizeProjectIds(combined);
  }

  private normalizeActiveProjectIds(projectIds: string[], activeProjectIds?: string[]): string[] {
    if (!activeProjectIds || activeProjectIds.length === 0) {
      return projectIds;
    }
    const activeSet = new Set(activeProjectIds.map((value) => value.trim()).filter(Boolean));
    return projectIds.filter((projectId) => activeSet.has(projectId));
  }


  private getActiveProjectIds(connectionId: string): string[] {
    const rows = this.db.prepare(`
      SELECT project_id
      FROM connection_project_bindings
      WHERE connection_id = ? AND is_active = 1
      ORDER BY created_at ASC
    `).all(connectionId) as Array<{ project_id: string }>;
    return rows.map((row) => row.project_id);
  }

  private getSelectedProjectId(): string | null {
    const row = this.db.prepare(`
      SELECT payload
      FROM app_settings
      WHERE key = ?
    `).get(SELECTED_PROJECT_KEY) as { payload: string } | undefined;

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

  private runInTransaction(operation: () => void): void {
    this.db.transaction(() => {
      operation();
    });
  }
}
