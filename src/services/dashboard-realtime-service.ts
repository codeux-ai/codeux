import type {
  DashboardRealtimeEvent,
  DashboardRealtimeScopeType,
  ExecutionDashboardSnapshot,
  OverviewTelemetrySnapshot,
} from "../contracts/app-types.js";
import type { ProjectCollectionResponse } from "../contracts/project-management-types.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  DashboardRealtimeEventRepository,
  type AppendDashboardRealtimeEventInput,
} from "../repositories/dashboard-realtime-event-repository.js";

export interface DashboardRealtimeSnapshotLoaders {
  getProjectsSnapshot: () => ProjectCollectionResponse;
  getProjectExecutionSnapshot: (projectId: string) => ExecutionDashboardSnapshot;
  getOverviewTelemetrySnapshot: () => OverviewTelemetrySnapshot;
}

export interface DashboardRealtimeMutationNotifier {
  scheduleProjectsRefresh: () => void;
  scheduleProjectExecutionRefresh: (projectId: string, options?: { includeOverview?: boolean }) => void;
  scheduleProjectStructureRefresh: (projectId: string, options?: { includeProjects?: boolean }) => void;
}

type DashboardRealtimeListener = (event: DashboardRealtimeEvent) => void;

const DEFAULT_FLUSH_DELAY_MS = 50;

export class DashboardRealtimeService implements DashboardRealtimeMutationNotifier {
  private readonly listeners = new Set<DashboardRealtimeListener>();
  private readonly pendingProjectIds = new Set<string>();
  private readonly pendingProjectStructureIds = new Set<string>();
  private pendingProjects = false;
  private pendingOverview = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private snapshotLoaders: DashboardRealtimeSnapshotLoaders | null = null;

  constructor(
    private readonly eventRepository: DashboardRealtimeEventRepository,
    private readonly logger: Logger,
  ) {}

  setSnapshotLoaders(loaders: DashboardRealtimeSnapshotLoaders): void {
    this.snapshotLoaders = loaders;
  }

  subscribe(listener: DashboardRealtimeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  getLatestSequence(): number | null {
    return this.eventRepository.getLatestSequence();
  }

  replay(scopes: string[], afterSequence: number, limit: number = 200): DashboardRealtimeEvent[] {
    return this.eventRepository.listEventsSince(scopes, afterSequence, limit);
  }

  scheduleProjectExecutionRefresh(
    projectId: string,
    options?: { includeOverview?: boolean; includeProjects?: boolean },
  ): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.pendingProjectIds.add(normalizedProjectId);
    if (options?.includeProjects !== false) {
      this.pendingProjects = true;
    }
    if (options?.includeOverview !== false) {
      this.pendingOverview = true;
    }
    this.scheduleFlush();
  }

  scheduleProjectStructureRefresh(projectId: string, options?: { includeProjects?: boolean }): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.pendingProjectStructureIds.add(normalizedProjectId);
    if (options?.includeProjects !== false) {
      this.pendingProjects = true;
    }
    this.scheduleFlush();
  }

  scheduleOverviewRefresh(): void {
    this.pendingOverview = true;
    this.scheduleFlush();
  }

  scheduleProjectsRefresh(): void {
    this.pendingProjects = true;
    this.scheduleFlush();
  }

  publishRawEvent(input: AppendDashboardRealtimeEventInput): DashboardRealtimeEvent {
    const event = this.eventRepository.appendEvent(input);
    this.broadcast(event);
    return event;
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushScheduledSnapshots();
    }, DEFAULT_FLUSH_DELAY_MS);
  }

  private flushScheduledSnapshots(): void {
    const loaders = this.snapshotLoaders;
    if (!loaders) {
      this.pendingProjectIds.clear();
      this.pendingProjectStructureIds.clear();
      this.pendingProjects = false;
      this.pendingOverview = false;
      return;
    }

    const projectIds = [...this.pendingProjectIds];
    const projectStructureIds = [...this.pendingProjectStructureIds];
    const shouldPublishProjects = this.pendingProjects;
    const shouldPublishOverview = this.pendingOverview;
    this.pendingProjectIds.clear();
    this.pendingProjectStructureIds.clear();
    this.pendingProjects = false;
    this.pendingOverview = false;

    if (shouldPublishProjects) {
      try {
        const projects = loaders.getProjectsSnapshot();
        this.publishRawEvent({
          scopeType: "projects",
          scopeId: "projects",
          eventType: "projects.updated",
          entityType: "project_collection",
          entityId: "projects",
          payload: projects,
        });
      } catch (error) {
        this.logger.error("Failed to publish projects realtime snapshot", {
          error,
        });
      }
    }

    for (const projectId of projectIds) {
      try {
        const snapshot = loaders.getProjectExecutionSnapshot(projectId);
        this.publishRawEvent({
          scopeType: "project",
          scopeId: projectId,
          eventType: "project.execution.updated",
          entityType: "project",
          entityId: projectId,
          projectId,
          payload: snapshot,
        });
      } catch (error) {
        this.logger.error("Failed to publish project execution realtime snapshot", {
          projectId,
          error,
        });
      }
    }

    for (const projectId of projectStructureIds) {
      try {
        this.publishRawEvent({
          scopeType: "project",
          scopeId: projectId,
          eventType: "project.structure.updated",
          entityType: "project",
          entityId: projectId,
          projectId,
          payload: {
            projectId,
            updatedAt: new Date().toISOString(),
          },
        });
      } catch (error) {
        this.logger.error("Failed to publish project structure realtime snapshot", {
          projectId,
          error,
        });
      }
    }

    if (!shouldPublishOverview) {
      return;
    }

    try {
      const telemetry = loaders.getOverviewTelemetrySnapshot();
      this.publishRawEvent({
        scopeType: "overview",
        scopeId: "overview",
        eventType: "overview.telemetry.updated",
        entityType: "overview",
        entityId: "overview",
        payload: telemetry,
      });
    } catch (error) {
      this.logger.error("Failed to publish overview telemetry realtime snapshot", {
        error,
      });
    }
  }

  private broadcast(event: DashboardRealtimeEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.logger.warn("Dashboard realtime listener failed", {
          eventType: event.eventType,
          scope: event.scope,
          error,
        });
      }
    }
  }
}

export function buildDashboardRealtimeScope(scopeType: DashboardRealtimeScopeType, scopeId: string): string {
  return scopeType === "overview" ? "overview" : `${scopeType}:${scopeId}`;
}
