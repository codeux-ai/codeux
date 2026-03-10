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
  UpdateConversationThreadInput,
  UpdateMcpConnectionInput,
  UpsertMcpConnectionInput,
} from "../contracts/connection-chat-types.js";
import type { DashboardRealtimeService } from "../services/dashboard-realtime-service.js";

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
const HEARTBEAT_WRITE_INTERVAL_MS = 15 * 1000;
const STALE_CONNECTION_THRESHOLD_MS = 10 * 60 * 1000;
const OFFLINE_CONNECTION_THRESHOLD_MS = 30 * 60 * 1000;
const PRUNE_CONNECTION_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

export interface ConnectionLifecycleCleanupResult {
  staleConnectionIds: string[];
  offlineConnectionIds: string[];
  prunedConnectionIds: string[];
}

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

  constructor(
    storage: AppDbStorage = new AppDbStorage(),
    private readonly realtimeService?: DashboardRealtimeService,
  ) {
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
        ,
        (
          SELECT COUNT(*)
          FROM task_dispatches td
          WHERE td.connection_id = c.id
            AND td.status IN ('claimed', 'running', 'cancel_requested')
        ) AS active_dispatch_count
      FROM mcp_connections c
      WHERE EXISTS (
        SELECT 1
        FROM connection_project_bindings b
        WHERE b.connection_id = c.id
          AND b.project_id = ?
      )
      ORDER BY COALESCE(c.last_heartbeat_at, c.updated_at) DESC, c.display_name ASC
    `).all(projectId, projectId, projectId, projectId, projectId) as unknown as ConnectionRow[];

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
        const insertBinding = this.db.prepare(`
          INSERT INTO connection_project_bindings (connection_id, project_id, is_active, created_at)
          VALUES (?, ?, ?, ?)
        `);
        for (const projectId of normalizedProjectIds) {
          insertBinding.run(connectionId, projectId, Number(activeProjectIds.includes(projectId)), now);
        }
      }
    });

    const connection = this.requireConnection(connectionId);
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
    this.notifyProjects([...connection.projectIds, ...connection.activeProjectIds]);
    return connection;
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
    const connectionId = input.connectionId ?? null;
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

    const thread = this.requireThread(threadId);
    this.notifyProjects([thread.projectId]);
    this.publishThreadUpdatedEvent(thread);
    return thread;
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

  updateThread(threadId: string, input: UpdateConversationThreadInput): ConversationThreadRecord {
    const thread = this.requireThread(threadId);
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
        SET connection_id = ?, updated_at = ?
        WHERE id = ?
      `).run(normalizedConnectionId || null, now, thread.id);

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

    const updated = this.requireThread(threadId);
    this.notifyProjects([updated.projectId]);
    this.publishThreadUpdatedEvent(updated);
    return updated;
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

    const preferredConnectionId = thread.connectionId || input.connectionId || null;
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
    this.notifyProjects([projectId]);
    const created = messages[messages.length - 1];
    if (created) {
      this.publishThreadUpdatedEvent(this.requireThread(thread.id));
      this.publishMessageCreatedEvent(projectId, thread.id, created);
    }
    return created;
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
      createdAt: row.created_at,
      deliveryStatus: "delivered" as const,
    }));
    this.notifyProjects(scopedProjectIds);
    for (const row of rows) {
      this.publishThreadUpdatedEvent(this.requireThread(row.thread_id));
    }
    return inbox;
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

    this.touchConnection(connection, "listening");
    const message = this.requireMessage(messageId);
    this.notifyProjects([thread.projectId]);
    this.publishThreadUpdatedEvent(this.requireThread(thread.id));
    this.publishMessageCreatedEvent(thread.projectId, thread.id, message);
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
    this.notifyProjects([
      ...this.resolveProjectIdsForConnections(result.staleConnectionIds),
      ...this.resolveProjectIdsForConnections(result.offlineConnectionIds),
      ...prunedProjectIds,
    ]);
    return result;
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
    if (!lastHeartbeatAt) {
      return storedStatus;
    }

    const ageMs = Date.now() - new Date(lastHeartbeatAt).getTime();
    if (Number.isFinite(ageMs)) {
      if (ageMs >= OFFLINE_CONNECTION_THRESHOLD_MS) {
        return "offline";
      }
      if (ageMs >= STALE_CONNECTION_THRESHOLD_MS) {
        return "stale";
      }
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
    return true;
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
