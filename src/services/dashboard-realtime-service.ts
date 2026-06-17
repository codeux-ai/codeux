import type {
  DashboardRealtimeEvent,
  DashboardRealtimeScopeType,
  DashboardStatus,
  ExecutionDashboardSnapshot,
  GitTrackingStatus,
  OverviewTelemetrySnapshot,
} from "../contracts/app-types.js";
import type { ProjectCollectionResponse } from "../contracts/project-management-types.js";
import type { Logger } from "../shared/logging/logger.js";
import {
  DashboardRealtimeEventRepository,
  type AppendDashboardRealtimeEventInput,
} from "../repositories/dashboard-realtime-event-repository.js";

type MaybePromise<T> = T | Promise<T>;

export interface DashboardSnapshotCacheInvalidator {
  invalidateProjectExecution(projectId: string): void;
  invalidateProjectStats(projectId: string): void;
  invalidateOverview(): void;
  invalidateProjects(): void;
}

export interface DashboardRealtimeSnapshotLoaders {
  getProjectsSnapshot: () => MaybePromise<ProjectCollectionResponse>;
  getProjectExecutionSnapshot: (projectId: string) => MaybePromise<ExecutionDashboardSnapshot>;
  getProjectStatusSnapshot: (projectId: string) => MaybePromise<DashboardStatus>;
  getProjectLiveSnapshot: (projectId: string) => MaybePromise<import("../contracts/app-types.js").ProjectLiveDashboardSnapshot>;
  /**
   * Git/CI/PR status for a project. Published on the dedicated, slow-cadence `project.git.updated`
   * channel (consumed only by the Live page) so the large, slow git payload never rides the hot
   * `project.live.updated` ticks. Optional so existing loader wirings/tests stay valid.
   */
  getProjectGitStatus?: (projectId: string) => MaybePromise<GitTrackingStatus | null>;
  getOverviewTelemetrySnapshot: () => MaybePromise<OverviewTelemetrySnapshot>;
}

export interface DashboardRealtimeMutationNotifier {
  scheduleProjectsRefresh: () => void;
  scheduleProjectLiveRefresh: (projectId: string) => void;
  scheduleProjectExecutionRefresh: (projectId: string, options?: { includeOverview?: boolean; includeProjects?: boolean }) => void;
  scheduleProjectRuntimeStatusRefresh: (projectId: string) => void;
  scheduleProjectStructureRefresh: (projectId: string, options?: { includeProjects?: boolean }) => void;
}

type DashboardRealtimeListener = (event: DashboardRealtimeEvent) => void;

const DEFAULT_FLUSH_DELAY_MS = 75;
// The live snapshot is the heaviest realtime payload (~480KB: full execution tree + runtime event
// feed) and is reassembled from several DB queries on each publish. The throttle below is checked
// *before* the loader runs, so it caps how often that assembly happens. A 5s floor keeps the Live
// page fresh enough while roughly halving the assemble/serialize/broadcast load versus the previous
// ~2s mutation-driven cadence.
const PROJECT_LIVE_MIN_INTERVAL_MS = 5_000;
const PROJECT_GIT_MIN_INTERVAL_MS = 5_000;
const PROJECT_EXECUTION_MIN_INTERVAL_MS = 300;
const PROJECT_RUNTIME_STATUS_MIN_INTERVAL_MS = 250;
const PROJECT_STRUCTURE_MIN_INTERVAL_MS = 250;
const PROJECTS_MIN_INTERVAL_MS = 750;
const OVERVIEW_MIN_INTERVAL_MS = 1_000;

export class DashboardRealtimeService implements DashboardRealtimeMutationNotifier {
  private readonly listeners = new Set<DashboardRealtimeListener>();
  private readonly pendingProjectLiveIds = new Set<string>();
  private readonly pendingProjectGitIds = new Set<string>();
  private readonly pendingProjectIds = new Set<string>();
  private readonly pendingProjectStatusIds = new Set<string>();
  private readonly pendingProjectStructureIds = new Set<string>();
  private readonly projectLivePublishedAt = new Map<string, number>();
  private readonly projectGitPublishedAt = new Map<string, number>();
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
  private cacheInvalidator: DashboardSnapshotCacheInvalidator | null = null;

