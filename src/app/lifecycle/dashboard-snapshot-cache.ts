import type { BootDashboardDeps } from "./dashboard-lifecycle-service.js";
import type {
  ProjectStatsQuery,
  ExecutionConnectionSummary,
  ExecutionAssignedWorkerSummary,
  ExecutionDashboardSnapshot,
} from "../../contracts/app-types.js";
import type { McpConnectionRecord } from "../../contracts/connection-chat-types.js";
import type { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import type { ProjectAttentionRepository } from "../../repositories/project-attention-repository.js";

export function mapExecutionConnections(connections: McpConnectionRecord[]): ExecutionConnectionSummary[] {
  return connections.map((connection) => ({
    id: connection.id,
    connectionKey: connection.connectionKey,
    displayName: connection.displayName,
    role: connection.role,
    transport: connection.transport,
    status: connection.status,
    model: typeof connection.capabilities.model === "string" ? connection.capabilities.model : null,
    instruction: typeof connection.capabilities.instruction === "string" ? connection.capabilities.instruction : null,
    labels: Array.isArray(connection.capabilities.labels)
      ? connection.capabilities.labels.map((label) => String(label || "").trim()).filter(Boolean)
      : [],
    listenMode: connection.capabilities.listenMode === true,
    machineName: typeof connection.capabilities.machineName === "string" ? connection.capabilities.machineName : null,
    platform: typeof connection.capabilities.platform === "string" ? connection.capabilities.platform : null,
    arch: typeof connection.capabilities.arch === "string" ? connection.capabilities.arch : null,
    localExecutionRuntime: typeof connection.capabilities.localExecutionRuntime === "string"
      ? connection.capabilities.localExecutionRuntime
      : null,
    lastHeartbeatAt: connection.lastHeartbeatAt,
    projectIds: connection.projectIds,
    activeProjectIds: connection.activeProjectIds,
    tasksRunCount: connection.tasksRunCount,
    threadCount: connection.threadCount,
    messageCount: connection.messageCount,
    pendingInboxCount: connection.pendingInboxCount,
    activeDispatchCount: connection.activeDispatchCount,
  }));
}

export function mapAssignedWorkers(assignments: ReturnType<ProjectWorkerAssignmentRepository["listAssignmentsForProject"]>): {
  primaryAssignedWorker: ExecutionAssignedWorkerSummary | null;
  overflowAssignedWorkers: ExecutionAssignedWorkerSummary[];
} {
  const mapped = assignments.map((assignment) => ({
    assignmentId: assignment.id,
    workerEndpointId: assignment.workerEndpointId,
    workerEndpointKey: assignment.workerEndpointKey,
    workerEndpointType: assignment.workerEndpointType,
    workerDisplayName: assignment.workerDisplayName,
    connectionId: assignment.connectionId,
    connectionKey: assignment.connectionKey,
    transport: assignment.transport,
    assignmentRole: assignment.assignmentRole,
    status: assignment.status,
    assignedAt: assignment.assignedAt,
    lastAffinityAt: assignment.lastAffinityAt,
    workerStatus: assignment.workerStatus,
    canSuperviseProjects: assignment.capabilities.canSuperviseProjects,
    canExecuteTasks: assignment.capabilities.canExecuteTasks,
  }));

  return {
    primaryAssignedWorker: mapped.find((assignment) => assignment.assignmentRole === "primary") || null,
    overflowAssignedWorkers: mapped.filter((assignment) => assignment.assignmentRole === "overflow"),
  };
}

export function mapAttentionItems(attentionItems: ReturnType<ProjectAttentionRepository["listProjectAttentionItems"]>) {
  return attentionItems.map((item) => ({
    id: item.id,
    sprintId: item.sprintId,
    taskId: item.taskId,
    sprintRunId: item.sprintRunId,
    dispatchId: item.dispatchId,
    attentionType: item.attentionType,
    severity: item.severity,
    ownerType: item.ownerType,
    status: item.status,
    assignedWorkerEndpointId: item.assignedWorkerEndpointId,
    title: item.title,
    summaryMarkdown: item.summaryMarkdown,
    payload: item.payload,
    openedAt: item.openedAt,
    claimedAt: item.claimedAt,
    resolvedAt: item.resolvedAt,
    updatedAt: item.updatedAt,
  }));
}

export type DashboardSnapshotCacheDeps = Pick<BootDashboardDeps,
  | 'projectManagementRepository'
  | 'executionRepository'
  | 'connectionChatRepository'
  | 'projectWorkerAssignmentRepository'
  | 'projectAttentionRepository'
>;

export class DashboardSnapshotCache {
  private deps: DashboardSnapshotCacheDeps;

  private PROJECT_EXECUTION_CACHE_TTL_MS = 2_000;
  private PROJECT_STATS_CACHE_TTL_MS = 2_000;
  private OVERVIEW_CACHE_TTL_MS = 500;
  private PROJECTS_CACHE_TTL_MS = 500;

  private projectExecutionSnapshotCache = new Map<string, { snapshot: ExecutionDashboardSnapshot; expiresAt: number }>();
  private projectStatsSnapshotCache = new Map<string, { snapshot: ReturnType<DashboardSnapshotCacheDeps["executionRepository"]["getProjectStatsSnapshot"]>; expiresAt: number }>();
  private overviewTelemetryCache: { snapshot: ReturnType<DashboardSnapshotCacheDeps["executionRepository"]["getOverviewTelemetrySnapshot"]>; expiresAt: number } | null = null;
  private projectsSnapshotCache: { snapshot: ReturnType<DashboardSnapshotCacheDeps["projectManagementRepository"]["listProjects"]>; expiresAt: number } | null = null;

  constructor(deps: DashboardSnapshotCacheDeps) {
    this.deps = deps;
  }

  getProjectsSnapshot = () => {
    const now = Date.now();
    if (this.projectsSnapshotCache && this.projectsSnapshotCache.expiresAt > now) {
      return this.projectsSnapshotCache.snapshot;
    }
    const snapshot = this.deps.projectManagementRepository.listProjects();
    this.projectsSnapshotCache = {
      snapshot,
      expiresAt: now + this.PROJECTS_CACHE_TTL_MS,
    };
    return snapshot;
  };

  getOverviewTelemetrySnapshot = () => {
    const now = Date.now();
    if (this.overviewTelemetryCache && this.overviewTelemetryCache.expiresAt > now) {
      return this.overviewTelemetryCache.snapshot;
    }
    const snapshot = this.deps.executionRepository.getOverviewTelemetrySnapshot();
    this.overviewTelemetryCache = {
      snapshot,
      expiresAt: now + this.OVERVIEW_CACHE_TTL_MS,
    };
    return snapshot;
  };

  getProjectExecutionSnapshot = (projectId: string) => {
    const now = Date.now();
    const cached = this.projectExecutionSnapshotCache.get(projectId);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }

    const assignedWorkers = mapAssignedWorkers(
      this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true }),
    );

    const baseSnapshot = this.deps.executionRepository.getProjectExecutionSnapshot(projectId);
    const snapshot = {
      ...baseSnapshot,
      connections: mapExecutionConnections(
        this.deps.connectionChatRepository.listConnections(projectId, { activeOnly: true, limit: 100 }),
      ),
      ...assignedWorkers,
      attentionItems: mapAttentionItems(
        this.deps.projectAttentionRepository.listProjectAttentionItems(projectId, {
          statuses: ["open", "claimed"],
          limit: 50,
        }),
      ),
    };

    this.projectExecutionSnapshotCache.set(projectId, {
      snapshot,
      expiresAt: now + this.PROJECT_EXECUTION_CACHE_TTL_MS,
    });
    return snapshot;
  };

  getProjectStatsSnapshot = (projectId: string, query: ProjectStatsQuery = { window: "7d" }) => {
    const now = Date.now();
    const cacheKey = `${projectId}:${JSON.stringify(query)}`;
    const cached = this.projectStatsSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }
    const snapshot = this.deps.executionRepository.getProjectStatsSnapshot(projectId, query);
    this.projectStatsSnapshotCache.set(cacheKey, {
      snapshot,
      expiresAt: now + this.PROJECT_STATS_CACHE_TTL_MS,
    });
    return snapshot;
  };

  invalidateProjectExecution(projectId: string): void {
    this.projectExecutionSnapshotCache.delete(projectId);
  }

  invalidateProjectStats(projectId: string): void {
    const keysToDelete = Array.from(this.projectStatsSnapshotCache.keys()).filter((k) => k.startsWith(`${projectId}:`));
    for (const key of keysToDelete) {
      this.projectStatsSnapshotCache.delete(key);
    }
  }

  invalidateOverview(): void {
    this.overviewTelemetryCache = null;
  }

  invalidateProjects(): void {
    this.projectsSnapshotCache = null;
  }

  invalidateAll(): void {
    this.projectExecutionSnapshotCache.clear();
    this.projectStatsSnapshotCache.clear();
    this.overviewTelemetryCache = null;
    this.projectsSnapshotCache = null;
  }
}
