import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
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
  UpdateMcpConnectionInput,
  UpsertMcpConnectionInput,
} from "../contracts/connection-chat-types.js";

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
}

interface BindingRow {
  connection_id: string;
  project_id: string;
  is_active: number | string;
}

interface ThreadRow {
  id: string;
  project_id: string;
  connection_id: string | null;
  scope: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  message_count: number | string | null;
  pending_message_count: number | string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
}

interface MessageRow {
  id: string;
  thread_id: string;
  direction: string;
  author_type: string;
  author_connection_id: string | null;
  body_markdown: string;
  delivery_status: string;
  created_at: string;
}

interface InboxRow extends MessageRow {
  title: string;
  project_id: string;
}

const SELECTED_PROJECT_KEY = "selected_project_id";

function toNumber(value: number | string | null | undefined): number {
  if (typeof value === "number") {
    return value;
  }
  return Number.parseInt(String(value ?? 0), 10) || 0;
}

function toBoolean(value: number | string | null | undefined): boolean {
  return value === 1 || value === "1";
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
  private readonly db: DatabaseSync;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  listConnections(projectId: string): McpConnectionRecord[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`
      SELECT
        c.*,
        (SELECT COUNT(*) FROM task_runs tr WHERE tr.connection_id = c.id AND tr.project_id = ?) AS tasks_run_count,
        (SELECT COUNT(*) FROM conversation_threads ct WHERE ct.project_id = ? AND ct.connection_id = c.id) AS thread_count,
        (
          SELECT COUNT(*)
          FROM conversation_messages cm
          INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
          WHERE ct.project_id = ?
            AND ct.connection_id = c.id
        ) AS message_count,
        (
          SELECT COUNT(*)
          FROM conversation_messages cm
          INNER JOIN conversation_threads ct ON ct.id = cm.thread_id
          WHERE ct.project_id = ?
            AND (ct.connection_id = c.id OR ct.connection_id IS NULL)
            AND cm.direction = 'dashboard_to_connection'
            AND cm.delivery_status = 'pending'
        ) AS pending_inbox_count
      FROM mcp_connections c
      WHERE EXISTS (
        SELECT 1
        FROM connection_project_bindings b
        WHERE b.connection_id = c.id
          AND b.project_id = ?
      )
        OR c.role = 'project_manager'
      ORDER BY
        CASE c.status WHEN 'listening' THEN 0 WHEN 'connected' THEN 1 WHEN 'idle' THEN 2 WHEN 'paused' THEN 3 ELSE 4 END,
        COALESCE(c.last_heartbeat_at, c.updated_at) DESC,
        c.display_name ASC
    `).all(projectId, projectId, projectId, projectId, projectId) as unknown as ConnectionRow[];

    return this.inflateConnections(rows);
  }

  getConnection(connectionId: string): McpConnectionRecord | null {
    const row = this.db.prepare(`
      SELECT
        c.*,
        0 AS tasks_run_count,
        0 AS thread_count,
        0 AS message_count,
        0 AS pending_inbox_count
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
        0 AS pending_inbox_count
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

    this.runInTransaction(() => {
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
        this.db.prepare(`DELETE FROM connection_project_bindings WHERE connection_id = ?`).run(connectionId);
        const insertBinding = this.db.prepare(`
          INSERT INTO connection_project_bindings (connection_id, project_id, is_active, created_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const projectId of normalizedProjectIds) {
          insertBinding.run(connectionId, projectId, Number(activeProjectIds.includes(projectId)), now);
        }
      }
    });

    return this.requireConnection(connectionId);
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

    return this.requireConnection(connectionId);
  }

  listThreads(projectId: string): ConversationThreadRecord[] {
    this.requireProject(projectId);
    const rows = this.db.prepare(`
      SELECT
        ct.*,
        (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.thread_id = ct.id) AS message_count,
        (
          SELECT COUNT(*)
          FROM conversation_messages cm
          WHERE cm.thread_id = ct.id
            AND cm.direction = 'dashboard_to_connection'
            AND cm.delivery_status IN ('pending', 'delivered')
        ) AS pending_message_count,
        (SELECT cm.created_at FROM conversation_messages cm WHERE cm.thread_id = ct.id ORDER BY cm.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT cm.body_markdown FROM conversation_messages cm WHERE cm.thread_id = ct.id ORDER BY cm.created_at DESC LIMIT 1) AS last_message_preview
      FROM conversation_threads ct
      WHERE ct.project_id = ?
      ORDER BY COALESCE(last_message_at, ct.updated_at) DESC, ct.created_at DESC
    `).all(projectId) as unknown as ThreadRow[];

    return rows.map((row) => this.mapThreadRow(row));
  }

  createThread(projectId: string, input: CreateConversationThreadInput): ConversationThreadRecord {
    this.requireProject(projectId);
    const connectionId = input.connectionId ?? this.findPreferredConnectionId(projectId);
    if (connectionId) {
      this.requireConnection(connectionId);
    }

    const now = new Date().toISOString();
    const threadId = randomUUID();
    this.db.prepare(`
      INSERT INTO conversation_threads (id, project_id, connection_id, scope, title, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      threadId,
      projectId,
      connectionId || null,
      input.scope || "project",
      input.title.trim(),
      "open",
      now,
      now
    );

    return this.requireThread(threadId);
  }

  listMessages(threadId: string): ConversationMessageRecord[] {
    this.requireThread(threadId);
    const rows = this.db.prepare(`
      SELECT *
      FROM conversation_messages
      WHERE thread_id = ?
      ORDER BY created_at ASC, id ASC
    `).all(threadId) as unknown as MessageRow[];

    return rows.map((row) => this.mapMessageRow(row));
  }

  postDashboardMessage(projectId: string, input: CreateDashboardConversationMessageInput): ConversationMessageRecord {
    this.requireProject(projectId);
    const thread = input.threadId
      ? this.requireThread(input.threadId)
      : this.createThread(projectId, {
        title: input.title?.trim() || `Project Chat ${new Date().toISOString().slice(0, 16)}`,
        connectionId: input.connectionId ?? undefined,
      });

    if (thread.projectId !== projectId) {
      throw new Error(`Thread ${thread.id} does not belong to project ${projectId}`);
    }

    const preferredConnectionId = thread.connectionId || input.connectionId || this.findPreferredConnectionId(projectId);
    const now = new Date().toISOString();

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
          id, thread_id, direction, author_type, author_connection_id, body_markdown, delivery_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        thread.id,
        "dashboard_to_connection",
        "dashboard_user",
        null,
        input.bodyMarkdown.trim(),
        "pending",
        now
      );
    });

    const messages = this.listMessages(thread.id);
    return messages[messages.length - 1];
  }

  startListen(input: StartListenInput): StartListenResponse {
    const projectId = input.projectId?.trim() || this.getSelectedProjectId();
    const connection = this.upsertConnection({
      connectionKey: input.connectionKey,
      displayName: input.displayName?.trim() || input.connectionKey.trim(),
      role: input.role || "listener",
      transport: input.transport?.trim() || "stdio",
      status: "listening",
      capabilities: {
        listenMode: true,
        ...(input.capabilities || {}),
      },
      projectIds: projectId ? [projectId] : [],
      activeProjectIds: projectId ? [projectId] : [],
    });

    const inbox = this.pullInbox({
      connectionKey: input.connectionKey,
      projectId: projectId || undefined,
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

    this.touchConnection(connection.id, "listening");

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

    return rows.map((row) => ({
      id: row.id,
      threadId: row.thread_id,
      threadTitle: row.title,
      projectId: row.project_id,
      bodyMarkdown: row.body_markdown,
      createdAt: row.created_at,
      deliveryStatus: "delivered",
    }));
  }

  postListenReply(input: PostListenReplyInput): ConversationMessageRecord {
    const connection = this.requireConnectionByKey(input.connectionKey);
    const thread = this.requireThread(input.threadId);
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
          id, thread_id, direction, author_type, author_connection_id, body_markdown, delivery_status, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        messageId,
        thread.id,
        "connection_to_dashboard",
        "connection",
        connection.id,
        input.bodyMarkdown.trim(),
        "processed",
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

    this.touchConnection(connection.id, "listening");
    return this.requireMessage(messageId);
  }

  touchConnectionHeartbeat(connectionId: string, status?: McpConnectionRecord["status"]): McpConnectionRecord {
    this.requireConnection(connectionId);
    this.touchConnection(connectionId, status);
    return this.requireConnection(connectionId);
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
      status: row.status as McpConnectionRecord["status"],
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
    }));
  }

  private mapThreadRow(row: ThreadRow): ConversationThreadRecord {
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
    };
  }

  private mapMessageRow(row: MessageRow): ConversationMessageRecord {
    return {
      id: row.id,
      threadId: row.thread_id,
      direction: row.direction as ConversationMessageRecord["direction"],
      authorType: row.author_type as ConversationMessageRecord["authorType"],
      authorConnectionId: row.author_connection_id,
      bodyMarkdown: row.body_markdown,
      deliveryStatus: row.delivery_status as ConversationMessageRecord["deliveryStatus"],
      createdAt: row.created_at,
    };
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

  private requireThread(threadId: string): ConversationThreadRecord {
    const row = this.db.prepare(`
      SELECT
        ct.*,
        (SELECT COUNT(*) FROM conversation_messages cm WHERE cm.thread_id = ct.id) AS message_count,
        (
          SELECT COUNT(*)
          FROM conversation_messages cm
          WHERE cm.thread_id = ct.id
            AND cm.direction = 'dashboard_to_connection'
            AND cm.delivery_status IN ('pending', 'delivered')
        ) AS pending_message_count,
        (SELECT cm.created_at FROM conversation_messages cm WHERE cm.thread_id = ct.id ORDER BY cm.created_at DESC LIMIT 1) AS last_message_at,
        (SELECT cm.body_markdown FROM conversation_messages cm WHERE cm.thread_id = ct.id ORDER BY cm.created_at DESC LIMIT 1) AS last_message_preview
      FROM conversation_threads ct
      WHERE ct.id = ?
    `).get(threadId) as ThreadRow | undefined;

    if (!row) {
      throw new Error(`Conversation thread not found: ${threadId}`);
    }

    return this.mapThreadRow(row);
  }

  private requireMessage(messageId: string): ConversationMessageRecord {
    const row = this.db.prepare(`
      SELECT *
      FROM conversation_messages
      WHERE id = ?
    `).get(messageId) as MessageRow | undefined;

    if (!row) {
      throw new Error(`Conversation message not found: ${messageId}`);
    }

    return this.mapMessageRow(row);
  }

  private touchConnection(connectionId: string, status?: string): void {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE mcp_connections
      SET status = COALESCE(?, status), last_heartbeat_at = ?, updated_at = ?
      WHERE id = ?
    `).run(status || null, now, now, connectionId);
  }

  private findPreferredConnectionId(projectId: string): string | null {
    const row = this.db.prepare(`
      SELECT c.id
      FROM mcp_connections c
      LEFT JOIN connection_project_bindings b ON b.connection_id = c.id
      WHERE (b.project_id = ? AND b.is_active = 1) OR c.role = 'project_manager'
      ORDER BY
        CASE c.status WHEN 'listening' THEN 0 WHEN 'connected' THEN 1 ELSE 2 END,
        COALESCE(c.last_heartbeat_at, c.updated_at) DESC
      LIMIT 1
    `).get(projectId) as { id: string } | undefined;

    return row?.id || null;
  }

  private normalizeProjectIds(projectIds?: string[]): string[] {
    const seen = new Set<string>();
    const normalized: string[] = [];
    for (const projectId of projectIds || []) {
      const trimmed = String(projectId || "").trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      this.requireProject(trimmed);
      seen.add(trimmed);
      normalized.push(trimmed);
    }
    return normalized;
  }

  private normalizeActiveProjectIds(projectIds: string[], activeProjectIds?: string[]): string[] {
    if (!activeProjectIds || activeProjectIds.length === 0) {
      return projectIds;
    }
    const activeSet = new Set(activeProjectIds.map((value) => value.trim()).filter(Boolean));
    return projectIds.filter((projectId) => activeSet.has(projectId));
  }

  private requireProject(projectId: string): void {
    const row = this.db.prepare(`
      SELECT id
      FROM projects
      WHERE id = ?
    `).get(projectId) as { id: string } | undefined;

    if (!row) {
      throw new Error(`Project not found: ${projectId}`);
    }
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
    this.db.exec("BEGIN");
    try {
      operation();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