  private executionRefreshDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  private queuedExecutionRefreshProjectIds = new Set<string>();

  constructor(
    private readonly eventRepository: DashboardRealtimeEventRepository,
    private readonly logger: Logger,
  ) {
    this.latestSequence = this.eventRepository.getLatestSequence() ?? 0;
  }

  setCacheInvalidator(invalidator: DashboardSnapshotCacheInvalidator): void {
    this.cacheInvalidator = invalidator;
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

    this.cacheInvalidator?.invalidateProjectExecution(normalizedProjectId);
    this.cacheInvalidator?.invalidateProjectStats(normalizedProjectId);

    if (options?.includeOverview !== false) {
       this.cacheInvalidator?.invalidateOverview();
    }
    if (options?.includeProjects === true) {
       this.cacheInvalidator?.invalidateProjects();
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

  /**
   * Schedules a project.live.updated publish that bypasses the steady-state throttle. Used for
   * explicit user actions — e.g. switching the selected sprint — where waiting up to
   * PROJECT_LIVE_MIN_INTERVAL_MS for the live snapshot to reflect the change feels sluggish. Clearing
   * the last-published watermark makes the throttle treat this as the first publish, so the next
   * flush (within the normal ~75ms debounce) emits immediately; normal throttling resumes after.
   */
  expediteProjectLiveRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.projectLivePublishedAt.delete(normalizedProjectId);
    this.pendingProjectLiveIds.add(normalizedProjectId);
    this.scheduleFlush();
  }

  /**
   * Schedule a publish of the project's git/CI/PR status on the dedicated `project.git.updated`
   * channel. Kept separate from the live tick so the slow, large git payload is throttled hard
   * and only reaches the Live page (which subscribes to this event), and only when it changes.
   */
  scheduleProjectGitRefresh(projectId: string): void {
    const normalizedProjectId = String(projectId || "").trim();
    if (!normalizedProjectId) {
      return;
    }

    this.pendingProjectGitIds.add(normalizedProjectId);
    this.scheduleFlush();
  }

  scheduleOverviewRefresh(): void {
    this.cacheInvalidator?.invalidateOverview();
    this.pendingOverview = true;
    this.scheduleFlush();
  }

  scheduleProjectsRefresh(): void {
    this.cacheInvalidator?.invalidateProjects();
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

  private buildPublishTask<T>(options: {
    now: number;
    lastPublishedAt: number;
    minIntervalMs: number;
    scopeType: DashboardRealtimeScopeType;
    scopeId: string;
    eventType: string;
    entityType: string;
    entityId: string;
    projectId?: string;
    loader: () => Promise<T> | T;
    cacheKey?: string;
    skipDuplicate?: boolean;
    sprintIdExtractor?: (payload: T) => string | undefined;
    logType?: "realtime_snapshot_published" | "realtime_background_refresh";
    logPayloadSize?: boolean;
    onPublished: (now: number) => void;
  }): { task: Promise<void> | null; waitMs: number } {
    const waitMs = this.getThrottleDelay(options.lastPublishedAt, options.minIntervalMs, options.now);
    if (waitMs > 0) {
      return { task: null, waitMs };
    }

    const task = (async () => {
      try {
        const payload = await Promise.resolve(options.loader());
        let sprintId: string | undefined;
        if (options.sprintIdExtractor) {
          sprintId = options.sprintIdExtractor(payload);
        }

        let payloadSizeBytes: number | undefined;

        if (options.cacheKey && options.skipDuplicate) {
          const fingerprint = this.getFingerprint(payload);
          if (this.lastPayloadFingerprints.get(options.cacheKey) === fingerprint) {
            this.logger.debug("skipping_duplicate_realtime_snapshot", {
              type: options.eventType,
              ...(options.projectId ? { projectId: options.projectId } : {}),
            });
            options.onPublished(options.now);
            return;
          }
          this.lastPayloadFingerprints.set(options.cacheKey, fingerprint);
          if (options.logPayloadSize) {
            payloadSizeBytes = Buffer.byteLength(fingerprint, "utf8");
          }
        } else if (options.logPayloadSize) {
          const fingerprint = this.getFingerprint(payload);
          payloadSizeBytes = Buffer.byteLength(fingerprint, "utf8");
        }

        this.publishRawEvent({
          scopeType: options.scopeType,
          scopeId: options.scopeId,
          eventType: options.eventType,
          entityType: options.entityType,
          entityId: options.entityId,
          ...(options.projectId ? { projectId: options.projectId } : {}),
          ...(sprintId ? { sprintId } : {}),
          payload,
          replayable: false,
        });

        if (options.logType) {
          if (options.logType === "realtime_snapshot_published") {
            this.logger.info(options.logType, {
              type: options.eventType,
              ...(payloadSizeBytes !== undefined ? { sizeBytes: payloadSizeBytes } : {}),
              ...(options.projectId ? { projectId: options.projectId } : {}),
              publishFrequencyMs: options.lastPublishedAt > 0 ? options.now - options.lastPublishedAt : 0,
            });
          } else {
            this.logger.info(options.logType, { type: options.entityId });
          }
        }

        options.onPublished(options.now);
      } catch (error) {
        this.logger.error(`Failed to publish ${options.eventType.replace(/\./g, " ")} realtime snapshot`, {
          ...(options.projectId ? { projectId: options.projectId } : {}),
          error,
        });
      }
    })();

    return { task, waitMs: 0 };
  }

  private async flushScheduledSnapshots(): Promise<void> {
    const loaders = this.snapshotLoaders;
    if (!loaders) {
      this.pendingProjectLiveIds.clear();
      this.pendingProjectGitIds.clear();
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
    const projectGitIds = [...this.pendingProjectGitIds];
    const projectIds = [...this.pendingProjectIds];
    const projectStatusIds = [...this.pendingProjectStatusIds];
    const projectStructureIds = [...this.pendingProjectStructureIds];
    const shouldPublishProjects = this.pendingProjects;
    const shouldPublishOverview = this.pendingOverview;
    this.pendingProjectLiveIds.clear();
    this.pendingProjectGitIds.clear();
    this.pendingProjectIds.clear();
    this.pendingProjectStatusIds.clear();
    this.pendingProjectStructureIds.clear();
    this.pendingProjects = false;
    this.pendingOverview = false;

    const publishTasks: Array<Promise<void>> = [];

    if (shouldPublishProjects) {
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.projectsPublishedAt,
        minIntervalMs: PROJECTS_MIN_INTERVAL_MS,
        scopeType: "projects",
        scopeId: "projects",
        eventType: "projects.updated",
        entityType: "project_collection",
        entityId: "projects",
        loader: () => loaders.getProjectsSnapshot(),
        logType: "realtime_background_refresh",
        onPublished: (publishedAt) => {
          this.projectsPublishedAt = publishedAt;
        },
      });

      if (result.waitMs > 0) {
        this.pendingProjects = true;
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
      }
    }

    for (const projectId of projectLiveIds) {
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.projectLivePublishedAt.get(projectId) ?? 0,
        minIntervalMs: PROJECT_LIVE_MIN_INTERVAL_MS,
        scopeType: "project",
        scopeId: projectId,
        eventType: "project.live.updated",
        entityType: "project_live",
        entityId: projectId,
        projectId,
        loader: () => loaders.getProjectLiveSnapshot(projectId),
        cacheKey: `project:${projectId}:project.live.updated`,
        skipDuplicate: true,
        sprintIdExtractor: (payload: any) => payload.selectedSprintId,
        logType: "realtime_snapshot_published",
        logPayloadSize: true,
        onPublished: (publishedAt) => {
          this.projectLivePublishedAt.set(projectId, publishedAt);
        },
      });

      if (result.waitMs > 0) {
        this.pendingProjectLiveIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
      }
    }

