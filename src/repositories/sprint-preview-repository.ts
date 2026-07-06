import { randomUUID } from "crypto";
import type {
  SprintPreviewHealthStatus,
  SprintPreviewPortMapping,
  SprintPreviewSession,
  SprintPreviewSessionStatus,
  SprintPreviewStartupMode,
} from "../contracts/app-types.js";
import { AppDbStorage } from "./app-db-storage.js";
import { toNumber } from "./repository-utils.js";

interface SprintPreviewSessionRow {
  id: string;
  project_id: string;
  sprint_id: string;
  project_name: string;
  sprint_name: string;
  sprint_number: number | string | null;
  status: string;
  host_port: number | string | null;
  container_app_port: number | string;
  port_mappings_json: string | null;
  container_id: string | null;
  container_name: string | null;
  worktree_path: string | null;
  feature_branch: string | null;
  startup_script_path: string;
  startup_mode: string;
  install_command: string | null;
  build_command: string | null;
  run_command: string | null;
  last_completed_task_count: number | string;
  last_seen_sprint_status: string | null;
  last_known_path: string | null;
  health_status: string;
  last_error: string | null;
  last_build_at: string | null;
  last_started_at: string | null;
  last_stopped_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSprintPreviewSessionInput {
  projectId: string;
  sprintId: string;
  status: SprintPreviewSessionStatus;
  containerAppPort: number;
  hostPort?: number | null;
  portMappings?: SprintPreviewPortMapping[];
  startupScriptPath: string;
  startupMode: SprintPreviewStartupMode;
  installCommand?: string | null;
  buildCommand?: string | null;
  runCommand?: string | null;
  lastCompletedTaskCount?: number;
  lastSeenSprintStatus?: string | null;
  lastKnownPath?: string | null;
}

export interface UpdateSprintPreviewSessionInput {
  status?: SprintPreviewSessionStatus;
  hostPort?: number | null;
  containerAppPort?: number;
  portMappings?: SprintPreviewPortMapping[];
  containerId?: string | null;
  containerName?: string | null;
  worktreePath?: string | null;
  featureBranch?: string | null;
  startupScriptPath?: string;
  startupMode?: SprintPreviewStartupMode;
  installCommand?: string | null;
  buildCommand?: string | null;
  runCommand?: string | null;
  lastCompletedTaskCount?: number;
  lastSeenSprintStatus?: string | null;
  lastKnownPath?: string | null;
  healthStatus?: SprintPreviewHealthStatus;
  lastError?: string | null;
  lastBuildAt?: string | null;
  lastStartedAt?: string | null;
  lastStoppedAt?: string | null;
}

export class SprintPreviewRepository {
  constructor(private readonly storage: AppDbStorage) {}

  listSessions(projectId?: string): SprintPreviewSession[] {
    const rows = (projectId
      ? this.storage.getDatabase().prepare(`
          SELECT
            sps.*,
            p.name AS project_name,
            sp.name AS sprint_name,
            sp.number AS sprint_number
          FROM sprint_preview_sessions sps
          INNER JOIN projects p ON p.id = sps.project_id
          INNER JOIN sprints sp ON sp.id = sps.sprint_id
          WHERE sps.project_id = ?
          ORDER BY sp.updated_at DESC, sps.updated_at DESC
        `).all(projectId)
      : this.storage.getDatabase().prepare(`
          SELECT
            sps.*,
            p.name AS project_name,
            sp.name AS sprint_name,
            sp.number AS sprint_number
          FROM sprint_preview_sessions sps
          INNER JOIN projects p ON p.id = sps.project_id
          INNER JOIN sprints sp ON sp.id = sps.sprint_id
          ORDER BY p.name ASC, sp.updated_at DESC, sps.updated_at DESC
        `).all()) as unknown as SprintPreviewSessionRow[];

    return rows.map((row) => this.mapRow(row));
  }

