import type {
  DashboardRealtimeEvent,
  DashboardRealtimeScopeType,
  DashboardStatus,
  ExecutionDashboardSnapshot,
  OverviewTelemetrySnapshot,
} from "../contracts/app-types.js";
import type { ProjectCollectionResponse } from "../contracts/project-management-types.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  DashboardRealtimeEventRepository,
  type AppendDashboardRealtimeEventInput,
} from "../repositories/dashboard-realtime-event-repository.js";

type MaybePromise<T> = T | Promise<T>;

export interface DashboardRealtimeSnapshotLoaders {
  getProjectsSnapshot: () => MaybePromise<ProjectCollectionResponse>;
  getProjectExecutionSnapshot: (projectId: string) => MaybePromise<ExecutionDashboardSnapshot>;
  getProjectStatusSnapshot: (projectId: string) => MaybePromise<DashboardStatus>;
  getProjectLiveSnapshot: (projectId: string) => MaybePromise<import("../contracts/app-types.js").ProjectLiveDashboardSnapshot>;
  getOverviewTelemetrySnapshot: () => MaybePromise<OverviewTelemetrySnapshot>;
}

export interface DashboardRealtimeMutationNotifier {
  scheduleProjectsRefresh: () => void;
  scheduleProjectLiveRefresh: (projectId: string) => void;
  scheduleProjectExecutionRefresh: (projectId: string, options?: { includeOverview?: boolean; includeProjects?: boolean }) => void;
  scheduleProjectRuntimeStatusRefresh: (projectId: string) => void;
  scheduleProjectStructureRefresh: (projectId: string, options?: { includeProjects?: boolean }) => void;
  notifyMemoriesCreated: (projectId: string) => void;
}

type DashboardRealtimeListener = (event: DashboardRealtimeEvent) => void;

const DEFAULT_FLUSH_DELAY_MS = 75;
const PROJECT_LIVE_MIN_INTERVAL_MS = 100;
const PROJECT_EXECUTION_MIN_INTERVAL_MS = 300;
const PROJECT_RUNTIME_STATUS_MIN_INTERVAL_MS = 250;
const PROJECT_STRUCTURE_MIN_INTERVAL_MS = 250;
const PROJECTS_MIN_INTERVAL_MS = 750;
const OVERVIEW_MIN_INTERVAL_MS = 1_000;

export class DashboardRealtimeService implements DashboardRealtimeMutationNotifier {
  private readonly listeners = new Set<DashboardRealtimeListener>();
  private readonly pendingProjectLiveIds = new Set<string>();
  private readonly pendingProjectIds = new Set<string>();
  private readonly pendingProjectStatusIds = new Set<string>();
  private readonly pendingProjectStructureIds = new Set<string>();
  private readonly projectLivePublishedAt = new Map<string, number>();
  private readonly projectExecutionPublishedAt = new Map<string, number>();
  private readonly projectRuntimeStatusPublishedAt = new Map<string, number>();
  private readonly projectStructurePublishedAt = new Map<string, number>();
  private readonly lastPayloadFingerprints = new Map<string, string>();
  private pendingProjects = false;
  private pendingOverview = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushDueAt: number | null = null;
  private latestSequence: number;
  private projectsPublishedAt = 0;
  private overviewPublishedAt = 0;
  private snapshotLoaders: DashboardRealtimeSnapshotLoaders | null = null;

  private executionRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedExecutionRefreshProjectIds = new Set<string>();

