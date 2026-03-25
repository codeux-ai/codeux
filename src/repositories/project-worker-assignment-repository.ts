import { randomUUID } from "crypto";
import type { DatabaseSync } from "node:sqlite";
import { AppDbStorage } from "./app-db-storage.js";
import { deriveWorkerEndpointStatus } from "./connection-lifecycle.js";
import type {
  ProjectWorkerAssignmentRecord,
  ProjectWorkerAssignmentRole,
  WorkerEndpointCapabilities,
  WorkerEndpointRecord,
  WorkerEndpointStatus,
  WorkerEndpointType,
} from "../contracts/worker-types.js";

interface ProjectWorkerAssignmentRow {
  id: string;
  project_id: string;
  worker_endpoint_id: string | null;
  worker_endpoint_key: string;
  worker_endpoint_type: string;
  worker_display_name: string;
  connection_id: string | null;
  connection_key: string | null;
  worker_transport: string | null;
  assignment_role: string;
  status: string;
  assigned_at: string;
  released_at: string | null;
  release_reason: string | null;
  last_affinity_at: string;
  created_at: string;
  updated_at: string;
  worker_status: string | null;
  worker_last_heartbeat_at: string | null;
  capabilities_json: string | null;
}

const DEFAULT_CAPABILITIES: WorkerEndpointCapabilities = {
  canSuperviseProjects: true,
  canExecuteTasks: true,
};

function parseCapabilities(value: string | null): WorkerEndpointCapabilities {
  if (!value) {
    return { ...DEFAULT_CAPABILITIES };
  }

  try {
    const parsed = JSON.parse(value) as Partial<WorkerEndpointCapabilities> | null;
    return {
      canSuperviseProjects: parsed?.canSuperviseProjects ?? DEFAULT_CAPABILITIES.canSuperviseProjects,
      canExecuteTasks: parsed?.canExecuteTasks ?? DEFAULT_CAPABILITIES.canExecuteTasks,
    };
  } catch {
    return { ...DEFAULT_CAPABILITIES };
  }
}

export class ProjectWorkerAssignmentRepository {
  private readonly db: DatabaseSync;

  constructor(private readonly storage: AppDbStorage = new AppDbStorage()) {
    this.db = storage.getDatabase();
  }

  listAssignmentsForProject(projectId: string, options?: { activeOnly?: boolean }): ProjectWorkerAssignmentRecord[] {
    const rows = this.db.prepare(`
      SELECT
        a.*,
        we.status AS worker_status,
        we.last_heartbeat_at AS worker_last_heartbeat_at,
        we.capabilities_json
      FROM project_worker_assignments a
      LEFT JOIN worker_endpoints we ON we.id = a.worker_endpoint_id
      WHERE a.project_id = ?
        ${options?.activeOnly ? "AND a.status = 'active'" : ""}
      ORDER BY
        CASE a.assignment_role WHEN 'primary' THEN 0 ELSE 1 END ASC,
        a.last_affinity_at DESC,
        a.assigned_at ASC
    `).all(projectId) as unknown as ProjectWorkerAssignmentRow[];

    return rows.map((row) => this.mapRow(row));
  }

  listAssignmentsForProjects(projectIds: string[], options?: { activeOnly?: boolean }): Map<string, ProjectWorkerAssignmentRecord[]> {
    if (projectIds.length === 0) {
      return new Map();
    }

    const map = new Map<string, ProjectWorkerAssignmentRecord[]>();
    for (const projectId of projectIds) {
      map.set(projectId, []);
    }

    const rows = this.storage.executeChunkedInQuery<ProjectWorkerAssignmentRow>({
      sqlPrefix: `
        SELECT
          a.*,
          we.status AS worker_status,
          we.last_heartbeat_at AS worker_last_heartbeat_at,
          we.capabilities_json
        FROM project_worker_assignments a
        LEFT JOIN worker_endpoints we ON we.id = a.worker_endpoint_id
        WHERE a.project_id
      `,
      sqlSuffix: `
        ${options?.activeOnly ? "AND a.status = 'active'" : ""}
        ORDER BY
          CASE a.assignment_role WHEN 'primary' THEN 0 ELSE 1 END ASC,
          a.last_affinity_at DESC,
          a.assigned_at ASC
      `,
      items: projectIds,
    });

    for (const row of rows) {
      const records = map.get(row.project_id);
      if (records) {
        records.push(this.mapRow(row));
      }
    }

    return map;
  }