    for (const projectId of projectGitIds) {
      const loadGit = loaders.getProjectGitStatus;
      if (!loadGit) {
        break;
      }
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.projectGitPublishedAt.get(projectId) ?? 0,
        minIntervalMs: PROJECT_GIT_MIN_INTERVAL_MS,
        scopeType: "project",
        scopeId: projectId,
        eventType: "project.git.updated",
        entityType: "project_git",
        entityId: projectId,
        projectId,
        loader: () => loadGit(projectId),
        cacheKey: `project:${projectId}:project.git.updated`,
        skipDuplicate: true,
        onPublished: (publishedAt) => {
          this.projectGitPublishedAt.set(projectId, publishedAt);
        },
      });

      if (result.waitMs > 0) {
        this.pendingProjectGitIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
      }
    }

    for (const projectId of projectIds) {
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.projectExecutionPublishedAt.get(projectId) ?? 0,
        minIntervalMs: PROJECT_EXECUTION_MIN_INTERVAL_MS,
        scopeType: "project",
        scopeId: projectId,
        eventType: "project.execution.updated",
        entityType: "project",
        entityId: projectId,
        projectId,
        loader: () => loaders.getProjectExecutionSnapshot(projectId),
        cacheKey: `project:${projectId}:project.execution.updated`,
        skipDuplicate: true,
        onPublished: (publishedAt) => {
          this.projectExecutionPublishedAt.set(projectId, publishedAt);
        },
      });

      if (result.waitMs > 0) {
        this.pendingProjectIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
      }
    }

    for (const projectId of projectStatusIds) {
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.projectRuntimeStatusPublishedAt.get(projectId) ?? 0,
        minIntervalMs: PROJECT_RUNTIME_STATUS_MIN_INTERVAL_MS,
        scopeType: "project",
        scopeId: projectId,
        eventType: "project.runtime_status.updated",
        entityType: "project_status",
        entityId: projectId,
        projectId,
        loader: () => loaders.getProjectStatusSnapshot(projectId),
        onPublished: (publishedAt) => {
          this.projectRuntimeStatusPublishedAt.set(projectId, publishedAt);
        },
      });

      if (result.waitMs > 0) {
        this.pendingProjectStatusIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
      }
    }

    for (const projectId of projectStructureIds) {
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.projectStructurePublishedAt.get(projectId) ?? 0,
        minIntervalMs: PROJECT_STRUCTURE_MIN_INTERVAL_MS,
        scopeType: "project",
        scopeId: projectId,
        eventType: "project.structure.updated",
        entityType: "project",
        entityId: projectId,
        projectId,
        loader: () => ({
          projectId,
          updatedAt: new Date().toISOString(),
        }),
        onPublished: (publishedAt) => {
          this.projectStructurePublishedAt.set(projectId, publishedAt);
        },
      });

      if (result.waitMs > 0) {
        this.pendingProjectStructureIds.add(projectId);
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
      }
    }

    if (shouldPublishOverview) {
      const result = this.buildPublishTask({
        now,
        lastPublishedAt: this.overviewPublishedAt,
        minIntervalMs: OVERVIEW_MIN_INTERVAL_MS,
        scopeType: "overview",
        scopeId: "overview",
        eventType: "overview.telemetry.updated",
        entityType: "overview",
        entityId: "overview",
        loader: () => loaders.getOverviewTelemetrySnapshot(),
        cacheKey: `overview:overview:overview.telemetry.updated`,
        skipDuplicate: true,
        logType: "realtime_background_refresh",
        onPublished: (publishedAt) => {
          this.overviewPublishedAt = publishedAt;
        },
      });

      if (result.waitMs > 0) {
        this.pendingOverview = true;
        nextDelayMs = this.getNextDelay(nextDelayMs, result.waitMs);
      } else if (result.task) {
        publishTasks.push(result.task);
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