  constructor(
    private readonly eventRepository: DashboardRealtimeEventRepository,
    private readonly logger: Logger,
  ) {
    this.latestSequence = this.eventRepository.getLatestSequence() ?? 0;
  }

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
    return this.latestSequence > 0 ? this.latestSequence : null;
  }

  getLatestSequenceForScopes(scopes: string[]): number | null {
    return this.eventRepository.getLatestSequenceForScopes(scopes);
  }

  hasNonReplayableEventsSince(scopes: string[], afterSequence: number): boolean {
    return this.eventRepository.hasNonReplayableEventsSince(scopes, afterSequence);
  }

  replay(scopes: string[], afterSequence: number, limit: number = 200): DashboardRealtimeEvent[] {
    return this.eventRepository.listEventsSince(scopes, afterSequence, limit);
  }

  private scheduleExecutionRefreshDebouncer(): void {
    if (this.executionRefreshDebounceTimer) {
      return;
    }

    this.executionRefreshDebounceTimer = setTimeout(() => {
      this.executionRefreshDebounceTimer = null;
      const projectIds = Array.from(this.queuedExecutionRefreshProjectIds);
      this.queuedExecutionRefreshProjectIds.clear();

      if (projectIds.length > 0) {
        this.publishRawEvent({
          scopeType: "projects",
          scopeId: "projects",
          eventType: "execution_refresh",
          entityType: "project_collection",
          entityId: "projects",
          payload: { projectIds },
          replayable: false,
        });
      }
    }, 10);
  }

  scheduleProjectExecutionRefresh(
    projectId: string,
    options?: { includeOverview?: boolean; includeProjects?: boolean },
  ): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.pendingProjectLiveIds.add(normalizedProjectId);
    this.pendingProjectIds.add(normalizedProjectId);
    if (options?.includeProjects === true) {
      this.pendingProjects = true;
    }
    if (options?.includeOverview !== false) {
      this.pendingOverview = true;
    }
    this.scheduleFlush();

    this.queuedExecutionRefreshProjectIds.add(normalizedProjectId);
    this.scheduleExecutionRefreshDebouncer();
  }

  scheduleProjectRuntimeStatusRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.pendingProjectLiveIds.add(normalizedProjectId);
    this.pendingProjectStatusIds.add(normalizedProjectId);
    this.scheduleFlush();
  }

  scheduleProjectStructureRefresh(projectId: string, options?: { includeProjects?: boolean }): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.pendingProjectLiveIds.add(normalizedProjectId);
    this.pendingProjectStructureIds.add(normalizedProjectId);
    if (options?.includeProjects !== false) {
      this.pendingProjects = true;
    }
    this.scheduleFlush();
  }

  scheduleProjectLiveRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.pendingProjectLiveIds.add(normalizedProjectId);
    this.scheduleFlush();
  }

  scheduleOverviewRefresh(): void {
    this.pendingOverview = true;
    this.scheduleFlush();
  }

  notifyMemoriesCreated(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) return;

    this.publishRawEvent({
      scopeType: "project",
      scopeId: normalizedProjectId,
      eventType: "memories_created",
      entityType: "memory_batch",
      entityId: normalizedProjectId,
      projectId: normalizedProjectId,
    });
  }

  scheduleProjectsRefresh(): void {
    this.pendingProjects = true;
    this.scheduleFlush();

    this.queuedExecutionRefreshProjectIds.add("projects");
    this.scheduleExecutionRefreshDebouncer();
  }

  publishRawEvent(input: AppendDashboardRealtimeEventInput): DashboardRealtimeEvent {
    const event = this.eventRepository.appendEvent(input);
    this.latestSequence = Math.max(this.latestSequence, event.sequence);
    this.broadcast(event);
    return event;
  }

  private scheduleFlush(delayMs: number = DEFAULT_FLUSH_DELAY_MS): void {
    const dueAt = Date.now() + Math.max(0, delayMs);
    if (this.flushTimer && this.flushDueAt !== null && this.flushDueAt <= dueAt) {
      return;
    }

    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
    }

    this.flushDueAt = dueAt;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushDueAt = null;
      void this.flushScheduledSnapshots();
    }, Math.max(0, dueAt - Date.now()));
  }

  private async flushScheduledSnapshots(): Promise<void> {
    const loaders = this.snapshotLoaders;
    if (!loaders) {
      this.pendingProjectLiveIds.clear();
      this.pendingProjectIds.clear();
      this.pendingProjectStatusIds.clear();
      this.pendingProjectStructureIds.clear();
      this.pendingProjects = false;
      this.pendingOverview = false;
      return;
    }

    const now = Date.now();
    let nextDelayMs: number | null = null;
    const projectLiveIds = [...this.pendingProjectLiveIds];
    const projectIds = [...this.pendingProjectIds];
    const projectStatusIds = [...this.pendingProjectStatusIds];
    const projectStructureIds = [...this.pendingProjectStructureIds];
    const shouldPublishProjects = this.pendingProjects;
    const shouldPublishOverview = this.pendingOverview;
    this.pendingProjectLiveIds.clear();
    this.pendingProjectIds.clear();
    this.pendingProjectStatusIds.clear();
    this.pendingProjectStructureIds.clear();
    this.pendingProjects = false;
    this.pendingOverview = false;

    const publishTasks: Array<Promise<void>> = [];

    if (shouldPublishProjects) {
      const waitMs = this.getThrottleDelay(this.projectsPublishedAt, PROJECTS_MIN_INTERVAL_MS, now);
      if (waitMs > 0) {
        this.pendingProjects = true;
        nextDelayMs = this.getNextDelay(nextDelayMs, waitMs);
      } else {
        publishTasks.push(
          (async () => {
            try {
              const projects = await Promise.resolve(loaders.getProjectsSnapshot());
              this.publishRawEvent({
                scopeType: "projects",
                scopeId: "projects",
                eventType: "projects.updated",
                entityType: "project_collection",
                entityId: "projects",
                payload: projects,
                replayable: false,
              });
              this.logger.info("realtime_background_refresh", { type: "projects" });
              this.projectsPublishedAt = now;
            } catch (error) {
              this.logger.error("Failed to publish projects realtime snapshot", {
                error,
              });
            }
          })()
        );
      }
    }

    for (const projectId of projectLiveIds) {
      const lastPublishedAt = this.projectLivePublishedAt.get(projectId) ?? 0;
      const waitMs = this.getThrottleDelay(lastPublishedAt, PROJECT_LIVE_MIN_INTERVAL_MS, now);
      if (waitMs > 0) {
        this.pendingProjectLiveIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, waitMs);
        continue;
      }

      publishTasks.push(
        (async () => {
          try {
            const snapshot = await Promise.resolve(loaders.getProjectLiveSnapshot(projectId));
            const fingerprint = this.getFingerprint(snapshot);
            const cacheKey = `project:${projectId}:project.live.updated`;

            if (this.lastPayloadFingerprints.get(cacheKey) === fingerprint) {
              this.logger.debug("skipping_duplicate_realtime_snapshot", {
                type: "project.live.updated",
                projectId,
              });
              this.projectLivePublishedAt.set(projectId, now);
              return;
            }

            const payloadSizeBytes = Buffer.byteLength(JSON.stringify(snapshot), "utf8");
            this.publishRawEvent({
              scopeType: "project",
              scopeId: projectId,
              eventType: "project.live.updated",
              entityType: "project_live",
              entityId: projectId,
              projectId,
              sprintId: snapshot.selectedSprintId,
              payload: snapshot,
              replayable: false,
            });
            this.lastPayloadFingerprints.set(cacheKey, fingerprint);

            this.logger.info("realtime_snapshot_published", {
              type: "project.live.updated",
              sizeBytes: payloadSizeBytes,
              projectId,
              publishFrequencyMs: lastPublishedAt > 0 ? now - lastPublishedAt : 0,
            });
            this.projectLivePublishedAt.set(projectId, now);
          } catch (error) {
            this.logger.error("Failed to publish project live realtime snapshot", {
              projectId,
              error,
            });
          }
        })()
      );
    }

    for (const projectId of projectIds) {
      const lastPublishedAt = this.projectExecutionPublishedAt.get(projectId) ?? 0;
      const waitMs = this.getThrottleDelay(lastPublishedAt, PROJECT_EXECUTION_MIN_INTERVAL_MS, now);
      if (waitMs > 0) {
        this.pendingProjectIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, waitMs);
        continue;
      }

      publishTasks.push(
        (async () => {
          try {
            const snapshot = await Promise.resolve(loaders.getProjectExecutionSnapshot(projectId));
            const fingerprint = this.getFingerprint(snapshot);
            const cacheKey = `project:${projectId}:project.execution.updated`;

            if (this.lastPayloadFingerprints.get(cacheKey) === fingerprint) {
              this.logger.debug("skipping_duplicate_realtime_snapshot", {
                type: "project.execution.updated",
                projectId,
              });
              this.projectExecutionPublishedAt.set(projectId, now);
              return;
            }

            this.publishRawEvent({
              scopeType: "project",
              scopeId: projectId,
              eventType: "project.execution.updated",
              entityType: "project",
              entityId: projectId,
              projectId,
              payload: snapshot,
              replayable: false,
            });
            this.lastPayloadFingerprints.set(cacheKey, fingerprint);
            this.projectExecutionPublishedAt.set(projectId, now);
          } catch (error) {
            this.logger.error("Failed to publish project execution realtime snapshot", {
              projectId,
              error,
            });
          }
        })()
      );
    }

    for (const projectId of projectStatusIds) {
      const lastPublishedAt = this.projectRuntimeStatusPublishedAt.get(projectId) ?? 0;
      const waitMs = this.getThrottleDelay(lastPublishedAt, PROJECT_RUNTIME_STATUS_MIN_INTERVAL_MS, now);
      if (waitMs > 0) {
        this.pendingProjectStatusIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, waitMs);
        continue;
      }

      publishTasks.push(
        (async () => {
          try {
            const snapshot = await Promise.resolve(loaders.getProjectStatusSnapshot(projectId));
            this.publishRawEvent({
              scopeType: "project",
              scopeId: projectId,
              eventType: "project.runtime_status.updated",
              entityType: "project_status",
              entityId: projectId,
              projectId,
              payload: snapshot,
              replayable: false,
            });
            this.projectRuntimeStatusPublishedAt.set(projectId, now);
          } catch (error) {
            this.logger.error("Failed to publish project runtime status realtime snapshot", {
              projectId,
              error,
            });
          }
        })()
      );
    }

    for (const projectId of projectStructureIds) {
      const lastPublishedAt = this.projectStructurePublishedAt.get(projectId) ?? 0;
      const waitMs = this.getThrottleDelay(lastPublishedAt, PROJECT_STRUCTURE_MIN_INTERVAL_MS, now);
      if (waitMs > 0) {
        this.pendingProjectStructureIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, waitMs);
        continue;
      }

      publishTasks.push(
        (async () => {
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
              replayable: false,
            });
            this.projectStructurePublishedAt.set(projectId, now);
          } catch (error) {
            this.logger.error("Failed to publish project structure realtime snapshot", {
              projectId,
              error,
            });
          }
        })()
      );
    }

    if (shouldPublishOverview) {
      const waitMs = this.getThrottleDelay(this.overviewPublishedAt, OVERVIEW_MIN_INTERVAL_MS, now);
      if (waitMs > 0) {
        this.pendingOverview = true;
        nextDelayMs = this.getNextDelay(nextDelayMs, waitMs);
      } else {
        publishTasks.push(
          (async () => {
            try {
              const telemetry = await Promise.resolve(loaders.getOverviewTelemetrySnapshot());
              const fingerprint = this.getFingerprint(telemetry);
              const cacheKey = `overview:overview:overview.telemetry.updated`;

              if (this.lastPayloadFingerprints.get(cacheKey) === fingerprint) {
                this.logger.debug("skipping_duplicate_realtime_snapshot", {
                  type: "overview.telemetry.updated",
                });
                this.overviewPublishedAt = now;
                return;
              }

              this.publishRawEvent({
                scopeType: "overview",
                scopeId: "overview",
                eventType: "overview.telemetry.updated",
                entityType: "overview",
                entityId: "overview",
                payload: telemetry,
                replayable: false,
              });
              this.lastPayloadFingerprints.set(cacheKey, fingerprint);
              this.logger.info("realtime_background_refresh", { type: "overview" });
              this.overviewPublishedAt = now;
            } catch (error) {
              this.logger.error("Failed to publish overview telemetry realtime snapshot", {
                error,
              });
            }
          })()
        );
      }
    }

    await Promise.allSettled(publishTasks);

    if (nextDelayMs !== null) {
      this.scheduleFlush(nextDelayMs);
    }
  }

  private getThrottleDelay(lastPublishedAt: number, minIntervalMs: number, now: number): number {
    if (lastPublishedAt <= 0) {
      return 0;
    }
    return Math.max(0, minIntervalMs - (now - lastPublishedAt));
  }

  private getNextDelay(currentDelayMs: number | null, candidateDelayMs: number): number {
    if (currentDelayMs === null) {
      return candidateDelayMs;
    }
    return Math.min(currentDelayMs, candidateDelayMs);
  }

  private getFingerprint(payload: unknown): string {
    return JSON.stringify(payload, (key, value) => {
      if (key === "updatedAt" || key === "timestamp") {
        return undefined;
      }
      return value;
    });
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
