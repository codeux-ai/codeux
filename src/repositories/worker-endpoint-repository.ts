import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
import { deriveWorkerEndpointStatus } from "./connection-lifecycle.js";
import type { McpConnectionRecord } from "../contracts/connection-chat-types.js";
import type { WorkerEndpointCapabilities, WorkerEndpointRecord, WorkerEndpointStatus } from "../contracts/worker-types.js";

interface WorkerEndpointRow {
  id: string;
  endpoint_key: string;
  endpoint_type: string;
  display_name: string;
  status: string;
  connection_id: string | null;
  connection_key: string | null;
  transport: string | null;
  capabilities_json: string | null;
  last_heartbeat_at: string | null;
  created_at: string;
  updated_at: string;
}

const DEFAULT_WORKER_ENDPOINT_CAPABILITIES: WorkerEndpointCapabilities = {
  canSuperviseProjects: true,
  canExecuteTasks: true,
};

function parseCapabilities(value: string | null): WorkerEndpointCapabilities {
  if (!value) {
    return { ...DEFAULT_WORKER_ENDPOINT_CAPABILITIES };
  }

  try {
    const parsed = JSON.parse(value) as Partial<WorkerEndpointCapabilities> | null;
    return {
      canSuperviseProjects: parsed?.canSuperviseProjects ?? DEFAULT_WORKER_ENDPOINT_CAPABILITIES.canSuperviseProjects,
      canExecuteTasks: parsed?.canExecuteTasks ?? DEFAULT_WORKER_ENDPOINT_CAPABILITIES.canExecuteTasks,
    };
  } catch {
    return { ...DEFAULT_WORKER_ENDPOINT_CAPABILITIES };
  }
}

export class WorkerEndpointRepository {
  private readonly db: DatabaseSync;

  constructor(storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  listWorkerEndpoints(): WorkerEndpointRecord[] {
    const rows = this.db.prepare(`
      SELECT *
      FROM worker_endpoints
      ORDER BY display_name ASC, created_at ASC
    `).all() as unknown as WorkerEndpointRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getWorkerEndpoint(endpointId: string): WorkerEndpointRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM worker_endpoints
      WHERE id = ?
    `).get(endpointId) as WorkerEndpointRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  getWorkerEndpointByConnectionId(connectionId: string): WorkerEndpointRecord | null {
    const row = this.db.prepare(`
      SELECT *
      FROM worker_endpoints
      WHERE connection_id = ?
    `).get(connectionId) as WorkerEndpointRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  upsertMcpConnectionEndpoint(connection: McpConnectionRecord): WorkerEndpointRecord | null {
    if (connection.role !== "worker") {
      this.deleteByConnectionId(connection.id);
      return null;
    }

    const existing = this.getWorkerEndpointByConnectionId(connection.id);
    const now = new Date().toISOString();
    const id = existing?.id || randomUUID();

    this.db.prepare(`
      INSERT INTO worker_endpoints (
        id,
        endpoint_key,
        endpoint_type,
        display_name,
        status,
        connection_id,
        connection_key,
        transport,
        capabilities_json,
        last_heartbeat_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(connection_id) DO UPDATE SET
        endpoint_key = excluded.endpoint_key,
        endpoint_type = excluded.endpoint_type,
        display_name = excluded.display_name,
        status = excluded.status,
        connection_key = excluded.connection_key,
        transport = excluded.transport,
        capabilities_json = excluded.capabilities_json,
        last_heartbeat_at = excluded.last_heartbeat_at,
        updated_at = excluded.updated_at
    `).run(
      id,
      this.toEndpointKey(connection.id),
      "mcp_connection",
      connection.displayName,
      this.mapConnectionStatus(connection.status),
      connection.id,
      connection.connectionKey,
      connection.transport,
      JSON.stringify(this.extractCapabilities(connection)),
      connection.lastHeartbeatAt,
      existing?.createdAt || now,
      now,
    );

    return this.getWorkerEndpointByConnectionId(connection.id);
  }

  deleteByConnectionId(connectionId: string): void {
    this.db.prepare(`
      DELETE FROM worker_endpoints
      WHERE connection_id = ?
    `).run(connectionId);
  }

  private mapRow(row: WorkerEndpointRow): WorkerEndpointRecord {
    return {
      id: row.id,
      endpointKey: row.endpoint_key,
      endpointType: row.endpoint_type as WorkerEndpointRecord["endpointType"],
      displayName: row.display_name,
      status: deriveWorkerEndpointStatus(row.status as WorkerEndpointRecord["status"], row.last_heartbeat_at),
      connectionId: row.connection_id,
      connectionKey: row.connection_key,
      transport: row.transport,
      capabilities: parseCapabilities(row.capabilities_json),
      lastHeartbeatAt: row.last_heartbeat_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private toEndpointKey(connectionId: string): string {
    return `mcp:${connectionId}`;
  }

  private mapConnectionStatus(status: McpConnectionRecord["status"]): WorkerEndpointStatus {
    switch (status) {
      case "listening":
      case "connected":
        return "connected";
      case "idle":
      case "paused":
      case "stale":
      case "offline":
        return status;
      default:
        return "configured";
    }
  }

  private extractCapabilities(connection: McpConnectionRecord): WorkerEndpointCapabilities {
    return {
      canSuperviseProjects: connection.capabilities.workerCanSuperviseProjects === false
        ? false
        : DEFAULT_WORKER_ENDPOINT_CAPABILITIES.canSuperviseProjects,
      canExecuteTasks: connection.capabilities.workerCanExecuteTasks === false
        ? false
        : DEFAULT_WORKER_ENDPOINT_CAPABILITIES.canExecuteTasks,
    };
  }
}