  getSession(id: string): SprintPreviewSession | null {
    const row = this.storage.getDatabase().prepare(`
      SELECT
        sps.*,
        p.name AS project_name,
        sp.name AS sprint_name,
        sp.number AS sprint_number
      FROM sprint_preview_sessions sps
      INNER JOIN projects p ON p.id = sps.project_id
      INNER JOIN sprints sp ON sp.id = sps.sprint_id
      WHERE sps.id = ?
      LIMIT 1
    `).get(id) as SprintPreviewSessionRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  getSessionForProjectSprint(projectId: string, sprintId: string, id: string): SprintPreviewSession | null {
    const row = this.storage.getDatabase().prepare(`
      SELECT
        sps.*,
        p.name AS project_name,
        sp.name AS sprint_name,
        sp.number AS sprint_number
      FROM sprint_preview_sessions sps
      INNER JOIN projects p ON p.id = sps.project_id
      INNER JOIN sprints sp ON sp.id = sps.sprint_id
      WHERE sps.project_id = ? AND sps.sprint_id = ? AND sps.id = ?
      LIMIT 1
    `).get(projectId, sprintId, id) as SprintPreviewSessionRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  getSessionByProjectSprint(projectId: string, sprintId: string): SprintPreviewSession | null {
    const row = this.storage.getDatabase().prepare(`
      SELECT
        sps.*,
        p.name AS project_name,
        sp.name AS sprint_name,
        sp.number AS sprint_number
      FROM sprint_preview_sessions sps
      INNER JOIN projects p ON p.id = sps.project_id
      INNER JOIN sprints sp ON sp.id = sps.sprint_id
      WHERE sps.project_id = ? AND sps.sprint_id = ?
      LIMIT 1
    `).get(projectId, sprintId) as SprintPreviewSessionRow | undefined;

    return row ? this.mapRow(row) : null;
  }

  createSession(input: CreateSprintPreviewSessionInput): SprintPreviewSession {
    const now = new Date().toISOString();
    const id = randomUUID();
    const portMappings = normalizePortMappings(
      input.portMappings,
      input.containerAppPort,
      input.hostPort ?? null,
    );
    const primaryMapping = getPrimaryPortMapping(portMappings);
    this.storage.getDatabase().prepare(`
      INSERT INTO sprint_preview_sessions (
        id, project_id, sprint_id, status, host_port, container_app_port, port_mappings_json,
        container_id, container_name, worktree_path, feature_branch,
        startup_script_path, startup_mode, install_command, build_command, run_command,
        last_completed_task_count, last_seen_sprint_status, last_known_path, health_status,
        last_error, last_build_at, last_started_at, last_stopped_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'unknown', NULL, NULL, NULL, NULL, ?, ?)
    `).run(
      id,
      input.projectId,
      input.sprintId,
      input.status,
      primaryMapping.hostPort,
      primaryMapping.containerPort,
      JSON.stringify(portMappings),
      input.startupScriptPath,
      input.startupMode,
      input.installCommand || null,
      input.buildCommand || null,
      input.runCommand || null,
      input.lastCompletedTaskCount || 0,
      input.lastSeenSprintStatus || null,
      input.lastKnownPath || "/",
      now,
      now,
    );

    const created = this.getSession(id);
    if (!created) {
      throw new Error(`Failed to load created sprint preview session ${id}`);
    }
    return created;
  }

  updateSession(id: string, patch: UpdateSprintPreviewSessionInput): SprintPreviewSession {
    const current = this.getSession(id);
    if (!current) {
      throw new Error(`Sprint preview session not found: ${id}`);
    }
    const now = new Date().toISOString();
    const hasPortMappingsPatch = Object.prototype.hasOwnProperty.call(patch, "portMappings");
    const portMappings = hasPortMappingsPatch
      ? normalizePortMappings(
          patch.portMappings,
          patch.containerAppPort ?? current.containerAppPort,
          patch.hostPort === undefined ? current.hostPort : patch.hostPort,
        )
      : updatePrimaryPortMapping(
          current.portMappings,
          patch.containerAppPort ?? current.containerAppPort,
          patch.hostPort === undefined ? current.hostPort : patch.hostPort,
        );
    const primaryMapping = getPrimaryPortMapping(portMappings);

    this.storage.getDatabase().prepare(`
      UPDATE sprint_preview_sessions
      SET status = ?,
          host_port = ?,
          container_app_port = ?,
          port_mappings_json = ?,
          container_id = ?,
          container_name = ?,
          worktree_path = ?,
          feature_branch = ?,
          startup_script_path = ?,
          startup_mode = ?,
          install_command = ?,
          build_command = ?,
          run_command = ?,
          last_completed_task_count = ?,
          last_seen_sprint_status = ?,
          last_known_path = ?,
          health_status = ?,
          last_error = ?,
          last_build_at = ?,
          last_started_at = ?,
          last_stopped_at = ?,
          updated_at = ?
      WHERE id = ?
    `).run(
      patch.status ?? current.status,
      primaryMapping.hostPort,
      primaryMapping.containerPort,
      JSON.stringify(portMappings),
      patch.containerId === undefined ? current.containerId : patch.containerId,
      patch.containerName === undefined ? current.containerName : patch.containerName,
      patch.worktreePath === undefined ? current.worktreePath : patch.worktreePath,
      patch.featureBranch === undefined ? current.featureBranch : patch.featureBranch,
      patch.startupScriptPath ?? current.startupScriptPath,
      patch.startupMode ?? current.startupMode,
      patch.installCommand === undefined ? current.installCommand : patch.installCommand,
      patch.buildCommand === undefined ? current.buildCommand : patch.buildCommand,
      patch.runCommand === undefined ? current.runCommand : patch.runCommand,
      patch.lastCompletedTaskCount ?? current.lastCompletedTaskCount,
      patch.lastSeenSprintStatus === undefined ? current.lastSeenSprintStatus : patch.lastSeenSprintStatus,
      patch.lastKnownPath === undefined ? current.lastKnownPath : patch.lastKnownPath,
      patch.healthStatus ?? current.healthStatus,
      patch.lastError === undefined ? current.lastError : patch.lastError,
      patch.lastBuildAt === undefined ? current.lastBuildAt : patch.lastBuildAt,
      patch.lastStartedAt === undefined ? current.lastStartedAt : patch.lastStartedAt,
      patch.lastStoppedAt === undefined ? current.lastStoppedAt : patch.lastStoppedAt,
      now,
      id,
    );

    const updated = this.getSession(id);
    if (!updated) {
      throw new Error(`Failed to load updated sprint preview session ${id}`);
    }
    return updated;
  }

  deleteSession(id: string): void {
    this.storage.getDatabase().prepare(`
      DELETE FROM sprint_preview_sessions
      WHERE id = ?
    `).run(id);
  }

  private mapRow(row: SprintPreviewSessionRow): SprintPreviewSession {
    const portMappings = parsePortMappingsJson(
      row.port_mappings_json,
      toNumber(row.container_app_port) || 3000,
      toNumber(row.host_port) || null,
    );
    const primaryMapping = getPrimaryPortMapping(portMappings);
    return {
      id: row.id,
      projectId: row.project_id,
      sprintId: row.sprint_id,
      projectName: row.project_name,
      sprintName: row.sprint_name,
      sprintNumber: toNumber(row.sprint_number) || null,
      status: row.status as SprintPreviewSessionStatus,
      hostPort: primaryMapping.hostPort,
      containerAppPort: primaryMapping.containerPort,
      portMappings,
      containerId: row.container_id,
      containerName: row.container_name,
      worktreePath: row.worktree_path,
      featureBranch: row.feature_branch,
      startupScriptPath: row.startup_script_path,
      startupMode: row.startup_mode as SprintPreviewStartupMode,
      installCommand: row.install_command,
      buildCommand: row.build_command,
      runCommand: row.run_command,
      lastCompletedTaskCount: toNumber(row.last_completed_task_count) || 0,
      lastSeenSprintStatus: row.last_seen_sprint_status,
      lastKnownPath: row.last_known_path,
      healthStatus: row.health_status as SprintPreviewHealthStatus,
      lastError: row.last_error,
      lastBuildAt: row.last_build_at,
      lastStartedAt: row.last_started_at,
      lastStoppedAt: row.last_stopped_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}

function isValidPort(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535;
}

function normalizePortMappings(
  mappings: SprintPreviewPortMapping[] | undefined,
  fallbackContainerPort: number,
  fallbackHostPort: number | null,
): SprintPreviewPortMapping[] {
  const validMappings = Array.isArray(mappings)
    ? mappings.filter((mapping) => isValidPort(mapping.containerPort) && (mapping.hostPort === null || isValidPort(mapping.hostPort)))
    : [];

  if (validMappings.length === 0) {
    return [{
      containerPort: isValidPort(fallbackContainerPort) ? fallbackContainerPort : 3000,
      hostPort: fallbackHostPort === null || isValidPort(fallbackHostPort) ? fallbackHostPort : null,
      isPrimary: true,
    }];
  }

  const primaryIndex = Math.max(0, validMappings.findIndex((mapping) => mapping.isPrimary === true));
  return validMappings.map((mapping, index) => {
    const label = typeof mapping.label === "string" && mapping.label.trim().length > 0
      ? mapping.label.trim()
      : undefined;
    return {
      containerPort: mapping.containerPort,
      hostPort: mapping.hostPort,
      ...(label ? { label } : {}),
      ...(index === primaryIndex ? { isPrimary: true } : {}),
    };
  });
}

function updatePrimaryPortMapping(
  mappings: SprintPreviewPortMapping[],
  containerPort: number,
  hostPort: number | null,
): SprintPreviewPortMapping[] {
  const normalized = normalizePortMappings(mappings, containerPort, hostPort);
  const primaryIndex = normalized.findIndex((mapping) => mapping.isPrimary === true);
  const targetIndex = primaryIndex >= 0 ? primaryIndex : 0;
  return normalized.map((mapping, index) => (
    index === targetIndex
      ? {
          ...mapping,
          containerPort: isValidPort(containerPort) ? containerPort : mapping.containerPort,
          hostPort: hostPort === null || isValidPort(hostPort) ? hostPort : null,
          isPrimary: true,
        }
      : mapping
  ));
}

function parsePortMappingsJson(value: string | null, fallbackContainerPort: number, fallbackHostPort: number | null): SprintPreviewPortMapping[] {
  if (typeof value !== "string" || value.trim().length === 0) {
    return normalizePortMappings(undefined, fallbackContainerPort, fallbackHostPort);
  }
  try {
    const parsed = JSON.parse(value) as unknown;
    return normalizePortMappings(
      Array.isArray(parsed) ? parsed as SprintPreviewPortMapping[] : undefined,
      fallbackContainerPort,
      fallbackHostPort,
    );
  } catch {
    return normalizePortMappings(undefined, fallbackContainerPort, fallbackHostPort);
  }
}

function getPrimaryPortMapping(mappings: SprintPreviewPortMapping[]): SprintPreviewPortMapping {
  return mappings.find((mapping) => mapping.isPrimary === true) ?? mappings[0] ?? {
    containerPort: 3000,
    hostPort: null,
    isPrimary: true,
  };
}