  listActiveAssignmentsForWorker(workerEndpointId: string): ProjectWorkerAssignmentRecord[] {
    const rows = this.db.prepare(`
      SELECT
        a.*,
        we.status AS worker_status,
        we.last_heartbeat_at AS worker_last_heartbeat_at,
        we.capabilities_json
      FROM project_worker_assignments a
      LEFT JOIN worker_endpoints we ON we.id = a.worker_endpoint_id
      WHERE a.worker_endpoint_id = ?
        AND a.status = 'active'
      ORDER BY
        CASE a.assignment_role WHEN 'primary' THEN 0 ELSE 1 END ASC,
        a.last_affinity_at DESC,
        a.assigned_at ASC
    `).all(workerEndpointId) as unknown as ProjectWorkerAssignmentRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getActiveAssignment(projectId: string, workerEndpointId: string): ProjectWorkerAssignmentRecord | null {
    const row = this.db.prepare(`
      SELECT
        a.*,
        we.status AS worker_status,
        we.last_heartbeat_at AS worker_last_heartbeat_at,
        we.capabilities_json
      FROM project_worker_assignments a
      LEFT JOIN worker_endpoints we ON we.id = a.worker_endpoint_id
      WHERE a.project_id = ?
        AND a.worker_endpoint_id = ?
        AND a.status = 'active'
      LIMIT 1
    `).get(projectId, workerEndpointId) as ProjectWorkerAssignmentRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  createAssignment(projectId: string, workerEndpoint: WorkerEndpointRecord, assignmentRole: ProjectWorkerAssignmentRole): ProjectWorkerAssignmentRecord {
    const id = randomUUID();
    const now = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO project_worker_assignments (
        id,
        project_id,
        worker_endpoint_id,
        worker_endpoint_key,
        worker_endpoint_type,
        worker_display_name,
        connection_id,
        connection_key,
        worker_transport,
        assignment_role,
        status,
        assigned_at,
        released_at,
        release_reason,
        last_affinity_at,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL, NULL, ?, ?, ?)
    `).run(
      id,
      projectId,
      workerEndpoint.id,
      workerEndpoint.endpointKey,
      workerEndpoint.endpointType,
      workerEndpoint.displayName,
      workerEndpoint.connectionId,
      workerEndpoint.connectionKey,
      workerEndpoint.transport,
      assignmentRole,
      now,
      now,
      now,
      now,
    );

    return this.requireAssignment(id);
  }

  touchAssignment(assignmentId: string, updates?: { assignmentRole?: ProjectWorkerAssignmentRole }): ProjectWorkerAssignmentRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE project_worker_assignments
      SET assignment_role = COALESCE(?, assignment_role),
          last_affinity_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(updates?.assignmentRole ?? null, now, now, assignmentId);

    return this.requireAssignment(assignmentId);
  }

  releaseAssignment(assignmentId: string, releaseReason?: string): ProjectWorkerAssignmentRecord {
    const now = new Date().toISOString();
    this.db.prepare(`
      UPDATE project_worker_assignments
      SET status = 'released',
          released_at = ?,
          release_reason = ?,
          updated_at = ?
      WHERE id = ?
        AND status = 'active'
    `).run(now, releaseReason ?? null, now, assignmentId);

    return this.requireAssignment(assignmentId);
  }

  private requireAssignment(assignmentId: string): ProjectWorkerAssignmentRecord {
    const row = this.db.prepare(`
      SELECT
        a.*,
        we.status AS worker_status,
        we.last_heartbeat_at AS worker_last_heartbeat_at,
        we.capabilities_json
      FROM project_worker_assignments a
      LEFT JOIN worker_endpoints we ON we.id = a.worker_endpoint_id
      WHERE a.id = ?
    `).get(assignmentId) as ProjectWorkerAssignmentRow | undefined;

    if (!row) {
      throw new Error(`Project worker assignment not found: ${assignmentId}`);
    }

    return this.mapRow(row);
  }

  private mapRow(row: ProjectWorkerAssignmentRow): ProjectWorkerAssignmentRecord {
    return {
      id: row.id,
      projectId: row.project_id,
      workerEndpointId: row.worker_endpoint_id,
      workerEndpointKey: row.worker_endpoint_key,
      workerEndpointType: row.worker_endpoint_type as WorkerEndpointType,
      workerDisplayName: row.worker_display_name,
      connectionId: row.connection_id,
      connectionKey: row.connection_key,
      transport: row.worker_transport,
      assignmentRole: row.assignment_role as ProjectWorkerAssignmentRole,
      status: row.status as ProjectWorkerAssignmentRecord["status"],
      assignedAt: row.assigned_at,
      releasedAt: row.released_at,
      releaseReason: row.release_reason,
      lastAffinityAt: row.last_affinity_at,
      workerStatus: row.worker_status
        ? deriveWorkerEndpointStatus(row.worker_status as WorkerEndpointStatus, row.worker_last_heartbeat_at)
        : null,
      capabilities: parseCapabilities(row.capabilities_json),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
