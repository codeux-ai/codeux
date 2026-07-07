import type { BootDashboardDeps } from "./dashboard-lifecycle-service.js";
import type {
  HeaderTokenThroughputQuery,
  ProjectStatsQuery,
  ExecutionConnectionSummary,
  ExecutionAssignedWorkerSummary,
  ExecutionDashboardSnapshot,
} from "../../contracts/app-types.js";
import type { McpConnectionRecord } from "../../contracts/connection-chat-types.js";
import type { ProjectWorkerAssignmentRepository } from "../../repositories/project-worker-assignment-repository.js";
import type { ProjectAttentionRepository } from "../../repositories/project-attention-repository.js";
import type { ProjectExecutionSnapshotOptions } from "../../repositories/execution/project-execution-snapshot-query.js";
import { DashboardSnapshotCachePolicy, type ProjectExecutionSnapshotCacheKey } from "./dashboard-snapshot-cache-policy.js";

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

  private projectExecutionSnapshotCache = new Map<ProjectExecutionSnapshotCacheKey, { snapshot: ExecutionDashboardSnapshot; expiresAt: number }>();
  private projectExecutionSnapshotKeysByProject = new Map<string, Set<ProjectExecutionSnapshotCacheKey>>();
  // Memoizes the feed-less view with the same explicit project/sprint scope as
  // the full snapshot cache. The source snapshot guard prevents stale lean views
  // from surviving a full snapshot rebuild after TTL expiry.
  private leanExecutionSnapshotCache = new Map<ProjectExecutionSnapshotCacheKey, {
    sourceSnapshot: ExecutionDashboardSnapshot;
    snapshot: ExecutionDashboardSnapshot;
    expiresAt: number;
  }>();
  private leanExecutionSnapshotKeysByProject = new Map<string, Set<ProjectExecutionSnapshotCacheKey>>();
  private projectStatsSnapshotCache = new Map<string, { snapshot: ReturnType<DashboardSnapshotCacheDeps["executionRepository"]["getProjectStatsSnapshot"]>; expiresAt: number }>();
  private projectStatsSnapshotKeysByProject = new Map<string, Set<string>>();
  private headerTokenThroughputSnapshotCache = new Map<string, { snapshot: ReturnType<DashboardSnapshotCacheDeps["executionRepository"]["getHeaderTokenThroughputSnapshot"]>; expiresAt: number }>();
  private headerTokenThroughputSnapshotKeysByProject = new Map<string, Set<string>>();
  private overviewTelemetryCache: { snapshot: ReturnType<DashboardSnapshotCacheDeps["executionRepository"]["getOverviewTelemetrySnapshot"]>; expiresAt: number } | null = null;
  private projectsSnapshotCache: { snapshot: ReturnType<DashboardSnapshotCacheDeps["projectManagementRepository"]["listProjects"]>; expiresAt: number } | null = null;

  constructor(deps: DashboardSnapshotCacheDeps) {
    this.deps = deps;
  }

  private registerProjectCacheKey<Key extends string>(
    index: Map<string, Set<Key>>,
    projectId: string,
    cacheKey: Key,
  ): void {
    const keys = index.get(projectId);
    if (keys) {
      keys.add(cacheKey);
      return;
    }
    index.set(projectId, new Set([cacheKey]));
  }

  private unregisterProjectCacheKey<Key extends string>(
    index: Map<string, Set<Key>>,
    projectId: string,
    cacheKey: Key,
  ): void {
    const keys = index.get(projectId);
    if (!keys) {
      return;
    }
    keys.delete(cacheKey);
    if (keys.size === 0) {
      index.delete(projectId);
    }
  }

  getProjectsSnapshot = () => {
    const now = Date.now();
    if (this.projectsSnapshotCache && this.projectsSnapshotCache.expiresAt > now) {
      return this.projectsSnapshotCache.snapshot;
    }
    const snapshot = this.deps.projectManagementRepository.listProjects();
    this.projectsSnapshotCache = {
      snapshot,
      expiresAt: now + DashboardSnapshotCachePolicy.PROJECTS_CACHE_TTL_MS,
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
      expiresAt: now + DashboardSnapshotCachePolicy.OVERVIEW_CACHE_TTL_MS,
    };
    return snapshot;
  };

  getProjectExecutionSnapshot = (projectId: string, options: ProjectExecutionSnapshotOptions = {}) => {
    const now = Date.now();
    const cacheKey = DashboardSnapshotCachePolicy.getProjectExecutionSnapshotCacheKey(projectId, options);
    const cached = this.projectExecutionSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }

    const assignedWorkers = mapAssignedWorkers(
      this.deps.projectWorkerAssignmentRepository.listAssignmentsForProject(projectId, { activeOnly: true }),
    );

    const baseSnapshot = this.deps.executionRepository.getProjectExecutionSnapshot(projectId, options);
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

    this.projectExecutionSnapshotCache.set(cacheKey, {
      snapshot,
      expiresAt: now + DashboardSnapshotCachePolicy.PROJECT_EXECUTION_CACHE_TTL_MS,
    });
    this.registerProjectCacheKey(this.projectExecutionSnapshotKeysByProject, projectId, cacheKey);
    this.leanExecutionSnapshotCache.delete(cacheKey);
    this.unregisterProjectCacheKey(this.leanExecutionSnapshotKeysByProject, projectId, cacheKey);
    return snapshot;
  };

  /**
   * Execution snapshot without the activity feed (`recentEvents` /
   * `recentInvocations`). The feed is only rendered by the Live and Tasks pages
   * (which receive it via the live payload); shipping it on the execution channel
   * to every other page bloats each push to ~0.5MB and makes the snapshot change
   * — and re-broadcast — several times per second on active sprints. This view
   * keeps the execution channel lean and, because the feed is what churns most,
   * lets the realtime publisher de-duplicate the vast majority of pushes.
   */
  getProjectExecutionSnapshotLean = (
    projectId: string,
    options: ProjectExecutionSnapshotOptions = {},
  ): ExecutionDashboardSnapshot => {
    const now = Date.now();
    const cacheKey = DashboardSnapshotCachePolicy.getProjectExecutionSnapshotCacheKey(projectId, options);
    const full = this.getProjectExecutionSnapshot(projectId, options);
    if (full.recentEvents.length === 0 && (full.recentInvocations?.length ?? 0) === 0) {
      return full;
    }
    const cached = this.leanExecutionSnapshotCache.get(cacheKey);
    if (cached && cached.sourceSnapshot === full && cached.expiresAt > now) {
      return cached.snapshot;
    }
    const lean: ExecutionDashboardSnapshot = { ...full, recentEvents: [], recentInvocations: [] };
    this.leanExecutionSnapshotCache.set(cacheKey, {
      sourceSnapshot: full,
      snapshot: lean,
      expiresAt: now + DashboardSnapshotCachePolicy.PROJECT_EXECUTION_CACHE_TTL_MS,
    });
    this.registerProjectCacheKey(this.leanExecutionSnapshotKeysByProject, projectId, cacheKey);
    return lean;
  };

  getProjectStatsSnapshot = (projectId: string, query: ProjectStatsQuery = { window: "7d" }) => {
    const now = Date.now();
    const cacheKey = DashboardSnapshotCachePolicy.getProjectStatsCacheKey(projectId, query);
    const cached = this.projectStatsSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }
    const snapshot = this.deps.executionRepository.getProjectStatsSnapshot(projectId, query);
    this.projectStatsSnapshotCache.set(cacheKey, {
      snapshot,
      expiresAt: now + DashboardSnapshotCachePolicy.PROJECT_STATS_CACHE_TTL_MS,
    });
    this.registerProjectCacheKey(this.projectStatsSnapshotKeysByProject, projectId, cacheKey);
    return snapshot;
  };

  getHeaderTokenThroughputSnapshot = (query: HeaderTokenThroughputQuery = { window: "24h" }) => {
    const now = Date.now();
    const cacheKey = DashboardSnapshotCachePolicy.getHeaderTokenThroughputCacheKey(query);
    const cached = this.headerTokenThroughputSnapshotCache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.snapshot;
    }
    const snapshot = this.deps.executionRepository.getHeaderTokenThroughputSnapshot(query);
    this.headerTokenThroughputSnapshotCache.set(cacheKey, {
      snapshot,
      expiresAt: now + DashboardSnapshotCachePolicy.HEADER_TOKEN_THROUGHPUT_CACHE_TTL_MS,
    });
    if (query.projectId) {
      this.registerProjectCacheKey(this.headerTokenThroughputSnapshotKeysByProject, query.projectId, cacheKey);
    }
    return snapshot;
  };

  invalidateProjectExecution(projectId: string): void {
    const executionKeys = this.projectExecutionSnapshotKeysByProject.get(projectId);
    if (executionKeys) {
      for (const key of executionKeys) {
        this.projectExecutionSnapshotCache.delete(key);
      }
      this.projectExecutionSnapshotKeysByProject.delete(projectId);
    }

    const leanKeys = this.leanExecutionSnapshotKeysByProject.get(projectId);
    if (leanKeys) {
      for (const key of leanKeys) {
        this.leanExecutionSnapshotCache.delete(key);
      }
      this.leanExecutionSnapshotKeysByProject.delete(projectId);
    }
  }

  invalidateProjectStats(projectId: string): void {
    const statsKeys = this.projectStatsSnapshotKeysByProject.get(projectId);
    if (statsKeys) {
      for (const key of statsKeys) {
        this.projectStatsSnapshotCache.delete(key);
      }
      this.projectStatsSnapshotKeysByProject.delete(projectId);
    }

    for (const key of this.headerTokenThroughputSnapshotCache.keys()) {
      if (DashboardSnapshotCachePolicy.isHeaderTokenThroughputCacheKeyMatch(key, projectId)) {
        this.headerTokenThroughputSnapshotCache.delete(key);
      }
    }
    this.headerTokenThroughputSnapshotKeysByProject.delete(projectId);
  }

  invalidateOverview(): void {
    this.overviewTelemetryCache = null;
  }

  invalidateProjects(): void {
    this.projectsSnapshotCache = null;
  }

  invalidateAll(): void {
    this.projectExecutionSnapshotCache.clear();
    this.projectExecutionSnapshotKeysByProject.clear();
    this.leanExecutionSnapshotCache.clear();
    this.leanExecutionSnapshotKeysByProject.clear();
    this.projectStatsSnapshotCache.clear();
    this.projectStatsSnapshotKeysByProject.clear();
    this.headerTokenThroughputSnapshotCache.clear();
    this.headerTokenThroughputSnapshotKeysByProject.clear();
    this.overviewTelemetryCache = null;
    this.projectsSnapshotCache = null;
  }
}
